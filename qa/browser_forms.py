from browser_check import mount, request, ROOT, CHROMIUM
from playwright.sync_api import sync_playwright
import json
request('/api/demo/reset','POST','{}')
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=CHROMIUM,headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1365,'height':980})
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    mount(page)
    page.locator('.heading-actions [data-action="register"]').click()
    page.locator('#provider-form input[name="name"]').fill('FORM-TEST')
    page.locator('#provider-form button[type="submit"]').click()
    page.wait_for_function("document.querySelectorAll('.map-node').length===7")
    page.locator('.heading-actions [data-action="deploy"]').click()
    page.locator('#deploy-form input[name="name"]').fill('manual-compute')
    page.locator('#deploy-form input[name="maxLatency"]').fill('110')
    page.locator('#deploy-form button[type="submit"]').click()
    page.wait_for_function("document.querySelector('#route-status').textContent.includes('READY')",timeout=11000)
    page.locator('#compute-command').fill('python task.py');page.locator('#run-compute').click()
    s=json.loads(request('/api/state')['body']);assert s['job']['spec']['name']=='manual-compute'
    page.locator(f'.map-node[data-id="{s["job"]["providerId"]}"]').click()
    page.wait_for_selector('button[data-action="kill"]')
    page.locator('button[data-action="kill"]').click()
    page.wait_for_function("document.querySelector('.failover-notice.recovered')!==null",timeout=13000)
    s=json.loads(request('/api/state')['body']);assert s['job']['failures']==1
    page.locator('.rail-button[data-action="workload"]').click()
    page.locator('button[data-action="stop"]').click()
    page.wait_for_function("document.querySelector('.big-status')?.textContent.includes('Stopped')")
    page.locator('#drawer button[data-action="close"]').click()
    page.keyboard.press('d')
    page.wait_for_selector('#deploy-form')
    page.locator('#deploy-form input[name="minVram"]').fill('192')
    page.locator('#deploy-form button[type="submit"]').click()
    page.wait_for_function("document.querySelector('.agent-assignment')?.textContent.includes('No compatible capacity')",timeout=7000)
    result={'manualProviderForm':True,'manualDeploymentForm':True,'computeButton':True,'manualKillAndRecovery':True,'stopButton':True,'keyboardShortcut':True,'impossibleWorkloadBlocked':True,'browserErrors':errors}
    assert not errors
    print(json.dumps(result,indent=2))
    browser.close()
