const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM,VirtualConsole}=require('jsdom');
const html=fs.readFileSync('app/static/index.html','utf8');
const source=fs.readFileSync('app/static/app.js','utf8');

function workspace(options={}){
  const errors=[];
  const console=new VirtualConsole();console.on('jsdomError',e=>errors.push(e));
  const dom=new JSDOM(html,{url:'http://localhost:8000/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:console});
  const w=dom.window;
  w.matchMedia=()=>({matches:true});
  w.fetch=options.fetch||(async()=>{throw Error('offline');});
  w.AbortSignal.timeout=()=>undefined;
  w.HTMLElement.prototype.scrollIntoView=function(){};
  w.HTMLElement.prototype.scrollTo=function(){};
  w.scrollTo=function(){};
  if(options.theme)w.document.documentElement.dataset.theme=options.theme;
  w.eval(source);
  const $=s=>w.document.querySelector(s);
  const click=s=>$(s).click();
  const submit=s=>$(s).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  const input=(s,value)=>{$(s).value=value;$(s).dispatchEvent(new w.Event('input',{bubbles:true}));};
  return {dom,w,$,click,submit,input,errors};
}
const flush=()=>new Promise(resolve=>setTimeout(resolve,30));

test('landing has only Veyra branding and account actions, with explicit demo access',()=>{
  const x=workspace({theme:'light'});
  try{
    assert.equal(x.$('.logo').textContent,'Veyra');
    assert.equal(x.$('.landing [data-action="theme"]'),null);
    assert.equal(x.$('.landing .logo small'),null);
    assert.equal(x.$('.hero h1').textContent,'Your money.A wider perspective.');
    x.click('.hero [data-action="demo"]');
    assert.equal(x.$('#app').hidden,false);
    assert.equal(x.$('#greetH').textContent,'Alex');
    assert.equal(x.$('#modeText').textContent,'Demo workspace');
    assert.equal(x.$('#monthOut').textContent,'€105.00');
    assert.equal(x.$('#activityCount').textContent,'8 transactions');
    assert.equal(x.errors.length,0);
  }finally{x.dom.window.close();}
});

test('transaction search, direction and currency filters compose',()=>{
  const x=workspace();
  try{
    x.click('.hero [data-action="demo"]');
    x.input('#activitySearch','coffee');
    assert.match(x.$('#activityList').textContent,/Blue Bottle Coffee/);
    assert.equal(x.$('#activityCount').textContent,'1 transaction');
    x.$('#activityDirection').value='in';x.$('#activityDirection').dispatchEvent(new x.w.Event('change'));
    assert.equal(x.$('#activityCount').textContent,'0 transactions');
    assert.match(x.$('#activityList').textContent,/No activity/);
    x.input('#activitySearch','');x.$('#activityDirection').value='all';
    x.click('.cur[data-cur="TRY"]');x.click('#filterCurBtn');
    assert.equal(x.$('#activityCount').textContent,'2 transactions');
    assert.match(x.$('#activityList').textContent,/Migros/);
    assert.doesNotMatch(x.$('#activityList').textContent,/Coffee/);
  }finally{x.dom.window.close();}
});

test('every Veyra wordmark returns to the landing page without ending the session',()=>{
  const x=workspace();
  let pauses=0,resumes=0;
  x.w.VeyraScene={pause:()=>pauses++,resume:()=>resumes++};
  try{
    x.click('.hero [data-action="demo"]');
    const token=x.w.sessionStorage.getItem('veyra_token');
    assert.equal(pauses,1);assert.equal(x.w.location.hash,'#workspace');
    x.click('.dlogo');
    assert.equal(x.$('#app').hidden,true);assert.equal(x.w.location.hash,'');
    assert.equal(x.w.document.body.classList.contains('app-open'),false);
    assert.equal(x.w.sessionStorage.getItem('veyra_token'),token);assert.equal(resumes,1);
    assert.equal(x.w.document.activeElement,x.$('.landing .logo'));
    x.click('#navSignIn');assert.equal(x.$('#app').hidden,false);
    x.click('.mobile-home');assert.equal(x.$('#app').hidden,true);
    assert.equal(x.w.sessionStorage.getItem('veyra_token'),token);assert.equal(resumes,2);
    x.click('.landing .logo');assert.equal(x.w.location.hash,'');
    assert.equal(x.errors.length,0);
  }finally{x.dom.window.close();}
});

test('profile and preferences persist, update the workspace and never store passwords in demo data',async()=>{
  const x=workspace();
  try{
    x.click('.hero [data-action="demo"]');x.click('.who');
    x.input('#profileName','Taylor Reed');x.submit('#personalF');await flush();
    assert.equal(x.$('#greetH').textContent,'Taylor');
    assert.equal(x.$('#uAvatar').textContent,'TR');
    x.click('[data-settings-tab="preferences"]');
    x.$('#prefTheme').value='light';x.$('#prefCurrency').value='USD';x.$('#prefHide').checked=true;x.$('#prefCompact').checked=true;x.$('#prefBudget').value='500';x.$('#prefIdle').value='30';x.submit('#preferencesF');await flush();
    assert.equal(x.w.document.documentElement.dataset.theme,'light');
    assert.equal(x.$('.cur[aria-selected="true"]').dataset.cur,'USD');
    assert.ok(x.$('#app').classList.contains('privacy-hidden'));
    assert.ok(x.$('#app').classList.contains('compact-activity'));
    assert.match(x.$('#budgetSummary').textContent,/500.00/);
    const profile=JSON.parse(x.w.localStorage.getItem('veyra-demo-profile'));
    assert.equal(profile.full_name,'Taylor Reed');assert.equal(profile.settings.monthly_budget,50000);
    x.click('[data-settings-tab="security"]');x.$('#profile2fa').checked=true;x.$('#profilePass').value='NeverStoreMe123';x.submit('#profileF');await flush();
    const saved=JSON.parse(x.w.localStorage.getItem('veyra-demo-profile'));
    assert.equal(saved.settings.two_factor,true);assert.equal(saved.settings.password,undefined);
    x.click('[data-action="signout"]');assert.equal(x.$('#m-profile').classList.contains('is-open'),false);
    assert.equal(x.w.sessionStorage.getItem('veyra_token'),null);assert.equal(x.w.localStorage.getItem('veyra_token'),null);
    assert.equal(x.errors.length,0);
  }finally{x.dom.window.close();}
});

test('offline sign-in and registration show errors without creating an authenticated session',async()=>{
  const x=workspace();
  try{
    x.click('#navSignIn');x.input('#siEmail','person@example.com');x.input('#siPass','Password123');x.submit('#signinForm');await flush();
    assert.match(x.$('#siErr').textContent,/unavailable/);assert.equal(x.$('#app').hidden,true);
    assert.equal(x.w.sessionStorage.getItem('veyra_token'),null);
    x.click('[data-action="to-register"]');await new Promise(resolve=>setTimeout(resolve,130));
    x.input('#rgName','Person Name');x.input('#rgEmail','person@example.com');x.input('#rgPass','Password123');x.submit('#regForm');await flush();
    assert.match(x.$('#rgErr').textContent,/unavailable/);assert.equal(x.$('#regStep2').hidden,true);
  }finally{x.dom.window.close();}
});

test('password visibility and reset flow call the correct API, with confirmation validation',async()=>{
  const calls=[];
  const x=workspace({fetch:async(path,opts)=>{calls.push({path,body:JSON.parse(opts.body)});return {ok:true,status:200,headers:{get:k=>k==='content-type'?'application/json':null},json:async()=>({message:'If this email has an account, a code will arrive.'})};}});
  try{
    x.click('#navSignIn');x.click('[data-target="siPass"]');assert.equal(x.$('#siPass').type,'text');
    x.click('[data-action="forgot"]');x.input('#resetEmail','person@example.com');x.submit('#resetRequestF');await flush();
    assert.equal(x.$('#resetF').hidden,false);assert.equal(calls[0].path,'/auth/password/reset/request');
    x.input('#resetCode','123456');x.input('#resetPassword','NewPassword123');x.input('#resetConfirm','DifferentPassword');x.submit('#resetF');await flush();
    assert.match(x.$('#resetErr').textContent,/do not match/);assert.equal(calls.length,1);
    x.input('#resetConfirm','NewPassword123');x.submit('#resetF');await flush();
    assert.equal(calls[1].path,'/auth/password/reset');assert.equal(calls[1].body.code,'123456');
    assert.equal(x.errors.length,0);
  }finally{x.dom.window.close();}
});

test('new savings space and funding keep balances and activity consistent',async()=>{
  const x=workspace();
  try{
    x.click('.hero [data-action="demo"]');x.click('[data-action="new-space"]');x.input('#snName','New home');x.input('#snGoal','2000');x.submit('#snF');await flush();
    const space=[...x.w.document.querySelectorAll('.space')].find(el=>el.textContent.includes('New home'));
    assert.ok(space);space.querySelector('[data-dir="add"]').click();x.input('#smAmt','50');x.submit('#smF');await flush();
    assert.equal(x.$('[data-bal="EUR"]').textContent,'€400.00');assert.match(x.$('#spacesList').textContent,/€50.00/);
    assert.match(x.$('#activityList').textContent,/Moved to New home/);assert.equal(x.errors.length,0);
  }finally{x.dom.window.close();}
});

test('live accounts have no sample data and exchange requires a reviewed quote before execution',async()=>{
  const requests=[];
  const user={id:12,email:'real@example.com',full_name:'Real Person',settings:{},created_at:'2026-01-01T00:00:00Z'};
  const accounts=[{id:1,kind:'current',currency:'EUR',balance:100000,account_number:'DE001111',owner_name:user.full_name},{id:2,kind:'current',currency:'USD',balance:0,account_number:'DE002222',owner_name:user.full_name}];
  const x=workspace({fetch:async(path,opts)=>{
    requests.push(path);
    const data=path==='/auth/login'?{access_token:'live-token'}:path==='/auth/me'?user:path==='/accounts/me'?accounts:path.endsWith('/statement')?{entries:[]}:path==='/fx/quote'?{quote_id:'review-me',amount:10000,received:10800,fee:0,rate:'1.08',rate_date:'2026-10-28',expires_in:30}:{status:'COMPLETED'};
    return {ok:true,status:200,headers:{get:k=>k==='content-type'?'application/json':null},json:async()=>data};
  }});
  try{
    x.click('#navSignIn');x.input('#siEmail',user.email);x.input('#siPass','ExistingPassword123!');x.submit('#signinForm');await flush();
    assert.equal(x.$('#app').hidden,false);assert.equal(x.$('[data-bal="EUR"]').textContent,'€1,000.00');
    assert.equal(x.$('[data-bal="TRY"]').textContent,'₺0.00');assert.equal(x.$('#activityCount').textContent,'0 transactions');
    assert.doesNotMatch(x.$('#spacesList').textContent,/Yaz Tatili/);
    assert.equal(x.w.localStorage.getItem('veyra_token'),null);assert.equal(x.w.sessionStorage.getItem('veyra_token'),'live-token');
    x.click('.actions [data-action="topup"]');assert.equal(x.$('#m-topup').hidden,true);
    x.click('.actions [data-action="convert"]');assert.equal(x.$('#cvOut').value,'');
    x.submit('#cvF');await flush();
    assert.equal(x.$('#cvOut').value,'108.00');assert.equal(x.$('#cvBtn').textContent,'Confirm exchange');
    assert.equal(requests.filter(p=>p==='/fx/swap').length,0);
    x.submit('#cvF');await flush();assert.equal(requests.filter(p=>p==='/fx/swap').length,1);
    assert.equal(x.errors.length,0);
  }finally{x.dom.window.close();}
});
