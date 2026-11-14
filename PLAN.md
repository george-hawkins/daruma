# Daruma: plan

Daruma (the repo is `japanese-study-app`) is a small installable web app (PWA) for Japanese study chores. This is a living document. It records the requirements, decisions and status so that work can carry on across separate sessions. Update it whenever something is decided or built.

## Status

- [x] Requirements and design agreed (below)
- [x] App shell: manifest, network-first service worker, top bar with tabs, sync indicator, settings page
- [x] Local persistence (localStorage, prefixed `daruma:`)
- [x] GitHub sync (Contents API, fine-grained token)
- [x] Forgotten kanji activity
- [x] Corrections activity
- [x] Icons (192/512 `any`, 512 `maskable`, 180 Apple touch icon) from `design/icon.svg`
- [x] Tested in headless Chrome (drawing, add, swipe-to-done + undo, tap-to-edit, Enter for new line, sync scenarios against a mocked GitHub API)
- [ ] GitHub Pages enabled (George, see below)
- [ ] Notes repo + token created and entered in Settings (George)
- [x] Multi-instance sync with three-way merge (0.7). Unit tests: `node --test` (in `test/`).
- [x] RTK lookup page (0.8): read-only keyword index and Anki deck from `anki-decks`, KanjiVG stroke order, Klee One. Unit tests in `test/rtk.test.mjs`; tested in headless Chrome against the real files.
- [ ] Try it on the phone; tune brush width (`BRUSH` in `js/kanji.js`) and anything else that feels off

## Requirements (the "what")

1. **A phone app for small, quick study chores.** It's used on Android, and is iOS-friendly where that's cheap. It must open instantly, work offline, and look like a native app (launcher icon, splash screen, no browser chrome).
2. **Nothing typed or ticked off is ever lost.** That holds when switching away, when Android kills the app, when there's no network, and when a new version is deployed.
3. **Data is stored as visible, versioned Markdown files on GitHub**, in a separate notes repo.
4. **Forgotten kanji:** a fast capture list of English keywords, newest at the top. The scroll position is remembered. Next to it is a finger-drawing scratch pad with a fixed black round brush and a single Clear button (no undo, no options). The list can be hidden. Entries can be edited or deleted, though this is very rare.
5. **Corrections:** two lists of one-line notes, "Corrections" (top ⅔) and "Maybe" (bottom ⅓). New items go at the top. Editing should be as easy as in a textarea. Marking an item done is quick. Done items are hidden in the app but kept in the file under `## Done`.
6. **Settings:** the GitHub URLs of the two files, and the access token. Also the two RTK files and their (optional, read-only) token.
7. **Hosting:** fully static, on GitHub Pages from this repo, updated by pushing.
8. **RTK lookup:** look a kanji up by frame number, kanji or keyword in two read-only files in another repo (`george-hawkins/anki-decks`): `rtk1-keywords.csv` (complete index of all 2200 frames) and `rtk1-v6.md` (the Anki deck, growing day by day). Show matches as a table, then a match as the back of its Anki card.

## Decisions

