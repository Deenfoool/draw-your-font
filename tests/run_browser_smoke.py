import json
import re
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

import websocket

ROOT = Path(__file__).resolve().parents[1]
SEGMENTATION = (ROOT / 'src' / 'segmentation.js').read_text(encoding='utf-8')
APP = (ROOT / 'app.js').read_text(encoding='utf-8')
INDEX = (ROOT / 'index.html').read_text(encoding='utf-8')
STYLE = (ROOT / 'style.css').read_text(encoding='utf-8')
PORT = 9444


def strip_module_syntax(source: str) -> str:
    return re.sub(r'\bexport\s+', '', source)


def cdp_call(ws, request_id: int, method: str, params=None):
    ws.send(json.dumps({'id': request_id, 'method': method, 'params': params or {}}))
    while True:
        message = json.loads(ws.recv())
        if message.get('id') == request_id:
            if 'error' in message:
                raise RuntimeError(message['error'])
            return message.get('result', {})


def cdp_eval(ws, request_id: int, expression: str):
    payload = cdp_call(ws, request_id, 'Runtime.evaluate', {
        'expression': expression,
        'returnByValue': True,
        'awaitPromise': True,
    })
    if payload.get('exceptionDetails'):
        details = payload['exceptionDetails']
        raise RuntimeError(details.get('exception', {}).get('description') or details.get('text') or 'Browser evaluation failed')
    result = payload.get('result', {})
    if result.get('subtype') == 'error':
        raise RuntimeError(result.get('description', 'Browser evaluation failed'))
    return result.get('value')


def set_document(ws, request_id: int, html: str):
    frame_tree = cdp_call(ws, request_id, 'Page.getFrameTree')
    frame_id = frame_tree['frameTree']['frame']['id']
    cdp_call(ws, request_id + 1, 'Page.setDocumentContent', {'frameId': frame_id, 'html': html})


