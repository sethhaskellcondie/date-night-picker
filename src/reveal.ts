import type { Activity } from './activities';
import { categoryStyle } from './categories';
import { burstConfetti, clearConfetti } from './confetti';
import { buildReel } from './picker';
import { renderDeck, renderFlipCard, renderReel } from './render';
import { byId } from './shared';
import { drumroll, taDa, tick, type Drumroll } from './sound';

// Every duration in the reveal, in ms and in timeline order. Tune the feel
// here; the whole full sequence runs about 7 s.
export const REVEAL_TIMINGS = {
  lockIn: 400, // 1. the form shrinks away and the backdrop dims
  shuffle: 1000, // 2. the deck riffles; the drumroll starts
  spin: 3000, // 3. the reel spins, slows and crawls onto the near miss
  nearMissHold: 450, // 4. "…is it?"
  nearMissStep: 350, //    then one click forward with an overshoot
  hold: 800, // 5. heartbeat pulses while the drumroll swells, then cuts
  flip: 700, // 6. the card flips face up and scales in…
  reveal: 1200, //    …inside the whole reveal stage
  single: 1600, // a pool of one: drumroll over the face-down card instead of 2–5
  choosing: 1000, // reduced motion: a "Choosing…" fade instead of 1–5
  close: 250, // the stage fades out on Change plans
};

const T = REVEAL_TIMINGS;
const REEL_SLOTS = 30;
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

  // Calls step(t) every frame with t going 0 → 1 over `ms`.
  frames(ms: number, step: (t: number) => void): Promise<void> {
    return this.pause((done) => {
      const start = performance.now();
      let raf = 0;
      const frame = (now: number) => {
        const t = Math.min((now - start) / ms, 1);
        step(t);
        if (t < 1) raf = requestAnimationFrame(frame);
        else done();
      };
      raf = requestAnimationFrame(frame);
      return () => cancelAnimationFrame(raf);
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

// Fast at first, then a long slow-down; the tail is the crawl.
function spinEase(t: number): number {
  return 1 - (1 - t) ** 2.4;
}

// Overshoots past 1, then settles back onto it.
function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

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

// 3. Spin and 4. near miss. Resolves with the reel.
async function spin(run: Run, els: Stage, req: RevealRequest): Promise<HTMLElement> {
  const slots = buildReel(req.pool, req.winner, REEL_SLOTS);
  els.center.innerHTML = renderReel(slots);
  const reel = els.center.querySelector<HTMLElement>('.reel');
  const strip = els.center.querySelector<HTMLElement>('.reel__strip');
  if (!reel || !strip) throw new Error('The reel failed to render');
  const items = [...strip.children] as HTMLElement[];
  items[items.length - 1].classList.add('is-winner');
  const itemHeight = items[0].getBoundingClientRect().height;

  // Moves the strip so slot `pos` sits on the center line, ticking once for
  // each new slot that arrives there. Nothing changes color as items pass;
  // only the small category chips are colored, so nothing flashes.
  let centered = 0;
  const place = (pos: number) => {
    strip.style.transform = `translateY(${-pos * itemHeight}px)`;
    const index = Math.round(pos);
    if (index === centered) return;
    centered = index;
    tick();
  };

  const nearMiss = slots.length - 2;
  run.fx(reel, [{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
  await run.frames(T.spin, (t) => place(nearMiss * spinEase(t)));

  setCaption(run, els, '…is it?');
  await run.wait(T.nearMissHold);
  await run.frames(T.nearMissStep, (t) => place(nearMiss + easeOutBack(t)));
  return reel;
}

// 5. Hold: everything but the winner fades, the framed winner gets two
// heartbeats, and the drumroll swells and cuts.
async function hold(run: Run, els: Stage, reel: Element, fx: Effects): Promise<void> {
  setCaption(run, els, "Tonight's date is…");
  reel.classList.add('reel--hold');
  fx.drum?.swell(T.hold);
  await run.play(reel, HEARTBEAT, { duration: T.hold, easing: 'ease-in-out' });
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

// 6. Reveal: the card flips face up and scales in, rays turn behind it, and
// confetti and the ta-da land as its face comes round.
async function flip(run: Run, els: Stage, req: RevealRequest, fx: Effects): Promise<void> {
  if (!els.center.querySelector('.flip')) els.center.innerHTML = renderFlipCard(req.winner, true);
  const card = els.center.querySelector('.flip');
  const inner = els.center.querySelector('.flip__inner');
  if (!card || !inner) throw new Error('The flip card failed to render');
  card.classList.remove('flip--down');
  els.root.classList.add('stage--rays');
  const flipping = run.play(
    inner,
    [
      { transform: 'rotateY(0deg) scale(0.7)' },
      { transform: 'rotateY(200deg) scale(1.05)', offset: 0.7 },
      { transform: 'rotateY(180deg) scale(1)' },
    ],
    { duration: T.flip, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' },
  );
  flipping.catch(() => {}); // a skip rejects it while the wait below is pending
  await run.wait(T.flip * 0.45);
  celebrate(req, fx, true);
  await flipping;
  await run.wait(T.reveal - T.flip);
}

async function playFull(run: Run, els: Stage, req: RevealRequest, fx: Effects, opening: boolean): Promise<void> {
  if (opening) await lockIn(run, els);
  await shuffle(run, els, req, fx);
  const reel = await spin(run, els, req);
  await hold(run, els, reel, fx);
  await flip(run, els, req, fx);
}

// A pool of one skips the shuffle and the reel, but not the suspense.
async function playSingle(run: Run, els: Stage, req: RevealRequest, fx: Effects, opening: boolean): Promise<void> {
  if (opening) await lockIn(run, els);
  setCaption(run, els, 'Only one idea fits… but you still get a drumroll.');
  els.center.innerHTML = renderFlipCard(req.winner, true);
  fx.drum = drumroll();
  fx.drum.swell(T.single);
  const card = els.center.querySelector('.flip');
  if (card) await run.play(card, HEARTBEAT, { duration: T.single, easing: 'ease-in-out' });
  fx.drum.stop();
  setCaption(run, els, "Tonight's date is…");
  await flip(run, els, req, fx);
}

// Reduced motion: no shrinking, riffling, spinning, flipping, rays or
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

// 7. Settle: the end state of stage 6, reached by finishing or by skipping.
function settle(els: Stage, req: RevealRequest, fx: Effects, reduced: boolean): void {
  fx.drum?.stop();
  if (!els.center.querySelector('.flip')) els.center.innerHTML = renderFlipCard(req.winner);
  els.center.querySelector('.flip')?.classList.remove('flip--down');
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
// the stage if it isn't up yet; "Spin again" reuses the open stage and starts
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
