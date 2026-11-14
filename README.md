# Daruma

<img src="icons/icon-192.png" alt="Daruma icon" width="96" align="right">

Daruma is a small installable web app (a PWA) for Japanese study chores. It runs entirely in the browser, keeps everything on the device first, and syncs its data to plain Markdown files in a GitHub repo of your choice.

The app lives at https://george-hawkins.github.io/daruma/

The icon is a daruma doll with only one eye painted in. Traditionally you paint in one eye when you set a goal and the other when you achieve it.

## Activities

The ? button in the top bar shows a summary of the gestures below.

**Kanji**: a list of English keywords for kanji you've forgotten, next to a scratch pad for writing kanji with your finger.

- Type a keyword in the box at the top and press Enter; new entries go at the top.
- Tap an entry to look it up on the RTK page (its card opens straight away if the entry is exactly an RTK keyword). Long-press an entry to edit or delete it.
- Draw on the pad and tap **Clear** to start again. There are deliberately no colours, widths or undo.
- ◀ / ▶ hides or shows the list to give more room for drawing.

**Corrections**: two lists of one-line notes, *Corrections* (to do soon) and *Maybe* (long-term reminders).

- Type in the box at the top of a list and press Enter to add an item at the top.
- Tap an item to edit it in place. Enter starts a new item below it, and an item left empty is removed.
- Swipe an item left or right to mark it done (with Undo). Done items are hidden in the app but kept in the file.
- Long-press an item to move it to the other list, mark it done or delete it.
- **Done** (top right) lists the items marked done, newest first, with the day each was done. Tap one to move it back to either list, or to delete it for good.

**RTK**: look up a kanji from *Remembering the Kanji* by frame number, kanji or keyword, in a keyword index (`rtk1-keywords.csv`) and an Anki deck (`rtk1-v6.md`) kept in another repo. These files are only read, never written.

- Matches in the index come first. Below them, on pale gold, come cards that mention what you typed in any field. Each group shows its first 20 matches, then **Show all**.
- With nothing typed, the cards you opened most recently are listed.
- Tap a row to see the back of its card, with the Clue (which Anki shows on the front) under the keyword. Tap the kanji to watch it drawn stroke by stroke. **Results**, or the back gesture, returns to the list.
- The address shows the card (e.g. `…/daruma/#rtk/可`), so refreshing keeps it open, and you can bookmark or share a link straight to a kanji's card.
- The files are kept on the device. They're checked for changes when you tap the sync icon, and otherwise every 6 hours.

## Setup

1. **Create a repo for the data**, e.g. `daruma-filestore`. It can be private, and it can be empty: the app creates the files.
2. **Create a fine-grained personal access token** at https://github.com/settings/personal-access-tokens/new:
   - *Repository access*: *Only select repositories* → the data repo.
   - *Permissions → Contents*: *Read and write*. Nothing else is needed.
