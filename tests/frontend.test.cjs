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
  const NativeDate=w.Date;
  w.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:['2026-11-15T12:00:00Z']));}static now(){return new NativeDate('2026-11-15T12:00:00Z').getTime();}};
  w.matchMedia=()=>({matches:options.reduced!==false});
  // Funded demo data belongs only to interaction tests. The product starts at zero.
  if(options.fundedDemo!==false)w.localStorage.setItem('veyra_state_v2:demo@veyra.local',fs.readFileSync('tests/fixtures/funded-demo.json','utf8'));
  w.fetch=async(path,opts)=>{if(path==='/workspace'&&!options.snapshot)return {ok:false,status:404,headers:new Map([['content-type','application/json']]),json:async()=>({detail:'Not found'})};return (options.fetch||(async()=>{throw Error('offline');}))(path,opts);};
  w.AbortSignal.timeout=()=>undefined;
  w.HTMLElement.prototype.scrollIntoView=function(){};
  w.HTMLElement.prototype.scrollTo=function(){};
  w.scrollTo=function(){};
  if(options.theme)w.document.documentElement.dataset.theme=options.theme;
  w.eval(source);
  w.eval(fs.readFileSync('app/static/select-controls.js','utf8'));
  const $=s=>w.document.querySelector(s);
  const click=s=>$(s).click();
  const submit=s=>$(s).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  const input=(s,value)=>{$(s).value=value;$(s).dispatchEvent(new w.Event('input',{bubbles:true}));};
  return {dom,w,$,click,submit,input,errors};
}
const flush=()=>new Promise(resolve=>setTimeout(resolve,30));

test('a fresh demo starts with zero balances and no fabricated activity',()=>{
 const x=workspace({fundedDemo:false});try{x.click('.hero [data-action="demo"]');assert.equal(x.$('#balAmt').textContent,'€0.00');assert.equal(x.$('#activityCount').textContent,'0 transactions');assert.equal(x.$('#monthIn').textContent,'€0.00');assert.match(x.$('#spacesList').textContent,/€0.00/);assert.equal(x.errors.length,0);}finally{x.dom.window.close();}
});

test('legacy demo balances are reset once while preserving savings goals',()=>{
 const x=workspace({fundedDemo:false});try{const state=JSON.parse(fs.readFileSync('tests/fixtures/funded-demo.json','utf8'));delete state.balanceRevision;x.w.localStorage.setItem('veyra_state_v2:demo@veyra.local',JSON.stringify(state));x.click('.hero [data-action="demo"]');assert.equal(x.$('#balAmt').textContent,'€0.00');assert.equal(x.$('#activityCount').textContent,'0 transactions');assert.match(x.$('#spacesList').textContent,/Yaz Tatili/);assert.equal(JSON.parse(x.w.localStorage.getItem('veyra_state_v2:demo@veyra.local')).balanceRevision,1);}finally{x.dom.window.close();}
});

test('snapshot loads all accounts and saves the selected account on the server',async()=>{
 const requests=[],user={id:7,full_name:'Test User',email:'test@example.com',settings:{selected_accounts:{EUR:12}}},accounts=[{id:11,kind:'current',currency:'EUR',balance:10000,account_number:'DE111'},{id:12,kind:'current',currency:'EUR',balance:20000,account_number:'DE222'}];
 const x=workspace({snapshot:true,fetch:async(path,opts)=>{requests.push(path);let data=path==='/auth/login'?{access_token:'snapshot-token'}:path==='/auth/me'?user:path==='/workspace'?{user,accounts,entries:[],recipients:[]}:{};if(path==='/auth/settings'){const body=JSON.parse(opts.body);user.settings.selected_accounts.EUR=body.selected_account_id;data=user.settings;}return {ok:true,status:200,headers:new Map([['content-type','application/json']]),json:async()=>data};}});
 try{await signInFixture(x);assert.equal(x.$('[data-bal="EUR"]').textContent,'€300.00');assert.equal(x.$('#balAmt').textContent,'€200.00');assert.equal(x.$('#accountSelect').hidden,false);assert.equal(x.$('#accountSelect').value,'12');x.$('#accountSelect').value='11';x.$('#accountSelect').dispatchEvent(new x.w.Event('change'));await flush();assert.equal(x.$('#balAmt').textContent,'€100.00');assert.equal(user.settings.selected_accounts.EUR,11);assert.equal(x.w.localStorage.getItem('veyra_state_v2:test@example.com'),null);assert.ok(requests.includes('/workspace'));assert.ok(!requests.includes('/accounts/me'));assert.equal(x.errors.length,0);}finally{x.dom.window.close();}
});

