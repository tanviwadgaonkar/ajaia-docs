"""Browser smoke test (Playwright): login, create/format/save/reload, import, sharing, view-only,
history/restore, keyboard focus handling, and no horizontal overflow on a narrow viewport. Also writes screenshots.
Usage: BASE_URL=http://localhost:3000 [CHROME_PATH=/usr/bin/google-chrome] [SHOT_DIR=docs/screenshots] python3 tests/e2e/smoke.py
Run against a FRESH database (it relies on the seeded demo data)."""
import os
from playwright.sync_api import sync_playwright

B = os.environ.get('BASE_URL', 'http://localhost:3000')
SHOTS = os.environ.get('SHOT_DIR', 'docs/screenshots'); os.makedirs(SHOTS, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))
kw = {'executable_path': os.environ['CHROME_PATH']} if os.environ.get('CHROME_PATH') else {}

def shot(pg, name): pg.screenshot(path=f'{SHOTS}/{name}.png')
def no_overflow(pg, label):
    ow = pg.evaluate('[document.documentElement.scrollWidth, window.innerWidth]')
    assert ow[0] <= ow[1], f'horizontal overflow on {label}: {ow}'

with sync_playwright() as p:
    br = p.chromium.launch(args=['--no-sandbox'], **kw)
    errors = []
    def mk(w=1280, h=800):
        ctx = br.new_context(viewport={'width': w, 'height': h}); pg = ctx.new_page()
        pg.on('pageerror', lambda e: errors.append(str(e)))
        return pg
    def login(pg, who):
        pg.goto(B); pg.wait_for_selector('.demo-user'); pg.click(f'.demo-user:has-text("{who}")'); pg.click('button:has-text("Sign in")')
        pg.wait_for_selector('h1:has-text("Documents")')

    # --- login screen (desktop + mobile)
    pg = mk(); pg.goto(B); pg.wait_for_selector('.demo-user'); shot(pg, 'login')
    assert 'demo accounts' in pg.inner_text('.demo').lower()
    m = mk(375, 740); m.goto(B); m.wait_for_selector('.demo-user'); no_overflow(m, 'login (mobile)')

    a = mk(); login(a, 'Alice')
    a.wait_for_selector('.row:has-text("Welcome to Ajaia Docs")'); shot(a, 'dashboard')

    # --- new doc, rename, format, autosave, reload
    a.click('button:has-text("New document")'); a.wait_for_selector('.ql-editor')
    a.fill('.title-input', 'E2E Doc')
    a.click('.ql-editor'); a.keyboard.type('Heading line')
    a.click('.ql-header .ql-picker-label'); a.click('.ql-header .ql-picker-item[data-value="1"]')
    a.keyboard.press('Enter')
    a.keyboard.press('Control+b'); a.keyboard.type('bold'); a.keyboard.press('Control+b'); a.keyboard.type(' and ')
    a.keyboard.press('Control+i'); a.keyboard.type('italic'); a.keyboard.press('Control+i'); a.keyboard.press('Enter')
    a.keyboard.press('Control+u'); a.keyboard.type('under'); a.keyboard.press('Control+u'); a.keyboard.press('Enter')
    a.click('.ql-list[value="bullet"]'); a.keyboard.type('item A'); a.keyboard.press('Enter'); a.keyboard.type('item B'); a.keyboard.press('Enter'); a.keyboard.press('Enter')
    a.click('.ql-list[value="ordered"]'); a.keyboard.type('first'); a.keyboard.press('Enter'); a.keyboard.type('second')
    a.wait_for_selector('.status:has-text("Saved ✓")', timeout=6000)
    assert 'words' in a.inner_text('.doc-footer')
    shot(a, 'editor')
    a.reload(); a.wait_for_selector('.ql-editor')
    html = a.inner_html('.ql-editor')
    for needle in ['<h1>Heading line</h1>', '<strong>bold</strong>', '<em>italic</em>', '<u>under</u>', 'item A', 'first']:
        assert needle in html, (needle, html)
    assert a.input_value('.title-input') == 'E2E Doc'
    print('PERSIST/FORMAT OK')

    # --- share dialog: keyboard + focus handling
    a.focus('button:has-text("Share")'); a.keyboard.press('Enter')
    a.wait_for_selector('[role=dialog]')
    assert a.evaluate("document.activeElement.id") == 'share-email', 'focus should land on the email field'
    a.fill('#share-email', 'bob@example.com'); a.keyboard.press('Enter')
    a.wait_for_selector('.share-row:has-text("Bob")'); assert 'Shared with Bob' in a.inner_text('.feedback')
    a.fill('#share-email', 'carol@example.com'); a.select_option('#share-role', 'viewer'); a.click('[role=dialog] button[type=submit]')
    a.wait_for_selector('.share-row:has-text("Carol")')
    a.fill('#share-email', 'nobody@example.com'); a.keyboard.press('Enter')
    a.wait_for_function("document.querySelector('.feedback.bad')"); assert 'No user' in a.inner_text('.feedback')
    shot(a, 'share-dialog')
    a.keyboard.press('Escape'); a.wait_for_selector('[role=dialog]', state='detached')
    assert a.evaluate("document.activeElement.innerText.trim()") == 'Share', 'focus must return to the Share button'
    print('SHARE DIALOG + FOCUS OK')

    # --- Bob (editor) and live update; Carol (viewer)
    b = mk(); login(b, 'Bob'); b.wait_for_selector('.row:has-text("E2E Doc")')
    assert 'Can edit' in b.inner_text('.row:has-text("E2E Doc")')
    b.click('.row:has-text("E2E Doc") a'); b.wait_for_selector('.ql-editor')
    assert b.query_selector('button:has-text("Share")') is None and b.query_selector('button:has-text("History")') is None
    b.click('.ql-editor'); b.keyboard.press('Control+End'); b.keyboard.type(' +bob')
    b.wait_for_selector('.status:has-text("Saved ✓")', timeout=6000)
    a.wait_for_function("document.querySelector('.ql-editor').innerText.includes('+bob')", timeout=9000)
    print('EDITOR SHARE + LIVE UPDATE OK')
    c = mk(); login(c, 'Carol'); c.click('.row:has-text("E2E Doc") a'); c.wait_for_selector('.readonly-banner')
    assert c.get_attribute('.ql-editor', 'contenteditable') == 'false'
    assert c.input_value('.title-input') == 'E2E Doc' and c.get_attribute('.title-input', 'readonly') is not None
    assert c.query_selector('.ql-toolbar') is None
    shot(c, 'view-only'); print('VIEW-ONLY OK')

    # --- import
    a.goto(B + '/#/'); a.wait_for_selector('h1:has-text("Documents")')
    with a.expect_file_chooser() as fc: a.click('button:has-text("Import file")')
    fc.value.set_files(os.path.join(HERE, 'sample.docx'))
    a.wait_for_selector('.ql-editor h1'); html = a.inner_html('.ql-editor')
    assert 'Quarterly Plan' in html and 'first item' in html and '<strong>bold</strong>' in html, html
    print('DOCX IMPORT OK')

    # --- dashboard delete confirmation (cancel keeps doc)
    a.goto(B + '/#/'); a.wait_for_selector('.row:has-text("sample")')
    a.click('button[aria-label="Delete sample"]'); a.wait_for_selector('[role=dialog]')
    a.keyboard.press('Escape'); a.wait_for_selector('[role=dialog]', state='detached')
    assert a.query_selector('.row:has-text("sample")'), 'doc must survive cancelled delete'
    print('DELETE CONFIRM OK')

    # --- history: Welcome doc (seeded content) -> edit -> snapshot -> preview -> restore
    a.click('.row:has-text("Welcome to Ajaia Docs") a'); a.wait_for_selector('.ql-editor')
    a.click('.ql-editor'); a.keyboard.press('Control+End'); a.keyboard.type(' EXTRA-TEXT')
    a.wait_for_selector('.status:has-text("Saved ✓")', timeout=6000)
    a.click('button:has-text("History")'); a.wait_for_selector('.version-item')
    a.click('.version-item'); a.wait_for_function("document.querySelector('.preview-pane .ql-editor') && document.querySelector('.preview-pane .ql-editor').innerText.includes('Welcome')")
    assert 'EXTRA-TEXT' not in a.inner_text('.preview-pane'); shot(a, 'history')
    a.click('button:has-text("Restore this version")'); a.click('button:has-text("Confirm restore")')
    a.wait_for_selector('[role=dialog]', state='detached')
    assert 'EXTRA-TEXT' not in a.inner_text('.ql-editor'), 'restore should replace content'
    a.wait_for_timeout(1500); a.reload(); a.wait_for_selector('.ql-editor')
    assert 'EXTRA-TEXT' not in a.inner_text('.ql-editor'), 'restored content must survive reload (no stale autosave overwrite)'
    a.click('button:has-text("History")'); a.wait_for_selector('.version-item')
    assert 'before a restore' in a.inner_text('.version-list'), 'pre-restore content must be kept as a version'
    print('HISTORY RESTORE OK'); a.keyboard.press('Escape')

    # --- mobile viewport: dashboard, editor, dialog without horizontal overflow
    m = mk(375, 740); login(m, 'Alice'); m.wait_for_selector('.row'); no_overflow(m, 'dashboard (mobile)'); shot(m, 'dashboard-mobile')
    m.click('.row:has-text("E2E Doc") a'); m.wait_for_selector('.ql-editor'); no_overflow(m, 'editor (mobile)'); shot(m, 'editor-mobile')
    m.click('button:has-text("Share")'); m.wait_for_selector('[role=dialog]'); no_overflow(m, 'share dialog (mobile)'); shot(m, 'share-dialog-mobile')
    print('MOBILE NO-OVERFLOW OK')
    assert not errors, errors
    print('NO PAGE ERRORS')
    br.close()
