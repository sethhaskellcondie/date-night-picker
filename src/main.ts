import './style.css';
import { FALLBACK, loadLiveActivities, readCachedActivities, type Activity } from './activities';
import { buildOptions, eligible, nearestFix, pickRandom, settleFilters, type Filters } from './picker';
import {
  fitText,
  hatCountText,
  renderBudgetOptions,
  renderCategoryOptions,
  renderShell,
  renderTimeOptions,
} from './render';
import { closeStage, isStageOpen, runReveal } from './reveal';
import { byId, loadStored, store } from './shared';
import { isMuted, setMuted, unlockAudio } from './sound';

const INPUTS_KEY = 'date-night-inputs-v1';

// Last used choices, checked against the current options before use.
function readStoredFilters(): Partial<Filters> {
  const value = loadStored(INPUTS_KEY);
  if (typeof value !== 'object' || value === null) return {};
  const v = value as Record<string, unknown>;
  return {
    hours: typeof v.hours === 'number' ? v.hours : undefined,
    dollars: typeof v.dollars === 'number' ? v.dollars : undefined,
    category: typeof v.category === 'string' ? v.category : null,
  };
}

const app = document.querySelector<HTMLDivElement>('#app');

if (app) {
  app.innerHTML = renderShell();

  const planner = byId<HTMLFormElement>('planner');
  const timeSelect = byId<HTMLSelectElement>('f-time');
  const budgetSelect = byId<HTMLSelectElement>('f-budget');
  const categorySelect = byId<HTMLSelectElement>('f-category');
  const fit = byId('fit');
  const pick = byId<HTMLButtonElement>('pick');
  const hatCount = byId('hat-count');
  const soundToggle = byId<HTMLButtonElement>('sound-toggle');
  const stage = byId('stage');

  // The pick is always made from this array as it is when the button is
  // pressed. Live data that lands mid-reveal waits in `pending` until the
  // reveal settles.
  const cached = readCachedActivities();
  let activities: Activity[] = cached ?? FALLBACK;
  console.info(`[date-night] ${activities.length} ideas from the ${cached ? 'cache' : 'fallback'}.`);
  // What the user last chose (empty until they choose), and that choice
  // settled onto the current options. Settling always starts from the real
  // choice, so untouched dropdowns keep tracking the busiest time and budget.
  let wanted = readStoredFilters();
  let filters = settleFilters(activities, wanted);
  let revealing = false;
  let pending: Activity[] | null = null;

  // Category counts, the "N ideas fit" line and the button follow every change.
  const renderFitState = () => {
    const { categories } = buildOptions(activities);
    categorySelect.innerHTML = renderCategoryOptions(
      categories.map((name) => ({ name, count: eligible(activities, { ...filters, category: name }).length })),
      filters.category,
    );
    const count = eligible(activities, filters).length;
    fit.textContent = fitText(count, nearestFix(activities, filters));
    fit.classList.toggle('fit--empty', count === 0);
    pick.disabled = count === 0;
  };

  // Rebuilds every dropdown from the data, keeping current choices where
  // they're still valid.
  const renderControls = () => {
    const options = buildOptions(activities);
    filters = settleFilters(activities, wanted);
    timeSelect.innerHTML = renderTimeOptions(options.times, filters.hours);
    budgetSelect.innerHTML = renderBudgetOptions(options.budgets, filters.dollars);
    hatCount.textContent = hatCountText(activities.length);
    renderFitState();
  };

  const useActivities = (list: Activity[]) => {
    activities = list;
    renderControls();
  };

  const renderSoundToggle = () => {
    soundToggle.textContent = isMuted() ? '🔇' : '🔊';
    soundToggle.setAttribute('aria-pressed', String(isMuted()));
  };

  const deal = async () => {
    if (revealing) return;
    const pool = eligible(activities, filters);
    const winner = pickRandom(pool);
    if (!winner) {
      closeStage();
      return;
    }
    unlockAudio(); // still inside the click, so autoplay rules allow it
    revealing = true;
    try {
      await runReveal({ winner, pool, category: filters.category });
    } finally {
      revealing = false;
      if (pending) {
        useActivities(pending);
        pending = null;
      }
    }
  };

  renderControls();
  renderSoundToggle();

  planner.addEventListener('change', () => {
    filters = {
      hours: Number(timeSelect.value),
      dollars: Number(budgetSelect.value),
      category: categorySelect.value || null,
    };
    wanted = filters;
    store(INPUTS_KEY, filters);
    renderFitState();
  });

  planner.addEventListener('submit', (e) => {
    e.preventDefault();
    void deal();
  });

  stage.addEventListener('click', (e) => {
    if (!(e.target instanceof Element)) return;
    const action = e.target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'again') void deal();
    else if (action === 'change') closeStage();
  });

  // Esc on a settled result goes back to the form (during a reveal it skips).
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isStageOpen() && !revealing) closeStage();
  });

  soundToggle.addEventListener('click', () => {
    setMuted(!isMuted());
    renderSoundToggle();
  });

  void loadLiveActivities().then((live) => {
    if (!live) return;
    console.info(`[date-night] ${live.length} ideas from the sheet.`);
    if (revealing) pending = live;
    else useActivities(live);
  });
}
