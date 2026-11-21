"""Forgotten kanji and Corrections: timestamp groups as seen in the files
pushed to GitHub, and the darker rule between groups in the app."""

from conftest import CORRECTIONS, FORGOTTEN, HOUR

MINUTE = 60 * 1000


def test_new_entries_group_under_timestamps_newest_group_first(app, files):
    app.open()
    app.add_kanji("apply")
    app.sync()
    assert files.text(FORGOTTEN) == "# Forgotten kanji\n\n### 2026-11-14T12:00:00Z\n\n* apply\n"

    app.advance(5 * HOUR + 59 * MINUTE)  # within 6 hours: joins the group
    app.add_kanji("discard")
    app.sync()
    assert files.text(FORGOTTEN) == "# Forgotten kanji\n\n### 2026-11-14T12:00:00Z\n\n* discard\n* apply\n"

    app.advance(2 * MINUTE)  # more than 6 hours: a new group, above the older one
    app.add_kanji("third")
    app.sync()
    assert files.text(FORGOTTEN) == (
        "# Forgotten kanji\n\n"
        "### 2026-11-14T18:01:00Z\n\n* third\n\n"
        "### 2026-11-14T12:00:00Z\n\n* discard\n* apply\n"
    )


def test_darker_rule_after_the_last_row_of_each_group(app, files):
    files.set(FORGOTTEN, "# Forgotten kanji\n\n### 2026-11-14T10:00:00Z\n\n* a\n* b\n\n### 2026-11-13T10:00:00Z\n\n* c\n")
    app.open()
    assert app.rows("#kanji-list") == ["a", "b", "c"]
    assert app.group_ends("#kanji-list") == [False, True, False]
    colors = app.page.eval_on_selector_all("#kanji-list > li", "els => els.map(e => getComputedStyle(e).borderBottomColor)")
    assert colors[1] != colors[0] and colors[0] == colors[2]


def test_editing_keeps_the_group_and_deleting_its_last_entry_drops_the_heading(app, files):
    files.set(FORGOTTEN, "# Forgotten kanji\n\n### 2026-11-14T10:00:00Z\n\n* new\n\n### 2026-11-13T10:00:00Z\n\n* old\n")
    app.open()
    app.menu(app.page.locator("#kanji-list li", has_text="old"), "Edit")
    app.page.fill(".dlg-input", "older")
    app.page.locator("#dialog button", has_text="Save").click()
    app.menu(app.page.locator("#kanji-list li", has_text="new"), "Delete")
    app.sync()
    assert files.text(FORGOTTEN) == "# Forgotten kanji\n\n### 2026-11-13T10:00:00Z\n\n* older\n"


OLD = "### 2026-11-13T08:00:00Z"
NOW = "### 2026-11-14T12:00:00Z"


def corrections(c="", m="", d=""):
    return f"## Corrections\n{c}\n## Maybe\n{m}\n## Done\n{d}".rstrip("\n") + "\n"


def test_each_list_has_its_own_groups_and_marking_done_starts_one_in_done(app, files):
    files.set(CORRECTIONS, corrections(c=f"\n{OLD}\n\n* Fix A\n* Fix B\n"))
    app.open(page="corrections")

    app.menu(app.page.locator("#clist-corrections li", has_text="Fix A"), "Mark done")
    app.sync()
    assert files.text(CORRECTIONS) == corrections(c=f"\n{OLD}\n\n* Fix B\n", d=f"\n{NOW}\n\n* Fix A\n")

    # Undo puts the item back in its old group; Done's group goes with it.
    app.menu(app.page.locator("#clist-corrections li", has_text="Fix B"), "Mark done")
    app.page.click("#snackbar-action")
    app.sync()
    assert files.text(CORRECTIONS) == corrections(c=f"\n{OLD}\n\n* Fix B\n", d=f"\n{NOW}\n\n* Fix A\n")

    # Moving counts as arriving in the other list.
    app.menu(app.page.locator("#clist-corrections li", has_text="Fix B"), "Move to Maybe")
    app.add_correction("Fix C")  # Corrections' newest group is over 6 hours old
    app.sync()
    assert files.text(CORRECTIONS) == corrections(c=f"\n{NOW}\n\n* Fix C\n", m=f"\n{NOW}\n\n* Fix B\n", d=f"\n{NOW}\n\n* Fix A\n")

    app.advance(1 * HOUR)  # within 6 hours of Done's newest group: joins it
    app.menu(app.page.locator("#clist-corrections li", has_text="Fix C"), "Mark done")
    app.sync()
    assert files.text(CORRECTIONS) == corrections(m=f"\n{NOW}\n\n* Fix B\n", d=f"\n{NOW}\n\n* Fix C\n* Fix A\n")


