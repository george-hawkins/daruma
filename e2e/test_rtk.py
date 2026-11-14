"""The RTK page: fetching the read-only files (and only re-checking them when
asked or every 6 hours), searching, and showing a match as its Anki card."""

from conftest import DECK, HOUR, KEYWORDS, SETTINGS


def search(app, query):
    app.page.fill("#rtk-query", query)
    app.page.wait_for_timeout(250)  # the search is debounced


def results(app):
    """{group: [(frame, kanji, keyword), ...]} in display order."""
    return app.page.evaluate("""() => Object.fromEntries([...document.querySelectorAll('.rtk-table tbody')].map(b =>
      [b.className.replace('group-', ''), [...b.querySelectorAll('tr.hit')].map(r => [...r.cells].map(c => c.textContent))]))""")


def open_rtk(app):
    app.open(page="rtk")
    return app


def test_frame_kanji_and_keyword_searches(app, files):
    open_rtk(app)
    assert "Type a frame number" in app.page.inner_text("#rtk-results")
    search(app, "97")
    assert results(app) == {"index": [["97", "可", "can"]]}
    search(app, "９７")  # full-width, from a Japanese keyboard
    assert results(app) == {"index": [["97", "可", "can"]]}
    # A kanji: its index row, then cards mentioning it elsewhere.
    search(app, "丁")
    assert results(app) == {"index": [["95", "丁", "street"]], "deck": [["97", "可", "can"]]}
    # Whole words, any case, in all fields (here the Clue and the Update).
    search(app, "Can")
    assert results(app) == {"index": [["97", "可", "can"], ["2116", "缶", "tin can"]]}
    search(app, "numeral")
    assert results(app) == {"deck": [["1", "一", "one"]]}
    search(app, "firefly")  # british_english column
    assert results(app) == {"index": [["557", "蛍", "lightning bug"]]}
    search(app, "鬼")  # only inside a comment in the deck
    assert "Nothing found" in app.page.inner_text("#rtk-results")


def test_the_two_groups_look_different(app, files):
    open_rtk(app)
    search(app, "丁")
    bg = lambda sel: app.page.eval_on_selector(sel, "e => getComputedStyle(e).backgroundColor")
    assert bg(".group-index tr.hit td") != bg(".group-deck tr.hit td")


def test_a_card_shows_the_back_of_the_anki_card(app, files):
    open_rtk(app)
    search(app, "can")
    app.page.locator("tr.hit", has_text="可").click()
    card = app.page.locator("#rtk-card-body")
    app.page.wait_for_selector("#rtk-card-body .kanjivg-animate svg")  # the KanjiVG drawing
    assert app.page.inner_text("#rtk-card-frame") == "Frame 97"
    assert card.locator(".keyword").inner_text() == "CAN"
    assert card.locator(".story").inner_html() == 'A <i>mouth</i> on the <i>street</i> (丁): "<b>Can</b> I get some help?"'
    assert card.locator(".note").all_inner_texts() == [
        "Note: drawn differently to 町\nthe second line of the note",
        "Update: can is hard to include in stories.",
    ]
    # Stroke numbers are thin grey text, not outlined by the app's icon style.
    style = app.page.eval_on_selector("#rtk-card-body svg text", "t => [getComputedStyle(t).stroke, getComputedStyle(t).fill]")
    assert style == ["none", "rgb(128, 128, 128)"]


def test_a_kanji_without_a_card_yet_shows_just_the_kanji_and_keyword(app, files):
    open_rtk(app)
    search(app, "2116")
    app.page.locator("tr.hit").click()
    app.page.wait_for_selector("#rtk-card-body .kanjivg-animate svg")
    assert app.page.locator("#rtk-card-body .keyword").inner_text() == "TIN CAN"
    assert app.page.locator("#rtk-card-body .story").inner_text() == ""
    assert app.page.locator("#rtk-card-body .note").count() == 0


def test_back_to_the_results_with_the_button_or_the_back_gesture(app, files):
    open_rtk(app)
    search(app, "can")
    card_open = lambda: app.page.evaluate("document.getElementById('page-rtk').classList.contains('card-open')")
    app.page.locator("tr.hit", has_text="可").click()
    assert card_open()
    app.page.click("#rtk-back")
    app.page.wait_for_function("!document.getElementById('page-rtk').classList.contains('card-open')")
    app.page.locator("tr.hit", has_text="缶").click()
    app.page.go_back()  # Android's back gesture
    app.page.wait_for_function("!document.getElementById('page-rtk').classList.contains('card-open')")
    assert app.page.url == f"{app.base_url}/#rtk"  # still in the app, on the results
    assert app.page.input_value("#rtk-query") == "can"


def test_files_are_checked_only_when_asked_or_after_6_hours(app, files):
    open_rtk(app)
    assert len(files.fetches(DECK)) == 1
    # Regaining focus a minute later syncs the notes but not the RTK files.
    app.advance(60 * 1000)
    app.page.evaluate("window.dispatchEvent(new Event('focus'))")
    app.wait_synced()
    app.page.wait_for_timeout(300)
    assert len(files.fetches(DECK)) == 1
    # Tapping the cloud checks them, sending the ETag: unchanged, so a 304.
    app.sync()
    fetches = files.fetches(DECK)
    assert len(fetches) == 2 and fetches[1]["headers"].get("if-none-match")
    # Changed on GitHub: picked up at the next check after 6 hours.
    files.set(DECK, files.text(DECK).replace("A **street** sign", "A **street** lamp"))
    app.advance(6 * HOUR + 60 * 1000)
    app.page.evaluate("window.dispatchEvent(new Event('focus'))")
    app.wait_synced()
    search(app, "lamp")
    assert results(app) == {"deck": [["95", "丁", "street"]]}


