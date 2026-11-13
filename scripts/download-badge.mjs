// Sums the download count of the plugin's main.js across all releases and prints a shields.io endpoint JSON.
// main.js is the one file every install or update fetches, so it tracks installs better than the
// repo-wide total (which also counts manifest.json, styles.css and the zip).
// Usage: node scripts/download-badge.mjs [output-file]   (set GITHUB_TOKEN to avoid API rate limits)
import { writeFileSync } from 'node:fs';

const repo = process.env.GITHUB_REPOSITORY || 'SamPlaysKeys/obsidian-folder-note-revamped-plugin';
const asset = 'main.js';
const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'download-badge' };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

let total = 0;
for (let page = 1; ; page++) {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`, { headers });
    if (!res.ok) {
        console.error(`GitHub API returned ${res.status} for ${repo}`);
        process.exit(1);
    }
    const releases = await res.json();
    for (const release of releases) {
        for (const a of release.assets) {
            if (a.name === asset) total += a.download_count;
        }
    }
    if (releases.length < 100) break;
}

const badge = JSON.stringify({ schemaVersion: 1, label: 'downloads', message: String(total), color: 'blue' }) + '\n';
if (process.argv[2]) writeFileSync(process.argv[2], badge);
else process.stdout.write(badge);
