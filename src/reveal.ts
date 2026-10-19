import type { Activity } from './activities';
import { categoryStyle } from './categories';
import { burstConfetti, clearConfetti } from './confetti';
import { renderDeck, renderFlipCard } from './render';
import { byId } from './shared';
import { drumroll, snap, taDa, type Drumroll } from './sound';

// Every duration in the reveal, in ms and in timeline order. Tune the feel
// here; the whole full sequence runs about 5.5 s.
export const REVEAL_TIMINGS = {
  lockIn: 400, // 1. the form shrinks away and the backdrop dims
  shuffle: 1000, // 2. the deck riffles; the drumroll starts
  deal: 450, // 3. each card's flight from the deck to its place…
  dealGap: 300, //    …and the gap before the next card leaves
  clear: 450, // 4. the outside cards slide away face down…
  hold: 1100, //    …while the middle card's heartbeat and the drumroll swell, then cut
  turn: 220, // 5. the middle card turns edge-on…
  flip: 650, //    …and comes round as the winner, growing to full size…
  reveal: 1200, //    …inside the whole reveal stage
  single: 1600, // a pool of one: drumroll over the face-down card instead of 2–4
  choosing: 1000, // reduced motion: a "Choosing…" fade instead of 1–4
  close: 250, // the stage fades out on Change plans
};

const T = REVEAL_TIMINGS;
const BRAND_COLORS = ['#ff6f91', '#ffc56b', '#c9a7ff', '#fff4e0'];

export interface RevealRequest {
  winner: Activity; // chosen before the reveal starts; the animation never changes it
  pool: Activity[];
  category: string | null;
}

class Skipped extends Error {}

// One reveal's cancel token. Skipping cancels the tracked animations and
// wakes every pending wait, and each await then throws Skipped so the
// timeline stops where it is.
class Run {
  skipped = false;
  private animations = new Set<Animation>();
  private wakers = new Set<() => void>();

  skip(): void {
    if (this.skipped) return;
    this.skipped = true;
    [...this.animations].forEach((a) => a.cancel());
    [...this.wakers].forEach((wake) => wake());
  }

  private check(): void {
    if (this.skipped) throw new Skipped();
  }

  private pause(start: (done: () => void) => () => void): Promise<void> {
    this.check();
    return new Promise<void>((resolve) => {
      const done = () => {
        stop();
        this.wakers.delete(done);
        resolve();
      };
      this.wakers.add(done);
      const stop = start(done);
    }).then(() => this.check());
  }

  wait(ms: number): Promise<void> {
    return this.pause((done) => {
      const timer = setTimeout(done, ms);
      return () => clearTimeout(timer);
    });
  }

  // Fire-and-forget animation that a skip still cancels.
  fx(el: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation | null {
    if (this.skipped) return null;
    const anim = el.animate(keyframes, options);
    this.animations.add(anim);
    const forget = () => this.animations.delete(anim);
    anim.finished.then(forget, forget);
    return anim;
  }

  async play(el: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions): Promise<void> {
    this.check();
    const anim = this.fx(el, keyframes, options);
    try {
      await anim?.finished;
    } catch {
      // Cancelled by a skip; check() below turns that into Skipped.
    }
    this.check();
  }
}

interface Stage {
  root: HTMLElement;
  backdrop: HTMLElement;
  caption: HTMLElement;
  center: HTMLElement;
  actions: HTMLElement;
  skipHint: HTMLElement;
  page: HTMLElement;
  planner: HTMLElement;
}

function stageEls(): Stage {
  const root = byId('stage');
  const part = (selector: string) => {
    const el = root.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`${selector} is missing from the stage`);
    return el;
  };
  return {
    root,
    backdrop: part('.stage__backdrop'),
    caption: part('.stage__caption'),
    center: part('.stage__center'),
    actions: part('.stage__actions'),
    skipHint: part('.stage__skip'),
    page: byId('page'),
    planner: byId('planner'),
  };
}

// What has already happened, so settling after a skip doesn't repeat it.
interface Effects {
  drum: Drumroll | null;
  tada: boolean;
  confetti: boolean;
}

