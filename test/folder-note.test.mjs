import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, makeFolderNote } from './helpers.mjs';

test('inside: the folder name must be a whole path segment', () => {
	const fn = makeFolderNote(makeApp());
	assert.equal(fn.isInsideFolderNotePath('Foo/Foo.md'), true);
	assert.equal(fn.isInsideFolderNotePath('A/Foo/Foo.md'), true);
	assert.equal(fn.isInsideFolderNotePath('Meeting Notes/Notes.md'), false);
	assert.equal(fn.isInsideFolderNotePath('Notes.md'), false);
	assert.equal(fn.isInsideFolderNotePath('Foo/Bar/Foo.md'), false);
});

test('isFolderNote per method', async () => {
	const app = makeApp({ 'Foo.md': '', 'Foo/x.md': '' });
	assert.equal(await makeFolderNote(app, 'inside').isFolderNote('Foo/Foo.md'), true);
	assert.equal(await makeFolderNote(app, 'inside').isFolderNote('Meeting Notes/Notes.md'), false);
	assert.equal(await makeFolderNote(app, 'index', '_about_').isFolderNote('Foo/_about_.md'), true);
	assert.equal(await makeFolderNote(app, 'index', '_about_').isFolderNote('Foo/Foo.md'), false);
	assert.equal(await makeFolderNote(app, 'outside').isFolderNote('Foo.md'), true);
	assert.equal(await makeFolderNote(app, 'outside').isFolderNote('Bar.md'), false);
});

test('note path of a folder, per method', () => {
	const app = makeApp();
	assert.deepEqual(makeFolderNote(app, 'inside').getFolderNotePath('A/Foo'), ['A/Foo/Foo.md', 'Foo']);
	assert.deepEqual(makeFolderNote(app, 'outside').getFolderNotePath('A/Foo'), ['A/Foo.md', 'Foo']);
	assert.deepEqual(makeFolderNote(app, 'index', '_about_').getFolderNotePath('A/Foo'), ['A/Foo/_about_.md', '_about_']);
});

test('folder of a note, per method', () => {
	const app = makeApp();
	assert.equal(makeFolderNote(app, 'inside').getNoteFolderPath('A/Foo/Foo.md'), 'A/Foo');
	assert.equal(makeFolderNote(app, 'outside').getNoteFolderPath('A/Foo.md'), 'A/Foo');
	assert.equal(makeFolderNote(app, 'index').getNoteFolderPath('A/Foo/_about_.md'), 'A/Foo');
});

test('folder of a note for the live brief', async () => {
	const fn = makeFolderNote(makeApp(), 'inside');
	assert.equal(await fn.getNoteFolderBriefPath('A/A.md'), 'A', 'a folder note lists its own folder');
	assert.equal(await fn.getNoteFolderBriefPath('A/Other.md'), 'A', 'another note lists its folder');
	assert.equal(await fn.getNoteFolderBriefPath('Root.md'), '/', 'a root note lists the vault root');
	assert.equal(await fn.getNoteFolderBriefPath(''), '');
	assert.equal(await fn.getNoteFolderBriefPath('   '), '');
});

test('expandContent keeps `$` patterns in the folder name and the brief literal', async () => {
	const dir = 'Price $& list';
	const app = makeApp({ [`${dir}/Costs.md`]: "Costs $$5 and $& and $' more" });
	const fn = makeFolderNote(app, 'inside');
	fn.setByFolderPath(dir);
	const out = await fn.expandContent('# {{FOLDER_NAME}}\n{{FOLDER_PATH}}\n{{FOLDER_BRIEF}}');
	assert.ok(out.includes('# Price $& list\nPrice $& list\n'), out);
	// the YAML in the brief doubles single quotes
	assert.ok(out.includes("Costs $$5 and $& and $'' more"), out);
	assert.ok(!out.includes('{{FOLDER_BRIEF}}'), out);
});

test('expandContent replaces every name/path placeholder and adds the live block', async () => {
	const fn = makeFolderNote(makeApp(), 'inside');
	fn.setByFolderPath('A/Foo');
	const out = await fn.expandContent('{{FOLDER_NAME}} {{FOLDER_NAME}} {{FOLDER_PATH}}{{FOLDER_BRIEF_LIVE}}');
	assert.equal(out, 'Foo Foo A/Foo\n```ccard\ntype: folder_brief_live\n```\n');
});
