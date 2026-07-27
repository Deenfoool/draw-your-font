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
PORT = 8916
DEBUG_PORT = 9916
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


server = subprocess.Popen(
    [sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'],
    cwd=ROOT,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)
subprocess.run(['pkill', '-9', Path(BROWSER).name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
with tempfile.TemporaryDirectory(prefix='dyfr-ui-flow-') as temp:
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
        ws = websocket.create_connection(page['webSocketDebuggerUrl'], timeout=180)
        try:
            call(ws, 1, 'Page.enable')
            call(ws, 2, 'Runtime.enable')
            result = evaluate(ws, 10, r'''(async () => {
              const waitFor = async (test, timeout = 30000) => {
                const start = performance.now();
                while (!test()) {
                  if (performance.now() - start > timeout) throw new Error('Timeout waiting for UI flow');
                  await new Promise(resolve => setTimeout(resolve, 40));
                }
              };
              const visible = element => Boolean(element && !element.hidden && getComputedStyle(element).display !== 'none');
              await waitFor(() => window.__drawYourFontWorkflow && window.__drawYourFontCursiveUi && document.querySelector('#workflowChoice'));

              const template = document.querySelector('#templateBuilder');
              const scanner = document.querySelector('#templateScanner');
              const manual = document.querySelector('#manualMode');
              const templateChoice = document.querySelector('#chooseTemplateWorkflow');
              const manualChoice = document.querySelector('#chooseManualWorkflow');
              const choiceRects = [templateChoice.getBoundingClientRect(), manualChoice.getBoundingClientRect()];
              const initial = { template: visible(template), scanner: visible(scanner), manual: visible(manual) };

              templateChoice.click();
              await new Promise(resolve => setTimeout(resolve, 80));
              const selectedTemplate = { template: visible(template), scanner: visible(scanner), manual: visible(manual) };

              const dryRun = await window.__drawYourFontTemplate.generateTemplateFile({ download: false, dpi: 48 });
              if (!dryRun) throw new Error('Template dry run failed');
              const scannerAfterDryRun = visible(scanner);

              const downloaded = await window.__drawYourFontTemplate.generateTemplateFile({ download: true, dpi: 48 });
              if (!downloaded) throw new Error('Template download run failed');
              await waitFor(() => visible(scanner));
              const scannerAfterDownload = visible(scanner);

              manualChoice.click();
              await new Promise(resolve => setTimeout(resolve, 80));
              const selectedManual = { template: visible(template), scanner: visible(scanner), manual: visible(manual), open: manual.open };
              templateChoice.click();
              await new Promise(resolve => setTimeout(resolve, 80));
              const scannerAfterReturn = visible(scanner);

              const projectModule = await import('/src/project.js');
              const makeGlyph = char => {
                const width = 54, height = 72, mask = new Uint8Array(width * height);
                for (let y = 18; y <= 61; y += 1) for (let x = 10; x <= 43; x += 1) {
                  if (x < 14 || x > 39 || y < 22 || y > 56) mask[y * width + x] = 1;
                }
                return projectModule.normalizeGlyphRecord({
                  char, width, height, mask,
                  guides: { capY: 8, xHeightY: 25, baselineY: 57, descenderY: 68 },
                });
              };
              const project = projectModule.createEmptyProject({ title: 'UI Flow Test' });
              project.glyphs = [...'мадарожьщукциф'].map(makeGlyph);
              window.__drawYourFontProject.setProject(project, { scroll: false });
              await waitFor(() => document.querySelector('#cursiveCharacter')?.options.length >= 8);

              const cursiveBody = document.querySelector('#cursiveBuilder .cursive-layout');
              const toggle = document.querySelector('#cursiveDisclosureToggle');
              const initialCursive = { expanded: visible(cursiveBody), checked: toggle.checked };
              toggle.click();
              await waitFor(() => visible(cursiveBody) && document.querySelector('#cursiveEnabled').checked);
              const enabledCursive = { expanded: visible(cursiveBody), checked: toggle.checked, enabled: document.querySelector('#cursiveEnabled').checked };

              const adjustments = document.querySelector('.cursive-form-adjustments');
              const field = document.querySelector('#cursivePreviewText');
              field.value = 'мама дрожь щука цифра мама дрожь щука цифра мама дрожь щука цифра';
              field.dispatchEvent(new Event('input', { bubbles: true }));
              await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              const wordCanvas = document.querySelector('#cursiveWordCanvas');

              const padding = ['templateScanner','glyphEditor','fontBuilder','cursiveBuilder'].map(id => {
                const card = document.getElementById(id);
                const header = card.querySelector(':scope > .flow-header');
                return Math.round(header.getBoundingClientRect().left - card.getBoundingClientRect().left);
              });

              return {
                initial,
                sameLine: Math.abs(choiceRects[0].top - choiceRects[1].top) < 4,
                selectedTemplate,
                scannerAfterDryRun,
                scannerAfterDownload,
                selectedManual,
                scannerAfterReturn,
                initialCursive,
                enabledCursive,
                adjustmentsHidden: !visible(adjustments),
                previewTag: field.tagName,
                previewLines: Number(wordCanvas.dataset.lines || 0),
                previewHeight: wordCanvas.height,
                padding,
              };
            })()''')
            if result['initial'] != {'template': False, 'scanner': False, 'manual': False}:
                raise RuntimeError(f'Initial workflow state is wrong: {result}')
            if not result['sameLine']:
                raise RuntimeError(f'Workflow options are not on one line: {result}')
            if result['selectedTemplate'] != {'template': True, 'scanner': False, 'manual': False}:
                raise RuntimeError(f'Template selection is wrong: {result}')
            if result['scannerAfterDryRun'] or not result['scannerAfterDownload'] or not result['scannerAfterReturn']:
                raise RuntimeError(f'Scanner gating is wrong: {result}')
            if result['selectedManual'] != {'template': False, 'scanner': False, 'manual': True, 'open': True}:
                raise RuntimeError(f'Manual selection is wrong: {result}')
            if result['initialCursive'] != {'expanded': False, 'checked': False}:
                raise RuntimeError(f'Cursive stage must start collapsed: {result}')
            if not all(result['enabledCursive'].values()):
                raise RuntimeError(f'Cursive disclosure did not enable the mode: {result}')
            if not result['adjustmentsHidden'] or result['previewTag'] != 'TEXTAREA':
                raise RuntimeError(f'Cursive controls were not simplified: {result}')
            if result['previewLines'] < 2 or result['previewHeight'] <= 310:
                raise RuntimeError(f'Multiline preview did not wrap: {result}')
            if any(value < 18 for value in result['padding']):
                raise RuntimeError(f'Step headings have insufficient padding: {result}')
            print(json.dumps(result, ensure_ascii=False, indent=2))
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