test('landing theme control updates every control and carries light mode into the workspace',()=>{
 const x=workspace();try{x.w.localStorage.setItem('veyra-demo-profile',JSON.stringify({id:0,full_name:'Alex Morgan',email:'demo@veyra.local',settings:{theme:'dark'}}));x.click('.landing [data-action="theme"]');assert.equal(x.w.document.documentElement.dataset.theme,'light');assert.equal(x.w.localStorage.getItem('veyra-theme'),'light');assert.equal(x.$('.landing .theme-toggle').getAttribute('aria-label'),'Switch to dark mode');x.click('.hero [data-action="demo"]');assert.equal(x.w.document.documentElement.dataset.theme,'light');x.click('.workspace-tools .theme-toggle');assert.equal(x.w.document.documentElement.dataset.theme,'dark');assert.equal(x.$('.landing .theme-toggle').getAttribute('aria-pressed'),'false');assert.equal(x.errors.length,0);}finally{x.dom.window.close();}
});

test('settings tabs animate the selected panel and move their capsule without changing profile data',()=>{
 const x=workspace({reduced:false});try{const animations=[];x.w.HTMLElement.prototype.animate=function(frames,options){animations.push({id:this.id,frames,options});return {cancel(){}};};x.w.document.documentElement.dataset.reducedMotion='false';x.click('.hero [data-action="demo"]');x.click('.who');x.click('[data-settings-tab="preferences"]');assert.equal(x.$('.settings-tabs').style.getPropertyValue('--active-tab'),'1');assert.equal(x.$('#pane-personal').hidden,true);assert.equal(x.$('#pane-preferences').hidden,false);assert.equal(x.$('#profileName').value,'Alex Morgan');assert.ok(animations.some(a=>a.id==='pane-preferences'));x.click('[data-settings-tab="security"]');assert.equal(x.$('.settings-tabs').style.getPropertyValue('--active-tab'),'2');assert.equal(x.errors.length,0);}finally{x.dom.window.close();}
});

test('custom preferences picker updates persisted settings and follows programmatic currency swaps',async()=>{
 const x=workspace();try{
  x.click('.hero [data-action="demo"]');x.click('.who');x.click('[data-settings-tab="preferences"]');await flush();
  x.click('#prefCurrency-trigger');x.click('#prefCurrency-trigger-list-option-'+Array.from(x.$('#prefCurrency').options).findIndex(o=>o.value==='GBP'));assert.equal(x.$('#prefCurrency').value,'GBP');
  x.submit('#preferencesF');await flush();assert.equal(JSON.parse(x.w.localStorage.getItem('veyra-demo-profile')).settings.primary_currency,'GBP');
  x.click('#m-profile [data-close]');x.click('[data-action="convert"]');await flush();
  const before=[x.$('#cvFrom').value,x.$('#cvTo').value];x.click('[data-action="cv-swap"]');await flush();
  assert.equal(x.$('#cvFrom').value,before[1]);assert.match(x.$('#cvFrom-trigger').textContent,new RegExp(before[1]));
  assert.equal(x.$('#cvTo').value,before[0]);assert.match(x.$('#cvTo-trigger').textContent,new RegExp(before[0]));assert.equal(x.errors.length,0);
 }finally{x.dom.window.close();}
});

