import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, makeApp, makeFolderNote } from './helpers.mjs';

const { ccardProcessor } = load('ccard-block.js');
const { CardBlock } = load('card-item.js');

// the rendering itself needs a DOM: replace it with a marker
CardBlock.prototype.getDocElement = function () {
	return { yaml: this.getYamlCode() };
};

async function run(source, sourcePath, app = makeApp({ 'Top/Top.md': 'x', 'Top/Alpha.md': 'a', 'Root.md': 'r' }, ['Empty'])) {
	const warnings = [];
	const originalWarn = console.warn;
	console.warn = (...args) => warnings.push(args.join(' '));
	try {
		const el = { children: [], appendChild(child) { this.children.push(child); } };
		await new ccardProcessor(app).run(source, el, { sourcePath }, makeFolderNote(app));
		return { el, warnings };
	} finally {
		console.warn = originalWarn;
	}
}

test('live brief of a note lists the folder of that note', async () => {
	const { el, warnings } = await run('type: folder_brief_live', 'Top/Alpha.md');
	assert.equal(el.children.length, 1);
	const yaml = el.children[0].yaml;
	assert.ok(yaml.includes("link: 'Top/Top.md'"), yaml);
	assert.ok(!yaml.includes('Alpha'), 'the note that contains the block is left out: ' + yaml);
	assert.deepEqual(warnings, []);
});

test('live brief in a note at the vault root lists the vault root', async () => {
	const { el, warnings } = await run('type: folder_brief_live', 'Root.md');
	assert.equal(el.children.length, 1);
	assert.ok(el.children[0].yaml.includes("title: 'Top'"), el.children[0].yaml);
	assert.deepEqual(warnings, []);
});

test('`folder: /` and an empty `folder:` mean the vault root', async () => {
	for (const source of ['type: folder_brief_live\nfolder: /', 'type: folder_brief_live\nfolder:']) {
		const { el, warnings } = await run(source, 'Top/Alpha.md');
		assert.equal(el.children.length, 1, source);
		assert.ok(el.children[0].yaml.includes("title: 'Top'"), source);
		assert.deepEqual(warnings, [], source);
	}
});

test('a folder that does not exist renders nothing and warns', async () => {
	const { el, warnings } = await run('type: folder_brief_live\nfolder: Nope', 'Top/Alpha.md');
	assert.equal(el.children.length, 0);
	assert.equal(warnings.length, 1);
	assert.ok(warnings[0].includes('Nope'));
});

test('no folder and no source note renders nothing and warns', async () => {
	const { el, warnings } = await run('type: folder_brief_live', '');
	assert.equal(el.children.length, 0);
	assert.equal(warnings.length, 1);
});

test('an unknown type renders nothing and warns', async () => {
	const { el, warnings } = await run('type: nonsense', 'Top/Alpha.md');
	assert.equal(el.children.length, 0);
	assert.equal(warnings.length, 1);
	assert.ok(warnings[0].includes('nonsense'));
});
