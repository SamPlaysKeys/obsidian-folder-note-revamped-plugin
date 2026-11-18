import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, makeApp } from './helpers.mjs';

const { FolderBrief } = load('folder-brief.js');
const brief = (content) => new FolderBrief(makeApp()).getContentBrief(content);

test('brief skips frontmatter and takes the first paragraph without markup', () => {
	assert.equal(brief('---\ntitle: x\n---\nHello **world** and [site](http://a.b)\n\nSecond'), 'Hello world and site');
	assert.equal(brief('text with `code` and <b>html</b>'), 'text with code and html');
	assert.equal(brief('![img](a.png)\n\nText after'), 'Text after');
	assert.equal(brief('> quote\n\nPlain'), 'Plain');
});

test('brief falls back to the headings, or is empty', () => {
	assert.equal(brief('# Title\n\n## Sub\n\nPara text'), 'Para text');
	assert.equal(brief('# Title\n## Sub\n### Third'), ' Title,  Sub,  Third');
	assert.equal(brief(''), '');
});

test('first image of a note, resolved against the folder', () => {
	const image = (content, folder = 'A/B') => new FolderBrief(makeApp()).getContentImage(content, folder);
	assert.equal(image('![a](pic.png)'), 'pic.png');
	assert.equal(image('![[pic.png]]'), 'pic.png');
	assert.equal(image('![a](../pic.png)'), 'A/pic.png');
	assert.equal(image('![a](https://x/y.png)'), 'https://x/y.png');
	assert.equal(image('![a](my%20pic.png)'), 'my pic.png');
	assert.equal(image('no image'), '');
});

test('cards: notes of a folder, without the active note, and subfolders without an outside note', async () => {
	const app = makeApp(
		{
			'Top/Top.md': 'the folder note',
			'Top/Alpha.md': 'Alpha text',
			'Top/pic.png': '',
			'Top/Sub/x.md': 'x',
			'Top/Done/y.md': 'y',
			'Top/Done.md': 'note of the Done folder',
		},
	);
	const cards = await new FolderBrief(app).makeBriefCards('Top', 'Top/Top.md');
	const yaml = cards.getYamlCode();
	assert.ok(yaml.includes("title: 'Alpha'"), yaml);
	assert.ok(yaml.includes("title: 'Sub'") && yaml.includes("head: 'Folder'"), yaml);
	// folder Done has the outside folder note Done.md: it is listed as a note, not as a folder
	assert.equal(yaml.match(/title: 'Done'/g).length, 1, yaml);
	assert.ok(yaml.includes("link: 'Top/Done.md'"), yaml);
	assert.ok(!yaml.includes("'Top'"), 'the active note is left out: ' + yaml);
	assert.ok(!yaml.includes('pic'), 'non-markdown files are left out: ' + yaml);
});

test('cards: the vault root can be listed with "/"', async () => {
	const app = makeApp({ 'Root.md': 'r', 'Folder/a.md': 'a' });
	const yaml = (await new FolderBrief(app).makeBriefCards('/', '')).getYamlCode();
	assert.ok(yaml.includes('Root') && yaml.includes('Folder'), yaml);
});
