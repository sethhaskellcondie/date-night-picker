import { categoryKey } from './picker';

export interface CategoryStyle {
  emoji: string;
  color: string;
}

// Emoji and chip color per category, keyed by lowercase name. Feeds the
// dropdown labels and reveal badge.
// TODO(Phase 2): rewrite from the real sheet's categories after `npm run
// snapshot`; these cover the placeholder fallback plus a few likely ones.
const KNOWN: Record<string, CategoryStyle | undefined> = {
  food: { emoji: '🍝', color: '#ff9f6b' },
  outdoors: { emoji: '🌲', color: '#6fd6a0' },
  'at home': { emoji: '🏠', color: '#c9a7ff' },
  entertainment: { emoji: '🎬', color: '#6fb8ff' },
  creative: { emoji: '🎨', color: '#ff7fc4' },
  adventure: { emoji: '🧭', color: '#ffd166' },
  active: { emoji: '🏃', color: '#5fe0d0' },
  culture: { emoji: '🎭', color: '#f4a5ff' },
  games: { emoji: '🎲', color: '#b5e36b' },
  relax: { emoji: '🛁', color: '#9fd3ff' },
  other: { emoji: '💫', color: '#d8cbe8' },
};

// FNV-1a: the same name gets the same color on every visit, so a category
// added to the sheet later has a stable look without a deploy.
function hashedColor(key: string): string {
  let hash = 0x811c9dc5;
  for (const ch of key) {
    hash ^= ch.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return `hsl(${(hash >>> 0) % 360}, 75%, 70%)`;
}

export function categoryStyle(category: string): CategoryStyle {
  const key = categoryKey(category);
  return KNOWN[key] ?? { emoji: '✨', color: hashedColor(key) };
}
