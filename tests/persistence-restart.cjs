// Explicit operational check: run this, then restart only the API when READY appears.
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:8000';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 let token;
 async function call(path,body,method){const r=await fetch(base+path,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(2000)});assert.ok(r.ok,path+' returned '+r.status);return r.json();}
 assert.equal((await call('/system/capabilities')).sandbox,true);
 const email='restart_probe_'+randomUUID()+'@example.com',password='DisposableRestartProbe123!';
 await call('/auth/register',{email,password,full_name:'Restart Persistence Probe'});
 token=(await call('/auth/login',{email,password})).access_token;
 const account=await call('/accounts',{currency:'EUR'});
 await call('/sandbox/funding',{account_id:account.id,amount:1234,idempotency_key:randomUUID()});
 const space=await call('/accounts',{currency:'EUR',kind:'space',owner_name:'Persisted goal',goal:50000});
 await call('/auth/settings',{theme:'light',monthly_budget:25000,selected_account_id:account.id},'PATCH');
 console.log('READY_RESTART_API');
 const deadline=Date.now()+120000;let sawOutage=false;
 while(Date.now()<deadline){try{await call('/health');if(sawOutage)break;}catch{ sawOutage=true;}await pause(250);}
 assert.ok(sawOutage,'No API restart was observed');
 const snapshot=await call('/workspace');
 assert.equal(snapshot.accounts.find(a=>a.id===account.id).balance,1234);
 assert.equal(snapshot.accounts.find(a=>a.id===space.id).goal,50000);
 assert.equal(snapshot.user.settings.monthly_budget,25000);
 assert.equal(snapshot.user.settings.theme,'light');
 assert.equal(snapshot.user.settings.selected_accounts.EUR,account.id);
 assert.equal(snapshot.entries.length,1);
 console.log('PASS: balances, savings goals, preferences, selection, session and journal survived the API restart.');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