test('demo deletion needs no typed word and removes only the current demo data',async()=>{
 const x=workspace();try{x.click('.hero [data-action="demo"]');x.click('.who');x.w.localStorage.setItem('unrelated','keep');x.click('[data-action="delete-account"]');assert.equal(x.$('#m-delete').hidden,false);assert.equal(x.$('#deleteRequestF').hidden,true);assert.equal(x.$('#deleteConfirmation'),null);assert.equal(x.$('#deleteConfirmBtn').textContent,'Delete Account');x.submit('#deleteConfirmF');await flush();assert.equal(x.$('#app').hidden,true);assert.equal(x.w.sessionStorage.getItem('veyra_token'),null);assert.equal(x.w.localStorage.getItem('veyra-demo-profile'),null);assert.equal(x.w.localStorage.getItem('veyra_state_v2:demo@veyra.local'),null);assert.equal(x.w.localStorage.getItem('unrelated'),'keep');assert.equal(x.errors.length,0);}finally{x.dom.window.close();}
});

test('landing preserves Veyra branding and account actions, with explicit demo access',()=>{
  const x=workspace({theme:'light'});
  try{
    assert.equal(x.$('.logo').textContent,'Veyra');
    assert.ok(x.$('.landing [data-action="theme"]'));
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

test('cash flow switches periods using real activity and motion preference persists',async()=>{
 const x=workspace();try{
  x.click('.hero [data-action="demo"]');assert.match(x.$('#cashflowChart').getAttribute('aria-label'),/Last 7 days: €330.58 in, €105.00 out. 4 transactions./);assert.equal(x.w.document.querySelectorAll('#cashflowChart .chart-column').length,7);
  x.click('[data-chart-days="30"]');assert.equal(x.w.document.querySelectorAll('#cashflowChart .chart-column').length,10);assert.match(x.$('#cashflowChart').getAttribute('aria-label'),/Last 30 days/);assert.equal(x.$('[data-chart-days="30"]').getAttribute('aria-pressed'),'true');
  assert.equal(x.$('[data-filter="all"]').getAttribute('aria-pressed'),'true');x.click('[data-filter="cur"]');assert.equal(x.$('#activityCount').textContent,'4 transactions');assert.equal(x.$('[data-chart-days="30"]').getAttribute('aria-pressed'),'true');
  x.click('.who');x.click('[data-settings-tab="preferences"]');x.$('#prefMotion').checked=true;x.submit('#preferencesF');await flush();assert.equal(x.w.document.documentElement.dataset.reducedMotion,'true');assert.equal(x.w.localStorage.getItem('veyra-reduced-motion'),'true');
  x.click('#m-profile [data-close]');x.click('.who');x.click('[data-settings-tab="preferences"]');assert.equal(x.$('#prefMotion').checked,true);assert.equal(x.errors.length,0);
 }finally{x.dom.window.close();}
});

test('demo payments hub can transition into personal sign-in, and get started opens registration',async()=>{
 const x=workspace();try{x.click('.hero [data-action="demo"]');x.click('[data-action="banking"]');await flush();x.click('[data-action="personal-signin"]');assert.equal(x.$('#m-signin').hidden,false);assert.equal(x.$('#app').hidden,true);assert.equal(x.w.sessionStorage.getItem('veyra_token'),null);x.click('#m-signin [data-close]');await new Promise(resolve=>setTimeout(resolve,250));x.click('.hero [data-action="demo"]');x.click('.dlogo');x.click('.hero [data-action="register"]');assert.equal(x.$('#m-register').hidden,false);assert.equal(x.$('#regStep1').hidden,false);assert.equal(x.errors.length,0);}finally{x.dom.window.close();}
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
    assert.equal(x.$('[data-bal="TRY"]'),null);assert.equal(x.$('#activityCount').textContent,'0 transactions');
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

function signedInWorkspace(){
 const requests=[],accounts=[{id:11,user_id:7,owner_name:'Test User',account_number:'DE38999999990000000000',currency:'EUR',balance:10000,kind:'current'}],user={id:7,full_name:'Test User',email:'test@example.com',settings:{},created_at:new Date().toISOString()};
 let recipients=[],schedules=[];
 const x=workspace({fetch:async(path,opts)=>{
  const body=opts.body?JSON.parse(opts.body):undefined;requests.push({path,body,method:opts.method});let data={},status=200;
  if(path==='/auth/login')data={access_token:'test-token'};
  else if(path==='/auth/me')data=user;
  else if(path==='/accounts/me')data=accounts;
  else if(path.endsWith('/statement'))data={entries:[]};
  else if(path==='/sandbox/funding'){accounts[0].balance+=body.amount;data={transaction_id:101,status:'COMPLETED'};}
  else if(path==='/sandbox/card-payments'){status=403;data={detail:'Your card is frozen.'};}
  else if(path.startsWith('/recipients/resolve'))data={id:22,owner_name:'Friend',currency:'EUR',account_number:'DE12999999990000000022'};
  else if(path==='/beneficiaries'&&opts.method==='POST'){recipients.push({id:1,...body,currency:'EUR'});data=recipients[0];}
  else if(path==='/beneficiaries')data=recipients;
  else if(path.startsWith('/beneficiaries/')){recipients=[];data={status:'deleted'};}
  else if(path==='/payments/scheduled'&&opts.method==='POST'){schedules.push({id:9,...body,status:'PENDING'});data=schedules[0];}
  else if(path==='/payments/scheduled')data=schedules;
  else if(path.startsWith('/payments/scheduled/')){schedules[0].status='CANCELLED';data={status:'CANCELLED'};}
  else if(path==='/audit/events')data=[{id:1,action:'payment.transfer',created_at:new Date().toISOString(),details:{transaction_id:101}}];
  else if(path.endsWith('/reconciliation'))data={balanced:true,difference:0,currency:'EUR'};
  return {ok:status<400,status,headers:new Map([['content-type','application/json']]),json:async()=>data};
 }});
 return {...x,requests};
}
async function signInFixture(x){x.click('#navSignIn');x.input('#siEmail','test@example.com');x.input('#siPass','StrongPassword123!');x.submit('#signinForm');await flush();await flush();}

test('chosen currency opens first and additional currencies appear only after account creation',async()=>{
 const user={id:7,full_name:'Currency User',email:'test@example.com',settings:{primary_currency:'CAD'}},accounts=[{id:81,currency:'CAD',kind:'current',balance:0,account_number:'DE001',owner_name:'Currency User'}],requests=[];
 const x=workspace({snapshot:true,fetch:async(path,opts)=>{
  requests.push(path);let data=path==='/auth/login'?{access_token:'currency-token'}:path==='/auth/me'?user:path==='/workspace'?{user,accounts,entries:[],recipients:[]}:{};
  if(path==='/accounts/currencies'){assert.equal(JSON.parse(opts.body).currency,'AUD');data={id:82,currency:'AUD',kind:'current',balance:0,account_number:'DE002',owner_name:'Currency User'};accounts.push(data);}
  return {ok:true,status:200,headers:new Map([['content-type','application/json']]),json:async()=>data};
 }});
 try{await signInFixture(x);assert.equal(x.$('#balLabel').textContent,'CAD balance');assert.equal(x.$('#balAmt').textContent,'C$ 0.00');assert.equal(x.w.document.querySelectorAll('#curRow .cur').length,1);assert.equal(x.$('#curRow .cur').dataset.cur,'CAD');assert.equal(x.$('#rgCurrency').options.length,7);
  x.click('[data-action="add-currency"]');assert.equal(x.$('#m-currency').hidden,false);assert.equal(Array.from(x.$('#newCurrency').options).some(o=>o.value==='CAD'),false);x.$('#newCurrency').value='AUD';x.submit('#currencyF');await flush();
  assert.equal(x.$('#balLabel').textContent,'AUD balance');assert.equal(x.$('#balAmt').textContent,'A$ 0.00');assert.equal(x.w.document.querySelectorAll('#curRow .cur').length,2);assert.equal(x.$('[data-cur="AUD"]').getAttribute('aria-selected'),'true');assert.equal(user.settings.primary_currency,'CAD');assert.equal(requests.filter(p=>p==='/accounts/currencies').length,1);assert.equal(x.errors.length,0);
 }finally{x.dom.window.close();}
});

test('live deletion requires the emailed code and sends no typed confirmation word',async()=>{
 const requests=[],user={id:7,full_name:'Test User',email:'test@example.com',settings:{primary_currency:'EUR'}};
 const x=workspace({snapshot:true,fetch:async(path,opts)=>{
  const body=opts.body?JSON.parse(opts.body):null;requests.push({path,body});let data=path==='/auth/login'?{access_token:'deletion-token'}:path==='/auth/me'?user:path==='/workspace'?{user,accounts:[{id:1,kind:'current',currency:'EUR',balance:0,account_number:'DE001'}],entries:[],recipients:[]}:{};
  return {ok:true,status:200,headers:new Map([['content-type','application/json']]),json:async()=>data};
 }});
 try{await signInFixture(x);x.click('.who');x.click('[data-action="delete-account"]');x.input('#deletePassword','StrongPassword123!');x.submit('#deleteRequestF');await flush();assert.equal(x.$('#deleteConfirmF').hidden,false);assert.equal(x.$('#deleteConfirmation'),null);
  x.submit('#deleteConfirmF');await flush();assert.match(x.$('#deleteErr').textContent,/six-digit/);assert.equal(requests.some(r=>r.path==='/auth/account'),false);
  x.input('#deleteCode','123456');x.submit('#deleteConfirmF');await flush();const deleted=requests.find(r=>r.path==='/auth/account');assert.deepEqual(deleted.body,{password:'StrongPassword123!',code:'123456'});assert.equal(x.$('#app').hidden,true);assert.equal(x.errors.length,0);
 }finally{x.dom.window.close();}
});

test('payments hub funds a real ledger account and surfaces card-control failures',async()=>{
 const x=signedInWorkspace();try{
  await signInFixture(x);x.click('.actions [data-action="topup"]');await flush();
  assert.equal(x.$('#m-banking').hidden,false);assert.match(x.$('#hubContent').textContent,/sandbox/);
  x.input('#hubAmount','125.25');x.submit('#hubPaymentF');await flush();await flush();
  const funding=x.requests.find(r=>r.path==='/sandbox/funding');assert.equal(funding.body.amount,12525);assert.equal(funding.body.account_id,11);assert.ok(funding.body.idempotency_key);assert.match(x.$('#hubResult').textContent,/101/);assert.match(x.$('#balAmt').textContent,/225.25/);
  x.click('[data-hub="card"]');x.submit('#hubPaymentF');await flush();assert.match(x.$('#hubErr').textContent,/frozen/);assert.equal(x.$('#hubPaymentF button').disabled,false);assert.equal(x.errors.length,0);
 }finally{x.dom.window.close();}
});

test('saved recipients and scheduled payment cancellation use persisted API records',async()=>{
 const x=signedInWorkspace();try{
  await signInFixture(x);x.click('[data-action="banking"]');await flush();x.click('[data-hub="recipients"]');await flush();
  x.input('#hubRecipientName','My friend');x.input('#hubRecipientId','VY-22');x.submit('#hubRecipientF');await flush();await flush();assert.match(x.$('#hubRecipients').textContent,/My friend/);
  x.click('[data-hub-delete="1"]');await flush();assert.match(x.$('#hubRecipients').textContent,/will appear/);
  x.click('[data-hub="scheduled"]');await flush();x.input('#hubDestination','VY-22');x.input('#hubAmount','12.50');x.input('#hubDate','2026-12-01T10:30');x.input('#hubReference','Rent');x.submit('#hubScheduleF');await flush();await flush();
  const schedule=x.requests.find(r=>r.path==='/payments/scheduled'&&r.method==='POST');assert.ok(schedule.body.idempotency_key);assert.equal(schedule.body.amount,1250);assert.equal(schedule.body.destination_account_id,22);assert.equal(schedule.body.reference,'Rent');assert.match(x.$('#hubSchedules').textContent,/PENDING/);
  x.click('[data-hub-cancel="9"]');await flush();assert.match(x.$('#hubSchedules').textContent,/CANCELLED/);
  x.click('[data-hub="audit"]');await flush();x.click('#hubReconcile');await flush();assert.match(x.$('#hubCheck').textContent,/Balanced/);assert.equal(x.errors.length,0);
 }finally{x.dom.window.close();}
});
