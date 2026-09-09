from browser_check import mount, request, ROOT, CHROMIUM
from playwright.sync_api import sync_playwright
import json, time
request('/api/demo/reset','POST','{}')
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=CHROMIUM,headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1512,'height':1100},device_scale_factor=1)
    errors=[]
    page.on('pageerror',lambda error: errors.append(str(error)))
    page.on('dialog',lambda d: d.accept())
    mount(page)
    page.locator('button[data-action="demo"]').click()
    page.wait_for_function("document.querySelectorAll('.map-node').length===7")
    page.wait_for_function("document.querySelector('#route-status').textContent.includes('READY')",timeout=16000)
    first=json.loads(request('/api/state')['body'])
    old=first['job']['providerId']
    page.evaluate('window.scrollTo(0,0)');page.wait_for_timeout(500)
    page.screenshot(path=str(ROOT/'qa/healthy-desktop.png'),full_page=True)
    page.locator('#compute-command').fill('python /workspace/task.py --input live')
    page.locator('#run-compute').click()
    page.wait_for_function("document.querySelector('.failover-notice.warning')!==null",timeout=10000)
    loss=json.loads(request('/api/state')['body'])
    billed=loss['job']['ledger']['settledNanos']
    page.wait_for_function("document.querySelector('.is-failing')!==null",timeout=6000)
    page.evaluate('window.scrollTo(0,0)');page.wait_for_timeout(500)
    page.screenshot(path=str(ROOT/'qa/failover-desktop.png'),full_page=True)
    paused=json.loads(request('/api/state')['body'])
    assert paused['job']['ledger']['settledNanos']==billed
    assert paused['job']['ledger']['refundedNanos']>0
    response=request('/api/compute','POST','{"command":"python task.py"}')
    assert response['status']==503
    page.wait_for_function("document.querySelector('.failover-notice.recovered')!==null",timeout=12000)
    recovered=json.loads(request('/api/state')['body'])
    assert recovered['job']['providerId']!=old
    assert recovered['demo']['completed']
    l=recovered['job']['ledger']
    assert l['depositNanos']==l['availableNanos']+l['heldNanos']+l['settledNanos']
    page.evaluate('window.scrollTo(0,0)');page.wait_for_timeout(500)
    page.screenshot(path=str(ROOT/'qa/recovered-desktop.png'),full_page=True)
    page.locator('button[data-action="ledger"]').first.click()
    page.wait_for_selector('.ledger-equation')
    assert 'Ledger balances exactly' in page.locator('.ledger-equation').inner_text()
    page.screenshot(path=str(ROOT/'qa/ledger-desktop.png'))
    page.locator('#drawer button[data-action="close"]').click()
    page.set_viewport_size({'width':390,'height':844})
    page.evaluate('window.scrollTo(0,0)')
    page.wait_for_timeout(400)
    page.screenshot(path=str(ROOT/'qa/recovered-mobile.png'),full_page=True)
    assert page.evaluate('document.documentElement.scrollWidth')==390
    print(json.dumps({'browser':'Chromium (local source harness with real HTTP bridge)','passed':True,'browserErrors':errors,
        'oldProvider':old,'backupProvider':recovered['job']['providerId'],'recoveryMs':recovered['job']['lastRecoveryMs'],
        'billingFrozen':True,'returnedReserve':l['refundedNanos']/1e9,'nativeServerUnavailableResponse':response['status'],
        'ledgerConservation':True,'mobileWidth':390,'noHorizontalOverflow':True},indent=2))
    assert not errors
    browser.close()
