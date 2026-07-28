import json
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

import websocket

ROOT = Path(__file__).resolve().parents[1]
PORT = 8917
DEBUG_PORT = 9917
BROWSER = shutil.which('chromium') or shutil.which('google-chrome') or shutil.which('google-chrome-stable')
if not BROWSER:
    raise RuntimeError('Chromium/Chrome not found')


def call(ws, ident, method, params=None):
    ws.send(json.dumps({'id': ident, 'method': method, 'params': params or {}}))
    while True:
        message = json.loads(ws.recv())
        if message.get('id') == ident:
            if 'error' in message:
                raise RuntimeError(message['error'])
            return message.get('result', {})


def evaluate(ws, ident, expression):
    payload = call(ws, ident, 'Runtime.evaluate', {
        'expression': expression,
        'returnByValue': True,
        'awaitPromise': True,
    })
    if payload.get('exceptionDetails'):
        details = payload['exceptionDetails']
        raise RuntimeError(details.get('exception', {}).get('description') or details.get('text'))
    return payload.get('result', {}).get('value')


def wait_eval(ws, expression, timeout=40):
    deadline = time.time() + timeout
    ident = 100
    while time.time() < deadline:
        try:
            if evaluate(ws, ident, expression):
                return
        except Exception:
            pass
        ident += 1
        time.sleep(0.1)
    raise RuntimeError(f'Timeout waiting for: {expression}')


server = subprocess.Popen(
    [sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'],
    cwd=ROOT,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)
subprocess.run(['pkill', '-9', Path(BROWSER).name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
with tempfile.TemporaryDirectory(prefix='dyfr-library-') as temp:
    chrome = subprocess.Popen([
        'xvfb-run', '-a', BROWSER,
        '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
        '--remote-allow-origins=*', f'--remote-debugging-port={DEBUG_PORT}',
        '--window-size=1440,1000', f'--user-data-dir={Path(temp) / "profile"}',
        f'http://127.0.0.1:{PORT}/',
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        targets = None
        deadline = time.time() + 30
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{DEBUG_PORT}/json', timeout=1) as response:
                    targets = json.load(response)
                if targets:
                    break
            except Exception:
                time.sleep(0.2)
        if not targets:
            raise RuntimeError('Chromium not ready')
        page = next(item for item in targets if item.get('type') == 'page')
        ws = websocket.create_connection(page['webSocketDebuggerUrl'], timeout=120)
        try:
            call(ws, 1, 'Page.enable')
            call(ws, 2, 'Runtime.enable')
            wait_eval(ws, 'Boolean(window.__drawYourFontLibraryBridge && window.__drawYourFontProject)', 40)
            saved = evaluate(ws, 10, r'''(async () => {
              const library = await import('/src/font-library.js');
              const projectModule = await import('/src/project.js');
              await library.clearFontLibrary();
              const width = 36, height = 52, mask = new Uint8Array(width * height);
              for (let y = 9; y < 44; y += 1) for (let x = 7; x < 30; x += 1) {
                if (x < 10 || x > 27 || y < 12 || y > 40) mask[y * width + x] = 1;
              }
              const project = projectModule.createEmptyProject({ id: 'library-chromium-project', title: 'Библиотечный шрифт' });
              project.glyphs = [projectModule.normalizeGlyphRecord({
                id: 'library-glyph-a', char: 'а', width, height, mask,
                guides: { capY: 5, xHeightY: 18, baselineY: 42, descenderY: 48 },
              })];
              window.__drawYourFontProject.setProject(project, { scroll: false });
              document.querySelector('#fontFamily').value = 'Библиотечный шрифт';
              document.querySelector('#fontStyle').value = 'Regular';
              window.__drawYourFontBuilder = { getState: () => ({ building: false, outputs: {
                ttf: new Uint8Array([0,1,0,0,0,10,0,128]),
                woff: new Uint8Array([119,79,70,70,0,1]),
                woff2: new Uint8Array([119,79,70,50,0,1]),
                css: '@font-face{font-family:"Библиотечный шрифт";}',
                zip: new Uint8Array([80,75,3,4,0,0]),
                baseName: 'library-font', familyName: 'Библиотечный шрифт', styleName: 'Regular',
                glyphSet: { entries: [{ char: 'а' }] },
              } }) };
              document.querySelector('#downloadTtf').disabled = false;
              window.__drawYourFontLibraryBridge.refresh();
              const button = document.querySelector('#addFontToLibrary');
              if (button.disabled || button.hidden) throw new Error('Library button is unavailable after build');
              const record = await window.__drawYourFontLibraryBridge.addCurrentFont();
              if (!record) throw new Error(document.querySelector('#librarySaveStatus').textContent);
              return { id: record.id, family: record.familyName, bytes: record.totalBytes, status: document.querySelector('#librarySaveStatus').textContent };
            })()''')
            if not saved or saved['family'] != 'Библиотечный шрифт' or saved['bytes'] < 20 or 'сохранён' not in saved['status']:
                raise RuntimeError(f'Font save failed: {saved}')

            call(ws, 20, 'Page.navigate', {'url': f'http://127.0.0.1:{PORT}/library.html'})
            wait_eval(ws, 'Boolean(window.__drawYourFontLibraryPage?.getState().fonts.length === 1 && !window.__drawYourFontLibraryPage?.getState().rendering)', 40)
            library_state = evaluate(ws, 30, r'''(() => {
              const card = document.querySelector('.library-font-card');
              const field = document.querySelector('#libraryPreviewText');
              field.value = 'Проверка библиотеки';
              field.dispatchEvent(new Event('input', { bubbles: true }));
              return {
                cards: document.querySelectorAll('.library-font-card').length,
                title: card?.querySelector('h2')?.textContent,
                preview: card?.querySelector('.library-font-preview')?.textContent,
                mode: card?.querySelector('.library-mode')?.textContent,
                downloads: [...card.querySelectorAll('.library-file-actions button')].map(button => !button.disabled),
                projectEnabled: !card.querySelector('.library-open-project').disabled,
              };
            })()''')
            if library_state['cards'] != 1 or library_state['title'] != 'Библиотечный шрифт':
                raise RuntimeError(f'Library card failed: {library_state}')
            if library_state['preview'] != 'Проверка библиотеки' or not library_state['projectEnabled']:
                raise RuntimeError(f'Library interaction failed: {library_state}')
            if library_state['downloads'][:2] != [True, True]:
                raise RuntimeError(f'Font downloads are disabled: {library_state}')

            deleted = evaluate(ws, 40, r'''(async () => {
              window.confirm = () => true;
              document.querySelector('.library-delete').click();
              const start = performance.now();
              while (window.__drawYourFontLibraryPage.getState().fonts.length || window.__drawYourFontLibraryPage.getState().rendering) {
                if (performance.now() - start > 10000) throw new Error('Delete timeout');
                await new Promise(resolve => setTimeout(resolve, 50));
              }
              return { empty: Boolean(document.querySelector('.library-empty')), count: window.__drawYourFontLibraryPage.getState().fonts.length };
            })()''')
            if deleted != {'empty': True, 'count': 0}:
                raise RuntimeError(f'Library delete failed: {deleted}')
            print(json.dumps({'saved': saved, 'library': library_state, 'deleted': deleted}, ensure_ascii=False, indent=2))
        finally:
            ws.close()
    finally:
        chrome.terminate()
        try:
            chrome.wait(timeout=5)
        except subprocess.TimeoutExpired:
            chrome.kill()
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