### Stack
- Plain HTML, CSS and JavaScript ES modules. No framework and **no build step**: the repo *is* the site.
- **Version:** `js/version.js` holds `VERSION`, shown in Settings → About. Bump it in every commit that changes the app, so the running version can be checked on the phone.
- Files: `index.html`, `styles.css`, `manifest.webmanifest`, `sw.js`, `js/` (`app.js` wiring, `store.js` localStorage, `markdown.js` parse/serialize, `github.js` API client, `sync.js` sync logic, `settings.js`, `ui.js` snackbar/dialogs/gestures, `kanji.js`, `corrections.js`, `rtk.js` RTK page, `rtkdata.js` RTK parsing/search/rendering, `rtksource.js` RTK fetching, `kanjivg-animate.js` George's stroke animator, copied unchanged from `george-hawkins/japanese`), `kanjivg/`, `fonts/`, `icons/`, `design/icon.svg` (icon source).

### Persistence and sync
- **Local first.** Every change is written to localStorage immediately. This is what guarantees nothing is lost, and it costs nothing. Text being typed in the "add" boxes is saved as a draft too. The service worker only caches the app's code, not data.
- All `*.github.io` project sites share one origin, so all keys are prefixed `daruma:`.
- **GitHub is a sync target.** Pushes (one commit each) happen when the app goes to the background, 60 s after the last edit, or when the sync indicator is tapped. Pulls happen on open, on returning to the app or the window regaining focus (if more than 30 s since the last pull), and every 5 minutes while visible (skipped while an input has focus). An interrupted push leaves the doc "dirty" and is retried next time.
- **Several instances edit the same files** (George adds corrections on his phone and marks them done in a laptop browser later; he also occasionally edits files on GitHub). Switching is slow and best effort is fine. Design, from 0.7:
  - Each doc stores `sha` (the blob it last synced) and `base` (that blob's parsed content). No git history beyond that is needed: `base` is the common ancestor for a three-way merge.
  - File changed on GitHub, no local changes: take GitHub's version.
  - Changed on both sides: `merge3(base, local, remote)` in `js/merge.js`, then push the result and show a notice. The merge works per item text, deciding which list it ends up in. One side changed it: take that. Both made the same change: take it. Both changed it differently: never lose the item, and prefer this device's list. Edits are remove-plus-add, so "edited here, marked done there" keeps both. New arrivals go at the top of their list (this device's first), then the rest in GitHub's order. Identical lines collapse into one.
  - First sync with a file URL: base = empty, so the merge is a union.
  - Docs synced by older versions have no `base`. It is fetched from GitHub by sha (`git/blobs/{sha}`), falling back to empty (union).
  - Writes send the base `sha`, so GitHub rejects them (409/422) if another instance pushed in between. The sync then re-reads, re-merges and retries (up to 3 attempts). The quick push on hide doesn't read first; if it's rejected, the next full sync merges.
  - Header, preamble and unknown sections can only change on GitHub, so GitHub's are kept.
  - 0.6's "which version do you want to keep?" prompt was replaced by this merge.
- Settings → *Sync details* shows, per document, the item count, whether there are unpushed changes, the last known GitHub blob sha and the result of the last sync. A missing file is created on the first sync, even when there is nothing new to push.
- Sync indicator: a line-icon cloud with a tick (synced), an up arrow (pending; pulsing while syncing), a slash (offline / not set up) or "!" (error). Tapping it shows the status and syncs now.
- Help: the ? button in the top bar opens a dialog. Its content is the `<template id="help">` in `index.html`; keep it in step with the gestures.

### Authentication
- A **fine-grained personal access token**, pasted into Settings. It is limited to the notes repo, with *Contents: Read and write* permission only.
- Why not "Sign in with GitHub": GitHub's OAuth needs a client secret (i.e. a server), and its token endpoints don't allow browser (CORS) requests. Google supports browser-only OAuth clients, which is why Google Drive sign-in works from static sites. This was considered and rejected: no server component.
- The token is stored in localStorage. It is readable by other project sites on the same origin, hence the narrow scope.

### File formats
- `forgotten.md`:
  ```
  # Forgotten kanji

  * apply
  * discard
  ```
- `corrections.md`:
  ```
  ## Corrections

  * Intelligent clue --> not CLEVER

  ## Maybe

  * Switch to Hawaii story for young

  ## Done

  * Discard clue: not DISPOSE
  ```
- Newest first in all lists. Text before the first section and unknown `##` sections are kept verbatim. `*` and `-` bullets are both accepted, and `*` is written.

### Navigation
- A top bar with tabs **Kanji | Corrections**, the sync indicator, and ⚙ for Settings. There's no hamburger menu until there's more to put in it.
- Navigation stays at the top (not bottom navigation) so it isn't hit while drawing. The last page shown is remembered.

### Forgotten kanji
- Left third: an add box at the top (Enter adds the entry at the top; focus stays in the box for the next word), with the list below it. Long-press an entry → Edit / Delete.
- ◀/▶ button hides or shows the list (remembered). The scroll position is saved and restored.
- Canvas: Pointer Events, `touch-action: none`, high-DPI, coalesced events plus quadratic smoothing. Only the first finger draws.
- Brush diameter = `BRUSH` (0.035) × the canvas's shorter side. The reference image is ~4.9 % of the kanji's size, and this gives ~4 %.
- The drawing is **not** preserved (George: drawings are throwaway). It does survive the canvas resizing, e.g. when the keyboard opens.

### Corrections
- Each list has an add box at the top. Enter adds the item and keeps focus, so several items can be typed in a row.
- Tap a row to edit it in place (the caret goes where you tap). Enter starts a new row below it. Rows left empty are removed.
- **Swipe a row either way → done**, with an **Undo** snackbar.
- Long-press → Move to the other list / Mark done / Delete.

### RTK lookup
- Tab **RTK**. It's backed by two **read-only** files in a different repo, so it has its own settings: the CSV URL, the deck URL and an optional token (fine-grained, *Contents: Read-only*; not needed for a public repo, since unauthenticated API reads are allowed, 60 an hour).
- **Fetching** (`js/rtksource.js`): raw Contents API (`application/vnd.github.raw+json`, no 1 MB limit) with the stored ETag, so an unchanged file is a 304. Checked only when forced (tapping the cloud, *Sync now*, *Save and test*) or when the last check is over 6 h old (tested whenever the normal sync runs). A changed URL is refetched at once. The text of both files (~300 KB) is kept in localStorage (`daruma:rtk`), so lookups work offline. Errors show in the sync icon like other sync errors.
- **Parsing** (`js/rtkdata.js`): the CSV handles quotes and CRLF. The deck follows the rules in `anki-decks/.claude/skills` (`rtk-caretaker/SKILL.md`, `rtk-story/ground.py`): `START`/`END` blocks, the note-type line, field labels `Keyword|Clue|Kanji|Reading|Story|Note|Update`, any other line continuing the current field (newlines are hard), and `<!-- … -->` comments skipped wherever they are, even over several lines (`ground.py` doesn't skip those; this parser matches it otherwise).
- **Search:** input is trimmed and full-width ASCII is made half-width.
  - Digits: a frame, in the CSV only.
  - One kanji: the CSV `kanji` column, plus cards with the kanji in any field.
  - Several kanji (e.g. a pasted word): each one in the CSV, plus cards containing the whole string.
  - Anything else: a case-insensitive whole-word phrase (so "can" isn't "candle" or "scan") in the CSV's `keyword`, `british_english` and `usual_form`, plus all card fields with `*`, `_` and backticks ignored. Text with kana or kanji is matched as a plain substring.
  - The CSV and the deck are joined on the kanji only. Cards whose kanji is already in the CSV group are left out of the deck group (they'd be the same row).
- **Results:** two groups, CSV first, each in file order. The deck group ("Also found in cards") is on pale gold paper with a gold margin.
- **Card:** George's back template (`<span class="kanjivg-animate">{{Kanji}}</span>`, keyword, story, `Note: …` if present), plus `Update: …` styled like the note, so the deck's optional sixth field isn't lost. Inline Markdown: `**bold**`, `_italic_`, `*italic*` (also inside a word: `*gold*fish`), code, links and hard newlines. A kanji with no card yet shows just the drawing and keyword. Styling follows `rtk-mockup.html` (20 px, line-height 1.5, centered, 8em drawing, uppercase bold keyword), without night mode or the mock frame.
- **Back to the results:** a "‹ Results" bar on the card, and opening a card pushes a history entry so Android's back gesture returns to the list (and doesn't leave the app). The card is an overlay, so the list keeps its scroll position.
- **KanjiVG:** `kanjivg/` holds the 2200 SVGs for the RTK kanji from `kanjivg-20260714-main.zip`, named by zero-padded hex code point (`04e00.svg`), as KanjiVG ships them. `kanjivgAnimate({ root, basePath: 'kanjivg', filenameFormat: 'hex', filenamePrefix: '' })` is called on the card; tapping the drawing replays it. If an SVG is missing, the character is shown in Klee One. KanjiVG is CC BY-SA 3.0, credited in Settings → About.
- **Klee One** SemiBold (`fonts/KleeOne-SemiBold.woff2`, 2.9 MB, OFL) is declared with a `unicode-range` for kana and kanji only, so Latin text stays in the system font (as in George's Ghostty setup). The font and SVGs aren't in the service worker's `SHELL`; they're cached on first use. Subsetting the font (e.g. `pyftsubset`) to the characters in use would cut it to a few hundred KB if the first load is ever a problem.
- Three tabs only just fit at 412 px; below 400 px the tab and icon padding shrinks.

### Updates without losing state
- `sw.js` is network-first (3 s timeout, then the cache). When online, the latest deployed version is always used, so there's no cache version number to bump on deploy. Offline, the cached copy is used.
- Data in localStorage is never touched by updates. If the data format ever changes, add a migration (each doc's state is `{data, dirty, sha, syncedUrl, rev}`).
- If a new file is added to the app, add it to `SHELL` in `sw.js` so it's available offline.

### iOS
- Included: `apple-touch-icon`, `apple-mobile-web-app-*` meta tags, safe-area insets.
- Skipped: per-device `apple-touch-startup-image` splash screens.
- iOS clears storage of non-installed sites after 7 days unused; home-screen apps are exempt, and GitHub has the data anyway.

### Visual design
- Concept: *genkō yōshi* (red-ruled Japanese manuscript paper) with the daruma's colours.
  - Daruma red `#b5162b`: top bar and primary buttons.
  - Gold `#e6c877` / `#c9a14a`: the active tab and Undo.
  - White paper, with pale vermilion rules (`#efcbc5`, `#e2a59c`) for list lines and guides.
- The drawing pad is plain white with no guides. (A practice square with a dashed 十 guide was tried in 0.5.0 and removed at George's request.)
- Swiping a correction reveals a 済 ("done") seal. "Maybe" sits on faintly tinted paper, with a muted heading, to show it's lower priority.
- Line-style SVG icons: a cloud with a state mark for sync, sliders for settings.
- System fonts only (Roboto and Noto Sans CJK on Android). Sentence-case headings, no all-caps labels.
- Screenshots at Pixel 8a size (412×915 CSS px, DPR 2.625) are in `design/screenshots/`.

### Icon
- A daruma doll with one eye painted in. Traditionally you paint one eye when you set a goal and the other when you achieve it. The belly has 学 in gold, on a cream background (`#f3ead7`, also the splash background). Theme colour `#c8102e`.
- Source: `design/icon.svg`, with a transparent background. `design/render-icons.sh` renders the PNGs with headless Chrome:
  - `icon-192/512.png` (`any`): transparent.
  - `favicon.png` (96 px): transparent, cropped to the daruma so it's legible in a browser tab.
  - `maskable-512.png` and `apple-touch-icon.png`: cream background (`#f3ead7`), because Android crops maskable icons to the launcher shape (they must be opaque, edge to edge) and iOS fills transparency with black. The maskable artwork is scaled to 86 % to sit inside the safe zone.
  - The 学 relies on a Japanese font at render time (Hiragino on macOS).

## Setup

### GitHub Pages (once)
1. Repo **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `master`, folder `/ (root)`, Save.
2. The site is at `https://george-hawkins.github.io/japanese-study-app/`. Each push to `master` redeploys it within a minute or two.
3. `.nojekyll` is present, so files are served as-is. All paths in the app are relative because it's served from a sub-path.

### Notes repo and token (once)
1. Create a repo for the notes, e.g. `george-hawkins/japanese-study-notes` (it can be private). It can be empty; the app creates the files on the first push.
2. Create a fine-grained token at https://github.com/settings/personal-access-tokens/new. Under *Repository access*, choose *Only select repositories* and pick the notes repo. Under *Permissions → Contents*, choose *Read and write*. Pick a long expiry.
3. In the app's Settings, enter `https://github.com/george-hawkins/japanese-study-notes/blob/main/forgotten.md`, the corresponding `corrections.md` URL, and the token, then tap **Save and test**.

### On the phone
Open the site in Chrome → ⋮ → **Add to home screen → Install**.

## Ideas / later
- Background Sync API (Android) to push even after the app is closed. Currently an interrupted push is retried on the next open.
- Long-press drag to reorder items, if ever needed.
