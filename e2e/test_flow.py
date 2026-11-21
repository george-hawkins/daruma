"""Moving between the activities, the Done list, and what tapping the cloud says."""

from playwright.sync_api import expect

from conftest import CORRECTIONS, FORGOTTEN


def corrections(c="", m="", d=""):
    return f"## Corrections\n{c}\n## Maybe\n{m}\n## Done\n{d}".rstrip("\n") + "\n"


NOW = "### 2026-11-14T12:00:00Z"


def test_tapping_a_forgotten_word_shows_its_rtk_card_and_back_returns(app, files):
    files.set(FORGOTTEN, f"# Forgotten kanji\n\n{NOW}\n\n* Can\n")
    app.open()
    app.page.locator("#kanji-list li", has_text="Can").click()
    app.page.wait_for_selector("#rtk-card-body .kanjivg-animate svg")
    assert app.shown() == "rtk Frame 97"  # exactly the keyword "can" (not "tin can")
    app.page.go_back()
    app.page.wait_for_function("!document.getElementById('page-rtk').classList.contains('card-open')")
    assert app.shown() == "rtk" and app.page.input_value("#rtk-query") == "Can"
    app.page.go_back()
    app.page.wait_for_function("document.getElementById('page-kanji').classList.contains('active')")
    assert app.hash() == "#kanji"


def test_installed_the_back_gesture_doesnt_close_the_app(app, files):
    app.open(installed=True)
    app.tab("corrections")
    app.add_correction("Kept")
    for _ in range(3):  # however often
        app.back(stays=True)
        assert app.shown() == "corrections" and app.hash() == "#corrections"
        assert app.page.url.startswith(f"{app.base_url}/#")
    assert app.page.locator("#clist-corrections .row-inner").all_inner_texts() == ["Kept"]
    # A refresh doesn't add another spare entry, and back still doesn't leave.
    entries = app.entries()
    app.page.reload()
    app.wait_synced()
    assert app.entries() == entries
    app.back(stays=True)
    assert app.shown() == "corrections"
    # Nothing is shown afresh: something half typed in Settings is still there.
    app.tab("settings")
    app.page.fill("#set-forgotten", "https://github.com/o/notes/blob/main/half-typed")
    app.back(stays=True)
    assert app.shown() == "settings" and app.page.input_value("#set-forgotten").endswith("half-typed")


def test_installed_back_still_returns_from_a_card_to_the_list_and_stops_there(app, files):
    files.set(FORGOTTEN, f"# Forgotten kanji\n\n{NOW}\n\n* Can\n")
    app.open(installed=True)
    app.page.locator("#kanji-list li", has_text="Can").click()
    app.page.wait_for_selector("#rtk-card-body .kanjivg-animate svg")
    assert app.shown() == "rtk Frame 97"
    app.back()
    app.page.wait_for_function("!document.getElementById('page-rtk').classList.contains('card-open')")
    assert app.shown() == "rtk"
    app.back()
    app.page.wait_for_function("document.getElementById('page-kanji').classList.contains('active')")
    app.back(stays=True)
    assert app.shown() == "kanji" and app.hash() == "#kanji"
    # And the same again from there.
    app.page.locator("#kanji-list li", has_text="Can").click()
    app.page.wait_for_function("document.getElementById('page-rtk').classList.contains('card-open')")
    app.back()
    app.back()
    app.page.wait_for_function("document.getElementById('page-kanji').classList.contains('active')")
    app.back(stays=True)
    assert app.shown() == "kanji"


def test_in_a_browser_tab_back_leaves_as_usual(app, files):
    app.open()
    assert app.entries() == 2  # the page before, and the app: no spare entry
    app.back()
    assert app.page.url == f"{app.base_url}/e2e-blank"


def test_tapping_a_word_that_isnt_a_keyword_shows_the_matches(app, files):
    files.set(FORGOTTEN, f"# Forgotten kanji\n\n{NOW}\n\n* mouth\n")
    app.open()
    app.page.locator("#kanji-list li", has_text="mouth").click()
    app.page.wait_for_selector(".rtk-table")
    assert app.shown() == "rtk"
    assert app.page.locator("tr.hit").all_inner_texts() == ["97\t可\tcan"]


def test_done_items_can_be_seen_and_moved_back(app, files):
    files.set(CORRECTIONS, corrections(c=f"\n{NOW}\n\n* Fix A\n* Fix B\n", d="\n### 2025-12-01T10:00:00Z\n\n* Old\n"))
    app.open(page="corrections")
    expect(app.page.locator("#show-done")).to_have_text("Done 1")
    app.menu(app.page.locator("#clist-corrections li", has_text="Fix A"), "Mark done")
    expect(app.page.locator("#show-done")).to_have_text("Done 2")
    app.page.click("#show-done")
    assert app.page.locator("#dialog .dlg-pick").all_inner_texts() == ["Fix A\nNov 14", "Old\nDec 1, 2025"]
    app.page.locator("#dialog .dlg-pick", has_text="Fix A").click()
    app.page.locator("#dialog button", has_text="Back to Maybe").click()
    app.page.click("#show-done")
    app.page.locator("#dialog .dlg-pick", has_text="Old").click()
    app.page.locator("#dialog button", has_text="Delete").click()
    app.sync()
    assert files.text(CORRECTIONS) == corrections(c=f"\n{NOW}\n\n* Fix B\n", m=f"\n{NOW}\n\n* Fix A\n")
    expect(app.page.locator("#show-done")).to_have_text("Done")


def test_tapping_the_cloud_says_how_the_sync_went(app, files):
    app.open()
    app.add_kanji("word")
    app.sync()
    assert app.page.inner_text("#snackbar-text") == "Everything is pushed to GitHub"
