# Design Notes — Date Night Picker

A small static site for picking a date night. You choose how much time and
money you have, and optionally a category. It picks one idea at random from
a list kept in a Google Sheet and shows it with a long, suspenseful reveal.
This document explains how the site is built, where its data comes from, and
how to make changes.

## Architecture at a glance

```
┌──────────────┐  edits   ┌────────────────────┐
│ You / spouse │ ───────► │  Google Sheet       │  activities tab (private)
└──────────────┘          │  time|budget|cat|idea│
                          └─────────┬──────────┘
                                    │ SpreadsheetApp
                          ┌─────────▼──────────┐
                          │ Apps Script web app │  doGet() → {"activities":[…]}
                          └─────────┬──────────┘
                                    │ fetch() from the browser on page load
┌──────────────┐  git push ┌─────────▼──────────┐
│ GitHub master│ ────────► │ Vercel (static)     │  serves dist/ built by Vite
└──────────────┘  auto-    │  date-night-picker  │  parse → Activity[] in memory
                  deploy   │                     │  dropdowns → filter → pick → reveal
                           └────────────────────┘
```

There is **no server in this repo**. Vercel only serves the static bundle.
The browser calls the Apps Script endpoint directly, and the build never
calls it. Editing the sheet changes the ideas **and the dropdown options** on
the next page load, with no build or deploy.

> **Status note:** the Apps Script isn't deployed yet. `SCRIPT_URL` in
> `src/config.ts` is `''`, so the site runs on `src/fallback-activities.json`,
> which holds **12 placeholder ideas**. To switch to the real sheet, follow
> "First-time setup" below.

## Repo layout

| Path | Purpose |
|------|---------|
| `index.html` | Page shell: Google Fonts (Fraunces, DM Sans), meta and Open Graph tags, `#app` |
| `src/main.ts` | Boot: renders the shell, loads data, fills and rebuilds the dropdowns, remembers choices, starts reveals |
| `src/config.ts` | `SCRIPT_URL`, the Apps Script endpoint (`''` = off) |
| `src/activities.ts` | `Activity` type, `parseActivities` (row-by-row validation), localStorage cache, live fetch, bundled fallback |
| `src/fallback-activities.json` | Snapshot of the sheet, written by `npm run snapshot` |
| `src/picker.ts` | Pure logic: `eligible`, `pickRandom`, `buildOptions`, `settleFilters`, `nearestFix`, dropdown labels |
| `src/categories.ts` | Category → emoji and color, with a hashed color and ✨ for unknown categories |
| `src/render.ts` | `render*()` functions returning HTML strings: shell, dropdown options, deck, result card |
| `src/reveal.ts` | The staged reveal timeline, `REVEAL_TIMINGS`, skip, the pool-of-one and reduced-motion paths |
| `src/confetti.ts` | Canvas confetti burst (about 150 particles) |
| `src/sound.ts` | Web Audio drumroll, card snap and ta-da, plus the remembered mute toggle |
| `src/shared.ts` | `esc()`, `plural()`, best-effort localStorage helpers, `byId()` |
| `src/style.css` | All styling. Theme tokens are on `:root` |
| `src/*.test.ts` | Vitest unit tests for `activities.ts` and `picker.ts` |
| `apps-script/Code.js` | Mirror of the sheet-bound Apps Script (deployment is still copy-paste) |
| `scripts/snapshot-activities.mjs` | `npm run snapshot`: refreshes the fallback JSON from the live endpoint |
| `public/favicon.svg` | Tab icon |
| `localFiles/` | Untracked local notes, including the original plan (see `.gitignore`) |

Commands: `npm run dev` (local dev server), `npm run build` (type-check and
production bundle in `dist/`), `npm run preview` (serve the built bundle),
`npm test` (unit tests), `npm run snapshot` (refresh the fallback).

## The data layer

### The Google Sheet (the "database")

One tab holds every idea. **Row 1 is the header row and its values become the
JSON keys.** Keep it frozen. The script trims and lowercases headers, so
`Time` or `budget ` still work, but the words themselves must stay
`time | budget | category | idea`.

| time | budget | category | idea |
|------|--------|----------|------|
| 3 | 40 | Food | Cook a new cuisine together |
| 1 | 0 | Outdoors | Sunset walk at the park |

- `time`: whole hours, at least 0. `0` means "less than an hour"; a time
  under an hour like `0.5` counts as `0` too. Longer fractions like `1.5`
  are rejected.
- `budget`: whole dollars, at least 0. `0` means free. `$40` and `1,200` are
  accepted too.
- `category`: free text. **The category dropdown is built from these
  values**, so spelling matters: "Outdoor" and "Outdoors" are two options.
  Case and extra spaces are normalized, so `food ` and `Food` are one
  category (the first spelling in the sheet is the label shown).
  A blank category becomes **Other**.
- `idea`: required. A row with a blank idea is skipped.

**Guardrails.** Add Sheets data validation (Data → Data validation), since the
site's options come straight from the sheet:

