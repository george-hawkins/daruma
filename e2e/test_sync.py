"""Syncing the notes files with GitHub: pulling, merging changes made on two
devices, a push rejected because another device pushed first, creating a
missing file, and data saved on the device by older versions of the app."""

from conftest import FORGOTTEN, SETTINGS, HOUR

OLD = "### 2026-11-13T08:00:00Z"
LAPTOP = "### 2026-11-14T10:00:00Z"
NOW = "### 2026-11-14T12:00:00Z"


def test_changes_on_github_are_pulled(app, files):
    app.open()
    files.set(FORGOTTEN, f"# Forgotten kanji\n\n{OLD}\n\n* from laptop\n")
    app.sync()
    assert app.rows("#kanji-list") == ["from laptop"]


def test_changes_on_both_sides_are_merged_with_groups_newest_first(app, files):
    files.set(FORGOTTEN, f"# Forgotten kanji\n\n{OLD}\n\n* old\n")
    app.open()
    app.add_kanji("phone")  # not pushed yet
    files.set(FORGOTTEN, f"# Forgotten kanji\n\n{LAPTOP}\n\n* laptop\n\n{OLD}\n\n* old\n")
    app.sync()
    assert files.text(FORGOTTEN) == f"# Forgotten kanji\n\n{NOW}\n\n* phone\n\n{LAPTOP}\n\n* laptop\n\n{OLD}\n\n* old\n"
    assert app.rows("#kanji-list") == ["phone", "laptop", "old"]
    assert "Merged" in app.page.inner_text("#snackbar-text")


def test_a_push_rejected_because_another_device_pushed_first_is_merged_and_retried(app, files):
    files.set(FORGOTTEN, f"# Forgotten kanji\n\n{OLD}\n\n* old\n")
    app.open()
    app.add_kanji("phone")
    # The laptop pushes between this device reading the file and writing it.
    files.before_next_put = lambda: files.set(FORGOTTEN, f"# Forgotten kanji\n\n{LAPTOP}\n\n* laptop\n\n{OLD}\n\n* old\n")
    app.sync()
    assert files.text(FORGOTTEN) == f"# Forgotten kanji\n\n{NOW}\n\n* phone\n\n{LAPTOP}\n\n* laptop\n\n{OLD}\n\n* old\n"


def test_a_missing_file_is_created(app, files):
    del files.files[FORGOTTEN]
    app.open()
    app.add_kanji("first")
    app.sync()
    assert files.text(FORGOTTEN) == f"# Forgotten kanji\n\n{NOW}\n\n* first\n"


def test_nothing_is_lost_when_the_app_is_backgrounded_and_reopened(app, files):
    app.open()
    app.add_kanji("typed offline")
    app.page.reload()
    app.wait_synced()
    assert app.rows("#kanji-list") == ["typed offline"]


# Data saved by 0.8 (before timestamp groups): items are plain strings. An 0.8
# instance that synced a file with groups took the "###" heading for part of
# the title (the bug fixed in 0.9.1).
V08_DATA = {"header": f"# Forgotten kanji\n\n{NOW}", "items": ["Foobar", "wagawags"]}
GROUPED = f"# Forgotten kanji\n\n{NOW}\n\n* Foobar\n* wagawags\n"


def v08_state(files, dirty=False, items=None):
    data = {**V08_DATA, "items": items or V08_DATA["items"]}
    return {"doc:kanji": {"data": data, "base": V08_DATA, "dirty": dirty, "rev": 1,
                          "sha": files.sha(FORGOTTEN), "syncedUrl": SETTINGS["forgottenUrl"]}}


def test_data_misread_by_an_older_version_is_read_again_from_github(app, files):
    files.set(FORGOTTEN, GROUPED)
    app.open(storage=v08_state(files), clock=None)
    app.page.clock.install(time="2026-11-14T14:27:00Z")
    state = app.stored("doc:kanji")
    assert state["data"]["header"] == "# Forgotten kanji"
    assert state["data"]["items"][0] == {"text": "Foobar", "time": "2026-11-14T12:00:00Z"}
    app.add_kanji("Test")  # within 6 hours of 12:00: joins that group
    app.sync()
    assert files.text(FORGOTTEN) == f"# Forgotten kanji\n\n{NOW}\n\n* Test\n* Foobar\n* wagawags\n"


def test_unpushed_changes_saved_by_an_older_version_are_kept(app, files):
    files.set(FORGOTTEN, GROUPED)
    app.open(storage=v08_state(files, dirty=True, items=["local only", "Foobar", "wagawags"]))
    assert files.text(FORGOTTEN) == f"# Forgotten kanji\n\n* local only\n\n{NOW}\n\n* Foobar\n* wagawags\n"


def test_an_unpushed_change_is_pushed_a_minute_after_the_last_edit(app, files):
    app.open()
    app.add_kanji("later")
    app.advance(61 * 1000)
    app.page.wait_for_function("() => document.getElementById('sync-status').classList.contains('ok')")
    assert files.text(FORGOTTEN) == f"# Forgotten kanji\n\n{NOW}\n\n* later\n"


def test_a_keyword_forgotten_again_survives_a_merge(app, files):
    files.set(FORGOTTEN, f"# Forgotten kanji\n\n{OLD}\n\n* apply\n")
    app.open()
    app.add_kanji("apply")
    files.set(FORGOTTEN, f"# Forgotten kanji\n\n{OLD}\n\n* laptop\n* apply\n")
    app.sync()
    assert files.text(FORGOTTEN) == f"# Forgotten kanji\n\n{NOW}\n\n* apply\n\n{OLD}\n\n* laptop\n* apply\n"


def test_offline_shows_the_offline_cloud_and_no_error(app, files):
    app.open()
    app.offline()
    app.add_kanji("typed offline")
    app.sync()
    assert "offline" in app.page.get_attribute("#sync-status", "class").split()
    assert "Offline" in app.page.get_attribute("#sync-status", "aria-label")
    assert "failed" not in app.page.inner_text("#snackbar-text")


def test_github_unreachable_while_online_also_counts_as_offline(app, files):
    app.open()
    app.page.unroute("https://api.github.com/**")
    app.page.route("https://api.github.com/**", lambda route: route.abort("connectionrefused"))
    app.sync()
    assert "offline" in app.page.get_attribute("#sync-status", "class").split()
    assert "Can't reach GitHub" in app.page.get_attribute("#sync-status", "aria-label")


def test_real_errors_are_still_reported(app, files):
    app.open(settings={**SETTINGS, "forgottenUrl": "https://github.com/o/notes/blob/main/forgotten.md"})
    app.page.unroute("https://api.github.com/**")
    app.page.route("https://api.github.com/**", lambda route: route.fulfill(status=401, json={"message": "Bad credentials"}))
    app.sync()
    assert "error" in app.page.get_attribute("#sync-status", "class").split()
    assert "Bad credentials" in app.page.inner_text("#snackbar-text")


def test_nothing_is_pushed_if_github_already_has_it(app, files):
    app.open()
    app.add_kanji("oops")
    app.menu(app.page.locator("#kanji-list li", has_text="oops"), "Delete")
    app.sync()
    assert files.puts == []
    assert "ok" in app.page.get_attribute("#sync-status", "class").split()


def test_a_save_that_fails_is_reported(app, files):
    app.open()
    app.page.evaluate("() => { Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); }; }")
    app.add_kanji("kept anyway")
    assert "Couldn't save on this device" in app.page.inner_text("#snackbar-text")
    assert app.rows("#kanji-list") == ["kept anyway"]
    app.sync()
    assert "* kept anyway" in files.text(FORGOTTEN)