let open = false;
let closing: Animation | null = null;

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function setCaption(run: Run, els: Stage, text: string): void {
  if (els.caption.textContent === text) return;
  els.caption.textContent = text;
  run.fx(els.caption, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], {
    duration: 250,
    easing: 'ease-out',
  });
}

// Two quick heartbeat pulses.
const HEARTBEAT: Keyframe[] = [
  { transform: 'scale(1)' },
  { transform: 'scale(1.04)', offset: 0.15 },
  { transform: 'scale(1)', offset: 0.3 },
  { transform: 'scale(1.07)', offset: 0.5 },
  { transform: 'scale(1)', offset: 0.75 },
  { transform: 'scale(1)' },
];

function openStage(els: Stage): void {
  closing?.cancel();
  closing = null;
  open = true;
  els.root.hidden = false;
  els.page.inert = true;
  document.body.classList.add('is-staged');
}

function resetStage(els: Stage): void {
  els.root.classList.remove('stage--rays');
  els.caption.textContent = '';
  els.center.innerHTML = '';
  els.actions.hidden = true;
  els.skipHint.hidden = false;
}

// 1. Lock in. The page underneath stays "away" (CSS) while the stage is up.
async function lockIn(run: Run, els: Stage): Promise<void> {
  await Promise.all([
    run.play(els.planner, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.88)' }], {
      duration: T.lockIn,
      easing: 'cubic-bezier(0.5, 0, 0.75, 0)',
    }),
    run.play(els.backdrop, [{ opacity: 0 }, { opacity: 1 }], { duration: T.lockIn, easing: 'ease-out' }),
  ]);
}

// 2. Shuffle: alternate cards riffle out left and right, twice.
async function shuffle(run: Run, els: Stage, req: RevealRequest, fx: Effects): Promise<void> {
  const n = req.pool.length;
  setCaption(run, els, req.category ? `Shuffling ${n} ${req.category} ideas…` : `Shuffling ${n} ideas that fit…`);
  els.center.innerHTML = renderDeck();
  fx.drum = drumroll();
  const deck = els.center.firstElementChild;
  if (deck) run.fx(deck, [{ opacity: 0, transform: 'scale(0.8)' }, { opacity: 1, transform: 'none' }], { duration: 200 });
  const cards = [...els.center.querySelectorAll('.deck__card')];
  const stagger = 70;
  const each = (T.shuffle - stagger * (cards.length - 1)) / 2;
  cards.forEach((card, i) => {
    const dir = i % 2 === 0 ? -1 : 1;
    run.fx(
      card,
      [
        { transform: 'none' },
        { transform: `translateX(${dir * 70}px) rotate(${dir * 12}deg)`, offset: 0.45 },
        { transform: 'none' },
      ],
      { duration: each, delay: i * stagger, iterations: 2, easing: 'ease-in-out' },
    );
  });
  await run.wait(T.shuffle);
}

// The dealt cards: the middle one is the one that gets turned over.
interface Table {
  middle: HTMLElement;
  sides: HTMLElement[];
}

// 3. Deal: the top three cards fly out face down to the left, the right and
// then the middle, each landing with a snap, and the rest of the deck fades
// away under the middle card. Every card is a plain back; the winner is
// only rendered once the middle card turns over.
async function deal(run: Run, els: Stage): Promise<Table> {
  setCaption(run, els, 'Dealing the cards…');
  const cards = [...els.center.querySelectorAll<HTMLElement>('.deck__card')];
  if (cards.length < 3) throw new Error('The deck failed to render');
  const [left, right, middle] = cards.slice(-3).reverse(); // top card first
  const rest = cards.slice(0, -3);

  [left, right, middle].forEach((card, k) => {
    const slot = card === left ? -1 : card === right ? 1 : 0;
    // The card is moved to its place first, then flown in from the deck.
    const stacked = getComputedStyle(card).translate;
    card.style.setProperty('--slot', String(slot));
    card.classList.add('is-dealt');
    const dealt = getComputedStyle(card).translate;
    const flight = run.fx(
      card,
      [
        { translate: stacked, transform: 'none' },
        { transform: `translateY(-16px) rotate(${slot * -5}deg) scale(1.06)`, offset: 0.5 },
        { translate: dealt, transform: 'none' },
      ],
      { duration: T.deal, delay: k * T.dealGap, easing: 'cubic-bezier(0.3, 0.6, 0.3, 1)', fill: 'backwards' },
    );
    flight?.finished.then(snap, () => {});
  });
  for (const card of rest) {
    card.style.opacity = '0';
    run.fx(card, [{ opacity: 1 }, { opacity: 0 }], { duration: T.deal, delay: 2 * T.dealGap, fill: 'backwards' });
  }
  await run.wait(2 * T.dealGap + T.deal);
  return { middle, sides: [left, right] };
}

