import json
import re
import shutil
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

import websocket

ROOT = Path(__file__).resolve().parents[1]
INDEX = (ROOT / 'index.html').read_text(encoding='utf-8')
FONT_CSS = (ROOT / 'font.css').read_text(encoding='utf-8')
BUILDER = (ROOT / 'src' / 'font-builder.js').read_text(encoding='utf-8')
APP = (ROOT / 'font-app.js').read_text(encoding='utf-8')
PORT = 9777
BROWSER = shutil.which('chromium') or shutil.which('google-chrome') or shutil.which('google-chrome-stable')
if not BROWSER:
    raise RuntimeError('Chromium/Chrome not found')


def strip_exports(source):
    return re.sub(r'\bexport\s+', '', source)


def strip_imports(source):
    return re.sub(r"import\s*\{[\s\S]*?\}\s*from\s*['\"][^'\"]+['\"];?", '', source)


def call(ws, ident, method, params=None):
    ws.send(json.dumps({'id': ident, 'method': method, 'params': params or {}}))
    while True:
        message = json.loads(ws.recv())
        if message.get('id') == ident:
            if 'error' in message:
                raise RuntimeError(message['error'])
            return message.get('result', {})


def evaluate(ws, ident, expression):
    payload = call(ws, ident, 'Runtime.evaluate', {'expression': expression, 'returnByValue': True, 'awaitPromise': True})
    if payload.get('exceptionDetails'):
        details = payload['exceptionDetails']
        raise RuntimeError(details.get('exception', {}).get('description') or details.get('text'))
    return payload.get('result', {}).get('value')


def set_document(ws, ident, html):
    tree = call(ws, ident, 'Page.getFrameTree')
    frame_id = tree['frameTree']['frame']['id']
    call(ws, ident + 1, 'Page.setDocumentContent', {'frameId': frame_id, 'html': html})


subprocess.run(['pkill', '-9', Path(BROWSER).name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
subprocess.run(['pkill', '-9', 'Xvfb'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
with tempfile.TemporaryDirectory(prefix='dyf-font-ui-') as temp:
    chrome = subprocess.Popen([
        'xvfb-run', '-a', BROWSER, '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
        '--remote-allow-origins=*', f'--remote-debugging-port={PORT}', f'--user-data-dir={Path(temp) / "profile"}', 'about:blank',
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
            raise RuntimeError('Chromium not ready')
        page = next(item for item in targets if item.get('type') == 'page')
        ws = websocket.create_connection(page['webSocketDebuggerUrl'], timeout=60)
        try:
            call(ws, 1, 'Page.enable')
            call(ws, 2, 'Runtime.enable')
            html = INDEX
            html = re.sub(r'<link rel="stylesheet" href="(?:style|template|font)\.css">', '', html)
            html = html.replace('</head>', f'<style>:root{{--border:#334155;--muted:#64748b;--text:#111827;--cyan:#0284c7;--accent:#16a34a;--accent-strong:#16a34a;--warning:#d97706;--danger:#dc2626}}body{{font-family:Arial}}{FONT_CSS}</style></head>')
            html = re.sub(r'<script type="module" src="(?:template-app|app|font-app)\.js"></script>', '', html)
            set_document(ws, 10, html)
            source = strip_exports(BUILDER)
            source += '''
async function encodeWoff2(ttfBytes, onProgress) { onProgress?.('Сжимаю WOFF2…'); const out = new Uint8Array(Math.max(64, Math.floor(ttfBytes.length * 0.55))); out.set([119,79,70,50]); return out; }
function getWoff2DependencyInfo(){ return { wasmUrl: 'https://cdn.jsdelivr.net/mock.wasm' }; }
'''
            source += strip_imports(APP)
            bootstrap = r'''
const width = 140, height = 90;
const mask = new Uint8Array(width * height);
function rect(x0,y0,x1,y1){ for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++) mask[y*width+x]=1; }
rect(10,20,42,75); rect(62,20,98,75); rect(70,7,77,13); rect(86,7,93,13);
window.__drawYourFontSegmentation = {
  getFontSource(){ return { width, height, mask: new Uint8Array(mask), glyphs:[{x0:10,y0:20,x1:42,y1:75},{x0:62,y0:7,x1:98,y1:75}], labels:['А','Ё'], fileName:'test.png' }; },
  getStats(){ return {available:true,glyphCount:2,labeledCount:2}; }
};
'''
            evaluate(ws, 12, f'(() => {{ {source}\n{bootstrap}\nwindow.dispatchEvent(new CustomEvent("drawyourfont:segmentation-updated",{{detail:{{available:true,glyphCount:2,labeledCount:2}}}})); return true; }})()')
            initial = evaluate(ws, 20, '''({
              disabled: document.querySelector('#fontBuild').disabled,
              source: document.querySelector('#fontSourceStats').textContent,
              status: document.querySelector('#fontStatus').textContent
            })''')
            if initial['disabled'] is not False or '2' not in initial['source']:
                raise RuntimeError(f'Font readiness failed: {initial}')

            result = evaluate(ws, 21, '''(async () => {
              const output = await window.__drawYourFontBuilder.buildFont();
              if (!output) return null;
              return {
                ttf: output.ttf.length,
                woff: output.woff.length,
                woff2: output.woff2.length,
                zip: output.zip.length,
                ttfSig: [...output.ttf.slice(0,4)],
                woffSig: String.fromCharCode(...output.woff.slice(0,4)),
                woff2Sig: String.fromCharCode(...output.woff2.slice(0,4)),
                entries: output.glyphSet.entries.map(e => e.character).join(''),
                status: document.querySelector('#fontStatus').textContent,
                css: document.querySelector('#fontCss').value,
                previewFamily: document.querySelector('#fontPreview').style.fontFamily,
                zipEnabled: !document.querySelector('#downloadFontZip').disabled
              };
            })()''')
            if not result:
                raise RuntimeError('Font build returned null')
            if result['ttfSig'] != [0, 1, 0, 0] or result['woffSig'] != 'wOFF' or result['woff2Sig'] != 'wOF2':
                raise RuntimeError(f'Format signatures invalid: {result}')
            if result['entries'] != 'ЁА' or result['ttf'] < 700 or result['woff'] < 500:
                raise RuntimeError(f'Font content invalid: {result}')
            if 'font-face' not in result['css'] or not result['zipEnabled'] or 'готов' not in result['status'].lower():
                raise RuntimeError(f'UI output invalid: {result}')
            if not result['previewFamily']:
                raise RuntimeError(f'Font preview not installed: {result}')

            changed = evaluate(ws, 22, '''(() => {
              const input = document.querySelector('#fontSideBearing');
              input.value = '100'; input.dispatchEvent(new Event('input'));
              return { zipDisabled: document.querySelector('#downloadFontZip').disabled, output: document.querySelector('#fontOutputStats').textContent };
            })()''')
            if changed['zipDisabled'] is not True or 'ещё не собран' not in changed['output']:
                raise RuntimeError(f'Invalidation failed: {changed}')
            print(json.dumps({'initial': initial, 'built': result, 'changed': changed}, ensure_ascii=False, indent=2))
        finally:
            ws.close()
    finally:
        chrome.terminate()
        try:
            chrome.wait(timeout=5)
        except subprocess.TimeoutExpired:
            chrome.kill()
