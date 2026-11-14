"""The service worker (blocked in the other tests): the app opens offline once
it has been opened online, and slow first fetches still arrive and are cached."""

import time

import pytest

from conftest import SETTINGS, App, FakeGitHub


@pytest.fixture
def sw_page(browser, base_url):
    context = browser.new_context(viewport={"width": 412, "height": 915}, service_workers="allow")
    page = context.new_page()
    yield page
    context.close()


def open_with_sw(page, base_url, files):
    page.route("https://api.github.com/**", files.handle)
    app = App(page, base_url).open(clock=None)
    page.wait_for_function("navigator.serviceWorker.controller !== null")
    page.wait_for_function("caches.open('daruma-shell').then(c => c.keys()).then(k => k.length >= 20)")
    return app


def fresh_files():
    from conftest import CORRECTIONS, EMPTY_CORRECTIONS, FORGOTTEN
    gh = FakeGitHub()
    gh.set(FORGOTTEN, "# Forgotten kanji\n\n### 2026-11-14T12:00:00Z\n\n* cached word\n")
    gh.set(CORRECTIONS, EMPTY_CORRECTIONS)
    return gh


def test_the_app_opens_offline(sw_page, base_url):
    app = open_with_sw(sw_page, base_url, fresh_files())
    app.offline()
    sw_page.reload()
    app.wait_synced()
    assert app.rows("#kanji-list") == ["cached word"]
    assert "offline" in sw_page.get_attribute("#sync-status", "class").split()


def test_a_slow_first_fetch_still_arrives_and_is_cached(sw_page, base_url):
    open_with_sw(sw_page, base_url, fresh_files())
    url = f"{base_url}/kanjivg/053ef.svg"  # not in the shell, so not cached yet

    def slow(route):
        time.sleep(3.5)  # longer than the service worker's timeout
        route.continue_()

    sw_page.context.route("**/kanjivg/053ef.svg", slow)
    assert sw_page.evaluate("u => fetch(u).then(r => r.ok, () => false)", url)
    assert sw_page.evaluate("u => caches.match(u).then(r => Boolean(r))", url)
