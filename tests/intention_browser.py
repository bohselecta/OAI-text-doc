#!/usr/bin/env python3
"""Native Chromium end-to-end acceptance. All model replies are labelled test fixtures.
No paid provider calls, HTTP interception, or altered production security policy.
"""
import json, os, socket, subprocess, tempfile, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1]
REPORT=ROOT/'test-results'/'intention'
IMAGES=ROOT/'docs'/'images'
REPORT.mkdir(parents=True,exist_ok=True)
IMAGES.mkdir(parents=True,exist_ok=True)
checks=[]; errors=[]; console_errors=[]

def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1',0)); return s.getsockname()[1]

def serve(script,directory):
    port=free_port(); origin=f'http://127.0.0.1:{port}'
    env={**os.environ,'PORT':str(port),'DOCUMENT_ORIGIN':origin,'DOCUMENT_PROVIDER':'local','INTENTION_DB':str(Path(directory)/f'{port}.sqlite'),'NODE_ENV':'test'}
    log=open(REPORT/f'server-{port}.log','w')
    process=subprocess.Popen(['node',script],cwd=ROOT,env=env,stdout=log,stderr=log)
    for _ in range(120):
        try:
            urllib.request.urlopen(origin+'/healthz',timeout=.5); return process,log,origin
        except Exception: time.sleep(.05)
    process.terminate();raise RuntimeError(f'Server failed to start: {log.name}')

def idle(page):
    expect(page.get_by_text('Working… Your accepted source is unchanged until the operation succeeds.')).to_have_count(0,timeout=15000)

def click(page,name,exact=True):
    page.get_by_role('button',name=name,exact=exact).click();idle(page)

def record_part(page,title):
    click(page,'Open the parts ↗');click(page,'+ Record a part')
    page.get_by_label('Part title',exact=True).fill(title);click(page,'Record part')

def export(page,name,destination):
    click(page,'Export capsule ↗')
    with page.expect_download() as download:
        page.get_by_role('button',name=name).click()
    download.value.save_as(destination);idle(page)
    return Path(destination)