def test_a_row_started_with_enter_joins_the_group_of_the_row_above(app, files):
    files.set(CORRECTIONS, corrections(c=f"\n{NOW}\n\n* New\n\n{OLD}\n\n* Fix A\n* Fix B\n"))
    app.open(page="corrections")
    app.page.locator("#clist-corrections li", has_text="Fix A").click()
    app.page.press("#clist-corrections li input", "End")
    app.page.press("#clist-corrections li input", "Enter")
    app.page.keyboard.type("Fix A2")
    app.page.click("#clist-corrections h2")  # finish editing
    app.sync()
    assert files.text(CORRECTIONS) == corrections(c=f"\n{NOW}\n\n* New\n\n{OLD}\n\n* Fix A\n* Fix A2\n* Fix B\n")
    assert app.group_ends("#clist-corrections .list") == [True, False, False, False]


def test_a_menu_acts_on_its_entry_even_if_a_sync_reorders_the_list_meanwhile(app, files):
    files.set(FORGOTTEN, f"# Forgotten kanji\n\n{NOW}\n\n* keep\n* delete me\n")
    app.open()
    app.long_press(app.page.locator("#kanji-list li", has_text="delete me"))
    # While the menu is open, another device adds an entry at the top and
    # this app pulls it in (on regaining focus, more than 30 s after the last pull).
    files.set(FORGOTTEN, f"# Forgotten kanji\n\n{NOW}\n\n* from laptop\n* keep\n* delete me\n")
    app.advance(31 * 1000)
    app.page.evaluate("window.dispatchEvent(new Event('focus'))")
    app.page.wait_for_function("() => document.querySelectorAll('#kanji-list li').length === 3")
    app.page.locator("#dialog button", has_text="Delete").click()
    app.sync()
    assert files.text(FORGOTTEN) == f"# Forgotten kanji\n\n{NOW}\n\n* from laptop\n* keep\n"


def test_clicking_another_row_while_editing_starts_editing_it(app, files):
    # With a mouse (e.g. a laptop), the press used to end the first edit and
    # re-render the list, so the click was lost.
    files.set(CORRECTIONS, corrections(c=f"\n{NOW}\n\n* A\n* B\n"))
    app.open(page="corrections")
    app.page.locator("#clist-corrections li", has_text="A").click()
    app.page.locator("#clist-corrections li", has_text="B").click()
    assert app.page.input_value("#clist-corrections li input") == "B"


def test_a_swipe_marks_the_swiped_row_done_even_if_a_sync_changes_the_list_meanwhile(app, files):
    files.set(CORRECTIONS, corrections(c=f"\n{NOW}\n\n* A\n* B\n"))
    app.open(page="corrections")
    app.page.clock.pause_at("2026-11-14T12:10:00Z")  # hold the slide-away animation
    app.swipe(app.page.locator("#clist-corrections li", has_text="B"))
    # Before it finishes, a sync brings in an entry from another device.
    files.set(CORRECTIONS, corrections(c=f"\n{NOW}\n\n* New\n* A\n* B\n"))
    app.sync()
    app.page.clock.run_for(500)
    app.sync()
    assert files.text(CORRECTIONS) == corrections(c=f"\n{NOW}\n\n* New\n* A\n", d="\n### 2026-11-14T12:10:00Z\n\n* B\n")


def test_an_edit_carries_on_through_a_sync_that_changes_the_list(app, files):
    files.set(CORRECTIONS, corrections(c=f"\n{NOW}\n\n* A\n* B\n"))
    app.open(page="corrections")
    app.page.locator("#clist-corrections li", has_text="B").click()
    app.page.keyboard.type(" more")
    # Back to this window after another device added an entry: a pull.
    files.set(CORRECTIONS, corrections(c=f"\n{NOW}\n\n* New\n* A\n* B\n"))
    app.advance(31 * 1000)
    app.page.evaluate("window.dispatchEvent(new Event('focus'))")
    app.page.wait_for_function("() => document.querySelectorAll('#clist-corrections li').length === 3")
    app.page.keyboard.type(" text")
    assert app.page.input_value("#clist-corrections li input") == "B more text"
    app.page.click("#clist-corrections h2")  # finish editing
    app.sync()
    # (The merge keeps the edited row where it was, below A.)
    assert files.text(CORRECTIONS) == corrections(c=f"\n{NOW}\n\n* New\n* A\n* B more text\n")


def test_a_cancelled_stroke_isnt_drawn_to_the_corner(app, files):
    app.open()
    ink = """([x, y]) => { const c = document.getElementById('kanji-canvas'), r = c.getBoundingClientRect(), d = devicePixelRatio;
      return c.getContext('2d').getImageData((x - r.left) * d, (y - r.top) * d, 1, 1).data[3]; }"""
    app.page.evaluate("document.getElementById('kanji-canvas').addEventListener('pointerdown', e => window.pid = e.pointerId)")
    box = app.page.locator("#kanji-canvas").bounding_box()
    x, y = box["x"] + 150, box["y"] + 300
    app.page.mouse.move(x, y)
    app.page.mouse.down()
    app.page.mouse.move(x + 20, y + 20, steps=4)
    # The system takes over the gesture: a pointercancel (here without a position).
    app.page.evaluate("document.getElementById('kanji-canvas').dispatchEvent(new PointerEvent('pointercancel', { pointerId: window.pid }))")
    app.page.mouse.up()
    assert app.page.evaluate(ink, [x + 10, y + 10]) > 0  # the stroke so far
    assert app.page.evaluate(ink, [x / 2, y / 2]) == 0  # nothing towards the corner