subprocess.run(['pkill', '-9', 'chromium'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
subprocess.run(['pkill', '-9', 'Xvfb'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

with tempfile.TemporaryDirectory(prefix='draw-your-font-browser-') as temporary:
    profile = Path(temporary) / 'profile'
    chrome = subprocess.Popen([
        'xvfb-run', '-a', 'chromium', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
        f'--remote-debugging-port={PORT}', '--remote-allow-origins=*', f'--user-data-dir={profile}',
        'about:blank',
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    try:
        targets = None
        deadline = time.time() + 20
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{PORT}/json', timeout=1) as response:
                    targets = json.load(response)
                if targets:
                    break
            except Exception:
                time.sleep(0.2)
        if not targets:
            raise RuntimeError('Chromium DevTools did not start')

        page = next(target for target in targets if target.get('type') == 'page')
        ws = websocket.create_connection(page['webSocketDebuggerUrl'], timeout=10)
        try:
            cdp_call(ws, 1, 'Page.enable')
            cdp_call(ws, 2, 'Runtime.enable')
            engine_source = strip_module_syntax(SEGMENTATION)
            engine_html = f'''<!doctype html><html lang="ru"><meta charset="utf-8"><title>Engine test</title>
<pre id="result">RUNNING</pre><script>{engine_source}
const width = 180, height = 100;
const gray = new Uint8Array(width * height);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) gray[y * width + x] = 240 - Math.round(x / width * 55);
function testRect(x0, y0, x1, y1, value = 25) {{ for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) gray[y * width + x] = value; }}
testRect(20,38,42,82); testRect(78,38,100,82); testRect(85,23,92,29); testRect(138,38,160,82);
const result = segmentGrayscale(gray, width, height, {{ thresholdDelta:24, absoluteCap:205, backgroundRadius:20, minArea:10, closeIterations:0, mergeStrength:62 }});
const ok = result.stats.glyphCount === 3 && result.stats.rowCount === 1 && result.glyphs[1].sourceIds.length >= 2;
document.querySelector('#result').textContent = ok ? 'PASS' : 'FAIL ' + JSON.stringify(result.stats);
document.documentElement.dataset.test = ok ? 'pass' : 'fail';
</script></html>'''
            set_document(ws, 10, engine_html)
            state = 'pending'
            for request_id in range(20, 60):
                state = cdp_eval(ws, request_id, 'document.documentElement.dataset.test || "pending"')
                if state != 'pending':
                    break
                time.sleep(0.1)
            if state != 'pass':
                details = cdp_eval(ws, 61, 'document.body.innerText')
                raise RuntimeError(f'Chromium engine test failed: {details}')

            app_without_import = re.sub(r"import\s*\{[\s\S]*?\}\s*from\s*['\"]\.\/src\/segmentation\.js['\"];?", '', APP, count=1)
            ui_html = INDEX.replace('<link rel="stylesheet" href="style.css">', f'<style>{STYLE}</style>')
            ui_html = ui_html.replace('<script type="module" src="app.js"></script>', '')
            set_document(ws, 70, ui_html)
            cdp_eval(ws, 72, f'''(() => {{
{engine_source}
{app_without_import}
window.__testApi = {{
  loadFile,
  processImage,
  splitSelectedAt(x) {{
    const id = [...state.selectedIds][0];
    const glyph = state.glyphs.find((item) => item.id === id);
    if (!glyph) throw new Error('No selected glyph');
    splitAtCanvasX(glyph, x);
  }}
}};
return true;
}})()''')
            time.sleep(0.2)
            title = cdp_eval(ws, 80, 'document.querySelector("h1")?.textContent || ""')
            process_disabled = cdp_eval(ws, 81, 'document.querySelector("#processButton")?.disabled')
            charset_options = cdp_eval(ws, 82, 'document.querySelector("#charsetSelect")?.options.length')
            status = cdp_eval(ws, 83, 'document.querySelector("#statusText")?.textContent || ""')
            js_ready = cdp_eval(ws, 84, 'document.querySelector("#thresholdDeltaValue")?.value === "34"')
            if title != 'Draw Your Font RU' or process_disabled is not True or charset_options != 4 or status != 'Ожидание фотографии' or js_ready is not True:
                raise RuntimeError(
                    f'UI smoke test failed: title={title!r}, disabled={process_disabled}, '
                    f'charsets={charset_options}, status={status!r}, ready={js_ready}'
                )

            e2e = cdp_eval(ws, 90, r'''(async () => {
              const canvas = document.createElement('canvas');
              canvas.width = 210; canvas.height = 100;
              const c = canvas.getContext('2d');
              const gradient = c.createLinearGradient(0, 0, canvas.width, 0);
              gradient.addColorStop(0, '#f4f4f4'); gradient.addColorStop(1, '#bdbdbd');
              c.fillStyle = gradient; c.fillRect(0, 0, canvas.width, canvas.height);
              c.fillStyle = '#191919';
              c.fillRect(20, 34, 23, 45);
              c.fillRect(82, 34, 23, 45);
              c.fillRect(88, 20, 7, 6);
              c.fillRect(146, 34, 23, 45);
              const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
              const file = new File([blob], 'browser-e2e.png', { type: 'image/png' });
              await window.__testApi.loadFile(file);
              await window.__testApi.processImage();
              const detected = document.querySelectorAll('.glyph-card').length;
              const cards = [...document.querySelectorAll('.glyph-card')];
              cards[0]?.click(); cards[1]?.click();
              document.querySelector('#mergeSelected').click();
              const afterMerge = document.querySelectorAll('.glyph-card').length;
              document.querySelectorAll('.glyph-card')[0]?.click();
              document.querySelector('#splitSelected').click();
              window.__testApi.splitSelectedAt(60);
              const afterSplit = document.querySelectorAll('.glyph-card').length;
              document.querySelector('#restoreDetection').click();
              const afterRestore = document.querySelectorAll('.glyph-card').length;
              document.querySelectorAll('.glyph-card')[0]?.click();
              document.querySelector('#removeSelected').click();
              const afterDelete = document.querySelectorAll('.glyph-card').length;
              return { detected, afterMerge, afterSplit, afterRestore, afterDelete, status: document.querySelector('#statusText').textContent };
            })()''')
            if e2e.get('detected') != 3 or e2e.get('afterMerge') != 2 or e2e.get('afterSplit') != 3 or e2e.get('afterRestore') != 3 or e2e.get('afterDelete') != 2:
                raise RuntimeError(f'UI image workflow failed: {e2e}')

            print('Chromium engine test: PASS')
            print('Chromium UI smoke test: PASS')
            print('Chromium image workflow test: PASS')
        finally:
            ws.close()
    finally:
        chrome.terminate()
        try:
            chrome.wait(timeout=5)
        except subprocess.TimeoutExpired:
            chrome.kill()
