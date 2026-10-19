import { afterEach, describe, expect, it, vi } from 'vitest';
import { FALLBACK, parseActivities, toHours, toWholeNumber } from './activities';

afterEach(() => {
  vi.restoreAllMocks();
});

function quietWarnings() {
  return vi.spyOn(console, 'warn').mockImplementation(() => {});
}

describe('toWholeNumber', () => {
  it.each([
    [3, 3],
    [0, 0],
    ['3', 3],
    [' $40 ', 40],
    ['$ 40', 40],
    ['1,200', 1200],
    ['0', 0],
  ])('accepts %j as %d', (input, expected) => {
    expect(toWholeNumber(input)).toBe(expected);
  });

  it.each([['', '   ', 'abc', '-1', -1, '2.5', 2.5, '1,20', '$', NaN, Infinity, null, undefined]])(
    'rejects %j',
    (input) => {
      expect(toWholeNumber(input)).toBeNull();
    },
  );
});

describe('toHours', () => {
  it.each([
    [0, 0],
    ['0', 0],
    [0.5, 0],
    ['0.5', 0],
    [' .25 ', 0],
    [0.99, 0],
    [1, 1],
    ['3', 3],
  ])('accepts %j as %d', (input, expected) => {
    expect(toHours(input)).toBe(expected);
  });

  it.each([['', '   ', 'abc', '-0.5', -0.5, '1.5', 1.5, NaN, null, undefined]])('rejects %j', (input) => {
    expect(toHours(input)).toBeNull();
  });
});

describe('parseActivities', () => {
  const row = { time: '3', budget: '40', category: 'Food', idea: 'Cook a new cuisine together' };
  const parsed = { time: 3, budget: 40, category: 'Food', idea: 'Cook a new cuisine together' };

  it('accepts the live {activities: [...]} payload', () => {
    expect(parseActivities({ activities: [row] })).toEqual([parsed]);
  });

  it('accepts a bare array (cache and fallback)', () => {
    expect(parseActivities([row])).toEqual([parsed]);
    expect(parseActivities([parsed])).toEqual([parsed]);
  });

  it('trims text and coerces numbers', () => {
    expect(
      parseActivities([{ time: ' 2 ', budget: ' $1,200 ', category: '  Big   Night ', idea: '  Fancy  dinner ' }]),
    ).toEqual([{ time: 2, budget: 1200, category: 'Big Night', idea: 'Fancy dinner' }]);
  });

  it('turns a blank category into "Other"', () => {
    expect(parseActivities([{ ...row, category: '  ' }])?.[0].category).toBe('Other');
    expect(parseActivities([{ ...row, category: undefined }])?.[0].category).toBe('Other');
  });

  it('gives every row of a category the first spelling seen', () => {
    const list = parseActivities([
      { ...row, category: 'food ' },
      { ...row, category: 'Food' },
      { ...row, category: 'FOOD' },
    ]);
    expect(list?.map((a) => a.category)).toEqual(['food', 'food', 'food']);
  });

  it('drops a bad row with a warning naming its sheet row, and keeps the rest', () => {
    const warn = quietWarnings();
    const list = parseActivities([row, { ...row, time: 'abc' }, { ...row, idea: '  ' }, row]);
    expect(list).toEqual([parsed, parsed]);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toContain('sheet row 3');
    expect(warn.mock.calls[0][0]).toContain('time');
    expect(warn.mock.calls[1][0]).toContain('sheet row 4');
    expect(warn.mock.calls[1][0]).toContain('idea');
  });

  it('rejects negative and fractional numbers', () => {
    quietWarnings();
    expect(parseActivities([{ ...row, budget: '-5' }])).toBeNull();
    expect(parseActivities([{ ...row, budget: '0.5' }])).toBeNull();
    expect(parseActivities([{ ...row, time: '1.5' }])).toBeNull();
  });

  it('reads a time under an hour as 0', () => {
    expect(parseActivities([{ ...row, time: '0.5' }])?.[0].time).toBe(0);
  });

  it('returns null when every row is bad', () => {
    quietWarnings();
    expect(parseActivities([{ ...row, time: '' }, 'junk', null])).toBeNull();
  });

  it('returns null for empty or malformed payloads', () => {
    expect(parseActivities([])).toBeNull();
    expect(parseActivities({ activities: [] })).toBeNull();
    expect(parseActivities({ events: [row] })).toBeNull();
    expect(parseActivities('nope')).toBeNull();
    expect(parseActivities(null)).toBeNull();
  });
});

describe('FALLBACK', () => {
  it('parses every row of the bundled snapshot', () => {
    expect(FALLBACK.length).toBeGreaterThan(0);
  });
});