// 4. Hold: the outside cards slide away face down, never turned, and the
// middle card gets two heartbeats while the drumroll swells and cuts.
async function hold(run: Run, els: Stage, table: Table, fx: Effects): Promise<void> {
  setCaption(run, els, "Tonight's date is…");
  for (const card of table.sides) {
    const dir = Number(card.style.getPropertyValue('--slot'));
    card.style.opacity = '0';
    run.fx(
      card,
      [
        { opacity: 1, transform: 'none' },
        { opacity: 0, transform: `translate(${dir * 36}px, 18px) rotate(${dir * 8}deg) scale(0.9)` },
      ],
      { duration: T.clear, easing: 'ease-in' },
    );
  }
  fx.drum?.swell(T.hold);
  await run.play(table.middle, HEARTBEAT, { duration: T.hold, easing: 'ease-in-out' });
  fx.drum?.stop();
}

function celebrate(req: RevealRequest, fx: Effects, confetti: boolean): void {
  if (!fx.tada) {
    fx.tada = true;
    taDa();
  }
  if (confetti && !fx.confetti) {
    fx.confetti = true;
    burstConfetti([...BRAND_COLORS, categoryStyle(req.winner.category).color]);
  }
}

// 5. Reveal: the face-down card turns edge-on, then comes round as the
// winner's face and grows to full size. Rays turn behind it, and confetti and
// the ta-da land as its face comes round.
async function flip(run: Run, els: Stage, req: RevealRequest, fx: Effects, card: Element): Promise<void> {
  els.root.classList.add('stage--rays');
  await run.play(card, [{ transform: 'none' }, { transform: 'rotateY(90deg) scale(1.06)' }], {
    duration: T.turn,
    easing: 'ease-in',
  });
  els.center.innerHTML = renderFlipCard(req.winner);
  const face = els.center.querySelector('.result');
  if (!face) throw new Error('The result card failed to render');
  const turning = run.play(
    face,
    [
      { transform: 'rotateY(-90deg) scale(0.6)' },
      { transform: 'rotateY(20deg) scale(1.05)', offset: 0.6 },
      { transform: 'none' },
    ],
    { duration: T.flip, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' },
  );
  turning.catch(() => {}); // a skip rejects it while the wait below is pending
  await run.wait(T.flip * 0.2);
  celebrate(req, fx, true);
  await turning;
  await run.wait(T.reveal - T.turn - T.flip);
}

async function playFull(run: Run, els: Stage, req: RevealRequest, fx: Effects, opening: boolean): Promise<void> {
  if (opening) await lockIn(run, els);
  await shuffle(run, els, req, fx);
  const table = await deal(run, els);
  await hold(run, els, table, fx);
  await flip(run, els, req, fx, table.middle);
}

// A pool of one skips the shuffle and the deal, but not the suspense.
async function playSingle(run: Run, els: Stage, req: RevealRequest, fx: Effects, opening: boolean): Promise<void> {
  if (opening) await lockIn(run, els);
  setCaption(run, els, 'Only one idea fits… but you still get a drumroll.');
  els.center.innerHTML = renderDeck(1);
  const card = els.center.querySelector('.deck__card');
  if (!card) throw new Error('The card failed to render');
  fx.drum = drumroll();
  fx.drum.swell(T.single);
  await run.play(card, HEARTBEAT, { duration: T.single, easing: 'ease-in-out' });
  fx.drum.stop();
  setCaption(run, els, "Tonight's date is…");
  await flip(run, els, req, fx, card);
}

// Reduced motion: no shrinking, riffling, dealing, flipping, rays or
// confetti. Just a fade, a pause and the answer. Sound still plays.
async function playReduced(run: Run, els: Stage, req: RevealRequest, fx: Effects, opening: boolean): Promise<void> {
  if (opening) await run.play(els.root, [{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
  setCaption(run, els, 'Choosing…');
  fx.drum = drumroll();
  fx.drum.swell(T.choosing);
  await run.wait(T.choosing);
  fx.drum.stop();
  setCaption(run, els, "Tonight's date is…");
  els.center.innerHTML = renderFlipCard(req.winner);
  celebrate(req, fx, false);
  await run.play(els.center, [{ opacity: 0 }, { opacity: 1 }], { duration: 400 });
}

// 6. Settle: the end state of stage 5, reached by finishing or by skipping.
function settle(els: Stage, req: RevealRequest, fx: Effects, reduced: boolean): void {
  fx.drum?.stop();
  if (!els.center.querySelector('.result')) els.center.innerHTML = renderFlipCard(req.winner);
  els.root.classList.toggle('stage--rays', !reduced);
  els.caption.textContent = "Tonight's date is…";
  celebrate(req, fx, !reduced);

  els.skipHint.hidden = true;
  els.actions.hidden = false;
  if (!reduced) {
    els.actions.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], {
      duration: 300,
      easing: 'ease-out',
    });
  }

  // Cleared first so the same idea twice in a row is still announced.
  const announcer = byId('announcer');
  announcer.textContent = '';
  setTimeout(() => {
    announcer.textContent = `Tonight's date: ${req.winner.idea}`;
  }, 50);
  els.center.querySelector<HTMLElement>('.result__idea')?.focus();
}

// Runs the whole reveal and resolves once it has settled on the winner. Opens
// the stage if it isn't up yet; "Deal again" reuses the open stage and starts
// at the shuffle.
export async function runReveal(req: RevealRequest): Promise<void> {
  const els = stageEls();
  const run = new Run();
  const reduced = reducedMotion();
  const opening = !open;
  const fx: Effects = { drum: null, tada: false, confetti: false };

  resetStage(els);
  if (opening) openStage(els);
  els.root.focus();

  // Tap, Space or Esc jumps to the end. Space on a button (the sound toggle)
  // keeps doing what the button does.
  const onKey = (e: KeyboardEvent) => {
    const isSpace = e.key === ' ' && !(e.target instanceof HTMLButtonElement);
    if (e.key !== 'Escape' && !isSpace) return;
    e.preventDefault();
    run.skip();
  };
  const onTap = () => run.skip();
  document.addEventListener('keydown', onKey);
  els.root.addEventListener('click', onTap);

  try {
    if (reduced) await playReduced(run, els, req, fx, opening);
    else if (req.pool.length === 1) await playSingle(run, els, req, fx, opening);
    else await playFull(run, els, req, fx, opening);
  } catch (err) {
    if (!(err instanceof Skipped)) throw err;
  } finally {
    document.removeEventListener('keydown', onKey);
    els.root.removeEventListener('click', onTap);
    settle(els, req, fx, reduced);
  }
}

export function isStageOpen(): boolean {
  return open;
}

// "Change plans": back to the form.
export function closeStage(): void {
  if (!open) return;
  open = false;
  const els = stageEls();
  const reduced = reducedMotion();
  const finish = () => {
    if (open) return; // reopened while fading out
    els.root.hidden = true;
    resetStage(els);
  };

  els.page.inert = false;
  document.body.classList.remove('is-staged');
  clearConfetti();
  byId('pick').focus();
  if (reduced) {
    finish();
    return;
  }
  els.planner.animate([{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'none' }], {
    duration: 300,
    easing: 'ease-out',
  });
  closing = els.root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: T.close, fill: 'forwards' });
  closing.finished.then(finish, finish);
}
