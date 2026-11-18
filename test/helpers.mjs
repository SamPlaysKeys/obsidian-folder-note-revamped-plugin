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
	return {
		vault: {
			getRoot: () => rootFolder,
			getAbstractFileByPath: (path) => byPath.get(path) ?? null,
			cachedRead: async (file) => contents.get(file.path),
			adapter: { exists: async (path) => byPath.has(path) },
		},
	};
}

export function makeFolderNote(app, method = 'inside', indexBase = '_about_') {
	const { FolderNote } = load('folder-note.js');
	return new FolderNote(app, method, indexBase);
}
