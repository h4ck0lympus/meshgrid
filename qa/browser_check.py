"""UI harness: Chromium navigation is blocked in this environment.
Render local source in about:blank; bridge fetch/EventSource to the real local HTTP server.
No browser policies or security configuration are changed.
"""
from playwright.sync_api import sync_playwright
from pathlib import Path
import json, re, base64, urllib.request, urllib.error, os, shutil
ROOT=Path(__file__).resolve().parents[1]
BASE=os.environ.get('ASTRAGRID_URL','http://127.0.0.1:3000')
CHROMIUM=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('google-chrome')
def request(path, method='GET', body=None):
    req=urllib.request.Request(BASE+path,data=body.encode() if body else None,method=method,headers={'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(req,timeout=10) as r: return {'status':r.status,'body':r.read().decode()}
    except urllib.error.HTTPError as e: return {'status':e.code,'body':e.read().decode()}

def mount(page):
    page.expose_function('__localHTTP',request)
    html=(ROOT/'public/index.html').read_text()
    html=re.sub(r'<link[^>]*>', '', html)
    html=re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.S)
    mark='data:image/svg+xml;base64,'+base64.b64encode((ROOT/'public/mark.svg').read_bytes()).decode()
    html=html.replace('/mark.svg',mark)
    page.set_content(html.replace('</head>','<style>'+(ROOT/'public/styles.css').read_text()+'</style></head>'))
    page.evaluate('''() => {
      window.fetch = async (path, options={}) => {
        const r = await window.__localHTTP(path, options.method || 'GET', options.body || null);
        return { ok:r.status>=200&&r.status<300, status:r.status, json:async()=>JSON.parse(r.body) };
      };
      window.EventSource = class {
        constructor(){setTimeout(()=>this.onopen?.(),10); this.timer=setInterval(async()=>{try {const s=await window.__localHTTP('/api/state');this.onmessage?.({data:s.body});} catch(e){this.onerror?.(e)}},250)}
        close(){clearInterval(this.timer)}
      };
    }''')
    ui=(ROOT/'public/ui.js').read_text().replace('export ','')
    modules=[]
    for name in ['components/topology.js','components/providers.js','components/astra.js','app.js']:
        code=(ROOT/'public'/name).read_text()
        code=re.sub(r'^import .*?;\s*','',code,flags=re.M)
        modules.append('(function(){'+code+'})();')
    script=(ui+'\n'+'\n'.join(modules)).replace('/mark.svg',mark)
    page.add_script_tag(content=script)
    page.wait_for_selector('.map-node')
    page.wait_for_timeout(500)

if __name__=='__main__':
    request('/api/demo/reset','POST','{}')
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=CHROMIUM,headless=True,args=['--no-sandbox'])
        page=browser.new_page(viewport={'width':1512,'height':1100},device_scale_factor=1)
        errors=[]
        page.on('pageerror',lambda error: errors.append(str(error)))
        mount(page)
        page.screenshot(path=str(ROOT/'qa/initial-desktop.png'),full_page=True)
        print(json.dumps({'title':page.title(),'nodes':page.locator('.map-node').count(),'errors':errors,'scrollWidth':page.evaluate('document.documentElement.scrollWidth'),'viewport':1512}))
        browser.close()
