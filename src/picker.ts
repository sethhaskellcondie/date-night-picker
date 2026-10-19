import type { Activity } from './activities';
import { plural } from './shared';

export interface Filters {
  hours: number;
  dollars: number;
  category: string | null; // null = "Any category"
}

export interface Options {
  times: number[];
  budgets: number[];
  categories: string[];
}

export function categoryKey(category: string): string {
  return category.trim().toLowerCase();
}

export function sameCategory(a: string, b: string): boolean {
  return categoryKey(a) === categoryKey(b);
}

// Dropdown labels. nearestFix uses them too, so its hints name real options.
export function timeLabel(hours: number): string {
  return hours === 0 ? 'Less than an hour' : plural(hours, 'hour');
}

export function budgetLabel(dollars: number): string {
  return dollars === 0 ? 'Free' : `$${dollars.toLocaleString('en-US')}`;
}

// Time and budget match exactly: a 3-hour, $40 idea fits "3 hours" and "$40",
// not "4 hours" or "$50".
export function eligible(list: Activity[], f: Filters): Activity[] {
  const { category } = f;
  return list.filter(
    (a) =>
      a.time === f.hours &&
      a.budget === f.dollars &&
      (category === null || sameCategory(a.category, category)),
  );
}

// Uniform and independent on every call; the same idea can come up twice in
// a row by design.
export function pickRandom<T>(pool: readonly T[], rng: () => number = Math.random): T | null {
  if (!pool.length) return null;
  return pool[Math.min(Math.floor(rng() * pool.length), pool.length - 1)];
}

function distinctAscending(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

// Every option matches at least one real idea, so there are no dead choices.
// Categories are de-duplicated case-insensitively; the first spelling seen is
// the label.
export function buildOptions(list: Activity[]): Options {
  const categories = new Map<string, string>();
  for (const a of list) {
    const key = categoryKey(a.category);
    if (!categories.has(key)) categories.set(key, a.category.trim());
  }
  return {
    times: distinctAscending(list.map((a) => a.time)),
    budgets: distinctAscending(list.map((a) => a.budget)),
    categories: [...categories.values()].sort((a, b) =>
      a.localeCompare(b, 'en', { sensitivity: 'base' }),
    ),
  };
}

// Kept when it's still an option, else the largest option at or below it,
// else the smallest.
function snap(wanted: number, options: number[]): number {
  if (!options.length) return 0;
  const atOrBelow = options.filter((o) => o <= wanted);
  return atOrBelow.length ? atOrBelow[atOrBelow.length - 1] : options[0];
}

// The time and budget shared by the most ideas (the shorter, cheaper pair on
// a tie), so untouched dropdowns always have ideas to pick from.
function busiestPair(list: Activity[]): { hours: number; dollars: number } {
  const counts = new Map<string, number>();
  let best = { hours: 0, dollars: 0, count: 0 };
  for (const a of list) {
    const key = `${a.time}|${a.budget}`;
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    const beats =
      count > best.count ||
      (count === best.count && (a.time < best.hours || (a.time === best.hours && a.budget < best.dollars)));
    if (beats) best = { hours: a.time, dollars: a.budget, count };
  }
  return { hours: best.hours, dollars: best.dollars };
}

// Fits remembered or current choices onto the options built from `list`. A
// time or budget that was never chosen goes to the busiest pair that agrees
// with the other choice. A category that's gone resets to "Any category".
export function settleFilters(list: Activity[], wanted: Partial<Filters>): Filters {
  const options = buildOptions(list);
  const want = wanted.category;
  const hours = wanted.hours === undefined ? undefined : snap(wanted.hours, options.times);
  const dollars = wanted.dollars === undefined ? undefined : snap(wanted.dollars, options.budgets);
  const busiest = busiestPair(
    list.filter(
      (a) => (hours === undefined || a.time === hours) && (dollars === undefined || a.budget === dollars),
    ),
  );
  return {
    hours: hours ?? busiest.hours,
    dollars: dollars ?? busiest.dollars,
    category: want ? (options.categories.find((c) => sameCategory(c, want)) ?? null) : null,
  };
}

function joinOr(items: string[]): string {
  if (items.length <= 2) return items.join(' or ');
  return `${items.slice(0, -1).join(', ')}, or ${items[items.length - 1]}`;
}

// The option nearest `current`, the smaller on a tie.
function closest(values: number[], current: number): number {
  return values.reduce((best, v) => {
    const d = Math.abs(v - current);
    const bestD = Math.abs(best - current);
    return d < bestD || (d === bestD && v < best) ? v : best;
  });
}

// The empty-pool hint, phrased in dropdown terms. Each suggestion on its own
// makes at least one idea fit, e.g.
// "No Outdoors ideas fit — try $40, 3 hours, or Any category".
// Returns '' when ideas already fit.
export function nearestFix(list: Activity[], f: Filters): string {
  if (!list.length) return 'No date ideas are loaded yet.';
  if (eligible(list, f).length) return '';

  const { category } = f;
  const inCategory =
    category === null ? list : list.filter((a) => sameCategory(a.category, category));
  const fixes: string[] = [];
  const budgets = inCategory.filter((a) => a.time === f.hours).map((a) => a.budget);
  if (budgets.length) fixes.push(budgetLabel(closest(budgets, f.dollars)));
  const times = inCategory.filter((a) => a.budget === f.dollars).map((a) => a.time);
  if (times.length) fixes.push(timeLabel(closest(times, f.hours)));
  if (category !== null && eligible(list, { ...f, category: null }).length) {
    fixes.push('Any category');
  }
  // No single dropdown change is enough: point at the cheapest idea instead.
  if (!fixes.length && inCategory.length) {
    const cheapest = [...inCategory].sort((a, b) => a.budget - b.budget || a.time - b.time)[0];
    fixes.push(`${budgetLabel(cheapest.budget)} and ${timeLabel(cheapest.time)}`);
  }

  const subject = category === null ? 'No ideas fit' : `No ${category} ideas fit`;
  return fixes.length ? `${subject} — try ${joinOr(fixes)}` : `${subject}.`;
}
