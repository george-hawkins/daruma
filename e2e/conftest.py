"""End-to-end tests: the real app in Chrome (via Playwright), served from this
repo, talking to a fake GitHub API.

Run with: uv run pytest
"""

import base64
import functools
import hashlib
import http.server
import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urlparse

import pytest
from playwright.sync_api import Page, Route

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = Path(__file__).resolve().parent / "fixtures"

NOTES = "https://github.com/o/notes/blob/main"
DECKS = "https://github.com/o/decks/blob/master"
SETTINGS = {
    "token": "t",
    "forgottenUrl": f"{NOTES}/forgotten.md",
    "correctionsUrl": f"{NOTES}/corrections.md",
    "rtkKeywordsUrl": f"{DECKS}/rtk1-keywords.csv",
    "rtkDeckUrl": f"{DECKS}/rtk1-v6.md",
    "rtkToken": "",
}

# The time the app's clock starts at in each test.
T0 = datetime(2026, 11, 14, 12, 0, tzinfo=timezone.utc)
HOUR = 60 * 60 * 1000


class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


@pytest.fixture(scope="session")
def base_url():
    """The app, served from the repo root (as GitHub Pages does)."""
    handler = functools.partial(_QuietHandler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()


@pytest.fixture
def browser_context_args(browser_context_args):
    # Phone-sized; no service worker, so every request reaches the routes.
    return {**browser_context_args, "viewport": {"width": 412, "height": 915}, "service_workers": "block"}


def sha_of(text: str) -> str:
    return hashlib.sha1(text.encode()).hexdigest()


class FakeGitHub:
    """Enough of the GitHub REST API for the app: repos, branches, contents
    (JSON and raw, with ETags), blobs by sha, and writes that are rejected if
    the sha they're based on is out of date. Files are keyed "owner/repo/path"."""

    CORS = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Authorization, Accept, Content-Type, If-None-Match",
        "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
        "Access-Control-Expose-Headers": "ETag",
    }

    def __init__(self):
        self.files: dict[str, str] = {}
        self.blobs: dict[str, str] = {}
        self.requests: list[dict] = []
        self.puts: list[dict] = []
        self.before_next_put = None  # e.g. another device pushing first

    def set(self, key: str, text: str):
        self.files[key] = text
        self.blobs[sha_of(text)] = text

    def text(self, key: str) -> str | None:
        return self.files.get(key)

    def sha(self, key: str) -> str:
        return sha_of(self.files[key])

    def fetches(self, key: str) -> list[dict]:
        return [r for r in self.requests if r["method"] == "GET" and r["key"] == key]

    def handle(self, route: Route):
        req = route.request
        if req.method == "OPTIONS":
            return route.fulfill(status=204, headers=self.CORS)
        url = urlparse(req.url)
        parts = [unquote(p) for p in url.path.strip("/").split("/")]
        owner, repo, rest = parts[1], parts[2], parts[3:]
        key = "/".join([owner, repo, *rest[1:]]) if rest[:1] == ["contents"] else None
        self.requests.append({"method": req.method, "key": key, "headers": req.headers})

        def reply(status=200, body=None, headers=None, raw=None):
            content = raw if raw is not None else json.dumps(body or {})
            route.fulfill(status=status, body=content, headers={**self.CORS, **(headers or {})},
                          content_type="text/plain" if raw is not None else "application/json")

        if not rest:
            return reply(body={"default_branch": "main" if repo == "notes" else "master"})
        if rest[0] == "branches":
            return reply()
        if rest[:2] == ["git", "blobs"]:
            text = self.blobs.get(rest[2])
            if text is None:
                return reply(404, {"message": "Not Found"})
            return reply(body={"content": base64.b64encode(text.encode()).decode()})
        if req.method == "PUT":
            if self.before_next_put:
                hook, self.before_next_put = self.before_next_put, None
                hook()
            body = json.loads(req.post_data)
            text = base64.b64decode(body["content"]).decode()
            current = self.files.get(key)
            if current is not None and body.get("sha") != sha_of(current):
                return reply(409 if body.get("sha") else 422, {"message": "sha mismatch"})
            self.set(key, text)
            self.puts.append({"key": key, "text": text, "base": body.get("sha")})
            return reply(201 if current is None else 200, {"content": {"sha": sha_of(text)}})
        text = self.files.get(key)
        if text is None:
            return reply(404, {"message": "Not Found"})
        etag = f'"{sha_of(text)}"'
        if "raw" in req.headers.get("accept", ""):
            if req.headers.get("if-none-match") == etag:
                return reply(304, raw="", headers={"ETag": etag})
            return reply(raw=text, headers={"ETag": etag})
        return reply(body={"sha": sha_of(text), "content": base64.b64encode(text.encode()).decode()})


