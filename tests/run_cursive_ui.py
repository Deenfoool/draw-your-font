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
PORT = 8915
DEBUG_PORT = 9915
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
with tempfile.TemporaryDirectory(prefix='dyfr-cursive-ui-') as temp:
    chrome = subprocess.Popen([
        'xvfb-run', '-a', BROWSER,
        '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
        '--remote-allow-origins=*', f'--remote-debugging-port={DEBUG_PORT}',
        f'--user-data-dir={Path(temp) / "profile"}',
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
              const waitFor = async (test, timeout = 20000) => {
                const start = performance.now();
                while (!test()) {
                  if (performance.now() - start > timeout) throw new Error('Timeout waiting for cursive UI');
                  await new Promise(resolve => setTimeout(resolve, 40));
                }
              };
              await waitFor(() => window.__drawYourFontProject && window.__drawYourFontCursive && document.querySelector('#cursiveBuilder'));
              const descenders = new Set(['д','р','у','ф','щ','ц']);
              const makeGlyph = (char, seed = 0) => {
                const width = 54, height = 78, mask = new Uint8Array(width * height);
                const put = (x,y,r=2) => { for(let yy=y-r;yy<=y+r;yy++)for(let xx=x-r;xx<=x+r;xx++)if(xx>=0&&yy>=0&&xx<width&&yy<height&&(xx-x)**2+(yy-y)**2<=r*r+.5)mask[yy*width+xx]=1; };
                const line = (x0,y0,x1,y1,r=2) => { const steps=Math.ceil(Math.hypot(x1-x0,y1-y0)*2); for(let i=0;i<=steps;i++){const t=i/steps;put(Math.round(x0+(x1-x0)*t),Math.round(y0+(y1-y0)*t),r);} };
                line(11+seed,57,17+seed,26);line(17+seed,26,27+seed,48);line(27+seed,48,39+seed,25);line(39+seed,25,44+seed,57);line(12+seed,56,44+seed,56);
                if(descenders.has(char)){line(24+seed,55,24+seed,73,2);line(24+seed,73,31+seed,69,2);}
                const bytes=[];let value=mask[0]?1:0,run=0;for(let i=0;i<mask.length;i++){const bit=mask[i]?1:0;if(bit===value&&run<65535)run++;else{bytes.push(value,run>>8,run&255);value=bit;run=1;}}bytes.push(value,run>>8,run&255);let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
                return {id:`g-${char}`,char,width,height,mask:btoa(binary),guides:{capY:8,xHeightY:25,baselineY:59,descenderY:73},metrics:{leftSideBearing:42,rightSideBearing:42,scale:1,offsetX:0,offsetY:0,advanceWidth:null},quality:{inkCount:mask.reduce((a,b)=>a+b,0),areaRatio:.1,bbox:{x0:8,y0:20,x1:47,y1:74,width:40,height:55},warnings:[]},source:{type:'test'}};
              };
              const now=new Date().toISOString();
              const chars=['м','а','т','д','р','у','ф','щ','ц','о','ж','ь','с','е','и','А'];
              const project={format:'draw-your-font-project',version:4,id:'cursive-browser-test',title:'Cursive Browser Test',createdAt:now,updatedAt:now,glyphs:chars.map((char,index)=>makeGlyph(char,(index%3)-1)),kerning:{'А|А':-40},font:{familyName:'Cursive Browser Test',styleName:'Regular',unitsPerEm:1000,ascent:800,descent:-200,lineGap:120},template:null,sourceFiles:[]};
              window.__drawYourFontProject.importProject(JSON.stringify(project));
              await waitFor(() => document.querySelector('#cursiveCharacter')?.options.length >= 15);
              const enabled=document.querySelector('#cursiveEnabled');if(!enabled.checked) enabled.click();
              document.querySelector('#cursiveDescenderPreset').click();
              document.querySelector('#cursiveCharacter').value='р';document.querySelector('#cursiveCharacter').dispatchEvent(new Event('change',{bubbles:true}));
              if(!document.querySelector('#cursiveHasDescender').checked) throw new Error('р is not marked as descender');
              document.querySelector('#cursiveDescenderScale').value='140';document.querySelector('#cursiveDescenderScale').dispatchEvent(new Event('input',{bubbles:true}));
              document.querySelector('#cursivePreviewText').value='дрожь';document.querySelector('#cursivePreviewText').dispatchEvent(new Event('input',{bubbles:true}));
              const simulation=window.__drawYourFontCursive.simulate('дрожь');
              const forms=simulation.map(item=>item.form);
              const contextual=simulation.map(item=>item.contextualForm);
              if(JSON.stringify(forms)!==JSON.stringify(['init','medi','medi','medi','fina'])) throw new Error(`Bad base simulation ${forms}`);
              if(JSON.stringify(contextual)!==JSON.stringify(['init.u','medi.l','medi.m','medi.u','fina'])) throw new Error(`Bad contextual simulation ${contextual}`);
              document.querySelector('#fontBuild').click();
              await waitFor(() => ['ok','error'].includes(document.querySelector('#fontStatus').dataset.mode), 120000);
              const status=document.querySelector('#fontStatus');
              if(status.dataset.mode!=='ok') throw new Error(status.textContent);
              const state=window.__drawYourFontCursive.getState();
              if(!state.outputs?.ttf || !state.outputs?.woff2) throw new Error('Connected outputs missing');
              if(!state.outputs.built.tables.includes('GSUB') || !state.outputs.built.tables.includes('GPOS')) throw new Error('GSUB or GPOS missing');
              if(state.outputs.built.layout.engine!=='russian-school-contextual-v1') throw new Error(`Wrong joining engine ${state.outputs.built.layout.engine}`);
              if(state.outputs.built.layout.featureLookups.length!==9) throw new Error(`Wrong contextual lookup count ${state.outputs.built.layout.featureLookups}`);
              const rVertical=state.outputs.built.layout.vertical['р'];
              if(!rVertical?.hasDescender || rVertical.yMin>=-80) throw new Error(`Bad р descender ${JSON.stringify(rVertical)}`);
              if(state.outputs.built.layout.metrics.descent>=-200) throw new Error(`Font descent did not expand ${JSON.stringify(state.outputs.built.layout.metrics)}`);
              const signature=String.fromCharCode(...state.outputs.ttf.slice(0,4));
              const woff2=String.fromCharCode(...state.outputs.woff2.slice(0,4));
              const preview=document.querySelector('#fontPreview');
              return {forms,contextual,ttf:state.outputs.ttf.length,woff2:state.outputs.woff2.length,signature,woff2Signature:woff2,featureSettings:preview.style.fontFeatureSettings,canvasCount:document.querySelectorAll('#cursiveForms canvas').length,status:status.textContent,tables:state.outputs.built.tables,engine:state.outputs.built.layout.engine,featureLookups:state.outputs.built.layout.featureLookups,vertical:rVertical,metrics:state.outputs.built.layout.metrics,controls:{baseline:!!document.querySelector('#cursiveBaseline'),descender:!!document.querySelector('#cursiveDescenderScale'),preset:!!document.querySelector('#cursiveDescenderPreset')}};
            })()''')
            if result['forms'] != ['init', 'medi', 'medi', 'medi', 'fina']:
                raise RuntimeError(f'Wrong base forms: {result}')
            if result['contextual'] != ['init.u', 'medi.l', 'medi.m', 'medi.u', 'fina']:
                raise RuntimeError(f'Wrong contextual forms: {result}')
            if result['signature'] != '\x00\x01\x00\x00' or result['woff2Signature'] != 'wOF2':
                raise RuntimeError(f'Wrong font signatures: {result}')
            if result['canvasCount'] != 10 or 'calt' not in result['featureSettings'] or 'curs' not in result['featureSettings']:
                raise RuntimeError(f'Cursive UI incomplete: {result}')
            if result['engine'] != 'russian-school-contextual-v1' or len(result['featureLookups']) != 9:
                raise RuntimeError(f'Contextual joining engine incomplete: {result}')
            if 'GSUB' not in result['tables'] or 'GPOS' not in result['tables']:
                raise RuntimeError(f'OpenType tables missing: {result}')
            if not all(result['controls'].values()) or result['vertical']['yMin'] >= -80 or result['metrics']['descent'] >= -200:
                raise RuntimeError(f'Descender UI/metrics incomplete: {result}')
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
