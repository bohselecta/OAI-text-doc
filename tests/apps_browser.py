#!/usr/bin/env python3
"""Native Chromium -> sandboxed MCP Apps iframe -> real MCP HTTP -> embedded PostgreSQL.
Local host is a labeled rehearsal fixture, not live ChatGPT, OAuth, Neon, or model inference.
"""
import json, os, socket, subprocess, tempfile, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1]
REPORT=ROOT/'test-results'

def main():
    REPORT.mkdir(exist_ok=True)
    with socket.socket() as s:
        s.bind(('127.0.0.1',0));port=s.getsockname()[1]
    origin=f'http://127.0.0.1:{port}'
    checks=[];errors=[]
    with tempfile.TemporaryDirectory(prefix='document-apps-browser-') as tmp:
        env={**os.environ,'PORT':str(port),'DOCUMENT_DEV_DATA':tmp+'/pg','NODE_ENV':'test'}
        log=open(REPORT/'apps-browser-server.log','w')
        server=subprocess.Popen(['node','scripts/dev-apps.mjs'],cwd=ROOT,env=env,stdout=log,stderr=log)
        try:
            for _ in range(300):
                try:
                    with urllib.request.urlopen(origin+'/healthz',timeout=1) as response: response.read()
                    break
                except Exception: time.sleep(.1)
            else: raise RuntimeError('MCP Apps rehearsal did not start')
            with sync_playwright() as p:
                launch={'headless':True}
                if os.environ.get('CHROMIUM_PATH'):launch['executable_path']=os.environ['CHROMIUM_PATH']
                browser=p.chromium.launch(**launch)
                context=browser.new_context(viewport={'width':1536,'height':1024},reduced_motion='reduce',accept_downloads=True)
                page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
                page.on('console',lambda message: print('BROWSER '+message.type+': '+message.text) if message.type=='error' else None)
                page.goto(origin,wait_until='domcontentloaded')
                frame=page.frame_locator('#document')
                expect(frame.get_by_role('button',name='Create a Document',exact=True)).to_be_visible(timeout=20000)
                expect(page.locator('#error')).to_have_text('')
                assert page.locator('iframe').get_attribute('sandbox')=='allow-scripts'
                checks.append('Read-only open initializes an empty opaque-sandbox app without seeding source')
                frame.get_by_role('button',name='Create a Document',exact=True).click()
                frame.get_by_role('button',name='Explore an example',exact=True).click()
                expect(frame.get_by_label('Propose section change',exact=True)).to_be_visible()
                component=frame.locator('language-document')
                def state():return component.evaluate('(el)=>structuredClone(el.s.doc)')
                def idle():
                    deadline=time.monotonic()+20
                    while time.monotonic()<deadline:
                        if component.evaluate('(el)=>!el.s.busy'):return
                        time.sleep(.05)
                    raise AssertionError('Canvas operation did not settle')
                idle();before=state();assert before['revision']==1
                assert component.locator('[contenteditable]').count()==0
                checks.append('Exact native component creates and renders a document through MCP tools and PostgreSQL')
                frame.locator('[data-section="recovery"]').click()
                frame.locator('#instruction').fill('Define recovery behavior')
                frame.get_by_label('Propose section change',exact=True).click()
                expect(frame.get_by_role('region',name='Proposed section change')).to_be_visible();idle()
                assert state()==before
                checks.append('Scoped proposal leaves canonical source unchanged until explicit acceptance')
                frame.get_by_role('button',name='Accept change',exact=True).click();idle()
                after=state();assert after['revision']==2
                for section in before['sections']:
                    current=next(s for s in after['sections'] if s['id']==section['id'])
                    if section['id']!='recovery':assert current==section
                checks.append('Accepted revision changes exactly one section; stale-safe durable path exercised')
                frame.get_by_role('button',name='Publish',exact=True).click()
                frame.get_by_role('button',name='Run audit',exact=True).click();idle()
                expect(frame.get_by_role('button',name='Publish BUILD',exact=True)).to_be_disabled()
                expect(frame.get_by_label('Include model + fresh-reader review')).to_be_disabled()
                assert state()==after
                checks.append('Publish derives a structural audit without mutating Draft; rehearsal release remains blocked')
                with page.expect_download() as download_info:
                    frame.get_by_role('button',name='Export draft',exact=True).click()
                downloaded=download_info.value
                text=Path(downloaded.path()).read_text()
                assert 'DRAFT EXPORT' in text and 'Semantic review: not_run' in text
                for section in after['sections']:assert section['content'] in text
                checks.append('MCP Apps host download exports complete BUILD draft with honest audit receipt')
                page.screenshot(path=str(REPORT/'apps-publish-desktop.png'),full_page=True)
                frame.get_by_role('button',name='Draft',exact=True).click()
                frame.get_by_label('View history',exact=True).click()
                expect(frame.get_by_role('dialog')).to_contain_text('Hash chain verified')
                frame.get_by_label('Close dialog',exact=True).click()
                frame.locator('#instruction').fill('Unsupported request for rehearsal')
                frame.get_by_label('Propose section change',exact=True).click();idle()
                expect(frame.get_by_role('alert')).to_contain_text('Rehearsal is deterministic')
                assert state()==after
                frame.get_by_label('Dismiss error',exact=True).click()
                checks.append('History, rejected instruction recovery and saved-source integrity survive the bridge')
                page.reload(wait_until='domcontentloaded')
                expect(frame.get_by_label('Propose section change',exact=True)).to_be_visible(timeout=20000);idle()
                assert state()==after
                checks.append('Reload rehydrates persisted PostgreSQL source over MCP')
                page.set_viewport_size({'width':390,'height':844})
                frame.locator('#instruction').focus()
                assert frame.locator('#instruction').evaluate('(el)=>el.getRootNode().activeElement===el')
                assert component.evaluate('(el)=>getComputedStyle(el.root.querySelector(".app")).height')
                page.screenshot(path=str(REPORT/'apps-draft-mobile.png'),full_page=True)
                checks.append('Mobile 390px and keyboard-focus/reduced-motion canvas inspected')
                assert not errors,errors
                context.close();browser.close()
        finally:
            server.terminate()
            try:server.wait(timeout=10)
            except subprocess.TimeoutExpired:server.kill();server.wait()
            log.close()
            report={'mode':'native Chromium sandboxed MCP Apps + HTTP + embedded PostgreSQL rehearsal','checks':checks,'passed':len(checks),'pageErrors':errors,'liveChatGPT':False,'liveNeon':False,'liveOAuth':False,'providerCalls':0}
            (REPORT/'apps-browser.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
if __name__=='__main__':main()