@pytest.fixture
def github(page: Page):
    gh = FakeGitHub()
    page.route("https://api.github.com/**", gh.handle)
    return gh


class App:
    """Drives the app in a page."""

    def __init__(self, page: Page, base_url: str):
        self.page = page
        self.base_url = base_url

    def open(self, *, settings=None, storage=None, page="kanji", clock=T0):
        """Seeds localStorage (keys without the "daruma:" prefix) and opens the
        app, with its clock starting at `clock`, then waits for the first sync."""
        if clock is not None:
            self.page.clock.install(time=clock)
        self.page.goto(f"{self.base_url}/e2e-blank")  # any same-origin page
        items = {"settings": SETTINGS if settings is None else settings, "page": page, **(storage or {})}
        self.page.evaluate(
            "items => { localStorage.clear(); for (const [k, v] of Object.entries(items)) localStorage.setItem('daruma:' + k, JSON.stringify(v)); }",
            items,
        )
        self.page.goto(f"{self.base_url}/")
        self.wait_synced()
        return self

    def wait_synced(self):
        self.page.wait_for_function(
            "() => /\\b(ok|pending|offline|off|error)\\b/.test(document.getElementById('sync-status').className)"
        )

    def sync(self):
        """Taps the cloud (a forced sync) and waits for it to finish."""
        self.page.click("#sync-status")
        self.wait_synced()

    def tab(self, name: str):
        self.page.click(f".tab[data-page={name}]")

    def advance(self, ms: int):
        self.page.clock.fast_forward(ms)

    def stored(self, key: str):
        return self.page.evaluate("k => JSON.parse(localStorage.getItem('daruma:' + k))", key)

    def add_kanji(self, text: str):
        self.page.fill("#kanji-add", text)
        self.page.press("#kanji-add", "Enter")

    def add_correction(self, text: str, list_="corrections"):
        sel = f"#clist-{list_} form input"
        self.page.fill(sel, text)
        self.page.press(sel, "Enter")

    def long_press(self, locator):
        box = locator.bounding_box()
        self.page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        self.page.mouse.down()
        self.page.wait_for_timeout(700)
        self.page.mouse.up()

    def menu(self, locator, choice: str):
        self.long_press(locator)
        self.page.locator("#dialog button", has_text=choice).click()

    def rows(self, list_selector: str) -> list[str]:
        return self.page.locator(f"{list_selector} > li").all_inner_texts()

    def group_ends(self, list_selector: str) -> list[bool]:
        return self.page.eval_on_selector_all(f"{list_selector} > li", "els => els.map(e => e.classList.contains('group-end'))")


@pytest.fixture
def app(page: Page, base_url: str, github: FakeGitHub) -> App:
    return App(page, base_url)


def fixture_text(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


FORGOTTEN = "o/notes/forgotten.md"
CORRECTIONS = "o/notes/corrections.md"
KEYWORDS = "o/decks/rtk1-keywords.csv"
DECK = "o/decks/rtk1-v6.md"
EMPTY_CORRECTIONS = "## Corrections\n\n## Maybe\n\n## Done\n"


@pytest.fixture
def files(github: FakeGitHub) -> FakeGitHub:
    """GitHub with empty notes files and the fixture RTK files."""
    github.set(FORGOTTEN, "# Forgotten kanji\n")
    github.set(CORRECTIONS, EMPTY_CORRECTIONS)
    github.set(KEYWORDS, fixture_text("rtk1-keywords.csv"))
    github.set(DECK, fixture_text("rtk1-v6.md"))
    return github