- `budget` column: *Whole number ≥ 0*, reject input. Bad numbers are then
  stopped in the sheet, where the editor can see them.
- `time` column: *Custom formula is* `=AND(ISNUMBER(A2), A2>=0, OR(A2<1, A2=INT(A2)))`
  (whole hours, or under an hour), reject input.
- `category` column: a *Dropdown* listing the current categories. New
  categories can still be added to that list, but typos can't sneak in.

### The Apps Script (the "API")

Bound to the sheet under **Extensions → Apps Script**. The source is mirrored
in `apps-script/Code.js`. Keep the two in sync: edit the repo copy, then paste
it into the editor.

```javascript
const TAB_NAME = 'Activities'; // the existing tab's name

function doGet() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_NAME);
  return ContentService.createTextOutput(
    JSON.stringify({ activities: tabToObjects(sheet) }),
  ).setMimeType(ContentService.MimeType.JSON);
}

function tabToObjects(sheet) {
  const [headers, ...rows] = sheet.getDataRange().getValues();
  const keys = headers.map((h) => String(h).trim().toLowerCase());
  return rows
    .filter((row) => row.some((cell) => cell !== ''))
    .map((row) => Object.fromEntries(keys.map((k, i) => [k, String(row[i])])));
}
```

Deployed via **Deploy → New deployment → Web app** with **Execute as: Me**
(this keeps the sheet private) and **Who has access: Anyone**. That gives a
stable `https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec` URL, which
goes in `src/config.ts`. No triggers or CacheService are needed: a few dozen
rows read in milliseconds.

### The frontend (the "client")

