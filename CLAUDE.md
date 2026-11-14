# Daruma

Read PLAN.md first: it records the requirements, decisions and status, and is kept up to date as things are decided or built. README.md is the user-facing description.

Rules for every change:

- **Tests.** Every change in behaviour comes with new or updated tests, and every bug fix with a test that fails without it. Run both suites before committing; both must pass:
  - `node --test`: unit tests in `test/` for the pure modules (`markdown.js`, `merge.js`, `rtkdata.js`).
  - `uv run pytest`: end-to-end tests in `e2e/` (pytest + Playwright, the real app in Chrome against a fake GitHub). See *Testing* in PLAN.md.
- **Version.** Bump `VERSION` in `js/version.js` in every commit that changes the app.
- **Docs.** Update PLAN.md (and README.md if users would notice) in the same commit.
- **New app files** go in `SHELL` in `sw.js`.
- **File format changes:** bump the doc's `format` in `js/app.js` (so data parsed by older versions is re-read), push the app, wait until GitHub Pages serves the new `js/version.js`, and only then change the files on GitHub.
- Python is run with `uv` (`uv run …`); the app itself has no dependencies or build step.
