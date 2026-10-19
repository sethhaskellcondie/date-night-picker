import { SCRIPT_URL } from './config';
import { loadStored, store } from './shared';
import fallbackRows from './fallback-activities.json';

export interface Activity {
  time: number; // hours, whole number ≥ 0 (0 = less than an hour)
  budget: number; // dollars, whole number ≥ 0 (0 = free)
  category: string;
  idea: string;
}

const CACHE_KEY = 'date-night-activities-v1';
const DEFAULT_CATEGORY = 'Other';

// Accepts 3, "3", " $40 " and "1,200". Rejects blanks, words, negatives and
// fractions, so a typo in the sheet drops that row instead of guessing.
export function toWholeNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/^\$\s*/, '');
  if (!/^(\d+|\d{1,3}(,\d{3})+)$/.test(text)) return null;
  return Number(text.replaceAll(',', ''));
}

// Hours: a whole number, or anything under an hour (0.5, ".25") as 0, which is
// "Less than an hour". Longer fractions like 1.5 are still rejected.
export function toHours(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof n === 'number' && n > 0 && n < 1) return 0;
  return toWholeNumber(value);
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

// An Activity, or why the row can't become one.
function parseRow(row: unknown): Activity | string {
  if (typeof row !== 'object' || row === null) return 'not a row object';
  const r = row as Record<string, unknown>;
  const time = toHours(r.time);
  if (time === null) return `time ${JSON.stringify(r.time)} isn't under 1 or a whole number`;
  const budget = toWholeNumber(r.budget);
  if (budget === null) return `budget ${JSON.stringify(r.budget)} isn't a whole number ≥ 0`;
  const idea = cleanText(r.idea);
  if (!idea) return 'idea is empty';
  return { time, budget, category: cleanText(r.category) || DEFAULT_CATEGORY, idea };
}

// Accepts the live {activities: [...]} payload or a bare array (the cache and
// the fallback snapshot). Rows are checked one at a time: a bad row is dropped
// with a warning rather than taking the other ideas down with it. Returns null
// when nothing usable is left, so an empty or broken sheet never replaces a
// good list that's already loaded.
export function parseActivities(value: unknown): Activity[] | null {
  const rows =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>).activities
      : value;
  if (!Array.isArray(rows)) return null;

  // One spelling per category (the first seen), so "food " and "Food" share
  // a dropdown option, a color and a badge.
  const spellings = new Map<string, string>();
  const activities: Activity[] = [];
  rows.forEach((row, i) => {
    const parsed = parseRow(row);
    if (typeof parsed === 'string') {
      // Row 1 is the header, so the first data row is sheet row 2.
      console.warn(`[date-night] Skipping sheet row ${i + 2}: ${parsed}.`, row);
      return;
    }
    const key = parsed.category.toLowerCase();
    if (!spellings.has(key)) spellings.set(key, parsed.category);
    activities.push({ ...parsed, category: spellings.get(key) ?? parsed.category });
  });
  return activities.length ? activities : null;
}

// Bundled snapshot of the sheet (`npm run snapshot`), for first-time visitors
// when the endpoint is down or switched off.
export const FALLBACK: Activity[] = parseActivities(fallbackRows) ?? [];

// Last good live list, preferred over the fallback on the next visit.
export function readCachedActivities(): Activity[] | null {
  return parseActivities(loadStored(CACHE_KEY));
}

// Fetches, validates and caches the live list. Resolves null (after logging)
// on any failure, so callers keep whatever they already show.
export async function loadLiveActivities(): Promise<Activity[] | null> {
  if (!SCRIPT_URL) return null;
  try {
    const res = await fetch(SCRIPT_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const activities = parseActivities(await res.json());
    if (!activities) throw new Error('no valid activities in the payload');
    store(CACHE_KEY, activities);
    return activities;
  } catch (err) {
    console.warn('[date-night] Live data unavailable; keeping the ideas already loaded.', err);
    return null;
  }
}