def test_lookups_work_offline_from_the_copy_on_the_device(app, files):
    open_rtk(app)
    app.page.unroute("https://api.github.com/**")
    app.page.route("https://api.github.com/**", lambda route: route.abort())
    app.page.reload()
    app.wait_synced()
    search(app, "97")
    assert results(app) == {"index": [["97", "可", "can"]]}


def test_not_set_up(app, files):
    app.open(page="rtk", settings={**SETTINGS, "rtkKeywordsUrl": "", "rtkDeckUrl": ""})
    assert "Set the RTK keyword and card files in Settings" in app.page.inner_text("#rtk-results")


def test_settings_test_the_read_only_files_without_a_token(app, files):
    app.open(page="settings")
    app.page.click("#settings-form button[type=submit]")
    app.page.wait_for_function("document.getElementById('set-result').textContent.includes('RTK cards')")
    result = app.page.inner_text("#set-result")
    assert "RTK keywords: ✓ file found" in result and "RTK cards: ✓ file found" in result
    del files.files[KEYWORDS]
    app.page.click("#settings-form button[type=submit]")
    app.page.wait_for_function("document.getElementById('set-result').textContent.includes('RTK keywords: ✗')")
    assert 'rtk1-keywords.csv not found on branch "master"' in app.page.inner_text("#set-result")


# The URL: #kanji, #corrections, #settings, #rtk, #rtk/可.


def open_card(app, query, kanji):
    search(app, query)
    app.page.locator("tr.hit", has_text=kanji).click()


def test_an_open_card_is_in_the_url_and_survives_a_refresh(app, files):
    open_rtk(app)
    assert app.hash() == "#rtk"
    open_card(app, "can", "可")
    assert app.hash() == "#rtk/可"
    app.page.reload()
    app.wait_synced()
    assert app.shown() == "rtk Frame 97"
    app.page.go_back()  # the back gesture still returns to the results
    app.page.wait_for_function("!document.getElementById('page-rtk').classList.contains('card-open')")
    assert app.hash() == "#rtk"
    assert results(app) == {"index": [["97", "可", "can"], ["2116", "缶", "tin can"]]}


def test_a_link_to_a_card_opens_it_even_on_a_first_visit(app, files):
    # Nothing on the device yet: the card is shown once the RTK files arrive.
    app.open(page="kanji", hash="#rtk/%E5%8F%AF")
    app.page.wait_for_function("document.getElementById('page-rtk').classList.contains('card-open')")
    assert app.shown() == "rtk Frame 97"
    history = app.page.evaluate("history.length")
    # There's no results entry to go back to: the button shows them anyway,
    # without leaving the app.
    app.page.click("#rtk-back")
    assert app.shown() == "rtk"
    assert app.hash() == "#rtk"
    assert app.page.evaluate("history.length") == history


def test_a_link_to_an_unknown_kanji_searches_for_it(app, files):
    app.open(hash="#rtk/鬼")
    app.page.wait_for_function("document.getElementById('rtk-results').textContent.includes('Nothing found')")
    assert app.shown() == "rtk"
    assert app.hash() == "#rtk"
    assert app.page.input_value("#rtk-query") == "鬼"


def test_tabs_are_in_the_url_without_adding_history_entries(app, files):
    app.open(page="kanji")
    assert app.hash() == "#kanji"
    history = app.page.evaluate("history.length")
    for name in ["corrections", "settings", "rtk", "kanji"]:
        app.tab(name)
        assert app.hash() == f"#{name}" and app.shown() == name
    assert app.page.evaluate("history.length") == history
    # The URL wins over the page remembered on the device.
    app.page.goto(f"{app.base_url}/#corrections")
    app.wait_synced()
    assert app.shown() == "corrections"


def test_switching_tabs_keeps_an_open_card(app, files):
    open_rtk(app)
    open_card(app, "can", "可")
    app.tab("kanji")
    assert app.hash() == "#kanji"
    app.tab("rtk")
    assert app.hash() == "#rtk/可"
    assert app.shown() == "rtk Frame 97"
    app.page.click("#rtk-back")
    app.page.wait_for_function("!document.getElementById('page-rtk').classList.contains('card-open')")
    assert app.hash() == "#rtk"


def test_without_a_hash_the_last_page_is_shown(app, files):
    app.open(page="corrections")
    assert app.shown() == "corrections"
    assert app.hash() == "#corrections"


def test_a_card_opened_from_the_url_fetches_only_its_drawing(app, files):
    open_rtk(app)  # the RTK files are now on the device
    requested = []
    app.page.on("request", lambda r: "kanjivg" in r.url and requested.append(r.url.rsplit("/", 1)[1]))
    app.page.goto(f"{app.base_url}/#rtk/%E5%8F%AF")
    app.page.wait_for_selector("#rtk-card-body .kanjivg-animate svg")
    assert requested == ["053ef.svg"]


def test_the_focus_moves_to_the_card_only_for_keyboard_users(app, files):
    open_rtk(app)
    search(app, "can")
    focused = lambda: app.page.evaluate("document.activeElement.id")
    app.page.locator("tr.hit", has_text="可").click()
    assert focused() != "rtk-back"
    app.page.click("#rtk-back")
    app.page.wait_for_function("!document.getElementById('page-rtk').classList.contains('card-open')")
    app.page.locator("tr.hit", has_text="可").focus()
    app.page.keyboard.press("Enter")
    assert focused() == "rtk-back"
