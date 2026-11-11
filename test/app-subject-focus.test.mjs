import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { appContentKitSource } from '../ui/app-content-kit.js';

async function kit(t) {
  let listener; const sent = [], doc = { activeElement: null };
  class Element {
    ownerDocument = doc; isConnected = true; disabled = false; visible = true; focused = 0;
    getClientRects() { return this.visible ? [{}] : []; }
    scrollIntoView() {}
    focus() { this.focused++; doc.activeElement = this; }
  }
  const parent = { postMessage: message => sent.push(message) };
  const window = {}, context = { window, parent, document: doc, HTMLElement: Element, setTimeout, clearTimeout,
    addEventListener: (_, fn) => { listener = fn; }, removeEventListener() {},
    navigator: { userActivation: { isActive: true } }, requestAnimationFrame: fn => fn() };
  vm.runInNewContext(appContentKitSource({ channel: 'focus-test' }), context);
  const post = (message, source = parent) => listener({ source, data: { jsonrpc: '2.0', channel: 'focus-test', ...message } });
  const ready = window.ailab.connect({ name: 'fixture', version: '1' });
  const initialize = sent.find(x => x.method === 'ui/initialize');
  post({ id: initialize.id, result: { protocolVersion: 'ailab-apps/1', hostContext: {} } });
  post({ method: 'ui/notifications/tool-input', params: { arguments: {} } });
  await ready;
  window.ailab.content({id:'urn:ailab:fixture:focus',revision:1,state:()=>({value:7}),actions:{}});
  t.after(() => post({ method:'ui/resource-teardown' }));
  let n=0;
  const focus = (subjectId, extra = {}, source = parent) => {
    const id='focus-'+(++n); post({ id, method:'ailab/information/focus', params:{subjectId}, ...extra }, source);
    return sent.find(x=>x.id===id && !x.method);
  };
  return { api:window.ailab, Element, focus, post, doc, sent };
}
test('registered source focus changes only presentation and reports the same subject', async t => {
  const v=await kit(t), target=new v.Element();let focused;
  v.api.subject('diagram.input',target);v.api.on('subject-focus',x=>{focused=x.subjectId;});
  const reply=v.focus('diagram.input');assert.equal(reply.result.focused,true);assert.equal(v.doc.activeElement,target);
  assert.equal(focused,'diagram.input');assert.equal(target.focused,1);
  assert.equal(v.sent.filter(x=>x.method==='ailab/notifications/resume-input').length,0);
});
test('unknown, detached, hidden and disabled subjects cannot produce a focus success', async t => {
  const v=await kit(t), target=new v.Element();v.api.subject('diagram.input',target);
  assert.equal(v.focus('other').error.message,'UNKNOWN_SUBJECT');
  target.isConnected=false;assert.equal(v.focus('diagram.input').error.message,'UNKNOWN_SUBJECT');target.isConnected=true;
  target.visible=false;assert.equal(v.focus('diagram.input').error.message,'SUBJECT_UNAVAILABLE');target.visible=true;
  target.disabled=true;assert.equal(v.focus('diagram.input').error.message,'SUBJECT_UNAVAILABLE');assert.equal(target.focused,0);
});
test('foreign senders/channels and stale unregister callbacks cannot redirect focus', async t => {
  const v=await kit(t), old=new v.Element(), current=new v.Element();const remove=v.api.subject('diagram.input',old);
  v.api.subject('diagram.input',current);remove();
  assert.equal(v.focus('diagram.input',{channel:'foreign'}),undefined);assert.equal(v.focus('diagram.input',{},{}),undefined);
  assert.equal(v.focus('diagram.input').result.focused,true);assert.equal(current.focused,1);assert.equal(old.focused,0);
});
test('subject registration is bounded and accepts local elements rather than selectors', async t => {
  const v=await kit(t);
  assert.throws(()=>v.api.subject('x','#outside'),{code:'INVALID_SUBJECT'});
  for(let i=0;i<64;i++)v.api.subject('node.'+i,new v.Element());
  assert.throws(()=>v.api.subject('node.64',new v.Element()),{code:'SUBJECT_LIMIT'});
  v.post({method:'ui/resource-teardown'});assert.throws(()=>v.api.subject('node.0',new v.Element()),{code:'CLOSED'});
});
