// Refreshes src/fallback-activities.json from the live sheet: `npm run snapshot`.
// Run it locally after big sheet edits and commit the JSON. It never runs in
// the Vercel build, so a slow or broken Apps Script can't break a deploy.
import { readFile, writeFile } from 'node:fs/promises';

const config = await readFile(new URL('../src/config.ts', import.meta.url), 'utf8');
const url = config.match(/SCRIPT_URL\s*=\s*['"]([^'"]*)['"]/)?.[1];
if (!url) {
  console.error('SCRIPT_URL in src/config.ts is empty; deploy the Apps Script first.');
  process.exit(1);
}

const res = await fetch(url);
if (!res.ok) throw new Error(`Apps Script answered HTTP ${res.status}`);
const { activities } = await res.json();
if (!Array.isArray(activities) || activities.length === 0) {
  throw new Error('The payload has no activities; keeping the current snapshot.');
}

const out = new URL('../src/fallback-activities.json', import.meta.url);
await writeFile(out, `${JSON.stringify(activities, null, 2)}\n`);
console.log(`Wrote ${activities.length} activities to src/fallback-activities.json`);