def test_the_brush_is_the_same_width_whatever_the_size_of_the_pad(app, files):
    app.open()
    # The width of the ink along a row of the canvas, in CSS pixels (y from the canvas's top).
    ink_width = """(y) => { const c = document.getElementById('kanji-canvas'), d = devicePixelRatio;
      const row = c.getContext('2d').getImageData(0, Math.round(y * d), c.width, 1).data;
      let sum = 0; for (let i = 3; i < row.length; i += 4) sum += row[i];
      return sum / 255 / d; }"""
    sized = """() => { const c = document.getElementById('kanji-canvas');
      return c.width === Math.round(c.getBoundingClientRect().width * devicePixelRatio); }"""

    def dot(y):
        box = app.page.locator("#kanji-canvas").bounding_box()
        app.page.mouse.click(box["x"] + 150, box["y"] + y)
        return app.page.evaluate(ink_width, y)

    def resized(change):
        before = app.page.locator("#kanji-canvas").bounding_box()
        change()
        app.page.wait_for_function(sized)
        after = app.page.locator("#kanji-canvas").bounding_box()
        assert (after["width"], after["height"]) != (before["width"], before["height"])

    # Dots drawn so far, by row: each stays exactly as it was drawn.
    drawn = {}

    def unchanged():
        return all(abs(app.page.evaluate(ink_width, y) - w) < 0.01 for y, w in drawn.items())

    def draw(y):
        drawn[y] = dot(y)
        return abs(drawn[y] - 10) < 0.5  # BRUSH, give or take the antialiasing

    assert draw(100)

    # The list is hidden: the pad grows from two thirds of the page to all of it.
    resized(lambda: app.page.click("#kanji-toggle"))
    assert app.page.locator("#kanji-side").is_hidden()
    assert unchanged()
    assert draw(150)

    # The phone is turned on its side.
    resized(lambda: app.page.set_viewport_size({"width": 915, "height": 412}))
    assert unchanged()
    assert draw(200)

    # And back, with the list shown again.
    resized(lambda: app.page.set_viewport_size({"width": 412, "height": 915}))
    resized(lambda: app.page.click("#kanji-toggle"))
    assert unchanged()
    assert draw(250)


def test_clear_works_on_touches_the_browser_doesnt_turn_into_clicks(app, files):
    app.open()
    page = app.page
    cdp = page.context.new_cdp_session(page)
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
    page.evaluate("document.getElementById('kanji-clear').addEventListener('click', () => window.clicks = (window.clicks ?? 0) + 1)")
    inked = """() => { const c = document.getElementById('kanji-canvas');
      return c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v > 0); }"""
    pad = page.locator("#kanji-canvas").bounding_box()
    btn = page.locator("#kanji-clear").bounding_box()
    px, py = pad["x"] + 150, pad["y"] + 300
    bx, by = btn["x"] + btn["width"] / 2, btn["y"] + btn["height"] / 2

    def touch(kind, *fingers):
        """The fingers on the screen after this event, as (id, x, y)."""
        cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"id": i, "x": x, "y": y} for i, x, y in fingers]})
        page.wait_for_timeout(30)

    # The drawing finger hasn't quite left the pad when another touches Clear.
    touch("touchStart", (1, px, py))
    touch("touchMove", (1, px + 40, py + 40))
    assert page.evaluate(inked)
    touch("touchStart", (1, px + 40, py + 40), (2, bx, by))
    assert not page.evaluate(inked)
    # The rest of that stroke, as the finger leaves, isn't drawn on the cleared pad.
    touch("touchMove", (1, px + 60, py + 60), (2, bx, by))
    touch("touchEnd", (2, bx, by))
    touch("touchEnd")
    assert not page.evaluate(inked)

    # A hurried tap that slides across the button.
    touch("touchStart", (1, px, py))
    touch("touchMove", (1, px + 40, py + 40))
    touch("touchEnd")
    assert page.evaluate(inked)
    touch("touchStart", (1, bx, by))
    touch("touchMove", (1, bx + 25, by))
    touch("touchEnd")
    assert not page.evaluate(inked)

    page.wait_for_timeout(400)
    assert page.evaluate("window.clicks ?? 0") == 0  # neither was a click
    # A click (e.g. Enter or Space on the button) still clears.
    touch("touchStart", (1, px, py))
    touch("touchEnd")
    assert page.evaluate(inked)
    page.focus("#kanji-clear")
    page.keyboard.press("Enter")
    assert not page.evaluate(inked) and page.evaluate("window.clicks") == 1
