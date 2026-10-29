"""One Chromium, loopback fixture servers, immutable app inputs; no production writes or model calls."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import selectors
import subprocess
import time
from urllib.parse import urlparse


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--node', default='node')
    parser.add_argument('--mm-reference', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--browser-executable')
    args = parser.parse_args()
    from playwright.sync_api import sync_playwright, expect

    root = Path(__file__).resolve().parents[1]
    args.output.mkdir(parents=True, exist_ok=True)
    report = {'scope': 'HOH renderer and pinned MM reference runtime; local fixture hosts, no live model, accounts or business writes', 'checks': [], 'errors': [], 'packages': []}
    server = subprocess.Popen([args.node, 'scripts/serve-packaged-content.mjs', '--mm-reference', str(args.mm_reference)], cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    def check(value, name):
        if not value:
            raise AssertionError(name)
        report['checks'].append(name)

    try:
        selector = selectors.DefaultSelector()
        selector.register(server.stdout, selectors.EVENT_READ)
        if not selector.select(15):
            raise RuntimeError('Preview server did not start within 15 seconds')
        line = server.stdout.readline()
        if not line:
            raise RuntimeError(server.stderr.read(3000))
        origin = json.loads(line)['url']
        check(urlparse(origin).hostname == '127.0.0.1', 'preview binds to loopback only')
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True, **({'executable_path': args.browser_executable} if args.browser_executable else {}))
            try:
                def fresh(mode='hoh', app='interop-board', mobile=False, strict=False):
                    context = browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 960}, locale='ko-KR', color_scheme='dark', reduced_motion='reduce')
                    context.route('**/*', lambda route: route.continue_() if urlparse(route.request.url).hostname in ('127.0.0.1', None) else route.abort())
                    page = context.new_page()
                    page.set_default_timeout(10000)
                    page.on('pageerror', lambda error: report['errors'].append(str(error)))
                    page.goto(origin + f'?host={mode}&app={app}' + ('&strict=1' if strict else ''), wait_until='networkidle')
                    page.wait_for_function('Boolean(window.hohInterop)')
                    page.wait_for_function('Boolean(window.hohInterop.peek())')
                    return context, page

                contexts = []
                try:
                    mm_context, mm = fresh('mm')
                    contexts.append(mm_context)
                    shared_context, shared = fresh('mm-kit')
                    contexts.append(shared_context)
                    hoh_context, hoh = fresh('hoh')
                    contexts.append(hoh_context)
                    report['packages'] = hoh.evaluate('window.hohInterop.summaries')
                    check(mm.evaluate('window.hohInterop.summaries') == report['packages'], 'both runtimes consume exactly the same bundle and template hashes')
                    check(shared.evaluate('window.hohInterop.summaries') == report['packages'], 'the shared kit also consumes unchanged packages in the existing MM host')
                    runtime_pages = [('MM', mm), ('MM with shared kit', shared), ('HOH', hoh)]
                    for label, page in runtime_pages:
                        page.bring_to_front()
                        frame = page.frame_locator('iframe').first
                        expect(frame.locator('#count')).to_have_text('0')
                        frame.locator('#add').click()
                        expect(frame.locator('#count')).to_have_text('1')
                        page.wait_for_function('hohInterop.peek()?.state.count===1')
                        result = page.evaluate('hohInterop.invoke("setCount", {count: 4})')
                        if not result.get('ok'):
                            report['diagnostic'] = {'host': label, 'request': page.evaluate('window.hohInteropLastRequest'), 'outcome': result, 'current': page.evaluate('hohInterop.read()')}
                            print(json.dumps(report['diagnostic'], ensure_ascii=False))
                        check(result['ok'] and result['snapshot']['state']['count'] == 4, f'{label}: agent request updates the same state as the human control (outcome={result.get("code", "ok")})')
                        expect(frame.locator('#count')).to_have_text('4')
                        check(frame.locator('body').evaluate('()=>document.compatMode') == 'CSS1Compat', f'{label}: package remains in standards mode')
                        blocked = frame.locator('body').evaluate('''async()=>{
                          let cookie=false, parentDom=false, network=false;
                          try{void document.cookie}catch{cookie=true}
                          try{void parent.document.body}catch{parentDom=true}
                          try{await fetch('/interop/catalog')}catch{network=true}
                          return {cookie,parentDom,network,origin:self.origin};
                        }''')
                        check(all(blocked[x] for x in ('cookie', 'parentDom', 'network')) and blocked['origin'] == 'null', f'{label}: app keeps its opaque-origin and network boundary')

                    check(hoh.locator('.chat').is_visible(), 'HOH runs the package inside its actual content-and-chat shell')
                    check('LLM 미연결' in hoh.locator('#chatStatus').inner_text(), 'the deterministic chat example does not claim a connected language model')
                    hoh.locator('#chatInput').fill('하나 추가')
                    hoh.locator('#chatForm').evaluate('(form)=>form.requestSubmit()')
                    expect(hoh.frame_locator('iframe').first.locator('#count')).to_have_text('5')
                    check(True, 'adjacent deterministic chat command uses the package action registry')
                    result = hoh.evaluate('''async()=>{
                      const c=await hohInterop.current(), r=await c.read();
                      const q={contentId:c.scope.contentId,descriptorRevision:c.scope.descriptorRevision,instanceId:c.scope.instanceId,bundleDigest:c.scope.bundleDigest,expectedStateRevision:r.snapshot.stateRevision,actionId:'increment',input:{},idempotencyKey:'same-command'};
                      const first=await c.invoke(q), again=await c.invoke(q), wrong=await c.invoke({...q,input:{undeclared:true}});
                      return {first,again,wrong,count:(await c.read()).snapshot.state.count};
                    }''')
                    check(result['first']['ok'] and result['again'] == result['first'] and result['count'] == 6, 'retrying the same mount-scoped action does not apply it twice')
                    check(result['wrong']['code'] == 'IDEMPOTENCY_MISMATCH', 'reusing a key for a different request is rejected')
                    revoked = hoh.evaluate('''async()=>{
                      const c=await hohInterop.current(), r=await c.read();
                      const q={contentId:c.scope.contentId,descriptorRevision:c.scope.descriptorRevision,instanceId:c.scope.instanceId,bundleDigest:c.scope.bundleDigest,expectedStateRevision:r.snapshot.stateRevision,actionId:'setCount',input:{count:6},idempotencyKey:'revoked-command'};
                      await c.invoke(q);hohInterop.setPolicyAllowed(false);
                      const repeat=await c.invoke(q);let readCode='unexpected';try{await c.read()}catch(e){readCode=e.code}
                      hohInterop.setPolicyAllowed(true);return {repeat,readCode};
                    }''')
                    check(revoked['repeat'].get('code') == 'DENIED' and revoked['readCode'] == 'DENIED', 'revoked host policy blocks both cached replay and state reads')
                    for action, value, code in [('setCount', {'count': 101}, 'SCHEMA_MISMATCH'), ('humanOnly', {}, 'GESTURE_REQUIRED'), ('confirmedOnly', {}, 'CONFIRMATION_REQUIRED'), ('notDeclared', {}, 'UNKNOWN_ACTION')]:
                        got = hoh.evaluate('([a,v])=>hohInterop.invoke(a,v)', [action, value])
                        check(got.get('code') == code, f'HOH rejects {code} before invoking the frame')
                    stale = hoh.evaluate('hohInterop.invoke("setCount", {count: 0}, {expectedStateRevision:0})')
                    check(stale.get('code') == 'STALE_REVISION', 'stale state is not silently refreshed and overwritten')
                    forged = hoh.evaluate('hohInterop.invoke("setCount", {count: 0}, {actor:"person",confirmation:{id:"forged"}})')
                    check(forged.get('code') == 'INVALID_REQUEST', 'model-supplied identity and confirmation cannot gain authority')
                    undeclared = hoh.frame_locator('iframe').first.locator('body').evaluate('async()=>{try{await ailab.call("not.registered",{});return "unexpected"}catch(e){return e.code}}')
                    check(undeclared == 'UNDECLARED_TOOL', 'template cannot call a tool outside its declared host binding')
                    awaitable = hoh.evaluate('''async()=>{const c=await hohInterop.current();await hohInterop.invoke('setUnsaved',{value:true});return c.canReplace()}''')
                    check(awaitable is False, 'unsaved app state prevents automatic replacement')
                    hoh.evaluate('hohInterop.invoke("setUnsaved",{value:false})')
                    check(hoh.evaluate('async()=>{const c=await hohInterop.current();return c.canReplace()}'), 'declared hot-reload can proceed once the app reports no unfinished work')
                    hoh.wait_for_function('hohInterop.resume()?.count === "6"')
                    check(hoh.evaluate('hohInterop.resume(undefined,"another-person")') is None, 'view restore does not cross principal scope')
                    old_scope = hoh.evaluate('async()=>(await hohInterop.current()).scope')
                    hoh.evaluate('hohInterop.open("interop-board")')
                    expect(hoh.frame_locator('iframe').first.locator('#count')).to_have_text('6')
                    rejected = hoh.evaluate('s=>hohInterop.invoke("increment",{}, {instanceId:s.instanceId,bundleDigest:s.bundleDigest})', old_scope)
                    check(rejected.get('code') == 'STALE_INSTANCE', 'a previous mount cannot issue commands against a reopened app')
                    check(True, 'declared resume input restores the same visible state on reopen')
                    hoh.screenshot(path=str(args.output / 'hoh-desktop.png'), full_page=True)

                    available = {p['name'] for p in report['packages']}
                    for name, action, data, property_, wanted in [
                        ('playback-demo', 'setFrame', {'index': 8}, 'frame', 9),
                        ('org', 'setTab', {'tab': 'work'}, 'tab', 'work'),
                        ('phone-workspace', 'navigate', {'tab': 'library'}, 'tab', 'library'),
                    ]:
                        if name not in available:
                            continue
                        for label, page in runtime_pages:
                            page.bring_to_front()
                            page.evaluate('(name)=>hohInterop.open(name)', name)
                            page.wait_for_function('Boolean(hohInterop.peek())')
                            value = page.evaluate('([a,v])=>hohInterop.invoke(a,v)', [action, data])
                            check(value.get('ok') and value['snapshot']['state'].get(property_) == wanted, f'{label}: unchanged {name} package executes its declared {action} action')

                    mobile_context, mobile = fresh('hoh', mobile=True)
                    contexts.append(mobile_context)
                    mobile.frame_locator('iframe').first.locator('#add').click()
                    expect(mobile.frame_locator('iframe').first.locator('#count')).to_have_text('1')
                    bounds = mobile.locator('iframe').bounding_box()
                    check(bounds and bounds['width'] > 200 and bounds['x'] >= -1 and bounds['x'] + bounds['width'] <= 391, 'phone layout keeps the runnable package inside the viewport')
                    mobile.screenshot(path=str(args.output / 'hoh-mobile.png'), full_page=True)
                    strict_context, strict = fresh('hoh', strict=True)
                    contexts.append(strict_context)
                    strict.frame_locator('iframe').first.locator('#add').click()
                    expect(strict.frame_locator('iframe').first.locator('#count')).to_have_text('1')
                    check(strict.evaluate('hohInterop.invoke("setCount",{count:7})').get('ok'), 'same-origin document delivery works under the existing production script/style CSP')
                    strict.screenshot(path=str(args.output / 'hoh-strict-policy.png'), full_page=True)
                    interrupted = strict.evaluate('''async()=>{
                      const c=await hohInterop.current(), r=await c.read();
                      const q={contentId:c.scope.contentId,descriptorRevision:c.scope.descriptorRevision,instanceId:c.scope.instanceId,bundleDigest:c.scope.bundleDigest,expectedStateRevision:r.snapshot.stateRevision,actionId:'increment',input:{},idempotencyKey:'closing-command'};
                      const running=c.invoke(q);await new Promise(resolve=>setTimeout(resolve,0));c.close();return running;
                    }''')
                    check(interrupted.get('code') == 'EXECUTION_UNCERTAIN', 'closing after dispatch reports uncertain completion instead of claiming rollback')
                    hoh.evaluate('hohInterop.close()')
                    check(hoh.locator('iframe').count() == 0, 'closing the current app removes its frame')
                    check(not report['errors'], 'no uncaught browser exceptions across both runtime paths')
                finally:
                    for context in contexts:
                        context.close()
            finally:
                browser.close()
        report['result'] = 'PASS'
    except BaseException as error:
        report['result'] = 'FAIL'
        report['failure'] = f'{type(error).__name__}: {error}'
        raise
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait(timeout=5)
        (args.output / 'result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps({'result': report['result'], 'checks': len(report['checks']), 'failure': report.get('failure')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
