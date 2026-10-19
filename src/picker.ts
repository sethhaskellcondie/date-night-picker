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
  return hours === 0 ? 'Under an hour' : `Up to ${plural(hours, 'hour')}`;
}

export function budgetLabel(dollars: number): string {
  return dollars === 0 ? 'Free' : `Up to $${dollars.toLocaleString('en-US')}`;
}

// Both bounds are inclusive: a 3-hour idea fits "Up to 3 hours".
export function eligible(list: Activity[], f: Filters): Activity[] {
  const { category } = f;
  return list.filter(
    (a) =>
      a.time <= f.hours &&
      a.budget <= f.dollars &&
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
// else the smallest. With nothing wanted, the largest (every idea fits).
function snap(wanted: number | undefined, options: number[]): number {
  if (!options.length) return 0;
  if (wanted === undefined) return options[options.length - 1];
  const atOrBelow = options.filter((o) => o <= wanted);
  return atOrBelow.length ? atOrBelow[atOrBelow.length - 1] : options[0];
}

// Fits remembered or current choices onto freshly built options. A category
// that's gone resets to "Any category".
export function settleFilters(options: Options, wanted: Partial<Filters>): Filters {
  const want = wanted.category;
  return {
    hours: snap(wanted.hours, options.times),
    dollars: snap(wanted.dollars, options.budgets),
    category: want ? (options.categories.find((c) => sameCategory(c, want)) ?? null) : null,
  };
}

function joinOr(items: string[]): string {
  if (items.length <= 2) return items.join(' or ');
  return `${items.slice(0, -1).join(', ')}, or ${items[items.length - 1]}`;
}

// The empty-pool hint, phrased in dropdown terms. Each suggestion on its own
// makes at least one idea fit, e.g.
// "No Outdoors ideas fit — try Up to $40, Up to 3 hours, or Any category".
// Returns '' when ideas already fit.
export function nearestFix(list: Activity[], f: Filters): string {
  if (!list.length) return 'No date ideas are loaded yet.';
  if (eligible(list, f).length) return '';

  const { category } = f;
  const inCategory =
    category === null ? list : list.filter((a) => sameCategory(a.category, category));
  const fixes: string[] = [];
  const budgets = inCategory.filter((a) => a.time <= f.hours).map((a) => a.budget);
  if (budgets.length) fixes.push(budgetLabel(Math.min(...budgets)));
  const times = inCategory.filter((a) => a.budget <= f.dollars).map((a) => a.time);
  if (times.length) fixes.push(timeLabel(Math.min(...times)));
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

function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// The spin reel: the pool shuffled and repeated to `slots` items with the
// winner last. The slot before it is the near miss, and it's a different idea
// whenever the pool has one.
export function buildReel<T>(
  pool: readonly T[],
  winner: T,
  slots = 30,
  rng: () => number = Math.random,
): T[] {
  if (!pool.length) return [winner];
  const strip: T[] = [];
  while (strip.length < slots - 1) {
    const round = shuffle(pool, rng);
    // No idea twice in a row across the seam between rounds.
    if (round.length > 1 && round[0] === strip[strip.length - 1]) round.push(round.shift()!);
    strip.push(...round);
  }
  strip.length = Math.max(slots - 1, 0);

  const others = pool.filter((p) => p !== winner);
  if (others.length && strip.length && strip[strip.length - 1] === winner) {
    const fresh = others.filter((p) => p !== strip[strip.length - 2]);
    strip[strip.length - 1] = pickRandom(fresh.length ? fresh : others, rng)!;
  }
  strip.push(winner);
  return strip;
}