`parseActivities` turns the payload into typed `Activity` objects. It accepts
the live `{activities: [...]}` payload or a bare array (the cache and the
fallback). **Rows are checked one at a time:** an invalid row is dropped with
a `console.warn` naming its sheet row (e.g. *Skipping sheet row 5: time "abc"
isn't a whole number ≥ 0*), and the other ideas still load. If no valid rows
are left it returns `null`, so an empty or broken sheet never replaces a good
list. (Row numbers assume no fully blank rows above the bad one, since the
script skips those.)

Loading strategy:

1. **On boot, right away:** the localStorage cache (`date-night-activities-v1`)
   or, failing that, the bundled fallback. The dropdowns are filled from it,
   so the form works on the first frame and the Apps Script cold start never
   shows.
2. **In the background:** `fetch(SCRIPT_URL)` → validate → replace the list →
   cache it → rebuild the dropdowns and the "N date ideas in the hat" line.
3. **On any failure:** keep what's loaded and `console.warn`.
4. The pick uses the list in memory when the button is pressed. If live data
   arrives during a reveal, the reveal finishes on the idea it already chose
   and the dropdowns are rebuilt once it settles.

### The fallback snapshot

`npm run snapshot` reads `SCRIPT_URL` from `src/config.ts`, fetches it, and
writes the rows to `src/fallback-activities.json`. The client runs that file
through the same `parseActivities`. Run it after big sheet changes and commit
the JSON. **It never runs in the Vercel build**, so a slow or broken Apps
Script can't break a deploy. The snapshot only matters to first-time visitors
when the endpoint is down.

## The dropdowns

All three are native `<select>`s built from the data in memory
(`buildOptions`):

| Dropdown | Options | Default |
|---|---|---|
| How much time? | Each distinct `time`, ascending: "Less than an hour", "1 hour", "n hours" | Last used, else the busiest pair (below) |
| What's the budget? | Each distinct `budget`, ascending: "Free", "$n" | Last used, else the busiest pair (below) |
| Category (optional) | "Any category", then each category A→Z with an emoji and how many ideas fit the current time and budget ("🍝 Food · 4") | Last used, else "Any category" |

Time and budget match exactly: a 3-hour, $40 idea fits "3 hours" and "$40",
not "4 hours" or "$50". Choices are remembered in localStorage
(`date-night-inputs-v1`). Whenever the options change (boot, live data),
`settleFilters` fits the last choice onto them: a time or budget that's gone
moves to the largest option at or below it (or the smallest if there's none),
and a category that's gone resets to "Any category". Until someone touches a
dropdown, time and budget follow the busiest pair — the time and budget
shared by the most ideas (shorter and cheaper on a tie) — so ideas always fit.

When nothing fits, the button is disabled and `nearestFix` explains what to
change in dropdown terms, e.g. *No Outdoors ideas fit — try $40, 3 hours, or
Any category*. Each suggestion works on its own and is the option closest to
the current one (the smaller on a tie).

## The reveal

The winner is chosen **before** any animation starts (`pickRandom` over the
ideas that fit, uniform and independent, so repeats are possible). The reveal
only displays it, which keeps the logic testable and makes skipping safe.

| # | Stage | Timing key | What happens |
|---|-------|-----------|--------------|
| 1 | Lock in | `lockIn` | The form shrinks away; the spotlight backdrop fades in |
| 2 | Shuffle | `shuffle` | A five-card deck riffles; "Shuffling 12 ideas that fit…"; drumroll starts |
| 3 | Deal | `deal`, `dealGap` | Three cards are dealt face down to the left, the right and the middle, each landing with a snap; the rest of the deck fades |
| 4 | Hold | `clear`, `hold` | The two outside cards slide away face down; the middle card gets two heartbeats; the drumroll swells and cuts |
| 5 | Reveal | `turn`, `flip`, `reveal` | The middle card turns over and grows into the winner; rays turn; confetti and the ta-da land |
| 6 | Settle | — | **Deal again** (new pick, same choices) and **Change plans** (back to the form, also Esc) |

- **No fake-outs:** the dealt cards are plain backs with nothing on them.
  The outside cards are never turned over, and the winner isn't rendered
  (not even hidden in the page) until the middle card turns. The only idea
  anyone sees is the one that was picked. The card turns edge-on, and at
  that moment it's swapped for the full-size result card, which turns the
  rest of the way.
- **Tuning:** every duration is in `REVEAL_TIMINGS` at the top of
  `src/reveal.ts`. Tune by feel on a real phone. The full run is about 5.5 s.
- **Skip:** a tap on the stage, **Space** or **Esc** cancels the running
  stage and jumps to the settled result. Deal again can't start while a
  reveal is running.
- **Pool of one:** the shuffle and deal are skipped. A single face-down card
  pulses under "Only one idea fits… but you still get a drumroll." and then
  turns over.
- **Reduced motion** (`prefers-reduced-motion`): stages 1–4 become a 1 s
  "Choosing…" and the result fades in, with no rays or confetti. Sound still
  plays unless muted.
- **No strobing:** nothing flashes full-screen, and the rays turn once every
  40 s.
- **Accessibility:** the result is announced through an `aria-live` region
  ("Tonight's date: …") and focus moves to the result heading. The stage is a
  modal dialog, and the page behind it is `inert`.
- **Sound** is synthesized with Web Audio, so there are no files. The
  `AudioContext` is created on the "Pick our date" press, a user gesture, so
  autoplay rules allow it. The 🔊/🔇 toggle is remembered
  (`date-night-muted-v1`). On iPhone the hardware silent switch also mutes it,
  which is expected.

## How to make updates

**Add or edit ideas:** edit the sheet. Live on the next page load.

**Add a category:** type it in the sheet (and add it to the category
column's validation list). It appears in the dropdown on the next load with
✨ and a color derived from its name. To give it a proper emoji and color,
add it to `KNOWN` in `src/categories.ts` (lowercase key) and deploy.

**Change the look:** `src/style.css` (theme tokens on `:root`) and the
`render*()` functions in `src/render.ts`. Check with `npm run dev`.

**Change the Apps Script:** edit `apps-script/Code.js`, paste it into the
script editor, then **Deploy → Manage deployments → edit (pencil) → Version:
New version**. Saving alone does **not** update the live URL. Editing the
existing deployment keeps the URL; a new deployment would mint a new one.

**Emergency off switch:** set `SCRIPT_URL = ''` and push. The site runs on
cached or fallback data.

### First-time setup (remaining Phase 2 steps)

1. Open the sheet. Note the tab name and check that row 1 reads
   `time | budget | category | idea`. Add the data validation above.
2. Paste `apps-script/Code.js` into Extensions → Apps Script, set `TAB_NAME`,
   and deploy it as a web app (Execute as: Me, access: Anyone).
3. Put the `/exec` URL in `src/config.ts` as `SCRIPT_URL`.
4. `npm run snapshot` to replace the placeholder fallback with the real ideas.
5. Rewrite `KNOWN` in `src/categories.ts` from the real category list.
6. Check: the console shows "N ideas from the sheet", and with
   `SCRIPT_URL = ''` the site still loads N ideas from the fallback.

## Hosting (Vercel)

- **Add New → Project → import `sethhaskellcondie/date-night-picker`**. The
  preset is detected as **Vite**: build `npm run build`, output `dist`,
  install `npm install`. No `vercel.json` or environment variables are needed.
- **Production branch: `master`.** Every push to `master` deploys to the
  production URL.
- **A failed build never goes live.** `npm run build` runs `tsc` first, so a
  type error fails the deploy and the previous version keeps serving.
- **Rollback:** Vercel's *Instant Rollback* (Deployments → … → Instant
  Rollback) for anything that builds but misbehaves.
- Node: `"engines": { "node": ">=22" }` in `package.json` keeps local and
  Vercel builds on the same major version.

## Constraints and gotchas

- **Read-only by design.** The site never writes to the sheet.
- **Everything the script returns is public.** Anyone with the URL can read
  the ideas. That's fine for date ideas, but don't add private columns.
- **All values arrive as strings.** `tabToObjects` stringifies cells, and the
  client coerces `time` and `budget`.
- **The header row is the schema.** Renaming a header drops that field from
  every row; the validation then drops the rows and warns.
- **Cold starts:** the first request after idle takes 1–2 s. The cache-first
  render hides it.
- **Open Graph image:** none yet. Link previews show the title and
  description only. Adding one needs an absolute URL, so do it once the
  production domain is settled.