with tempfile.TemporaryDirectory(prefix='canvas-intention-browser-') as directory:
    subprocess.run(['node','scripts/build-intention.mjs'],cwd=ROOT,check=True)
    local,local_log,local_origin=serve('scripts/dev-intention.mjs',directory)
    connected,connected_log,origin=serve('tests/intention-fixture.mjs',directory)
    try:
        with sync_playwright() as pw:
            launch={'headless':True}
            if os.environ.get('CHROMIUM_PATH'):launch['executable_path']=os.environ['CHROMIUM_PATH']
            browser=pw.chromium.launch(**launch)
            context=browser.new_context(viewport={'width':1440,'height':1040},accept_downloads=True,reduced_motion='reduce')
            page=context.new_page()
            page.on('pageerror',lambda error:errors.append(str(error)))
            page.on('console',lambda m:console_errors.append(m.text) if m.type=='error' and 'Failed to load resource' not in m.text else None)
            page.goto(local_origin,wait_until='networkidle')
            expect(page.get_by_role('heading',name='One intention. Room to unfold.')).to_be_visible()
            page.screenshot(path=str(IMAGES/'intention-start.png'),full_page=True)
            page.get_by_label('Here’s what I want to make',exact=True).fill('A quiet field guide for first-time gardeners')
            click(page,'Begin →')
            expect(page.get_by_role('heading',name='Current result')).to_be_visible()
            expect(page.get_by_text('Local workspace · no AI',exact=True)).to_be_visible()
            checks.append('One editable seed creates a durable whole with no fabricated structure or AI')
            page.get_by_label('What should happen next?',exact=False).fill('Develop this')
            click(page,'Develop intention ↗')
            expect(page.get_by_role('alert')).to_contain_text('needs a connected model')
            expect(page.get_by_label('What should happen next?',exact=False)).to_have_value('Develop this')
            checks.append('Unavailable whole development is honest; failed instructions survive')
            record_part(page,'The first growing season')
            page.get_by_label('Instruction for this part',exact=False).fill('Replace with: Begin with one container, a little light and something you enjoy eating. Keep a small record of what grows.')
            click(page,'Propose change ↗')
            expect(page.get_by_label('Development proposal')).to_contain_text('Semantic whole-intention review has not run')
            expect(page.locator('.part-content')).not_to_contain_text('Begin with one container')
            click(page,'Accept this development')
            expect(page.locator('.part-content')).to_contain_text('Begin with one container')
            click(page,'Lock part')
            page.get_by_label('Instruction for this part',exact=False).fill('Replace with: Lost source')
            click(page,'Propose change ↗');expect(page.get_by_role('alert')).to_contain_text('Unlock this part')
            click(page,'Unlock part')
            checks.append('Part-local exact instruction, proposal acceptance and lock rejection work through HTTP')
            click(page,'Back to the whole');page.reload(wait_until='networkidle')
            expect(page.get_by_label('Current result')).to_contain_text('Begin with one container')
            click(page,'Constraints & acceptance')
            page.get_by_label('Constraints · one per line').fill('No pesticides\nKeep it approachable')
            page.get_by_label('Acceptance · one per line').fill('A novice can follow every step')
            click(page,'Save boundaries');click(page,'The whole')
            page.screenshot(path=str(IMAGES/'intention-whole-local.png'),full_page=True)
            checks.append('Whole preview, explicit constraints and refresh recovery retain accepted state')
            capsule=export(page,'Interactive HTML capsule ↗',REPORT/'local.capsule.html')
            backup=export(page,'Structured JSON backup',REPORT/'local.capsule.json')
            source=json.loads(backup.read_text());assert source['parts'][0]['content'].startswith('Begin with one container')
            handoff=export(page,'BUILD handoff · Markdown',REPORT/'BUILD.md');assert source['parts'][0]['content'] in handoff.read_text()
            checks.append('Native HTML, JSON and BUILD downloads preserve complete accepted source')
            # Native file navigation of the actual generated file. It is not served by a model host.
            offline=context.new_page();offline.on('pageerror',lambda error:errors.append(str(error)))
            network=[];offline.on('request',lambda req:network.append(req.url) if req.url.startswith(('http:','https:')) else None)
            offline.goto(capsule.resolve().as_uri(),wait_until='load')
            expect(offline.get_by_role('heading',name='Current result')).to_be_visible()
            expect(offline.get_by_text('Local workspace · no AI',exact=True)).to_be_visible()
            offline.get_by_role('button',name='The first growing season',exact=False).first.click();idle(offline)
            offline.get_by_label('Instruction for this part',exact=False).fill('Append: Notice one small change each day.')
            click(offline,'Propose change ↗');click(offline,'Accept this development')
            expect(offline.locator('.part-content')).to_contain_text('Notice one small change each day.')
            offline.reload(wait_until='load');expect(offline.locator('.part-content')).to_contain_text('Notice one small change each day.')
            reexport=export(offline,'Interactive HTML capsule ↗',REPORT/'edited.capsule.html')
            second=context.new_page();second.goto(reexport.resolve().as_uri(),wait_until='load')
            expect(second.get_by_label('Current result')).to_contain_text('Notice one small change each day.')
            assert not network,network
            offline.screenshot(path=str(IMAGES/'intention-offline.png'),full_page=True)
            checks.append('Downloaded single HTML runs offline, edits, recovers, reexports and makes zero network requests')
            # Import parsing must never run imported script tags, or replace work on invalid data.
            second.locator('#import-file').set_input_files({'name':'bad.json','mimeType':'application/json','buffer':b'{broken'})
            idle(second);expect(second.get_by_role('alert')).to_contain_text('valid capsule JSON')
            expect(second.get_by_label('Current result')).to_contain_text('Notice one small change')
            malicious=reexport.read_text().replace('<body>','<body><script>window.IMPORTED_ATTACK=true</script><img src="https://invalid.example/spy">')
            second.locator('#import-file').set_input_files({'name':'import.html','mimeType':'text/html','buffer':malicious.encode()})
            idle(second);assert second.evaluate('() => window.IMPORTED_ATTACK') is None
            checks.append('Malformed import preserves current work; importing HTML never executes its scripts')
            # Connected boundary uses an explicit deterministic fixture, never a live provider.
            page.goto(origin,wait_until='networkidle')
            page.get_by_label('Here’s what I want to make',exact=True).fill('A quiet field guide for first-time gardeners')
            click(page,'Begin →')
            page.get_by_label('What should happen next?',exact=False).fill('Develop guide')
            click(page,'Develop intention ↗');click(page,'Accept this development')
            expect(page.get_by_label('Current result')).to_contain_text('Grow something good')
            expect(page.get_by_role('heading',name='Will this garden be indoors or outside?')).to_be_visible()
            page.screenshot(path=str(IMAGES/'intention-whole-fixture.png'),full_page=True)
            page.get_by_label('Answer: Will this garden be indoors or outside?').fill('Outside on a balcony')
            click(page,'Record answer')
            click(page,'Open the parts ↗')
            page.get_by_role('button',name='The small garden',exact=False).last.click();idle(page)
            page.get_by_label('Instruction for this part',exact=False).fill('Focus on balcony herbs')
            click(page,'Propose change ↗')
            expect(page.get_by_role('button',name='Approve related changes')).to_be_disabled()
            page.screenshot(path=str(IMAGES/'intention-scoped-proposal.png'),full_page=True)
            click(page,'Accept this development')
            expect(page.locator('.part-content')).to_contain_text('balcony herb garden')
            expect(page.get_by_role('button',name='Approve related changes')).to_be_enabled()
            click(page,'Keep only my first edit')
            click(page,'Back to the whole')
            page.get_by_role('button',name='From seed to first harvest',exact=False).first.click();idle(page)
            expect(page.locator('.part-content')).to_contain_text('Choose a container with drainage')
            checks.append('Connected whole creation produces nested structure and a material decision; local edit cannot propagate without separate approval')
            click(page,'Back to the whole')
            page.get_by_role('button',name='The small garden',exact=False).first.click();idle(page)
            page.get_by_label('Instruction for this part',exact=False).fill('Focus on balcony herbs again')
            click(page,'Propose change ↗');click(page,'Accept this development');click(page,'Approve related changes')
            click(page,'Back to the whole')
            page.get_by_role('button',name='From seed to first harvest',exact=False).first.click();idle(page)
            expect(page.locator('.part-content')).to_contain_text('balcony-safe containers')
            page.get_by_role('button',name='The first week',exact=False).last.click();idle(page)
            expect(page.get_by_role('heading',name='The first week')).to_be_visible()
            click(page,'← From seed to first harvest')
            page.go_back();expect(page.get_by_role('heading',name='The first week')).to_be_visible()
            click(page,'The whole')
            checks.append('Explicit related approval, nested unfolding, parent navigation and browser Back preserve whole context')
            page.get_by_label('What should happen next?',exact=False).fill('What is missing?')
            click(page,'Discuss')
            expect(page.locator('.messages')).to_contain_text('Fixture discussion at whole scope')
            page.get_by_label('What should happen next?',exact=False).fill('provider failure')
            click(page,'Develop intention ↗');expect(page.get_by_role('alert')).to_contain_text('test provider failed')
            expect(page.get_by_label('Current result')).to_contain_text('balcony herb garden')
            checks.append('Whole discussion changes only conversation; provider failure preserves accepted source and editable instruction')
            click(page,'Revision history')
            expect(page.locator('.history')).to_contain_text('Separately approved related changes')
            page.get_by_role('button',name='Restore before this',exact=True).first.click()
            click(page,'Cancel');expect(page.get_by_role('dialog')).to_have_count(0)
            page.get_by_role('button',name='Restore before this',exact=True).first.click();click(page,'Restore source')
            expect(page.get_by_role('heading',name='Current result')).to_be_visible()
            checks.append('History restore confirmation/cancellation and restoration create a safe new revision')
            # Dialog keyboard trap and Escape, responsive tree and no horizontal overflow.
            click(page,'Export capsule ↗');expect(page.get_by_role('dialog')).to_be_visible()
            page.keyboard.press('Escape');expect(page.get_by_role('dialog')).to_have_count(0)
            page.keyboard.press('Tab');assert page.evaluate('() => document.activeElement.tagName')=='BUTTON'
            page.set_viewport_size({'width':390,'height':844})
            page.screenshot(path=str(IMAGES/'intention-mobile.png'),full_page=True)
            assert page.evaluate('() => document.documentElement.scrollWidth <= innerWidth'), 'mobile horizontal overflow'
            expect(page.get_by_role('button',name='Open the parts ↗')).to_be_visible()
            click(page,'Open the parts ↗');page.get_by_role('button',name='The small garden',exact=False).last.click();idle(page)
            expect(page.get_by_role('heading',name='The small garden')).to_be_visible()
            checks.append('390px responsive layout, keyboard dialog dismissal and reduced-motion flow work without overflow')
            assert not errors,errors
            assert not console_errors,console_errors
            browser.close()
    finally:
        local.terminate();connected.terminate();local.wait(timeout=10);connected.wait(timeout=10);local_log.close();connected_log.close()
        (REPORT/'browser.json').write_text(json.dumps({'mode':'native navigation and native downloaded file; explicit provider fixture','checks':checks,'pageErrors':errors,'consoleErrors':console_errors,'liveProviderCalls':0},indent=2))
print(json.dumps({'passed':len(checks),'checks':checks,'pageErrors':errors},indent=2))
