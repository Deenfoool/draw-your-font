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
SOURCES = [
    ROOT / 'src' / 'template-code.js',
    ROOT / 'src' / 'template.js',
    ROOT / 'src' / 'template-scanner.js',
    ROOT / 'src' / 'project.js',
    ROOT / 'src' / 'scan-recovery.js',
    ROOT / 'stage4-app.js',
    ROOT / 'stage4-recovery-app.js',
]
PORT = 9898
BROWSER = shutil.which('chromium') or shutil.which('google-chrome') or shutil.which('google-chrome-stable')
if not BROWSER:
    raise RuntimeError('Chromium/Chrome not found')


def strip_module(source):
    source = re.sub(r"import\s+(?:\{[\s\S]*?\}\s*from\s*)?['\"][^'\"]+['\"]\s*;?", '', source)
    source = re.sub(r'\bexport\s+', '', source)
    source = source.replace('import.meta.url', "'http://127.0.0.1/src/scan-recovery.js'")
    return source


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
with tempfile.TemporaryDirectory(prefix='dyf-stage4-ui-') as temp:
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
        ws = websocket.create_connection(page['webSocketDebuggerUrl'], timeout=120)
        try:
            call(ws, 1, 'Page.enable')
            call(ws, 2, 'Runtime.enable')
            html = re.sub(r'<link[^>]+>', '', INDEX)
            html = re.sub(r'<script type="module"[^>]*></script>', '', html)
            set_document(ws, 10, html)
            source = '\n'.join(strip_module(path.read_text(encoding='utf-8')) for path in SOURCES)
            bootstrap = r'''
const __plan = planTemplatePages(getTemplateCharset('ru-full'), {layoutId:'balanced', charsetId:'ru-full', title:'Stage 4 Browser'});
window.__drawYourFontTemplate = { getState(){ return {plan:__plan,pageIndex:0,generating:false}; } };
Object.assign(window,{renderTemplatePage,rgbaToGray,computeHomography,warpGrayscale,detectTemplateMarkers,debugTemplateMarkerCandidates});
'''
            evaluate(ws, 20, f'(() => {{ {source}\n{bootstrap}\nreturn true; }})()')
            result = evaluate(ws, 30, r'''(async () => {
              const plan = window.__drawYourFontTemplate.getState().plan;
              const page = plan.pages[0];
              const canvas = document.createElement('canvas');
              const ctx = canvas.getContext('2d', {alpha:false, willReadFrequently:true});
              renderTemplatePage(ctx, page, {dpi:101.6, showGuides:true});
              const sx=canvas.width/210, sy=canvas.height/297;
              ctx.fillStyle='#777';
              for(const cell of page.cells){const cx=cell.centerX*sx, base=cell.baseline*sy;ctx.fillRect(cx-4,base-42,8,44);ctx.fillRect(cx-17,base-7,34,7);}
              const image=ctx.getImageData(0,0,canvas.width,canvas.height);
              const canonical=rgbaToGray(image.data,canvas.width,canvas.height);
              for(let i=0;i<canonical.length;i++) canonical[i]=Math.round(178+(canonical[i]/255)*54);
              const pw=1180,ph=920;
              const quad=[{x:1020,y:65},{x:1085,y:845},{x:140,y:865},{x:85,y:90}];
              const corners=[{x:0,y:0},{x:canvas.width-1,y:0},{x:canvas.width-1,y:canvas.height-1},{x:0,y:canvas.height-1}];
              const h=computeHomography(quad,corners);
              const photo=warpGrayscale(canonical,canvas.width,canvas.height,h,pw,ph);
              const pc=document.createElement('canvas');pc.width=pw;pc.height=ph;const pctx=pc.getContext('2d');const out=pctx.createImageData(pw,ph);
              for(let i=0;i<photo.length;i++){const p=i*4;out.data[p]=out.data[p+1]=out.data[p+2]=photo[i];out.data[p+3]=255;}pctx.putImageData(out,0,0);
              const blob=await new Promise(resolve=>pc.toBlob(resolve,'image/png'));
              const file=new File([blob],'washed-rotated-page.png',{type:'image/png'});
              const input=document.querySelector('#scanFiles');const dt=new DataTransfer();dt.items.add(file);input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));
              await window.__drawYourFontProject.processScanFiles();
              const before=window.__drawYourFontProject.getState();
              if (!before.project) return {debug:true,status:document.querySelector('#scanStatus').textContent,report:document.querySelector('#scanReport').textContent,pages:before.scans.length};
              const exported=window.__drawYourFontProject.exportProject();
              window.__drawYourFontProject.importProject(exported);
              document.querySelector('#editorAutoMetrics').click();
              document.querySelector('#kerningLeft').value='А';document.querySelector('#kerningRight').value='В';document.querySelector('#kerningValue').value='-55';document.querySelector('#kerningSet').click();
              const project=window.__drawYourFontProject.getProject();
              return {glyphs:project.glyphs.length,first:project.glyphs[0].char,ink:project.glyphs[0].quality.inkCount,pages:before.scans.length,missing:document.querySelector('#scanReport').textContent,status:document.querySelector('#scanStatus').textContent,kerning:project.kerning['А|В'],editorShown:document.querySelector('#editorEmpty').hidden,serialized:exported.length,recovery:before.scans[0]?.recovery};
            })()''')
            if result.get('debug'):
                raise RuntimeError(f'Debug scan failed: {result}')
            if result['glyphs'] != 48 or result['first'] != 'А' or result['ink'] <= 10:
                raise RuntimeError(f'Scan/project invalid: {result}')
            if result['pages'] != 1 or '2' not in result['missing'] or result['kerning'] != -55:
                raise RuntimeError(f'Page/kerning invalid: {result}')
            if not result['editorShown'] or result['serialized'] < 1000:
                raise RuntimeError(f'Integration invalid: {result}')
            if not result.get('recovery') or result['recovery'].get('variant') == 'original':
                raise RuntimeError(f'Low-contrast recovery was not used: {result}')
            print(json.dumps(result, ensure_ascii=False, indent=2))
        finally:
            ws.close()
    finally:
        chrome.terminate()
        try:
            chrome.wait(timeout=5)
        except subprocess.TimeoutExpired:
            chrome.kill()
