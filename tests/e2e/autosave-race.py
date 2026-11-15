"""Regression test: an in-flight save must not mark newer edits as saved.
Needs: pip install playwright && playwright install chromium (or set CHROME_PATH), app running at BASE_URL.
Usage: BASE_URL=http://localhost:3000 python3 tests/e2e/autosave-race.py
"""
import os, time, json
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
kw = {'executable_path': os.environ['CHROME_PATH']} if os.environ.get('CHROME_PATH') else {}

with sync_playwright() as p:
    br = p.chromium.launch(args=['--no-sandbox'], **kw)
    pg = br.new_page()
    pg.goto(BASE); pg.wait_for_selector('.demo-user'); pg.click('.demo-user:has-text("Alice")'); pg.click('button:has-text("Sign in")')
    pg.wait_for_selector('h1:has-text("Documents")')
    pg.click('button:has-text("New document")'); pg.wait_for_selector('.ql-editor')

    puts, held = [], []   # PUT bodies in order; first PUT's route is held open (without blocking the browser)
    def intercept(route):
        if route.request.method != 'PUT': return route.continue_()
        puts.append(json.loads(route.request.post_data)['content'])
        if len(puts) <= 2: held.append(route)     # hold responses #1 and #2 until we release them
        else: route.continue_()
    pg.route('**/api/docs/*', intercept)

    pg.click('.ql-editor'); pg.keyboard.type('AAA')
    deadline = time.time() + 5
    while not held and time.time() < deadline: pg.wait_for_timeout(50)
    assert held, 'first save never started'
    pg.keyboard.type('BBB')                       # edit made while save #1 is in flight
    held[0].continue_()                           # let save #1 complete BEFORE the debounce for BBB fires (<700ms)
    pg.wait_for_timeout(300)
    status = pg.inner_text('.status')   # follow-up save #2 (if any) is still held, so 'Saved' here would be a lie
    print('status just after save #1 completed:', repr(status), '| PUTs so far:', len(puts))
    assert 'Saved' not in status.replace('Unsaved',''), 'BUG: save #1 marked the doc clean while newer edits (BBB) are unsaved'
    deadline = time.time() + 5
    while len(held) < 2 and time.time() < deadline: pg.wait_for_timeout(50)
    assert len(held) == 2, 'follow-up save for newer edit never sent'
    held[1].continue_()
    pg.wait_for_function("document.querySelector('.status').innerText.includes('Saved')", timeout=8000)
    assert 'AAABBB' in puts[-1], f'final save missing newer edit: {puts}'
    # Server really has everything.
    pg.reload(); pg.wait_for_selector('.ql-editor')
    assert 'AAABBB' in pg.inner_text('.ql-editor'), 'newer edit lost after reload'
    print('AUTOSAVE RACE TEST PASSED; saves sent:', len(puts))
    br.close()
