import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, makeFolderNote, wireRenames } from './helpers.mjs';

// The fake vault fires rename events like Obsidian: one for the renamed item, then one per
// descendant, with the descendant's old path, without awaiting the handlers.

function setup(files, method = 'inside', folders = []) {
	const app = makeApp(files, folders);
	const folderNote = makeFolderNote(app, method);
	wireRenames(app, folderNote);
	return { app, folderNote };
}

const rename = (app, oldPath, newPath) =>
	app.fileManager.renameFile(app.vault.getAbstractFileByPath(oldPath), newPath);

// errors that the plugin lets escape (`void promise`) or logs
async function collectErrors(fn) {
	const rejections = [];
	const logged = [];
	const onRejection = (reason) => rejections.push(reason);
	const originalError = console.error;
	process.on('unhandledRejection', onRejection);
	console.error = (...args) => logged.push(args);
	try {
		await fn();
		await new Promise((resolve) => setImmediate(resolve));
	} finally {
		process.off('unhandledRejection', onRejection);
		console.error = originalError;
	}
	return { rejections, logged };
}

test('inside: renaming a folder renames its folder note', async () => {
	const { app } = setup({ 'Foo/Foo.md': 'x', 'Foo/Other.md': 'y' });
	await rename(app, 'Foo', 'Bar');
	await app.settle();
	assert.deepEqual(app.paths(), ['Bar', 'Bar/Bar.md', 'Bar/Other.md']);
});

test('inside: renaming the folder note renames its folder', async () => {
	const { app } = setup({ 'Foo/Foo.md': 'x', 'Foo/Other.md': 'y' });
	await rename(app, 'Foo/Foo.md', 'Foo/Baz.md');
	await app.settle();
	assert.deepEqual(app.paths(), ['Baz', 'Baz/Baz.md', 'Baz/Other.md']);
});

test('inside: nested folders keep their parent path', async () => {
	const { app } = setup({ 'A/Foo/Foo.md': 'x', 'A/A.md': 'y' });
	await rename(app, 'A/Foo', 'A/Bar');
	await app.settle();
	assert.deepEqual(app.paths(), ['A', 'A/A.md', 'A/Bar', 'A/Bar/Bar.md']);
});

test('inside: renaming other notes queues nothing', async () => {
	const { app } = setup({ 'Foo/Foo.md': 'x', 'Foo/Other.md': 'y' });
	await rename(app, 'Foo/Other.md', 'Foo/Other2.md');
	await app.settle();
	assert.deepEqual(app.paths(), ['Foo', 'Foo/Foo.md', 'Foo/Other2.md']);
});

test('inside: a note in a folder of a different name is not a folder note', async () => {
	const { app } = setup({ 'Meeting Notes/Notes.md': 'x' });
	await rename(app, 'Meeting Notes/Notes.md', 'Meeting Notes/Other.md');
	await app.settle();
	assert.deepEqual(app.paths(), ['Meeting Notes', 'Meeting Notes/Other.md']);
});

test('inside: folders renamed in the same burst all get their folder note renamed', async () => {
	const { app } = setup({ 'A/A.md': '1', 'B/B.md': '2', 'C/C.md': '3' });
	await Promise.all([rename(app, 'A', 'A2'), rename(app, 'B', 'B2'), rename(app, 'C', 'C2')]);
	await app.settle();
	assert.deepEqual(app.paths(), ['A2', 'A2/A2.md', 'B2', 'B2/B2.md', 'C2', 'C2/C2.md']);
});

test('inside: notes renamed in the same burst all get their folder renamed', async () => {
	const { app } = setup({ 'A/A.md': '1', 'B/B.md': '2' });
	await Promise.all([rename(app, 'A/A.md', 'A/A2.md'), rename(app, 'B/B.md', 'B/B2.md')]);
	await app.settle();
	assert.deepEqual(app.paths(), ['A2', 'A2/A2.md', 'B2', 'B2/B2.md']);
});

test('inside: moving a folder keeps its folder note and raises no errors', async () => {
	const { app } = setup({ 'Foo/Foo.md': 'x', 'P/P.md': 'y' });
	const { rejections, logged } = await collectErrors(async () => {
		await rename(app, 'Foo', 'P/Foo');
		await app.settle();
	});
	assert.deepEqual(app.paths(), ['P', 'P/Foo', 'P/Foo/Foo.md', 'P/P.md']);
	assert.deepEqual(rejections, []);
	assert.deepEqual(logged, []);
});

test('inside: moving the folder note out under another name leaves its folder alone', async () => {
	const { app } = setup({ 'Foo/Foo.md': 'x', 'Foo/Other.md': 'y' }, 'inside', ['Elsewhere']);
	await rename(app, 'Foo/Foo.md', 'Elsewhere/Bar.md');
	await app.settle();
	assert.deepEqual(app.paths(), ['Elsewhere', 'Elsewhere/Bar.md', 'Foo', 'Foo/Other.md']);
});

test('inside: a rename that cannot happen is skipped without an unhandled error', async () => {
	const { app } = setup({ 'X/X.md': '1', 'Y/Y.md': '2' });
	const { rejections } = await collectErrors(async () => {
		await rename(app, 'X/X.md', 'X/Y.md');
		await app.settle();
	});
	// folder Y exists already: X is not renamed over it
	assert.deepEqual(app.paths(), ['X', 'X/Y.md', 'Y', 'Y/Y.md']);
	assert.deepEqual(rejections, []);
});

test('inside: one failing rename is logged and does not stop the others', async () => {
	const { app } = setup({ 'A/A.md': '1', 'B/B.md': '2' });
	const renameFile = app.fileManager.renameFile;
	app.fileManager.renameFile = async (file, newPath) => {
		if (newPath === 'A2/A2.md') throw new Error('disk says no');
		return renameFile(file, newPath);
	};
	const { rejections, logged } = await collectErrors(async () => {
		await Promise.all([rename(app, 'A', 'A2'), rename(app, 'B', 'B2')]);
		await app.settle();
	});
	assert.deepEqual(app.paths(), ['A2', 'A2/A.md', 'B2', 'B2/B2.md']);
	assert.deepEqual(rejections, []);
	assert.equal(logged.length, 1);
});

test('inside: the plugin does not queue work after its own renames', async () => {
	const { app } = setup({ 'Foo/Foo.md': 'x' });
	await rename(app, 'Foo', 'Bar');
	await app.settle();
	assert.equal(app.pendingTimers(), 0);
});

test('outside: renaming a folder renames the note next to it', async () => {
	const { app } = setup({ 'Foo.md': 'x', 'Foo/a.md': 'y' }, 'outside');
	await rename(app, 'Foo', 'Bar');
	await app.settle();
	assert.deepEqual(app.paths(), ['Bar', 'Bar.md', 'Bar/a.md']);
});

test('outside: renaming the folder note renames the folder', async () => {
	const { app } = setup({ 'Foo.md': 'x', 'Foo/a.md': 'y' }, 'outside');
	await rename(app, 'Foo.md', 'Bar.md');
	await app.settle();
	assert.deepEqual(app.paths(), ['Bar', 'Bar.md', 'Bar/a.md']);
});

test('index: renames are left alone', async () => {
	const { app } = setup({ 'Foo/_about_.md': 'x' }, 'index');
	await rename(app, 'Foo', 'Bar');
	await app.settle();
	assert.deepEqual(app.paths(), ['Bar', 'Bar/_about_.md']);
});
