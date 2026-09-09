import test from 'node:test';
import assert from 'node:assert/strict';
import { createGridServer } from '../server/index.mjs';
import { chooseWithOpenAI } from '../server/scheduler.mjs';

async function fixture(t) {
  const app = createGridServer({autoTick:false});
  await new Promise(resolve => app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const post=(path,data={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  return {...app,base,post};
}
test('HTTP serves app and an API snapshot without provider tokens',async t=>{
  const {base}=await fixture(t);
  const r=await fetch(base+'/'); assert.equal(r.status,200); assert.match(await r.text(),/AstraGrid/);
  const s=await (await fetch(base+'/api/state')).json(); assert.equal(s.providers.length,6);
  assert.ok(s.providers.every(n=>n.token===undefined));
});
test('HTTP register and authenticated telemetry heartbeat',async t=>{
  const {base,post}=await fixture(t);
  const r=await post('/api/providers',{name:'LOCAL-TEST',source:'agent'});assert.equal(r.status,201);
  const data=await r.json();
  const hb=await fetch(`${base}/api/providers/${data.provider.id}/heartbeat`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${data.heartbeatToken}`},body:JSON.stringify({telemetry:{utilization:12}})});
  assert.equal(hb.status,200);
  assert.equal((await post(`/api/providers/${data.provider.id}/heartbeat`,{})).status,401);
});
test('HTTP workloads reject concurrent deployment and invalid data',async t=>{
  const {post}=await fixture(t);
  assert.equal((await post('/api/workloads',{maxPrice:-2})).status,400);
  assert.equal((await post('/api/workloads')).status,201);
  assert.equal((await post('/api/workloads')).status,409);
  assert.equal((await post('/api/compute',{command:'python task.py'})).status,503);
});
test('HTTP rejects malformed JSON, non-JSON and array bodies',async t=>{
  const {base}=await fixture(t);
  for(const body of ['{oops','[]','null']){
    const r=await fetch(base+'/api/workloads',{method:'POST',headers:{'Content-Type':'application/json'},body});assert.equal(r.status,400);
  }
  assert.equal((await fetch(base+'/api/workloads',{method:'POST',body:'{}'})).status,415);
});
test('cross-origin writes fail and private assets are never served',async t=>{
  const {base}=await fixture(t);
  assert.equal((await fetch(base+'/api/demo/reset',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.example'},body:'{}'})).status,403);
  for(const path of ['/.env','/server/engine.mjs','/%2e%2e%2fserver%2findex.mjs'])assert.equal((await fetch(base+path)).status,404);
});
test('audit export contains honest boundaries and no heartbeat secrets',async t=>{
  const {base}=await fixture(t);const r=await fetch(base+'/api/export');
  assert.match(r.headers.get('content-disposition'),/meshwork-audit.json/);
  const s=await r.json();assert.equal(s.disclosure.runtime,'simulated');assert.equal(s.disclosure.accounting,'demo balance only');
  assert.equal(JSON.stringify(s).includes('heartbeatToken'),false);
});
test('native SSE stream publishes initial and subsequent engine snapshots',async t=>{
  const {base,engine}=await fixture(t);const control=new AbortController();
  const r=await fetch(base+'/api/events',{signal:control.signal});
  assert.match(r.headers.get('content-type'),/text\/event-stream/);
  const reader=r.body.getReader();const initial=new TextDecoder().decode((await reader.read()).value);
  assert.match(initial,/data: /);assert.match(initial,/NIMBUS-01/);
  engine.register({name:'SSE-NEW'});
  const next=new TextDecoder().decode((await reader.read()).value);assert.match(next,/SSE-NEW/);
  control.abort();await reader.cancel().catch(()=>{});
});
test('structured-output adapter sends an enum allowlist and server-only secret',async()=>{
  let sent;
  const fetcher=async(url,options)=>{sent={url,options};return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({providerId:'node_1',summary:'Fits price and latency goals.'})}]}]})}};
  const result=await chooseWithOpenAI({name:'job'},[{id:'node_1',compatible:true},{id:'bad',compatible:false}],{OPENAI_API_KEY:'fake-test-key',OPENAI_MODEL:'configured-model'},fetcher);
  assert.equal(result.providerId,'node_1');assert.equal(result.mode,'openai');
  const payload=JSON.parse(sent.options.body);assert.equal(payload.store,false);
  assert.deepEqual(payload.text.format.schema.properties.providerId.enum,['node_1']);
  assert.equal(sent.options.headers.Authorization,'Bearer fake-test-key');
});
test('structured-output adapter rejects hallucinated node, refusal and HTTP error',async()=>{
  const candidates=[{id:'real',compatible:true}],env={OPENAI_API_KEY:'fake',OPENAI_MODEL:'configured-model'};
  await assert.rejects(chooseWithOpenAI({},candidates,env,async()=>({ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:'{"providerId":"invented","summary":"oops"}'}]}]})})),/invalid placement/);
  await assert.rejects(chooseWithOpenAI({},candidates,env,async()=>({ok:true,json:async()=>({status:'incomplete'})})),/incomplete/);
  await assert.rejects(chooseWithOpenAI({},candidates,env,async()=>({ok:false,status:429})),/HTTP 429/);
});
test('structured-output adapter requires explicit model configuration',async()=>{
  await assert.rejects(chooseWithOpenAI({},[],{}),/OPENAI_API_KEY and OPENAI_MODEL/);
});
