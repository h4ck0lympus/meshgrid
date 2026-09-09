from browser_check import mount, request, ROOT, CHROMIUM
from playwright.sync_api import sync_playwright
import subprocess,json
request('/api/demo/reset','POST','{}')
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=CHROMIUM,headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1512,'height':1100},device_scale_factor=1)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    mount(page)
    with open(ROOT/'qa/http-smoke.txt','w') as log:
        proc=subprocess.Popen(['node','scripts/smoke.mjs'],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT)
        page.wait_for_function("document.querySelector('#route-status').textContent.includes('READY')",timeout=15000)
        page.wait_for_timeout(800)
        page.evaluate('window.scrollTo(0,0)')
        page.screenshot(path=str(ROOT/'qa/healthy-desktop.png'),full_page=True)
        page.wait_for_function("document.querySelector('.is-failing')!==null",timeout=16000)
        page.wait_for_timeout(600)
        page.screenshot(path=str(ROOT/'qa/failover-desktop.png'),full_page=True)
        page.wait_for_function("document.querySelector('.failover-notice.recovered')!==null",timeout=12000)
        page.wait_for_timeout(800)
        page.screenshot(path=str(ROOT/'qa/recovered-desktop.png'),full_page=True)
        code=proc.wait(timeout=5)
    print((ROOT/'qa/http-smoke.txt').read_text())
    print(json.dumps({'httpSmokeExitCode':code,'browserErrors':errors,'screenshots':'healthy, failover, recovered'}))
    assert code==0 and not errors
    browser.close()
