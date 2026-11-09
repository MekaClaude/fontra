"""The plug-in on a mock of the editor's page: it loads, adds its panel,
offers the editor tour, and a lesson's step waits for the font.

    python -m http.server 8123   (at the repository's root)
    pytest test/test_plugin.py   (needs playwright: pip install playwright pytest)
"""
import pathlib
import re

import pytest

pytest.importorskip("playwright")
from playwright.sync_api import sync_playwright  # noqa: E402

URL = "http://localhost:8123/test/mock-editor.html"


@pytest.fixture(scope="module")
def page():
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        page.goto(URL)
        page.wait_for_function("window.pluginLoaded")
        yield page
        browser.close()


def test_panel_and_welcome(page):
    page.wait_for_selector(".fontra-tour")
    assert page.locator(".fontra-tour h3").inner_text().startswith("Welcome")
    assert page.locator('.sidebar-tab[data-sidebar-name="fontra-tutorials"]').count() == 1
    panel = page.locator("fontra-tutorials-panel")
    assert panel.locator("button.tour").count() == 6
    page.click(".fontra-tour button.next")
    assert page.locator(".fontra-tour h3").inner_text() == "The canvas"
    page.keyboard.press("Escape")
    assert page.locator(".fontra-tour").count() == 0
    assert page.evaluate('JSON.parse(localStorage.getItem("fontra.tutorials")).editor') == "skipped"


def test_lesson_waits(page):
    page.evaluate('document.querySelector(\'fontra-tutorials-panel\').shadowRoot.querySelector(\'[data-tour="first-font"]\').click()')
    page.click(".fontra-tour button.next")  # Start
    page.click(".fontra-tour button.next")  # new font: empty, so done
    assert page.locator(".fontra-tour h3").inner_text().startswith("Create the H")
    assert page.locator(".fontra-tour button.next").inner_text() == "I did it"
    page.evaluate("window.mockFont.glyphMap.H = [72]")
    page.wait_for_selector(".fontra-tour.done")
    assert page.locator(".fontra-tour button.next").inner_text() == "Next"
    page.keyboard.press("Escape")


def test_other_page_step_says_where(page):
    page.evaluate('document.querySelector(\'fontra-tutorials-panel\').shadowRoot.querySelector(\'[data-tour="font-info"]\').click()')
    page.click(".fontra-tour button.next")
    assert "Font Info" in page.locator(".fontra-tour p.where").inner_text()
    page.keyboard.press("Escape")


def test_keys_follow_the_keyboard(page):
    said = page.evaluate(
        """async () => {
            const { forKeyboard } = await import("/tour.js");
            return [
                forKeyboard("⌘A, ⌘↑ and ⌘-scroll", true),
                forKeyboard("⌘A, ⌘↑ and ⌘-scroll", false),
            ];
        }"""
    )
    assert said == ["⌘A, ⌘↑ and ⌘-scroll", "Ctrl+A, Ctrl+↑ and Ctrl-scroll"]


def test_no_tour_asks_to_click_with_the_command_key():
    # Outside a Mac, Fontra ignores a mouse press with Ctrl down.
    for path in pathlib.Path(__file__).parent.parent.glob("tours/*.js"):
        assert not re.search(r"(Hold|with|while).{0,12}⌘", path.read_text()), path