3. **Open the app in Chrome on your phone** and choose ⋮ → **Add to home screen → Install**. On iOS, use Safari's Share → **Add to Home Screen**.
4. **In ⚙ Settings**, enter the file URLs, e.g. `https://github.com/george-hawkins/daruma-filestore/blob/master/forgotten.md` and `…/blob/master/corrections.md` (the branch must exist, or be the repo's default branch if the repo is still empty), and the token. Then tap **Save and test**.

5. **For RTK lookup**, enter the URLs of the two files, e.g. `https://github.com/george-hawkins/anki-decks/blob/master/rtk1-keywords.csv` and `…/blob/master/rtk1-v6.md`. If that repo is private, add a fine-grained token for it with *Contents: Read-only*; for a public repo, leave the token empty.

The token is stored only on the device. A token is needed because GitHub doesn't support signing in from a purely static site (it requires a server-side secret).

## How data is saved

- Every change is saved on the device immediately, so nothing is lost if you switch away or the app is killed.
- Changes are pushed to GitHub, one commit per push, when you leave the app, a minute after your last edit, or when you tap the sync icon in the top bar (it then says how the sync went). The app pulls from GitHub when it's opened or brought back to the front.
- Sync icon: a cloud with a tick (synced), with an arrow (changes waiting to be pushed; it pulses while syncing), crossed out (offline, GitHub can't be reached, or not set up; nothing is lost, it catches up later) or with "!" (needs attention; tap it).
- You can use Daruma on several devices (e.g. a phone and a laptop browser) and edit the files on GitHub too. Enter the settings on each device. Each copy picks up the latest version when it's opened, comes back to the front, or every few minutes while it's open. If a device has unpushed changes and the file changed elsewhere too, the two are merged item by item: additions, edits, moves and items marked done from both sides are kept, including a word added again that is already further down the list.

Entries are grouped under UTC timestamps, newest first. A new group starts when an entry arrives in a list (typed in, moved, or marked done) more than 6 hours after that list's newest group began. The app doesn't show the timestamps, only a slightly darker line between groups. The files look like this:

```markdown
# Forgotten kanji

### 2026-11-15T09:30:00Z

* apply

### 2026-11-14T12:00:00Z

* discard
```

```markdown
## Corrections

### 2026-11-14T12:00:00Z

* Intelligent clue --> not CLEVER

## Maybe

### 2026-11-14T12:00:00Z

* Switch to Hawaii story for young

## Done

### 2026-11-15T09:30:00Z

* Discard clue: not DISPOSE
```

## Development

Plain HTML, CSS and JavaScript modules: no framework, no dependencies, no build step. (The only dependencies are for the end-to-end tests, below.) To run it locally, serve the repo root with any static server and open it in a browser:

```
$ uv run python -m http.server 8000
```

Then open http://localhost:8000/. Service workers work on `localhost` without HTTPS.

There are two sets of tests. Run both before committing.

- **Unit tests** for the pure logic (Markdown files, merging, timestamp groups, RTK parsing and search), with Node's built-in test runner (Node 20 or later, no dependencies):

  ```
  $ node --test
  ```

- **End-to-end tests** in `e2e/`, with pytest and Playwright run by [uv](https://docs.astral.sh/uv/). They drive the real app in your installed Google Chrome against a fake GitHub API, covering the activities, syncing and the RTK page. `uv` installs the dependencies on the first run:

  ```
  $ uv run pytest
  ```

Layout:

| Path | Purpose |
| --- | --- |
| `index.html`, `styles.css` | The single page and its styles |
| `js/app.js` | Wiring: pages, tabs, sync indicator |
| `js/kanji.js`, `js/corrections.js`, `js/rtk.js` | The three activities |
| `js/rtkdata.js`, `js/rtksource.js` | RTK files: parsing, search and card Markdown; fetching and caching |
| `js/kanjivg-animate.js`, `kanjivg/` | Stroke-order animation and the KanjiVG drawings of the 2200 RTK kanji |
| `fonts/` | Klee One, used for Japanese text on the RTK page |
| `js/sync.js` | Local-first documents and GitHub sync |
| `js/merge.js` | Three-way merge of list items |
| `test/` | Unit tests (`node --test`) |
| `e2e/`, `pyproject.toml` | End-to-end tests (`uv run pytest`): `conftest.py` has the fake GitHub and helpers, `fixtures/` small RTK files |
| `js/github.js` | Minimal GitHub Contents API client |
| `js/markdown.js` | Markdown ⇄ data conversion |
| `js/settings.js`, `js/store.js`, `js/ui.js` | Settings page, localStorage, shared UI helpers |
| `sw.js` | Network-first service worker (offline support) |
| `manifest.webmanifest`, `icons/` | PWA manifest and icons |
| `design/icon.svg`, `design/render-icons.sh` | Icon source and the script that renders the PNGs (macOS, needs Chrome) |

If you add a file the app needs, also add it to `SHELL` in `sw.js` so it's available offline.

### Deployment

GitHub Pages serves the repo root of the `master` branch (Settings → Pages → *Deploy from a branch*). Pushing to `master` redeploys the site. Installed copies pick up the new version the next time they're opened while online. Data stored on the device isn't affected by updates.

See [PLAN.md](PLAN.md) for the design decisions and the reasoning behind them.
