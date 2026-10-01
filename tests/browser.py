#!/usr/bin/env python3
"""Real Chromium acceptance checks; no provider calls.

Default: navigate the actual service and test browser HTTP/CSP/downloads.
--memory: for a managed browser that prohibits ALL URL navigation, load the
unchanged component logic and real CSS into an in-memory page and bridge API
requests to the actual HTTP service. This mode does NOT certify browser network,
CSP loading, or native downloads, and is recorded as such in the report.
"""
from __future__ import annotations
import argparse
import base64
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / "test-results"
IMAGES = ROOT / "docs/images"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--memory", action="store_true")
    args = parser.parse_args()
    REPORT.mkdir(exist_ok=True)
    IMAGES.mkdir(parents=True, exist_ok=True)
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    origin = f"http://127.0.0.1:{port}"
    checks: list[str] = []
    exports: list[dict] = []
    errors: list[str] = []

    def http(path: str, body=None, method=None):
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(origin + path, data=data, method=method or ("GET" if body is None else "POST"), headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.loads(response.read())

    with tempfile.TemporaryDirectory(prefix="document-browser-") as directory:
        env = {**os.environ, "HOST": "127.0.0.1", "PORT": str(port), "DOCUMENT_ORIGIN": origin, "DOCUMENT_AUTH": "local", "DOCUMENT_PROVIDER": "rehearsal", "DOCUMENT_DB": directory + "/browser.sqlite", "NODE_ENV": "test"}
        log = open(REPORT / "browser-server.log", "w")
        server = subprocess.Popen(["node", "src/server/index.mjs"], cwd=ROOT, env=env, stdout=log, stderr=log)
        try:
            for _ in range(100):
                try:
                    http("/healthz")
                    break
                except (urllib.error.URLError, ConnectionError):
                    time.sleep(0.05)
            else:
                raise RuntimeError("Document service did not start")

            with sync_playwright() as playwright:
                launch = {"headless": True}
                if os.environ.get("CHROMIUM_PATH"):
                    launch["executable_path"] = os.environ["CHROMIUM_PATH"]
                browser = playwright.chromium.launch(**launch)
                context = browser.new_context(viewport={"width": 1536, "height": 1024}, device_scale_factor=1, reduced_motion="reduce", accept_downloads=True)
                page = context.new_page()
                page.on("pageerror", lambda error: errors.append(str(error)))

                def transport(request):
                    # Explicit, test-only server bridge. No production code uses this.
                    path = request["url"]
                    if not path.startswith("/api/"):
                        raise ValueError("Test bridge permits only the local Document API")
                    data = request.get("body")
                    req = urllib.request.Request(origin + path, method=request["method"], headers=request["headers"], data=data.encode() if data is not None else None)
                    try:
                        response = urllib.request.urlopen(req, timeout=10)
                    except urllib.error.HTTPError as error:
                        response = error
                    with response:
                        return {"status": response.status, "body": response.read().decode(), "headers": dict(response.headers)}

                def wait_component_idle():
                    # Poll via CDP evaluation instead of wait_for_function's string
                    # evaluator: the shipped CSP intentionally disallows unsafe-eval.
                    deadline = time.monotonic() + 15
                    while time.monotonic() < deadline:
                        if page.evaluate("() => !document.querySelector('language-document')?.s.busy"):
                            return
                        page.wait_for_timeout(25)
                    raise AssertionError("Document did not finish its operation within 15 seconds")

                def mount():
                    if not args.memory:
                        page.goto(origin, wait_until="networkidle")
                    else:
                        page.set_content("<!doctype html><html lang='en'><head><meta charset='utf-8'><title>Document · component acceptance</title></head><body><language-document></language-document></body></html>")
                        page.add_style_tag(content=(ROOT / "src/ui/shell.css").read_text())
                        presentation = (ROOT / "src/ui/presentation.mjs").read_text().replace("export ", "")
                        component = (ROOT / "src/ui/document.mjs").read_text()
                        component = component.replace("import { esc, icon, markdown, shortHash, number, date } from './presentation.mjs';", "")
                        component = component.replace("const STYLE=new URL('./document.css',import.meta.url).href;", "")
                        image = "data:image/svg+xml;base64," + base64.b64encode((ROOT / "src/ui/document.svg").read_bytes()).decode()
                        component = component.replace("const LOGO=new URL('./document.svg',import.meta.url).href;", "const LOGO=" + json.dumps(image) + ";")
                        component = component.replace('<link rel="stylesheet" href="${STYLE}">', '<style>${DOCUMENT_TEST_CSS}</style>').replace("export ", "")
                        page.add_script_tag(content="const DOCUMENT_TEST_CSS=" + json.dumps((ROOT / "src/ui/document.css").read_text()) + ";\n" + "window.fetch=async(url,options={})=>{const r=await window.documentTestTransport({url,method:options.method||'GET',headers:options.headers||{},body:options.body??null});return new Response(r.body,{status:r.status,headers:r.headers});};\n" + presentation + "\n" + component + "\nDocumentModule.prototype.download=function(content,name,type){window.documentTestExport({content,name,type});};")
                    expect(page.locator('[data-section="intent"]')).to_be_visible()
                    wait_component_idle()

                if args.memory:
                    page.expose_function("documentTestTransport", transport)
                    page.expose_function("documentTestExport", lambda value: exports.append(value))
                mount()
                shadow = "document.querySelector('language-document')"

                def state():
                    return page.evaluate(shadow + ".s")

                def wait_idle():
                    wait_component_idle()
                    page.wait_for_timeout(40)

                def action(name: str):
                    page.locator(f'[data-action="{name}"]:visible').first.click()
                    wait_idle()

                def snap(name: str):
                    wait_idle()
                    page.screenshot(path=str(IMAGES / (name + ".png")))

                def export_now():
                    if args.memory:
                        count = len(exports)
                        action("export")
                        assert len(exports) == count + 1
                        return exports[-1]
                    with page.expect_download() as download:
                        action("export")
                    downloaded = download.value
                    dest = REPORT / downloaded.suggested_filename
                    downloaded.save_as(dest)
                    return {"name": downloaded.suggested_filename, "content": dest.read_text()}

                original = state()["doc"]
                assert len(original["sections"]) == 17
                assert page.locator('[contenteditable]').count() == 0
                assert page.locator('.canvas-section textarea,.canvas-section input').count() == 0
                checks.append("17-section source loads; no manual content-editing surface")
                snap("document-draft")

                # Section keyboard interaction and focus are exercised in the browser.
                page.locator('[data-section="intent"]').focus()
                page.keyboard.press("ArrowDown")
                assert page.evaluate(shadow + ".root.activeElement.dataset.section") == "outcome"
                page.keyboard.press("Enter")
                expect(page.locator("#instruction")).to_be_focused()
                assert state()["selected"] == "outcome"
                page.locator('[data-action="select"][data-id="intent"]').first.click()
                page.locator("#instruction").fill("Make this more concise")
                page.locator("#instruction").press("Enter")
                expect(page.locator('[data-action="accept"]')).to_be_visible()
                wait_idle()
                assert http("/api/documents/" + original["id"]) == original
                checks.append("Keyboard scope selection; proposed edit leaves accepted source unchanged")
                snap("document-proposal")
                action("accept")
                changed = http("/api/documents/" + original["id"])
                assert changed["revision"] == 2
                assert changed["sections"][0]["content"] != original["sections"][0]["content"]
                assert changed["sections"][1:] == original["sections"][1:]
                checks.append("Accept mutates selected section only; every other section is byte-identical")
                # Reload uses the real persistence layer; no localStorage fiction.
                if args.memory:
                    page.evaluate(shadow + ".load()")
                else:
                    page.reload(wait_until="networkidle")
                wait_idle()
                assert state()["doc"]["revision"] == 2
                action("undo")
                assert state()["doc"]["sections"] == original["sections"]
                assert state()["doc"]["revision"] == 3
                checks.append("Reload persistence and section-only undo retain history")
                page.locator('[data-action="history"][aria-label="View history"]').click()
                expect(page.get_by_role("dialog")).to_be_visible()
                expect(page.get_by_text("Hash chain verified for the stored events.", exact=False)).to_be_visible()
                page.keyboard.press("Escape")
                assert page.evaluate(shadow + ".root.activeElement.dataset.action") == "history"
                checks.append("History integrity display; Escape closes dialog and returns focus")

                page.locator('[data-action="select"][data-id="constraints"]').first.click()
                expect(page.locator("#instruction")).to_be_disabled()
                action("lock")
                expect(page.locator("#instruction")).to_be_enabled()
                action("lock")
                expect(page.locator("#instruction")).to_be_disabled()
                checks.append("Locked sections cannot generate; explicit unlock/relock works")

                action("publish-view")
                expect(page.locator(".finding")).to_have_count(1)
                expect(page.locator('[data-action="publish"]')).to_be_disabled()
                snap("document-publish-blocked")
                page.locator('.finding[data-id="recovery"]').click()
                page.locator("#instruction").fill("Define recovery behavior")
                page.locator("#instruction").press("Enter")
                expect(page.locator('[data-action="accept"]')).to_be_visible()
                action("accept")
                action("publish-view")
                assert not state()["audit"]["findings"]
                assert state()["audit"]["semantic"]["status"] == "not_run"
                expect(page.locator('[data-action="publish"]')).to_be_disabled()
                expect(page.locator("#semantic")).to_be_disabled()
                checks.append("Resolve real audit finding in Draft; structural pass never becomes fake semantic pass")
                snap("document-publish")
                exported = export_now()
                assert exported["name"] == "BUILD-DRAFT.md"
                assert "DRAFT EXPORT — NOT AN AUDITED RELEASE" in exported["content"]
                for section in state()["doc"]["sections"]:
                    assert section["content"] in exported["content"]
                page.locator("#format").select_option("txt")
                exported_txt = export_now()
                assert exported_txt["name"] == "BUILD-DRAFT.txt"
                assert exported_txt["content"] == exported["content"]
                checks.append("Actual server exports Markdown and plain text with every source section intact")

                page.locator("#context").fill("2048")
                page.locator("#context").press("Tab")
                page.locator("#reserve").fill("1024")
                page.locator("#reserve").press("Tab")
                action("audit")
                assert any(x["code"] == "CONTEXT_OVERFLOW" for x in state()["audit"]["findings"])
                assert state()["audit"]["compiled"]["budget"]["fits"] is False
                checks.append("Budget overflow is explicit and non-truncating")
                page.locator("#context").fill("128000")
                page.locator("#context").press("Tab")
                page.locator("#reserve").fill("32000")
                page.locator("#reserve").press("Tab")
                action("audit")
                action("draft")
                page.locator('[data-action="select"][data-id="intent"]').first.click()
                action("new-menu")
                expect(page.get_by_role("menuitem", name="Document New")).to_be_visible()
                snap("document-spaces")
                page.keyboard.press("Escape")
                checks.append("Document appears in Spaces reference create menu; host-only controls are honest")

                # An actual unsupported instruction is not treated as LLM success.
                page.locator("#instruction").fill("Compose an orbital ballet")
                page.locator("#instruction").press("Enter")
                expect(page.locator(".error-banner")).to_be_visible()
                assert not state()["proposal"]
                assert state()["instructions"]["intent"] == "Compose an orbital ballet"
                action("close-notice")
                checks.append("Unsupported rehearsal instruction fails visibly and preserves the instruction")

                # Mobile size and accessibility states, not just a desktop screenshot.
                page.set_viewport_size({"width": 390, "height": 844})
                action("toggle-sidebar")
                wait_idle()
                assert page.evaluate(shadow + ".root.querySelector('.app').scrollWidth") <= 390
                expect(page.locator("#instruction")).to_be_visible()
                assert page.locator("#instruction").bounding_box()["width"] > 200
                page.locator("#instruction").fill("Make this more concise")
                snap("document-mobile")
                # Re-enable panel to use create action on a phone.
                action("toggle-sidebar")
                action("new-menu")
                page.get_by_role("menuitem", name="Document New").click()
                expect(page.get_by_role("dialog")).to_be_visible()
                page.locator("#new-title").fill("Research notebook")
                page.locator("#new-profile").select_option("research")
                page.locator("#new-goal").fill("Compare different ways to measure project clarity without claiming that model review is scientific validation.")
                action("create-submit")
                assert state()["doc"]["title"] == "Research notebook"
                assert state()["doc"]["profiles"] == ["research"]
                checks.append("390-pixel layout, reduced motion, creation dialog and Research spine")
                # Close mobile navigation after creating the document.
                if state()["sidebar"]:
                    action("toggle-sidebar")
                action("profile-dialog")
                page.locator('input[name="profile"][value="software"]').check()
                before = state()["doc"]["sections"]
                action("profiles-save")
                current = state()["doc"]["sections"]
                assert current[:len(before)] == before
                assert any(x["kind"] == "security" for x in current)
                checks.append("Hybrid spine adds missing kinds without rewriting existing source")

                # Imported document markup remains inert text, even with raw HTML.
                malicious = b'# Imported source\n<script>window.DOCUMENT_XSS=1</script>\n<img src=x onerror="window.DOCUMENT_XSS=2">\n'
                page.locator("#import-file").set_input_files({"name": "untrusted.md", "mimeType": "text/markdown", "buffer": malicious})
                wait_idle()
                assert state()["doc"]["title"] == "untrusted"
                assert page.evaluate("window.DOCUMENT_XSS ?? null") is None
                assert page.locator(".canvas-section script,.canvas-section img").count() == 0
                checks.append("Imported HTML is escaped; no script/image execution")

                page.set_viewport_size({"width": 1536, "height": 1024})
                # Restore the repaired blueprint for a light-theme reference.
                if not state()["sidebar"]:
                    action("toggle-sidebar")
                page.locator(f'[data-action="load-doc"][data-id="{original["id"]}"]').click()
                wait_idle()
                action("theme")
                snap("document-light")
                checks.append("Light theme renders the same persisted document")
                assert not errors, "Browser runtime errors: " + repr(errors)
                browser.close()
        finally:
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()
            log.close()
            result = {"mode": "in-memory Chromium component + real HTTP bridge" if args.memory else "native Chromium navigation, HTTP, CSP and downloads", "passed": len(checks), "checks": checks, "pageErrors": errors, "providerCalls": 0}
            (REPORT / "browser.json").write_text(json.dumps(result, indent=2) + "\n")
            print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
