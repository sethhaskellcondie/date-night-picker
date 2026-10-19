import type { Activity } from './activities';
import { categoryStyle } from './categories';
import { budgetLabel, timeLabel } from './picker';
import { esc, plural } from './shared';

function field(id: string, label: string, extra = ''): string {
  return `
    <div class="field">
      <label class="field__label" for="${id}">${label}${extra}</label>
      <div class="select">
        <select id="${id}"></select>
      </div>
    </div>
  `;
}

// Everything static: the page, the stage overlay (hidden until a pick) and the
// screen-reader announcer. Data-driven parts are filled in by main.ts.
export function renderShell(): string {
  return `
    <div class="sky" aria-hidden="true"></div>
    <button type="button" class="sound-toggle" id="sound-toggle" aria-label="Mute sound"></button>
    <main class="page" id="page">
      <header class="masthead">
        <p class="eyebrow">✦ Tonight's plan ✦</p>
        <h1 class="masthead__title">Date Night <em>Picker</em></h1>
        <p class="hat-count" id="hat-count"></p>
      </header>
      <form class="planner" id="planner">
        ${field('f-time', 'How much time?')}
        ${field('f-budget', "What's the budget?")}
        ${field('f-category', 'Category', ' <span class="field__optional">optional</span>')}
        <div class="planner__footer">
          <p class="fit" id="fit" aria-live="polite"></p>
          <button type="submit" class="btn btn--primary" id="pick">Pick a date ✨</button>
        </div>
      </form>
    </main>
    <div class="stage" id="stage" role="dialog" aria-modal="true" aria-labelledby="stage-caption" tabindex="-1" hidden>
      <div class="stage__backdrop"></div>
      <div class="stage__rays" aria-hidden="true"></div>
      <div class="stage__body">
        <p class="stage__caption" id="stage-caption"></p>
        <div class="stage__center"></div>
        <div class="stage__actions" hidden>
          <button type="button" class="btn btn--primary" data-action="again">Deal again</button>
          <button type="button" class="btn btn--ghost" data-action="change">Change plans</button>
        </div>
        <p class="stage__skip">Tap or press Space to skip</p>
      </div>
    </div>
    <div class="sr-only" id="announcer" aria-live="polite"></div>
  `;
}

// Plain text (set with textContent): "34 date ideas in the hat".
export function hatCountText(count: number): string {
  return `${plural(count, 'date idea')} in the hat`;
}

export function renderTimeOptions(times: number[], selected: number): string {
  return times
    .map((t) => `<option value="${t}"${t === selected ? ' selected' : ''}>${timeLabel(t)}</option>`)
    .join('');
}

export function renderBudgetOptions(budgets: number[], selected: number): string {
  return budgets
    .map((b) => `<option value="${b}"${b === selected ? ' selected' : ''}>${budgetLabel(b)}</option>`)
    .join('');
}

// Each category shows how many ideas fit the current time and budget, e.g.
// "🍝 Food · 4". A 0 stays selectable; the hint explains what to change.
export function renderCategoryOptions(
  categories: { name: string; count: number }[],
  selected: string | null,
): string {
  const options = categories.map(({ name, count }) => {
    const isSelected = name === selected ? ' selected' : '';
    return `<option value="${esc(name)}"${isSelected}>${categoryStyle(name).emoji} ${esc(name)} · ${count}</option>`;
  });
  return [`<option value=""${selected === null ? ' selected' : ''}>Any category</option>`, ...options].join('');
}

// Plain text (set with textContent): "12 ideas fit", or the nearestFix hint
// when none do.
export function fitText(count: number, hint: string): string {
  return count ? `${plural(count, 'idea')} fit${count === 1 ? 's' : ''}` : hint;
}

function timeChip(hours: number): string {
  return hours === 0 ? 'Under 1 hr' : `${hours} hr${hours === 1 ? '' : 's'}`;
}

function budgetChip(dollars: number): string {
  return dollars === 0 ? 'Free' : `$${dollars.toLocaleString('en-US')}`;
}

// Face-down card art.
const CARD_BACK = '<span class="card-back__mark">♥</span>';

// A stack of plain card backs in the middle of the table, which the reveal
// shuffles and deals. No idea is on any of them.
export function renderDeck(count = 5): string {
  const cards = Array.from(
    { length: count },
    (_, i) => `<div class="card-back deck__card" style="--i: ${i}">${CARD_BACK}</div>`,
  ).join('');
  return `<div class="deck" aria-hidden="true">${cards}</div>`;
}

function renderResult(a: Activity): string {
  const { emoji, color } = categoryStyle(a.category);
  return `
    <article class="result" style="--cat: ${color}">
      <span class="result__badge">${emoji} ${esc(a.category)}</span>
      <h2 class="result__idea" tabindex="-1">${esc(a.idea)}</h2>
      <ul class="result__chips">
        <li class="result__chip">⏱ ${timeChip(a.time)}</li>
        <li class="result__chip">💵 ${budgetChip(a.budget)}</li>
      </ul>
    </article>
  `;
}

// The winner's face, the far side of the dealt card. It rests face up; the
// reveal turns it in from edge-on.
export function renderFlipCard(a: Activity): string {
  return `<div class="flip">${renderResult(a)}</div>`;
}
