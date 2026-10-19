import { describe, expect, it } from 'vitest';
import type { Activity } from './activities';
import {
  budgetLabel,
  buildOptions,
  buildReel,
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
  it('treats both bounds as inclusive', () => {
    expect(eligible(list, any(3, 40))).toContain(list[0]);
    expect(eligible(list, any(2, 40))).not.toContain(list[0]);
    expect(eligible(list, any(3, 39))).not.toContain(list[0]);
  });

  it('returns everything that fits with "Any category"', () => {
    expect(eligible(list, any(5, 100))).toEqual(list);
    expect(eligible(list, any(0, 0))).toEqual([list[4]]);
  });

  it('matches categories ignoring case and spaces', () => {
    expect(eligible(list, { hours: 5, dollars: 100, category: ' FOOD ' })).toEqual([list[0], list[2]]);
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
  const options = buildOptions(list);

  it('defaults to the largest time and budget and any category', () => {
    expect(settleFilters(options, {})).toEqual({ hours: 5, dollars: 100, category: null });
  });

  it('keeps choices that are still options', () => {
    expect(settleFilters(options, { hours: 2, dollars: 20, category: 'Food' })).toEqual({
      hours: 2,
      dollars: 20,
      category: 'Food',
    });
  });

  it('snaps a missing value to the largest option at or below it', () => {
    expect(settleFilters(options, { hours: 10, dollars: 30 })).toMatchObject({ hours: 5, dollars: 20 });
  });

  it('snaps to the smallest option when nothing is at or below', () => {
    const tight = buildOptions([activity(2, 15, 'Food')]);
    expect(settleFilters(tight, { hours: 1, dollars: 5 })).toMatchObject({ hours: 2, dollars: 15 });
  });

  it('uses the option spelling for a category and resets a missing one', () => {
    expect(settleFilters(options, { category: 'outdoors' }).category).toBe('Outdoors');
    expect(settleFilters(options, { category: 'Museums' }).category).toBeNull();
  });
});

describe('labels', () => {
  it('names times and budgets the way the dropdowns do', () => {
    expect(timeLabel(0)).toBe('Under an hour');
    expect(timeLabel(1)).toBe('Up to 1 hour');
    expect(timeLabel(3)).toBe('Up to 3 hours');
    expect(budgetLabel(0)).toBe('Free');
    expect(budgetLabel(40)).toBe('Up to $40');
    expect(budgetLabel(1200)).toBe('Up to $1,200');
  });
});

describe('nearestFix', () => {
  it('is empty when ideas fit', () => {
    expect(nearestFix(list, any(5, 100))).toBe('');
  });

  it('offers each dropdown change that would make an idea fit', () => {
    const outdoors = [activity(1, 40, 'Outdoors'), activity(3, 0, 'Outdoors'), activity(1, 0, 'Food')];
    expect(nearestFix(outdoors, { hours: 1, dollars: 0, category: 'Outdoors' })).toBe(
      'No Outdoors ideas fit — try Up to $40, Up to 3 hours, or Any category',
    );
  });

  it('suggests the smallest raise that works', () => {
    const ideas = [activity(1, 60, 'Food'), activity(1, 25, 'Food'), activity(3, 0, 'Food')];
    expect(nearestFix(ideas, { hours: 1, dollars: 0, category: 'Food' })).toBe(
      'No Food ideas fit — try Up to $25 or Up to 3 hours',
    );
  });

  it('suggests a combined change when no single one is enough', () => {
    const ideas = [activity(3, 40, 'Outdoors'), activity(1, 50, 'Food'), activity(4, 0, 'Food')];
    expect(nearestFix(ideas, { hours: 1, dollars: 0, category: 'Outdoors' })).toBe(
      'No Outdoors ideas fit — try Up to $40 and Up to 3 hours',
    );
  });

  it('explains an empty list', () => {
    expect(nearestFix([], any(0, 0))).toBe('No date ideas are loaded yet.');
  });
});

describe('buildReel', () => {
  const pool = list.slice(0, 4);

  it('fills the slots with pool items and ends on the winner', () => {
    const reel = buildReel(pool, pool[2], 30, seeded(7));
    expect(reel).toHaveLength(30);
    expect(reel[29]).toBe(pool[2]);
    expect(reel.every((a) => pool.includes(a))).toBe(true);
  });

  it('never makes the near miss the winner when the pool has another idea', () => {
    for (let seed = 0; seed < 200; seed++) {
      const two = pool.slice(0, 2);
      const reel = buildReel(two, two[seed % 2], 30, seeded(seed));
      expect(reel[28]).not.toBe(reel[29]);
    }
  });

  it('works with a pool of one', () => {
    expect(buildReel([pool[0]], pool[0], 5)).toEqual(Array(5).fill(pool[0]));
  });
});
