import { describe, expect, it } from 'vitest';
import type { Activity } from './activities';
import {
  budgetLabel,
  buildOptions,
  eligible,
  nearestFix,
  pickRandom,
  settleFilters,
  timeLabel,
  type Filters,
} from './picker';

function activity(time: number, budget: number, category: string, idea = `${category} ${time}h $${budget}`): Activity {
  return { time, budget, category, idea };
}

// Deterministic rng for repeatable picks.
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const list: Activity[] = [
  activity(3, 40, 'Food'),
  activity(1, 0, 'Outdoors'),
  activity(2, 0, 'food'),
  activity(4, 20, 'Outdoors'),
  activity(0, 0, 'At Home'),
  activity(5, 100, 'Adventure'),
];

const any = (hours: number, dollars: number): Filters => ({ hours, dollars, category: null });

describe('eligible', () => {
  it('matches time and budget exactly', () => {
    expect(eligible(list, any(3, 40))).toEqual([list[0]]);
    expect(eligible(list, any(4, 40))).toEqual([]);
    expect(eligible(list, any(2, 40))).toEqual([]);
    expect(eligible(list, any(3, 50))).toEqual([]);
    expect(eligible(list, any(3, 20))).toEqual([]);
  });

  it('returns every category with "Any category"', () => {
    const shared = [activity(1, 0, 'Food'), activity(1, 0, 'Outdoors'), activity(2, 0, 'Food')];
    expect(eligible(shared, any(1, 0))).toEqual(shared.slice(0, 2));
  });

  it('matches categories ignoring case and spaces', () => {
    expect(eligible(list, { hours: 2, dollars: 0, category: ' FOOD ' })).toEqual([list[2]]);
    expect(eligible(list, { hours: 1, dollars: 0, category: 'outdoors' })).toEqual([list[1]]);
  });
});

describe('pickRandom', () => {
  it('returns null for an empty pool', () => {
    expect(pickRandom([])).toBeNull();
  });

  it('maps the rng range onto the whole pool', () => {
    expect(pickRandom(['a', 'b', 'c'], () => 0)).toBe('a');
    expect(pickRandom(['a', 'b', 'c'], () => 0.5)).toBe('b');
    expect(pickRandom(['a', 'b', 'c'], () => 0.999999)).toBe('c');
    expect(pickRandom(['a', 'b', 'c'], () => 1)).toBe('c');
  });

  it('is repeatable with a seeded rng and reaches every item', () => {
    const pool = ['a', 'b', 'c', 'd'];
    const run = () => {
      const rng = seeded(42);
      return Array.from({ length: 200 }, () => pickRandom(pool, rng));
    };
    const picks = run();
    expect(run()).toEqual(picks);
    expect(new Set(picks)).toEqual(new Set(pool));
  });
});

describe('buildOptions', () => {
  it('lists distinct times and budgets in ascending order', () => {
    const options = buildOptions(list);
    expect(options.times).toEqual([0, 1, 2, 3, 4, 5]);
    expect(options.budgets).toEqual([0, 20, 40, 100]);
  });

  it('lists categories A→Z, de-duplicated case-insensitively by first spelling', () => {
    expect(buildOptions(list).categories).toEqual(['Adventure', 'At Home', 'Food', 'Outdoors']);
    expect(buildOptions([activity(1, 0, 'food'), activity(1, 0, 'Food')]).categories).toEqual(['food']);
  });

  it('handles an empty list', () => {
    expect(buildOptions([])).toEqual({ times: [], budgets: [], categories: [] });
  });
});

describe('settleFilters', () => {
  const busy = [
    activity(1, 0, 'Food'),
    activity(1, 10, 'Food'),
    activity(1, 10, 'Outdoors'),
    activity(3, 20, 'Food'),
    activity(3, 20, 'Outdoors'),
    activity(3, 20, 'At Home'),
  ];

  it('defaults to the time and budget shared by the most ideas, and any category', () => {
    expect(settleFilters(busy, {})).toEqual({ hours: 3, dollars: 20, category: null });
  });

  it('breaks a tie with the shorter, cheaper pair', () => {
    expect(settleFilters(list, {})).toMatchObject({ hours: 0, dollars: 0 });
  });

  it('fills an unchosen value from the busiest pair that agrees with the other', () => {
    expect(settleFilters(busy, { hours: 1 })).toMatchObject({ hours: 1, dollars: 10 });
    expect(settleFilters(busy, { dollars: 0 })).toMatchObject({ hours: 1, dollars: 0 });
  });

  it('keeps choices that are still options', () => {
    expect(settleFilters(list, { hours: 2, dollars: 20, category: 'Food' })).toEqual({
      hours: 2,
      dollars: 20,
      category: 'Food',
    });
  });

  it('snaps a missing value to the largest option at or below it', () => {
    expect(settleFilters(list, { hours: 10, dollars: 30 })).toMatchObject({ hours: 5, dollars: 20 });
  });

  it('snaps to the smallest option when nothing is at or below', () => {
    const tight = [activity(2, 15, 'Food')];
    expect(settleFilters(tight, { hours: 1, dollars: 5 })).toMatchObject({ hours: 2, dollars: 15 });
  });

  it('uses the option spelling for a category and resets a missing one', () => {
    expect(settleFilters(list, { category: 'outdoors' }).category).toBe('Outdoors');
    expect(settleFilters(list, { category: 'Museums' }).category).toBeNull();
  });
});

describe('labels', () => {
  it('names times and budgets the way the dropdowns do', () => {
    expect(timeLabel(0)).toBe('Less than an hour');
    expect(timeLabel(1)).toBe('1 hour');
    expect(timeLabel(3)).toBe('3 hours');
    expect(budgetLabel(0)).toBe('Free');
    expect(budgetLabel(40)).toBe('$40');
    expect(budgetLabel(1200)).toBe('$1,200');
  });
});

describe('nearestFix', () => {
  it('is empty when ideas fit', () => {
    expect(nearestFix(list, any(5, 100))).toBe('');
  });

  it('offers each dropdown change that would make an idea fit', () => {
    const outdoors = [activity(1, 40, 'Outdoors'), activity(3, 0, 'Outdoors'), activity(1, 0, 'Food')];
    expect(nearestFix(outdoors, { hours: 1, dollars: 0, category: 'Outdoors' })).toBe(
      'No Outdoors ideas fit — try $40, 3 hours, or Any category',
    );
  });

  it('suggests the closest option that works, up or down', () => {
    const ideas = [
      activity(2, 60, 'Food'),
      activity(2, 25, 'Food'),
      activity(2, 0, 'Food'),
      activity(5, 30, 'Food'),
      activity(1, 30, 'Food'),
    ];
    expect(nearestFix(ideas, { hours: 2, dollars: 30, category: 'Food' })).toBe(
      'No Food ideas fit — try $25 or 1 hour',
    );
  });

  it('prefers the smaller option on a tie', () => {
    const ideas = [activity(2, 40, 'Food'), activity(2, 20, 'Food')];
    expect(nearestFix(ideas, { hours: 2, dollars: 30, category: 'Food' })).toBe('No Food ideas fit — try $20');
  });

  it('suggests a combined change when no single one is enough', () => {
    const ideas = [activity(3, 40, 'Outdoors'), activity(1, 50, 'Food'), activity(4, 0, 'Food')];
    expect(nearestFix(ideas, { hours: 1, dollars: 0, category: 'Outdoors' })).toBe(
      'No Outdoors ideas fit — try $40 and 3 hours',
    );
  });

  it('explains an empty list', () => {
    expect(nearestFix([], any(0, 0))).toBe('No date ideas are loaded yet.');
  });
});
