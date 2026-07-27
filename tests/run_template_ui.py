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
TEMPLATE_CSS = (ROOT / 'template.css').read_text(encoding='utf-8')
TEMPLATE_CODE = (ROOT / 'src' / 'template-code.js').read_text(encoding='utf-8')
TEMPLATE = (ROOT / 'src' / 'template.js').read_text(encoding='utf-8')
PDF = (ROOT / 'src' / 'pdf.js').read_text(encoding='utf-8')
APP = (ROOT / 'template-app.js').read_text(encoding='utf-8')
PORT = 9666
BROWSER = shutil.which('chromium') or shutil.which('google-chrome') or shutil.which('google-chrome-stable')
if not BROWSER: raise RuntimeError('Chromium/Chrome not found')


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
with tempfile.TemporaryDirectory(prefix='dyf-template-ui-') as temp:
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
        ws = websocket.create_connection(page['webSocketDebuggerUrl'], timeout=40)
        try:
            call(ws, 1, 'Page.enable')
            call(ws, 2, 'Runtime.enable')
            html = INDEX.replace('<link rel="stylesheet" href="style.css">', '<style>:root{--border:#334155;--muted:#64748b;--text:#111827;--cyan:#0284c7;--accent:#16a34a;--accent-strong:#16a34a;--warning:#d97706;--danger:#dc2626}body{font-family:Arial;background:#eee}.card{background:white}.primary-button,.secondary-button{padding:10px}</style>')
            html = html.replace('<link rel="stylesheet" href="template.css">', f'<style>{TEMPLATE_CSS}</style>')
            html = re.sub(r'<script type="module"[^>]*></script>', '', html)
            set_document(ws, 10, html)
            source = strip_exports(TEMPLATE_CODE) + '\n' + strip_exports(strip_imports(TEMPLATE)) + '\n' + strip_exports(PDF) + '\n' + strip_imports(APP)
            evaluate(ws, 12, f'(() => {{ {source} return true; }})()')
            initial = evaluate(ws, 20, '''({
              summary: document.querySelector('#templateSummary').textContent,
              page: document.querySelector('#templatePageLabel').textContent,
              width: document.querySelector('#templatePreview').width,
              height: document.querySelector('#templatePreview').height,
              nextDisabled: document.querySelector('#templateNext').disabled,
              status: document.querySelector('#templateStatus').textContent
            })''')
            if '88' not in initial['summary'] or '2' not in initial['summary'] or initial['page'] != 'Страница 1 из 2':
                raise RuntimeError(f'Initial UI invalid: {initial}')
            if initial['width'] != 595 or initial['height'] != 842 or initial['nextDisabled'] is not False:
                raise RuntimeError(f'Preview invalid: {initial}')

            page2 = evaluate(ws, 21, "document.querySelector('#templateNext').click(); document.querySelector('#templatePageLabel').textContent")
            if page2 != 'Страница 2 из 2':
                raise RuntimeError(f'Navigation failed: {page2}')

            extended = evaluate(ws, 22, '''(() => {
              const select = document.querySelector('#templateCharset');
              select.value = 'ru-extended'; select.dispatchEvent(new Event('change'));
              return { layout: document.querySelector('#templateLayout').value, summary: document.querySelector('#templateSummary').textContent };
            })()''')
            if extended['layout'] != 'compact' or '98' not in extended['summary'] or '2' not in extended['summary']:
                raise RuntimeError(f'Extended preset failed: {extended}')

            custom = evaluate(ws, 23, '''(() => {
              const select = document.querySelector('#templateCharset');
              select.value = 'custom'; select.dispatchEvent(new Event('change'));
              const area = document.querySelector('#templateCustomCharset');
              area.value = 'А Б В Ё ё'; area.dispatchEvent(new Event('input'));
              return { hidden: area.hidden, summary: document.querySelector('#templateSummary').textContent };
            })()''')
            if custom['hidden'] is not False or '5' not in custom['summary']:
                raise RuntimeError(f'Custom charset failed: {custom}')

            result = evaluate(ws, 24, '''(async () => {
              const select = document.querySelector('#templateCharset');
              select.value = 'ru-full'; select.dispatchEvent(new Event('change'));
              const output = await window.__drawYourFontTemplate.generateTemplateFile({ download: false, dpi: 72 });
              return output ? { pageCount: output.pageCount, size: output.size, status: document.querySelector('#templateStatus').textContent } : null;
            })()''')
            if not result or result['pageCount'] != 2 or result['size'] < 50000 or 'PDF проверен' not in result['status']:
                raise RuntimeError(f'UI PDF generation failed: {result}')
            print(json.dumps({'initial': initial, 'extended': extended, 'custom': custom, 'generated': result}, ensure_ascii=False, indent=2))
        finally:
            ws.close()
    finally:
        chrome.terminate()
        try:
            chrome.wait(timeout=5)
        except subprocess.TimeoutExpired:
            chrome.kill()
