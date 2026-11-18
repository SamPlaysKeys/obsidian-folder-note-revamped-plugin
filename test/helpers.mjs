// Loads the plugin's source (compiled by `npm run build:test` into .test-build/) against a
// minimal stub of the `obsidian` module and a fake vault, so logic can be tested in Node.
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export class TAbstractFile {
	constructor(path) {
		this.path = path;
		this.name = path.split('/').pop();
	}
}
export class TFile extends TAbstractFile {
	constructor(path, mtime = 0) {
		super(path);
		const dot = this.name.lastIndexOf('.');
		this.extension = dot > 0 ? this.name.substring(dot + 1) : '';
		this.stat = { mtime };
	}
}
export class TFolder extends TAbstractFile {
	constructor(path) {
		super(path);
		this.children = [];
	}
}

const stubs = { TAbstractFile, TFile, TFolder, Plugin: class {}, PluginSettingTab: class {} };
const obsidianStub = new Proxy(stubs, {
	get: (target, prop) => {
		if (prop === '__esModule') return false;
		if (!(prop in target)) target[prop] = class {};
		return target[prop];
	},
});

const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
	return request === 'obsidian' ? obsidianStub : originalLoad.call(this, request, ...rest);
};

// Obsidian adds String.prototype.contains; the plugin still uses it
if (!String.prototype.contains) {
	// eslint-disable-next-line no-extend-native
	String.prototype.contains = function (s) { return this.includes(s); };
}

export const load = (name) => require(resolve(root, '.test-build', name));

// Fake app with a vault built from { 'path/to/file.md': 'content' }; folders are created
// implicitly, extra empty ones can be listed in `folders`.
export function makeApp(files = {}, folders = []) {
	const byPath = new Map();
	const rootFolder = new TFolder('/');
	byPath.set('/', rootFolder);
	const contents = new Map();
	const ensureFolder = (path) => {
		if (byPath.has(path)) return byPath.get(path);
		const folder = new TFolder(path);
		byPath.set(path, folder);
		const parentPath = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '/';
		ensureFolder(parentPath).children.push(folder);
		return folder;
	};
	for (const folder of folders) ensureFolder(folder);
	for (const [path, content] of Object.entries(files)) {
		const file = new TFile(path);
		byPath.set(path, file);
		contents.set(path, content);
		const parentPath = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '/';
		ensureFolder(parentPath).children.push(file);
	}
	const parentOf = (path) => (path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '/');
	const handlers = { rename: [] };
	const pending = [];

	// Moves a file or folder and its descendants. Like Obsidian, it then fires one `rename`
	// event for the item itself and one for each descendant (with the descendant's old path),
	// without awaiting the handlers. Event order is an assumption, not verified in the app.
	const move = (file, newPath) => {
		if (byPath.has(newPath)) throw new Error('Destination file already exists!');
		if (!byPath.has(parentOf(newPath))) throw new Error('Destination folder does not exist');
		const moved = [];
		const collect = (item) => {
			moved.push(item);
			if (item instanceof TFolder) item.children.forEach(collect);
		};
		collect(file);
		const oldPaths = moved.map((item) => item.path);
		const oldPrefix = file.path;
		const oldParent = byPath.get(parentOf(oldPrefix));
		oldParent.children.splice(oldParent.children.indexOf(file), 1);
		for (const item of moved) {
			const oldPath = item.path;
			byPath.delete(oldPath);
			item.path = newPath + oldPath.substring(oldPrefix.length);
			item.name = item.path.split('/').pop();
			if (item instanceof TFile) {
				const dot = item.name.lastIndexOf('.');
				item.extension = dot > 0 ? item.name.substring(dot + 1) : '';
				if (contents.has(oldPath)) {
					contents.set(item.path, contents.get(oldPath));
					contents.delete(oldPath);
				}
			}
			byPath.set(item.path, item);
		}
		byPath.get(parentOf(newPath)).children.push(file);
		moved.forEach((item, i) => {
			for (const handler of handlers.rename) pending.push(Promise.resolve(handler(item, oldPaths[i])));
		});
	};

	// Timers are captured instead of run, so tests decide when the plugin's delayed work happens
	const timers = new Map();
	let timerId = 0;
	globalThis.window = {
		setTimeout: (fn) => { timers.set(++timerId, fn); return timerId; },
		clearTimeout: (id) => { timers.delete(id); },
	};

	return {
		vault: {
			getRoot: () => rootFolder,
			getAbstractFileByPath: (path) => byPath.get(path) ?? null,
			cachedRead: async (file) => contents.get(file.path),
			on: (name, handler) => { handlers[name].push(handler); },
			adapter: {
				exists: async (path) => byPath.has(path),
				rename: async (oldPath, newPath) => {
					const file = byPath.get(oldPath);
					if (!file) throw new Error('ENOENT: ' + oldPath);
					move(file, newPath);
				},
			},
		},
		fileManager: { renameFile: async (file, newPath) => move(file, newPath) },
		// vault paths of everything that exists, for assertions
		paths: () => [...byPath.keys()].filter((path) => path !== '/').sort(),
		// runs the captured timers and waits for all rename handlers, until nothing is left
		settle: async () => {
			for (let i = 0; i < 10; i++) {
				while (pending.length) await pending.shift();
				const due = [...timers.values()];
				timers.clear();
				due.forEach((fn) => fn());
				await new Promise((resolve) => setImmediate(resolve));
				if (!pending.length && !timers.size) return;
			}
			throw new Error('settle: still busy after 10 rounds');
		},
		pendingTimers: () => timers.size,
	};
}

// Sends the vault's rename events to the plugin, like main.ts does
export function wireRenames(app, folderNote) {
	app.vault.on('rename', (file, oldPath) => folderNote.syncName(file, oldPath));
}

export function makeFolderNote(app, method = 'inside', indexBase = '_about_') {
	const { FolderNote } = load('folder-note.js');
	return new FolderNote(app, method, indexBase);
}
