/** Runs the complete real-HTTP demo. This intentionally RESETS the current in-memory run. */
import assert from 'node:assert/strict';
const base=process.env.MESHWORK_URL??process.env.ASTRAGRID_URL??'http://127.0.0.1:3000';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function request(path,data){
  const r=await fetch(base+path,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const result=await r.json();if(!r.ok)throw new Error(result.error);return result;
}
try{
  await request('/api/demo/start',{});
  let last='',firstProvider,settledAtLoss,sawRefund=false,complete=false;
  const deadline=Date.now()+60000;
  while(Date.now()<deadline){
    const s=await request('/api/state'),j=s.job,p=s.providers.find(n=>n.id===j?.providerId);
    const phase=`${s.demo.label} / ${j?.status??'provider verification'}`;
    if(phase!==last){console.log(phase);last=phase;}
    if(j){
      const l=j.ledger;assert.equal(l.depositNanos,l.availableNanos+l.heldNanos+l.settledNanos,'Accounting conservation');
      if(j.status==='healthy'&&!firstProvider)firstProvider=j.providerId;
      if(p&&!p.emitting&&j.providerId===firstProvider&&settledAtLoss===undefined)settledAtLoss=l.settledNanos;
      if(settledAtLoss!==undefined&&j.status!=='healthy')assert.equal(l.settledNanos,settledAtLoss,'Billing must stop before recovery');
      if(l.refundedNanos>0)sawRefund=true;
    }
    if(s.demo.completed){
      assert.equal(j.status,'healthy');assert.notEqual(j.providerId,firstProvider);assert.ok(sawRefund);
      const response=await request('/api/compute',{command:'python /workspace/task.py --input backup'});assert.equal(response.simulated,true);
      console.log(JSON.stringify({pass:true,oldProvider:firstProvider,backupProvider:j.providerId,recoveryMs:j.lastRecoveryMs,
        returnedReserve:j.ledger.refundedNanos/1e9,meteredSeconds:j.verifiedMs/1000,computeProvider:response.provider.name},null,2));
      complete=true;break;
    }
    await sleep(250);
  }
  assert.ok(complete,'Demo did not finish within 60 seconds');
}catch(error){console.error(`SMOKE TEST FAILED: ${error.message}`);process.exitCode=1;}
