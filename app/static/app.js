(function(){
'use strict';

/* =====================================================================
   0. HELPERS
   ===================================================================== */
var $=function(s,r){return (r||document).querySelector(s);};
var $$=function(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s));};
var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms);});};
var reduceMotion=!!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches);
function uuid(){
  if(window.crypto&&crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){var r=Math.random()*16|0;return (c==='x'?r:(r&3|8)).toString(16);});
}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
var SYM={EUR:'€',USD:'$',TRY:'₺',GBP:'£'};
var CUR_NAME={EUR:'Euro',USD:'US Dollar',TRY:'Turkish Lira',GBP:'British Pound'};
function money(v,c,plus){
  var n=Math.round(v*100)/100;
  var s=Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  return (n<0?'-':(plus&&n>0?'+':''))+SYM[c]+s;
}
function parseAmt(v){
  var s=String(v||'').trim().replace(/\s/g,'');
  if(/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s=s.replace(/\./g,'').replace(',','.');
  else s=s.replace(/,/g, s.indexOf('.')>-1?'':'.');
  var n=parseFloat(s);
  return isFinite(n)?Math.round(n*100)/100:NaN;
}
function initials(name){
  var p=String(name||'').trim().split(/\s+/).filter(Boolean);
  return ((p[0]||'V')[0]+(p.length>1?p[p.length-1][0]:'')).toUpperCase();
}
function firstName(name){return String(name||'').trim().split(/\s+/)[0]||'there';}
function groupIban(s){return String(s||'').replace(/\s+/g,'').toUpperCase().replace(/(.{4})/g,'$1 ').trim();}

var toastTimer;
function toast(msg,isErr){
  var t=$('#toast');$('#toastMsg').textContent=msg;
  t.classList.toggle('err',!!isErr);t.classList.add('is-on');
  clearTimeout(toastTimer);toastTimer=setTimeout(function(){t.classList.remove('is-on');},3800);
}
function copyText(text){
  if(navigator.clipboard&&window.isSecureContext!==false){
    return navigator.clipboard.writeText(text).catch(function(){return fallbackCopy(text);});
  }
  return Promise.resolve(fallbackCopy(text));
}
function fallbackCopy(text){
  var ta=document.createElement('textarea');ta.value=text;ta.setAttribute('readonly','');
  ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();
  try{document.execCommand('copy');}catch(e){}
  document.body.removeChild(ta);
}
function btnBusy(btn,busy,label){
  if(!btn) return;
  if(busy){btn.dataset.label=btn.innerHTML;btn.disabled=true;btn.innerHTML='<span class="spin"></span><span>'+esc(label||'Please wait…')+'</span>';}
  else{btn.disabled=false;if(btn.dataset.label!=null) btn.innerHTML=btn.dataset.label;}
}

var Hero={pause:function(){if(window.VeyraScene)window.VeyraScene.pause();},resume:function(){if(window.VeyraScene)window.VeyraScene.resume();}};

/* =====================================================================
   3. BURGER MENU
   ===================================================================== */
var Burger=(function(){
  var row=$('.navrow'), btn=$('.burger'), menu=$('#site-nav');
  function set(open){
    row.dataset.open=open?'true':'false';
    btn.setAttribute('aria-expanded',open?'true':'false');
    btn.setAttribute('aria-label',open?'Close navigation':'Open navigation');
  }
  set(false);
  btn.addEventListener('click',function(e){e.stopPropagation();set(row.dataset.open!=='true');});
  document.addEventListener('click',function(e){
    if(row.dataset.open==='true'&&!menu.contains(e.target)&&!btn.contains(e.target)) set(false);
  });
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape'&&row.dataset.open==='true'){set(false);btn.focus();}
  });
  menu.addEventListener('click',function(e){if(e.target.closest('a')) set(false);});
  return {set:set};
})();

/* =====================================================================
   4. MODALS
   ===================================================================== */
var Modals={
  stack:[],
  isOpen:function(){return this.stack.length>0;},
  open:function(id){
    var el=document.getElementById(id); if(!el) return;
    if(this.stack.some(function(s){return s.el===el;})) return;
    this.stack.push({el:el,ret:document.activeElement});
    el.hidden=false;
    requestAnimationFrame(function(){el.classList.add('is-open');});
    setTimeout(function(){
      var f=el.querySelector('[data-autofocus]')||el.querySelector('input:not([type=hidden]):not([readonly]):not([type=radio]):not([type=range]),select,textarea');
      if(f&&f.offsetParent!==null) f.focus();
    },80);
  },
  close:function(id){
    var el=id?document.getElementById(id):(this.stack.length?this.stack[this.stack.length-1].el:null);
    if(!el) return;
    var idx=-1;this.stack.forEach(function(s,i){if(s.el===el) idx=i;});
    var entry=idx>-1?this.stack.splice(idx,1)[0]:null;
    el.classList.remove('is-open');
    setTimeout(function(){el.hidden=true;},230);
    if(el.id==='m-register'){Otp.teardown();Otp.password=null;$('#rgPass').value='';}
    if(entry&&entry.ret&&entry.ret.focus&&document.body.contains(entry.ret)) setTimeout(function(){entry.ret.focus();},10);
  }
};
$$('.modal').forEach(function(m){
  m.addEventListener('mousedown',function(e){if(e.target===m) Modals.close(m.id);});
  $$('[data-close]',m).forEach(function(b){b.addEventListener('click',function(){Modals.close(m.id);});});
});
document.addEventListener('keydown',function(e){
  if(e.key!=='Escape') return;
  if(Modals.isOpen()){e.preventDefault();Modals.close();return;}
  if(Drawer.isOpen()){e.preventDefault();Drawer.close();}
});

/* =====================================================================
   5. API + SESSION
   ===================================================================== */
var API_AVAILABLE=/^https?:$/.test(location.protocol);
async function api(path,opts){
  opts=opts||{};
  if(!API_AVAILABLE) return {offline:true};
  var headers={'Accept':'application/json'};
  if(opts.body) headers['Content-Type']='application/json';
  if(opts.auth!==false&&Session.mode==='live'&&Session.token) headers['Authorization']='Bearer '+Session.token;
  var t0=performance.now();
  try{
    var res=await fetch(path,{method:opts.method||'GET',headers:headers,body:opts.body?JSON.stringify(opts.body):undefined,signal:AbortSignal.timeout(15000)});
    var ms=performance.now()-t0;
    var ct=res.headers.get('content-type')||'';
    if(ct.indexOf('application/json')===-1) return {offline:true,status:res.status};
    var data=await res.json();
    return {ok:res.ok,status:res.status,data:data,ms:ms,serverMs:parseFloat(res.headers.get('X-Process-Time-Ms'))||null};
  }catch(err){return {offline:true,error:err};}
}
function apiErr(r){
  var d=r&&r.data&&r.data.detail;
  if(Array.isArray(d)) return d.map(function(x){return x.msg;}).join(' · ');
  return d||'Something went wrong. Please try again.';
}

var Session={
  token:null,mode:null,user:null,remember:false,
  storage:function(){return this.remember?localStorage:sessionStorage;},
  load:function(){
    try{this.remember=!sessionStorage.getItem('veyra_token');var store=this.storage();this.token=store.getItem('veyra_token');this.mode=store.getItem('veyra_mode');this.user=JSON.parse(store.getItem('veyra_user')||'null');}catch(e){}
    return !!(this.token&&this.user);
  },
  start:function(token,mode,user){
    this.remember=mode==='live'&&$('#siRemember').checked;
    try{[localStorage,sessionStorage].forEach(function(store){['veyra_token','veyra_mode','veyra_user'].forEach(function(k){store.removeItem(k);});});}catch(e){}
    this.token=token;this.mode=mode;this.user=user;
    try{var store=this.storage();store.setItem('veyra_token',token);store.setItem('veyra_mode',mode);store.setItem('veyra_user',JSON.stringify(user));}catch(e){}
    updateNavForSession();
  },
  clear:function(){
    this.token=this.mode=this.user=null;
    try{[localStorage,sessionStorage].forEach(function(store){['veyra_token','veyra_mode','veyra_user'].forEach(function(k){store.removeItem(k);});});}catch(e){}
    updateNavForSession();
  }
};
function b64url(obj){return btoa(unescape(encodeURIComponent(JSON.stringify(obj)))).replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');}
function demoJwt(user){
  var now=Math.floor(Date.now()/1000);
  return b64url({alg:'none',typ:'JWT'})+'.'+b64url({sub:'demo',email:user.email,name:user.full_name,iat:now,exp:now+3600,iss:'veyra-demo'})+'.';
}
function updateNavForSession(){
  var a=$('#navSignIn');
  a.textContent=Session.token?'My Ledger':'Sign In';
}

async function setTheme(theme,persist){
  var previous=document.documentElement.dataset.theme||'dark';
  document.documentElement.dataset.theme=theme;
  try{localStorage.setItem('veyra-theme',theme);}catch(e){}
  $$('.theme-toggle').forEach(function(b){b.setAttribute('aria-label',theme==='light'?'Switch to dark mode':'Switch to light mode');});
  if($('#prefTheme'))$('#prefTheme').value=theme;
  if(persist&&Session.user&&!await saveProfileSettings({theme:theme}))setTheme(previous,false);
}
function toggleTheme(){setTheme(document.documentElement.dataset.theme==='light'?'dark':'light',true);}

/* =====================================================================
   6. AUTH FLOWS
   ===================================================================== */
function openSignIn(){
  if(Session.token){App.open();return;}
  $('#siErr').textContent='';
  $('#siCode').value='';$('#siCodeField').hidden=true;
  Modals.open('m-signin');
}
function openRegister(){
  if(Session.token){App.open();return;}
  showRegStep(1);$('#rgErr').textContent='';
  Modals.open('m-register');
}
function showRegStep(n){
  $('#regStep1').hidden=n!==1;
  $('#regStep2').hidden=n!==2;
}
var EMAIL_RE=/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

$('#signinForm').addEventListener('submit',async function(e){
  e.preventDefault();
  var email=$('#siEmail').value.trim().toLowerCase(), pass=$('#siPass').value, err=$('#siErr'), btn=$('#siBtn');
  err.textContent='';
  if(!EMAIL_RE.test(email)){err.textContent='Enter a valid email address.';$('#siEmail').focus();return;}
  if(!pass){err.textContent='Enter your password.';$('#siPass').focus();return;}
  btnBusy(btn,true,'Signing in…');
  var r=await api('/auth/login',{method:'POST',auth:false,body:{email:email,password:pass,code:$('#siCode').value||null}});
  if(r.offline){btnBusy(btn,false);err.textContent='The service is unavailable. Please try again, or explore the demo.';return;}
  if(r.status===428){btnBusy(btn,false);$('#siCodeField').hidden=false;$('#siCode').focus();err.textContent='A 6-digit code was sent to your email. Enter it to finish signing in.';return;}
  if(!r.ok){btnBusy(btn,false);err.textContent=apiErr(r);return;}
  Session.token=r.data.access_token;Session.mode='live';
  var me=await api('/auth/me');
  btnBusy(btn,false);
  if(!me.ok){err.textContent=apiErr(me);Session.token=null;Session.mode=null;return;}
  Session.start(r.data.access_token,'live',me.data);
  Modals.close('m-signin');App.open();
  toast('Welcome back, '+firstName(me.data.full_name)+'.');
});

function openDemo(){
  var user={id:0,email:'demo@veyra.local',full_name:'Alex Morgan',created_at:new Date().toISOString(),settings:{}};
  try{var saved=JSON.parse(localStorage.getItem('veyra-demo-profile')||'null');if(saved)user=saved;}catch(e){}
  Session.start(demoJwt(user),'demo',user);Modals.close('m-signin');Modals.close('m-register');App.open();
  toast('Demo workspace · sample money only.');
}

var Otp={
  email:null,name:null,password:null,currency:'EUR',purpose:'Personal Daily Banking',code:null,mode:null,expires:0,timer:null,resendAt:0,
  teardown:function(){clearInterval(this.timer);this.timer=null;Mail.hide();},
  startTimers:function(){
    var self=this;clearInterval(this.timer);
    function tick(){
      var left=Math.max(0,self.expires-Date.now()), m=Math.floor(left/60000), s=Math.floor(left%60000/1000);
      $('#otpTimer').textContent=left>0?('Code expires in '+m+':'+(s<10?'0':'')+s):'Code expired — request a new one';
      var wait=Math.max(0,Math.ceil((self.resendAt-Date.now())/1000));
      var rb=$('#otpResend');rb.disabled=wait>0;rb.textContent=wait>0?('Resend in '+wait+'s'):'Resend code';
    }
    tick();this.timer=setInterval(tick,1000);
  }
};
async function sendOtp(){
  var r=await api('/auth/otp/send',{method:'POST',auth:false,body:{email:Otp.email}});
  if(r.offline)return 'Email verification is unavailable. Please try again later, or explore the demo.';
  if(!r.ok)return apiErr(r);
  Otp.mode='live';Otp.code=null;Otp.expires=Date.now()+600000;Otp.resendAt=Date.now()+60000;
  return null;
}
$('#regForm').addEventListener('submit',async function(e){
  e.preventDefault();
  var name=$('#rgName').value.trim(), email=$('#rgEmail').value.trim().toLowerCase(), pass=$('#rgPass').value;
  var err=$('#rgErr'), btn=$('#rgBtn');err.textContent='';
  if(name.length<2){err.textContent='Enter your full name.';$('#rgName').focus();return;}
  if(!EMAIL_RE.test(email)){err.textContent='Enter a valid email address.';$('#rgEmail').focus();return;}
  if(pass.length<8){err.textContent='Password must be at least 8 characters.';$('#rgPass').focus();return;}
  Otp.name=name;Otp.email=email;Otp.password=pass;
  Otp.currency=$('#rgCurrency').value;Otp.purpose=$('#rgPurpose').value;
  btnBusy(btn,true,'Sending code…');
  var problem=await sendOtp();
  btnBusy(btn,false);
  if(problem){err.textContent=problem;return;}
  $('#otpEmail').textContent=email;
  clearOtpBoxes();$('#otpErr').textContent='';
  showRegStep(2);
  Otp.startTimers();
  if(Otp.code) setTimeout(function(){Mail.show(Otp.code);},500);
  toast('Verification code sent to '+email);
  setTimeout(function(){otpBoxes[0].focus();},60);
});

var otpBoxes=$$('#otpBoxes input');
function clearOtpBoxes(){otpBoxes.forEach(function(b){b.value='';b.classList.remove('filled');});}
function fillOtp(str,from){
  var d=String(str).replace(/\D/g,'').split('');
  var i=from||0;
  d.forEach(function(ch){if(i<6){otpBoxes[i].value=ch;otpBoxes[i].classList.add('filled');i++;}});
  var next=Math.min(i,5);otpBoxes[next].focus();
  if(otpBoxes.every(function(b){return b.value;})) verifyOtp();
}
otpBoxes.forEach(function(box,idx){
  box.addEventListener('input',function(){
    var v=box.value.replace(/\D/g,'');
    if(v.length>1){box.value='';fillOtp(v,idx);return;}
    box.value=v;box.classList.toggle('filled',!!v);
    $('#otpErr').textContent='';
    if(v&&idx<5) otpBoxes[idx+1].focus();
    if(otpBoxes.every(function(b){return b.value;})) verifyOtp();
  });
  box.addEventListener('keydown',function(e){
    if(e.key==='Backspace'&&!box.value&&idx>0){otpBoxes[idx-1].value='';otpBoxes[idx-1].classList.remove('filled');otpBoxes[idx-1].focus();e.preventDefault();}
    else if(e.key==='ArrowLeft'&&idx>0){otpBoxes[idx-1].focus();e.preventDefault();}
    else if(e.key==='ArrowRight'&&idx<5){otpBoxes[idx+1].focus();e.preventDefault();}
    else if(e.key==='Enter'){verifyOtp();}
  });
  box.addEventListener('focus',function(){box.select();});
  box.addEventListener('paste',function(e){
    e.preventDefault();
    var t=(e.clipboardData||window.clipboardData).getData('text');
    clearOtpBoxes();fillOtp(t,0);
  });
});
var verifying=false;
async function verifyOtp(){
  if(verifying) return;
  var code=otpBoxes.map(function(b){return b.value;}).join(''), err=$('#otpErr'), btn=$('#otpBtn');
  if(code.length<6){err.textContent='Enter all 6 digits.';return;}
  function fail(msg){
    err.textContent=msg;var g=$('#otpBoxes');g.classList.remove('shake');void g.offsetWidth;g.classList.add('shake');
    clearOtpBoxes();otpBoxes[0].focus();
  }
  verifying=true;btnBusy(btn,true,'Verifying…');
  try{
    if(Otp.mode==='live'){
      var r=await api('/auth/otp/verify',{method:'POST',auth:false,body:{email:Otp.email,code:code,password:Otp.password,full_name:Otp.name,primary_currency:Otp.currency,purpose:Otp.purpose}});
      if(r.offline){fail('Lost connection to the ledger. Try again.');return;}
      if(!r.ok){fail(apiErr(r));return;}
      Session.start(r.data.access_token,'live',r.data.user);
    }else{
      if(Date.now()>Otp.expires){fail('This code has expired. Request a new one.');return;}
      if(code!==Otp.code){fail('That code doesn\'t match. Check the email and try again.');return;}
      var user={id:0,email:Otp.email,full_name:Otp.name};
      Session.start(demoJwt(user),'demo',user);
    }
    Otp.password=null;
    Modals.close('m-register');
    App.open();
    toast('Email verified — welcome to Veyra, '+firstName(Session.user.full_name)+'.');
  }finally{verifying=false;btnBusy(btn,false);}
}

var Mail={
  show:function(code){
    var m=$('#mailCard');$('#mailCode').textContent=code;m.hidden=false;
    requestAnimationFrame(function(){m.classList.add('is-on');});
  },
  hide:function(){
    var m=$('#mailCard');if(m.hidden) return;
    m.classList.remove('is-on');setTimeout(function(){m.hidden=true;},320);
  }
};

/* =====================================================================
   7. BANKING STATE
   ===================================================================== */
var RATES={EUR:1,USD:1.0842,TRY:37.18,GBP:0.8436};
function rate(from,to){return RATES[to]/RATES[from];}
function toCur(v,from,to){return v*rate(from,to);}

var DEMO_IBAN={
  EUR:'CH93 0076 2011 6238 5295 7',
  USD:'Account 8310 4471 2094 · ACH routing 026073150',
  TRY:'TR36 0006 7010 0000 0098 7654 32',
  GBP:'GB35 VEYR 0400 0444 9201 94'
};
var RECIPIENTS=[
  {name:'Selin Kaya',iban:'TR700006701000000098123456',bank:'Yapı Kredi'},
  {name:'Emre Vural',iban:'TR660006200000123456789012',bank:'Garanti BBVA'},
  {name:'Zeynep Aksoy',iban:'TR930006400019876543210044',bank:'İş Bankası'},
  {name:'Canberk Aydın',iban:'TR630004600088776655443322',bank:'Akbank'},
  {name:'Lena Hoffmann',iban:'DE89370400440532013000',bank:'Commerzbank'}
];
var TR_BANKS={'00010':'Ziraat Bankası','00012':'Halkbank','00015':'VakıfBank','00032':'TEB','00046':'Akbank','00062':'Garanti BBVA','00064':'İş Bankası','00067':'Yapı Kredi','00111':'QNB','00134':'Denizbank'};
var IBAN_LEN={TR:26,DE:22,CH:21,GB:22,FR:27,NL:18,ES:24,IT:27,BE:16,AT:20,LU:20,IE:22};
var DIRECTORY_NAMES=['Mert Yıldız','Ayşe Demir','Can Öztürk','Elif Şahin','Burak Koç','Deniz Arslan','Ece Kılıç','Kerem Aydın'];

function ago(days,h,m){var d=new Date();d.setDate(d.getDate()-days);d.setHours(h,m,0,0);return d.getTime();}
function defaultState(){
  return {
    v:2,
    wallets:{EUR:450,USD:1250,TRY:42500,GBP:320},
    active:'EUR',
    liveOffset:0,
    card:{frozen:false,online:true,limits:{daily:2500,nfc:50,atm:1000}},
    spaces:[
      {id:'s1',name:'Yaz Tatili',goal:2000,saved:640,cur:'EUR',icon:'sun'},
      {id:'s2',name:'Acil Durum Fonu',goal:5000,saved:1850,cur:'EUR',icon:'shield'}
    ],
    activity:[
      {id:'a1',t:ago(0,9,12),title:'Card Top-Up',sub:'Mastercard •• 9010',cat:'topup',amt:100,cur:'EUR'},
      {id:'a2',t:ago(0,8,41),title:'Blue Bottle Coffee',sub:'Card payment · Berlin',cat:'coffee',amt:-5,cur:'EUR'},
      {id:'a3',t:ago(1,18,20),title:'Transfer to #2',sub:'Selin Kaya · FAST',cat:'transfer',amt:-100,cur:'EUR'},
      {id:'a4',t:ago(1,12,5),title:'Migros',sub:'Groceries · İstanbul',cat:'grocery',amt:-842.5,cur:'TRY'},
      {id:'a5',t:ago(2,16,30),title:'Converted USD to EUR',sub:'$250.00 at 0.9223',cat:'fx',amt:230.58,cur:'EUR'},
      {id:'a6',t:ago(3,9,0),title:'Salary',sub:'Veyra Holdings A.Ş.',cat:'salary',amt:38000,cur:'TRY'},
      {id:'a7',t:ago(4,20,15),title:'Spotify Premium',sub:'Subscription',cat:'sub',amt:-10.99,cur:'GBP'},
      {id:'a8',t:ago(5,13,40),title:'Whole Foods Market',sub:'Groceries · New York',cat:'grocery',amt:-64.2,cur:'USD'}
    ],
    liveLabels:{}
  };
}
var S=defaultState();
var Live={accounts:[],primary:null,entries:[]};
function stateKey(){return 'veyra_state_v2:'+((Session.user&&Session.user.email)||'guest');}
function loadState(){
  try{var raw=localStorage.getItem(stateKey());S=raw?JSON.parse(raw):defaultState();if(!S||S.v!==2) S=defaultState();}
  catch(e){S=defaultState();}
  if(Session.mode==='live'){S.wallets={EUR:0,USD:0,TRY:0,GBP:0};S.spaces=[];S.activity=[];S.liveOffset=0;}
}
function saveState(){try{localStorage.setItem(stateKey(),JSON.stringify(S));}catch(e){}}
function isLive(){return Session.mode==='live'&&!!Live.primary;}
function adjust(cur,delta){
  S.wallets[cur]=Math.round((S.wallets[cur]+delta)*100)/100;
  if(cur==='EUR'&&isLive()) S.liveOffset=Math.round((S.liveOffset+delta)*100)/100;
}
function logActivity(a){
  a.id='l'+Date.now().toString(36)+Math.random().toString(36).slice(2,5);
  a.t=a.t||Date.now();
  S.activity.unshift(a);
  if(S.activity.length>80) S.activity.length=80;
}
function ibanFor(cur){
  var live=Live.accounts.find(function(a){return a.kind==='current'&&a.currency===cur;});
  if(live) return groupIban(live.account_number);
  return Session.mode==='live'?'Account not available':DEMO_IBAN[cur];
}

/* =====================================================================
   8. DASHBOARD RENDERING
   ===================================================================== */
var ICON_FOR={transfer:'i-transfer',coffee:'i-coffee',grocery:'i-cart',salary:'i-salary',topup:'i-topup',fx:'i-swap',space:'i-target',sub:'i-repeat',engine:'i-bolt'};
var SPACE_ICON={sun:'i-sun',shield:'i-shield',home:'i-home',car:'i-car'};
var activityFilter='all', activityLimit=8;

function greeting(){var h=new Date().getHours();return h<5?'Good evening':h<12?'Good morning':h<18?'Good afternoon':'Good evening';}

function renderAll(){
  renderHeader();renderCurrencies();renderBalance();renderCard();renderSpaces();renderActivity();renderInsights();applyPreferences();renderAvatar();
}
function renderHeader(){
  var u=Session.user||{full_name:'Guest',email:''};
  $('#workspaceStatus').textContent=Session.mode==='live'?'Personal workspace · Updated '+new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}):'Demo workspace · Sample money only';
  $('#securitySummary').textContent=(u.settings||{}).two_factor?'Two-step sign-in is enabled. Review your password and session controls anytime.':'Add an email verification code to your sign-in for another layer of protection.';
  $('#uName').textContent=u.full_name;$('#uEmail').textContent=u.email;$('#uAvatar').textContent=initials(u.full_name);
  $('#greetSm').textContent=greeting();$('#greetH').textContent=firstName(u.full_name);
  var live=Session.mode==='live';
  $('#modeChip').classList.toggle('live',live);
  $('#modeText').textContent=live?'Personal account':'Demo workspace';
  $('#modeChip').title=live?'Your personal Veyra workspace':'Sample money · saved on this device';
  var total=0;Object.keys(S.wallets).forEach(function(c){total+=toCur(S.wallets[c],c,S.active);});
  $('#totalCaption').textContent=live?'Available in your '+S.active+' account':'Total across currencies · indicative';
  $('#totalAll').textContent=live?money(S.wallets[S.active],S.active):'≈ '+money(total,S.active);
}
function renderCurrencies(){
  $$('#curRow .cur').forEach(function(b){
    var c=b.dataset.cur;
    b.setAttribute('aria-selected',c===S.active?'true':'false');
    b.tabIndex=c===S.active?0:-1;
    $('[data-bal]',b).textContent=money(S.wallets[c],c);
  });
}
function renderBalance(){
  var c=S.active, v=S.wallets[c], s=money(v,c), dot=s.lastIndexOf('.');
  $('#balLabel').textContent=c+' balance';
  $('#balAmt').innerHTML=esc(s.slice(0,dot))+'<span>'+esc(s.slice(dot))+'</span>';
  var liveEur=isLive();
  $('#balTag').hidden=!liveEur;
  $('#balSub').textContent=liveEur?('Available in your '+c+' account'):(CUR_NAME[c]+' account · available now');
  $('#acctLabel').textContent=(c==='USD'?'Account details':'IBAN')+' · '+c+' account';
  $('#acctIban').textContent=ibanFor(c);
  $('#acctHolder').textContent=(Session.user&&Session.user.full_name)||'—';
  $('#acctId').textContent=isLive()?('VY-'+Live.primary.id):Session.mode==='live'?'Unavailable':'Demo';
  $('#filterCurBtn').textContent=c+' only';
}
function renderCard(){
  var vc=$('#vcard');
  vc.classList.toggle('is-frozen',S.card.frozen);
  $('#cardBal').textContent=money(S.wallets[S.active],S.active);
  $('#cardName').textContent=((Session.user&&Session.user.full_name)||'VEYRA CLIENT').toUpperCase();
  $('#cardIban').textContent=ibanFor('EUR');
  var f=$('#ctlFreeze');f.setAttribute('aria-pressed',S.card.frozen?'true':'false');
  $('#ctlFreezeSt').textContent=S.card.frozen?'Frozen — tap to unfreeze':'Card is active';
  var o=$('#ctlOnline');o.setAttribute('aria-pressed',S.card.online?'true':'false');
  $('#ctlOnlineSt').textContent=S.card.online?'Allowed':'Blocked';
  var flipped=vc.classList.contains('is-flipped');
  $('#ctlDetails').setAttribute('aria-pressed',flipped?'true':'false');
  $('#ctlDetailsSt').textContent=flipped?'Hide details':'Show CVV & expiry';
  $('#vback').setAttribute('aria-hidden',flipped?'false':'true');
  $('#ctlLimitsSt').textContent=money(S.card.limits.daily,'EUR').replace('.00','')+' / day';
}
function renderSpaces(){
  var list=$('#spacesList');
  list.innerHTML=S.spaces.map(function(sp){
    var pct=sp.goal>0?Math.min(100,Math.round(sp.saved/sp.goal*100)):0;
    return '<article class="space">'+
      '<div class="space-top"><span class="space-ic"><svg class="ic"><use href="#'+(SPACE_ICON[sp.icon]||'i-target')+'"/></svg></span>'+
      '<div><b>'+esc(sp.name)+'</b><small>'+pct+'% of '+esc(money(sp.goal,sp.cur))+'</small></div></div>'+
      '<div class="space-amt">'+esc(money(sp.saved,sp.cur))+'</div>'+
      '<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+pct+'" aria-label="'+esc(sp.name)+' progress"><i style="width:'+pct+'%"></i></div>'+
      '<div class="space-btns"><button class="add" type="button" data-action="space-move" data-id="'+sp.id+'" data-dir="add">Add</button>'+
      '<button class="wd" type="button" data-action="space-move" data-id="'+sp.id+'" data-dir="withdraw">Withdraw</button></div>'+
    '</article>';
  }).join('')+
  '<button class="space space-new" type="button" data-action="new-space"><svg class="ic"><use href="#i-plus"/></svg>Create a space</button>';
}
function liveActivity(){
  return Live.entries.map(function(en){
    var debit=String(en.entry_type).toUpperCase()==='DEBIT';
    var label=S.liveLabels[en.transaction_id];
    return {id:'e'+en.id,t:new Date(en.created_at).getTime(),
      title:label||(debit?'Transfer sent':'Money received'),
      sub:'Veyra transfer · settled on ledger',cat:label&&label.indexOf('Engine')===0?'engine':'transfer',
      amt:(debit?-1:1)*en.amount/100,cur:en.currency||S.active,live:true};
  });
}
function dayLabel(t){
  var d=new Date(t), today=new Date();today.setHours(0,0,0,0);
  var diff=Math.round((today-new Date(d.getFullYear(),d.getMonth(),d.getDate()))/86400000);
  if(diff===0) return 'Today';
  if(diff===1) return 'Yesterday';
  return d.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'});
}
function renderActivity(){
  var items=filteredActivity();
  $('#activityCount').textContent=items.length+' transaction'+(items.length===1?'':'s');
  var shown=items.slice(0,activityLimit), html='', lastDay='';
  if(!shown.length) html='<li class="empty">No activity yet in this view.</li>';
  shown.forEach(function(a){
    var day=dayLabel(a.t);
    if(day!==lastDay){html+='<li class="act-day">'+esc(day)+'</li>';lastDay=day;}
    var time=new Date(a.t).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
    html+='<li class="tx"><span class="tx-ic"><svg class="ic"><use href="#'+(ICON_FOR[a.cat]||'i-transfer')+'"/></svg></span>'+
      '<span class="tx-txt"><b>'+esc(a.title)+'</b><small>'+esc(a.sub)+'</small></span>'+
      '<span class="tx-amt"><b class="'+(a.amt>0?'pos':'')+'">'+esc(money(a.amt,a.cur,true))+'</b><small>'+time+(a.live?' · Live':'')+'</small></span></li>';
  });
  $('#activityList').innerHTML=html;
  $('#activityMore').hidden=items.length<=activityLimit;
}
function refresh(){saveState();renderAll();}

/* =====================================================================
   9. APP OPEN / CLOSE + LIVE SYNC
   ===================================================================== */
var App={
  open:function(){
    loadState();
    Live.accounts=[];Live.primary=null;Live.entries=[];
    var prefs=(Session.user&&Session.user.settings)||{};if(prefs.primary_currency)S.active=prefs.primary_currency;if(prefs.theme)setTheme(prefs.theme,false);
    lastInteraction=Date.now();
    var app=$('#app');app.hidden=false;
    document.body.classList.add('app-open');
    Burger.set(false);Mail.hide();Hero.pause();
    renderAll();
    requestAnimationFrame(function(){app.classList.add('is-in');});
    app.scrollTop=0;history.replaceState(null,'','#workspace');
    if(Session.mode==='live') syncLive();
    else{Live.accounts=[];Live.primary=null;Live.entries=[];}
  },
  close:function(){
    var app=$('#app');app.classList.remove('is-in');Drawer.close();
    app.hidden=true;
    document.body.classList.remove('app-open');history.replaceState(null,'',location.pathname);Hero.resume();
  }
};
async function syncLive(){
  if(syncInProgress||Session.mode!=='live')return;syncInProgress=true;var syncToken=Session.token;
  try{
  var me=await api('/auth/me');
  if(me.offline){toast('Ledger API unreachable — showing your last known state.',true);return;}
  if(!me.ok){
    if(me.status===401){Session.clear();App.close();toast('Your session expired. Please sign in again.',true);}
    return;
  }
  if(Session.token!==syncToken)return;
  Session.user=me.data;persistSessionUser();
  var remoteSettings=me.data.settings||{};
  if(typeof remoteSettings.card_frozen==='boolean')S.card.frozen=remoteSettings.card_frozen;
  if(typeof remoteSettings.online_payments==='boolean')S.card.online=remoteSettings.online_payments;
  if(typeof remoteSettings.contactless_limit==='number')S.card.limits.nfc=remoteSettings.contactless_limit/100;
  if(typeof remoteSettings.daily_limit==='number')S.card.limits.daily=remoteSettings.daily_limit/100;
  if(typeof remoteSettings.atm_limit==='number')S.card.limits.atm=remoteSettings.atm_limit/100;
  if(remoteSettings.theme)setTheme(remoteSettings.theme,false);
  var acc=await api('/accounts/me');
  if(Session.token!==syncToken)return;
  if(acc.ok){
    Live.accounts=acc.data||[];
    Live.accounts.filter(function(a){return a.kind==='current';}).forEach(function(a){S.wallets[a.currency]=Math.round(a.balance)/100;});
    S.spaces=Live.accounts.filter(function(a){return a.kind==='space';}).map(function(a){return {id:String(a.id),name:a.owner_name,goal:a.goal/100,saved:a.balance/100,cur:a.currency,icon:'shield',live:true};});
    Live.primary=Live.accounts.find(function(a){return a.kind==='current'&&a.currency===S.active;})||Live.accounts.find(function(a){return a.kind==='current';})||null;
  }
  var statements=await Promise.all(Live.accounts.filter(function(a){return a.kind==='current';}).map(async function(a){var st=await api('/accounts/'+a.id+'/statement');return st.ok?(st.data.entries||[]).map(function(en){return Object.assign({},en,{currency:a.currency});}):null;}));
  if(statements.every(function(entries){return entries!==null;}))Live.entries=statements.flat();else toast('Some activity could not be refreshed. Please try again.',true);
  if(Session.token!==syncToken)return;
  refresh();Engine.paintAccounts();
  }finally{syncInProgress=false;}
}
function signOut(){
  Modals.stack.slice().forEach(function(item){Modals.close(item.el.id);});
  Session.clear();App.close();
  toast('You have been signed out.');
}

/* =====================================================================
   10. CARD CONTROLS + TILT
   ===================================================================== */
async function toggleFreeze(){
  var next=!S.card.frozen;if(!await saveProfileSettings({card_frozen:next}))return;S.card.frozen=next;refresh();toast(next?'Card preview frozen.':'Card preview active.');
}
async function toggleOnline(){
  var next=!S.card.online;if(!await saveProfileSettings({online_payments:next}))return;S.card.online=next;refresh();toast(next?'Online payments preference enabled.':'Online payments preference disabled.');
}
function toggleDetails(){
  var vc=$('#vcard');vc.classList.remove('tilting');vc.style.setProperty('--ry','0deg');vc.style.setProperty('--rx','0deg');
  vc.classList.toggle('is-flipped');renderCard();
}

/* =====================================================================
   11. SEND MONEY (FAST)
   ===================================================================== */
var Send={target:null,timer:null};
function ibanValid(raw){
  var s=raw.replace(/\s+/g,'').toUpperCase();
  if(!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(s)) return false;
  var len=IBAN_LEN[s.slice(0,2)];
  if(len&&s.length!==len) return false;
  if(s.length<15||s.length>34) return false;
  var re=s.slice(4)+s.slice(0,4), rem=0;
  for(var i=0;i<re.length;i++){
    var c=re.charCodeAt(i), v=c>=65?String(c-55):re[i];
    for(var j=0;j<v.length;j++) rem=(rem*10+(+v[j]))%97;
  }
  return rem===1;
}
function hashPick(str,arr){var h=0;for(var i=0;i<str.length;i++) h=(h*31+str.charCodeAt(i))>>>0;return arr[h%arr.length];}
function openSend(prefill){
  $('#sendForm').hidden=false;$('#sendDone').hidden=true;
  $('#sdErr').textContent='';$('#sdAmt').value='';$('#sdRef').value='';
  $('#sdCur').value=S.active;$('#sdTo').value=prefill||'';
  Send.target=null;$('#sdResolve').hidden=true;
  renderRecipients();updateSendAvail();
  Modals.open('m-send');
  if(prefill) resolveRecipient();
}
function renderRecipients(){
  var list=RECIPIENTS.map(function(r){return {key:r.iban,name:r.name,label:firstName(r.name)};});
  if(Session.mode==='live') Live.accounts.slice(1).forEach(function(a){list.unshift({key:String(a.id),name:a.owner_name,label:'#'+a.id});});
  $('#recips').innerHTML=list.map(function(r){
    return '<button type="button" class="recip" data-action="pick-recip" data-key="'+esc(r.key)+'" aria-label="Send to '+esc(r.name)+'"><span>'+esc(initials(r.name))+'</span><small>'+esc(r.label)+'</small></button>';
  }).join('');
}
function updateSendAvail(){
  var c=$('#sdCur').value;$('#sdAvail').textContent=money(S.wallets[c],c);
  var veyra=Send.target&&Send.target.type==='veyra';
  $('#sdNet').textContent=veyra?'Veyra internal · instant':(c==='TRY'?'FAST · instant, 24/7':(c==='EUR'?'SEPA Instant · seconds':c==='GBP'?'Faster Payments · seconds':'Fedwire · same day'));
}
function setResolve(kind,html){
  var el=$('#sdResolve');el.hidden=false;el.className='resolve'+(kind?' '+kind:'');el.innerHTML=html;
}
function resolveRecipient(){
  clearTimeout(Send.timer);Send.target=null;
  var raw=$('#sdTo').value.trim();
  $$('.recip').forEach(function(b){b.classList.toggle('sel',b.dataset.key.replace(/\s/g,'')===raw.replace(/\s/g,'').toUpperCase()||b.dataset.key===raw);});
  if(!raw){$('#sdResolve').hidden=true;updateSendAvail();return;}
  var id=raw.replace(/^#/,'');
  if(/^\d{1,9}$/.test(id)){
    if(Session.mode==='live'){
      setResolve('','<span class="spin"></span><span>Looking up Veyra account #'+esc(id)+'…</span>');
      api('/recipients/resolve?identifier='+encodeURIComponent('VY-'+id)).then(function(r){
        if(!r.ok){setResolve('bad','<svg class="ic"><use href="#i-close"/></svg><span>'+esc(apiErr(r))+'</span>');return;}
        Send.target={type:'veyra',id:r.data.id,name:r.data.owner_name,bank:'Veyra',currency:r.data.currency};
        setResolve('ok','<svg class="ic"><use href="#i-check"/></svg><span><b>'+esc(r.data.owner_name)+'</b> · '+esc(r.data.currency)+' Veyra account</span>');updateSendAvail();
      });return;
    }
    setResolve('','<span class="spin"></span><span>Looking up Veyra account #'+esc(id)+'…</span>');
    Send.timer=setTimeout(function(){
      var own=Live.accounts.find(function(a){return String(a.id)===id;});
      if(own&&Live.primary&&own.id===Live.primary.id){setResolve('bad','<svg class="ic"><use href="#i-close"/></svg><span>That\'s the account you\'re sending from.</span>');return;}
      var name=own?own.owner_name:hashPick('veyra'+id,DIRECTORY_NAMES);
      Send.target={type:'veyra',id:+id,name:name,bank:'Veyra',own:!!own};
      setResolve('ok','<svg class="ic"><use href="#i-check"/></svg><span><b>'+esc(name)+'</b> · Veyra account #'+esc(id)+(own?' (yours)':'')+'</span>');
      updateSendAvail();
    },420);
    return;
  }
  var clean=raw.replace(/\s+/g,'').toUpperCase();
  var len=IBAN_LEN[clean.slice(0,2)]||15;
  if(clean.length<len){setResolve('','<span>Keep typing — '+(len-clean.length)+' characters to go</span>');return;}
  if(!ibanValid(clean)){setResolve('bad','<svg class="ic"><use href="#i-close"/></svg><span>This IBAN doesn\'t look right. Please check it.</span>');return;}
  if(Session.mode==='live'){
    setResolve('','<span class="spin"></span><span>Verifying recipient name…</span>');
    api('/recipients/resolve?identifier='+encodeURIComponent(clean)).then(function(r){
      if(!r.ok){setResolve('bad','<svg class="ic"><use href="#i-close"/></svg><span>'+esc(apiErr(r))+'</span>');return;}
      Send.target={type:'veyra',id:r.data.id,iban:r.data.account_number,name:r.data.owner_name,bank:'Veyra',currency:r.data.currency};
      setResolve('ok','<svg class="ic"><use href="#i-check"/></svg><span><b>'+esc(r.data.owner_name)+'</b> · '+esc(r.data.currency)+' Veyra</span>');updateSendAvail();
    });return;
  }
  setResolve('','<span class="spin"></span><span>Verifying recipient name…</span>');
  Send.timer=setTimeout(function(){
    var known=RECIPIENTS.find(function(r){return r.iban===clean;});
    var bank=known?known.bank:(clean.slice(0,2)==='TR'?(TR_BANKS[clean.slice(4,9)]||'Turkish bank'):clean.slice(0,2)+' bank');
    var name=known?known.name:hashPick(clean,DIRECTORY_NAMES);
    Send.target={type:'iban',iban:clean,name:name,bank:bank};
    setResolve('ok','<svg class="ic"><use href="#i-check"/></svg><span><b>'+esc(name)+'</b> · '+esc(bank)+'</span>');
    updateSendAvail();
  },520);
}
$('#sdTo').addEventListener('input',function(){
  var v=this.value;
  if(/^[a-z]{2}/i.test(v.trim())){
    var pos=this.selectionStart, before=v.slice(0,pos).replace(/\s/g,'').length;
    var g=groupIban(v);this.value=g;
    var p=0,count=0;while(p<g.length&&count<before){if(g[p]!==' ') count++;p++;}
    this.setSelectionRange(p,p);
  }
  resolveRecipient();
});
$('#sdCur').addEventListener('change',updateSendAvail);
$('#sendF').addEventListener('submit',async function(e){
  e.preventDefault();
  var err=$('#sdErr'), btn=$('#sdBtn'), cur=$('#sdCur').value, amt=parseAmt($('#sdAmt').value), ref=$('#sdRef').value.trim();
  err.textContent='';
  if(!Send.target){err.textContent='Add a valid recipient IBAN or Veyra ID.';$('#sdTo').focus();return;}
  if(!(amt>0)){err.textContent='Enter an amount greater than zero.';$('#sdAmt').focus();return;}
  if(amt>S.wallets[cur]){err.textContent='That\'s more than your '+cur+' balance of '+money(S.wallets[cur],cur)+'.';return;}
  if(toCur(amt,cur,'EUR')>10000){err.textContent='Transfers above €10,000 need a compliance review. Contact your private banker.';return;}
  var t=Send.target, title='Transfer to '+t.name, liveTx=null;
  btnBusy(btn,true,'Sending…');
  var liveSource=Live.accounts.find(function(a){return a.kind==='current'&&a.currency===cur;});
  var liveDestination=Live.accounts.find(function(a){return a.id===t.id;})||(t.type==='veyra'?{id:t.id,currency:t.currency}:null);
  if(Session.mode==='live'&&(!liveSource||!liveDestination||liveDestination.currency!==cur||t.type!=='veyra')){btnBusy(btn,false);err.textContent='Choose a Veyra recipient with an account in '+cur+'. External bank transfers are not connected.';return;}
  if(Session.mode==='live'&&liveSource&&liveDestination&&liveDestination.currency===cur&&t.type==='veyra'){
    var key=uuid();
    var r=await api('/transfers',{method:'POST',body:{source_account_id:liveSource.id,destination_account_id:t.id,amount:Math.round(amt*100),idempotency_key:key}});
    if(r.offline){btnBusy(btn,false);err.textContent='The transfer result could not be confirmed. Refresh your activity before retrying.';return;}
    if(!r.ok){btnBusy(btn,false);err.textContent=apiErr(r);return;}
    liveTx=r.data;S.liveLabels[r.data.transaction_id]=title;
    await syncLive();
  }else{
    await sleep(650);
    adjust(cur,-amt);
    logActivity({title:title,sub:(ref?ref+' · ':'')+(t.type==='veyra'?'Veyra transfer':t.bank+' · '+(cur==='TRY'?'FAST':'Bank transfer')),cat:'transfer',amt:-amt,cur:cur});
    refresh();
  }
  btnBusy(btn,false);
  $('#sendForm').hidden=true;
  var done=$('#sendDone');done.hidden=false;
  done.innerHTML='<div class="done"><span class="done-ic"><svg class="ic"><use href="#i-check"/></svg></span>'+
    '<h3>'+esc(money(amt,cur))+' sent</h3><p>'+esc(t.name)+' will see it in their account in seconds.</p>'+
    '<div class="summary"><div><span>To</span><b>'+esc(t.name)+'</b></div>'+
    '<div><span>'+(t.type==='veyra'?'Veyra ID':'IBAN')+'</span><b>'+esc(t.type==='veyra'?'#'+t.id:groupIban(t.iban))+'</b></div>'+
    '<div><span>Reference</span><b>'+esc(liveTx?('TX-'+liveTx.transaction_id+' · ledger'):(ref||'—'))+'</b></div></div>'+
    '<button class="btn-ink lg" type="button" data-close-send>Done</button></div>';
  $('[data-close-send]',done).addEventListener('click',function(){Modals.close('m-send');});
  $('[data-close-send]',done).focus();
});

/* =====================================================================
   12. ADD MONEY (TOP-UP)
   ===================================================================== */
function luhn(num){
  var s=0,alt=false;
  for(var i=num.length-1;i>=0;i--){var n=+num[i];if(alt){n*=2;if(n>9) n-=9;}s+=n;alt=!alt;}
  return s%10===0;
}
function cardBrand(n){
  if(/^4/.test(n)) return 'VISA';
  if(/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(n)) return 'MASTERCARD';
  if(/^9792/.test(n)) return 'TROY';
  if(/^3[47]/.test(n)) return 'AMEX';
  return 'CARD';
}
function openTopup(){
  if(Session.mode==='live'){toast('Card funding is not connected. You can receive transfers from another Veyra ledger account.',true);return;}
  $('#topForm').hidden=false;$('#top3ds').hidden=true;$('#topDone').hidden=true;
  $('#tpErr').textContent='';$('#tpCur').value=S.active;
  if(!$('#tpName').value) $('#tpName').value=(Session.user&&Session.user.full_name)||'';
  paintTopPreview();Modals.open('m-topup');
}
function paintTopPreview(){
  var n=$('#tpNum').value.replace(/\D/g,'');
  $('#tpBrand').textContent=cardBrand(n);
  $('#tpNumPrev').textContent=(n+'••••••••••••••••').slice(0,16).replace(/(.{4})/g,'$1 ').trim();
  $('#tpNamePrev').textContent=($('#tpName').value.trim()||'CARDHOLDER').toUpperCase();
  $('#tpExpPrev').textContent=$('#tpExp').value||'MM/YY';
}
$('#tpNum').addEventListener('input',function(){var d=this.value.replace(/\D/g,'').slice(0,19);this.value=d.replace(/(.{4})/g,'$1 ').trim();paintTopPreview();});
$('#tpName').addEventListener('input',paintTopPreview);
$('#tpExp').addEventListener('input',function(){var d=this.value.replace(/\D/g,'').slice(0,4);this.value=d.length>2?d.slice(0,2)+'/'+d.slice(2):d;paintTopPreview();});
$('#tpCvc').addEventListener('input',function(){this.value=this.value.replace(/\D/g,'').slice(0,4);});
$('#tpChips').addEventListener('click',function(e){var b=e.target.closest('button');if(b){$('#tpAmt').value=b.dataset.v;}});
$('#topF').addEventListener('submit',async function(e){
  e.preventDefault();
  if(Session.mode==='live'){toast('Card funding is not connected.',true);return;}
  var err=$('#tpErr'), n=$('#tpNum').value.replace(/\D/g,''), exp=$('#tpExp').value, cvc=$('#tpCvc').value, cur=$('#tpCur').value, amt=parseAmt($('#tpAmt').value);
  err.textContent='';
  if(n.length<13||!luhn(n)){err.textContent='That card number isn\'t valid.';$('#tpNum').focus();return;}
  var m=/^(\d{2})\/(\d{2})$/.exec(exp);
  if(!m||+m[1]<1||+m[1]>12){err.textContent='Enter the expiry as MM/YY.';$('#tpExp').focus();return;}
  var expDate=new Date(2000+ +m[2],+m[1],0,23,59);
  if(expDate<new Date()){err.textContent='This card has expired.';$('#tpExp').focus();return;}
  if(cvc.length<3){err.textContent='Enter the 3 or 4-digit security code.';$('#tpCvc').focus();return;}
  var minA=cur==='TRY'?100:10, maxA=cur==='TRY'?150000:5000;
  if(!(amt>=minA&&amt<=maxA)){err.textContent='Top-ups must be between '+money(minA,cur)+' and '+money(maxA,cur)+'.';$('#tpAmt').focus();return;}
  $('#topForm').hidden=true;$('#top3ds').hidden=false;
  await sleep(1400);
  adjust(cur,amt);
  var brand=cardBrand(n);
  logActivity({title:'Card Top-Up',sub:(brand==='CARD'?'Card':brand.charAt(0)+brand.slice(1).toLowerCase())+' •• '+n.slice(-4),cat:'topup',amt:amt,cur:cur});
  refresh();
  $('#top3ds').hidden=true;
  var done=$('#topDone');done.hidden=false;
  done.innerHTML='<div class="done"><span class="done-ic"><svg class="ic"><use href="#i-check"/></svg></span>'+
    '<h3>'+esc(money(amt,cur))+' added</h3><p>Your '+cur+' balance is now '+esc(money(S.wallets[cur],cur))+'.</p>'+
    '<button class="btn-ink lg" type="button" data-close-top>Done</button></div>';
  $('[data-close-top]',done).addEventListener('click',function(){Modals.close('m-topup');});
  $('[data-close-top]',done).focus();
  $('#tpCvc').value='';
});

/* =====================================================================
   13. CONVERT
   ===================================================================== */
var liveRates=Object.assign({},RATES),currentQuote=null;
function openConvert(){
  currentQuote=null;
  $('#cvFrom').value=S.active;
  $('#cvTo').value=S.active==='EUR'?'USD':'EUR';
  $('#cvErr').textContent='';
  if(!(parseAmt($('#cvAmt').value)>0)) $('#cvAmt').value='100';
  calcConvert();Modals.open('m-convert');
}
function calcConvert(){
  var from=$('#cvFrom').value, to=$('#cvTo').value, amt=parseAmt($('#cvAmt').value)||0;
  var r=liveRates[to]/liveRates[from], fee=Math.round(amt*0.0015*100)/100, out=Math.max(0,(amt-fee)*r);
  $('#cvAvail').textContent=money(S.wallets[from],from);
  if(Session.mode==='live'){
    if(currentQuote&&(currentQuote.from!==from||currentQuote.to!==to||currentQuote.amount!==Math.round(amt*100)||Date.now()>=currentQuote.expires))currentQuote=null;
    $('#cvRate').textContent=currentQuote?'1 '+from+' = '+currentQuote.rate+' '+to:'Request a reference quote';
    $('#cvFee').textContent=currentQuote?money(currentQuote.fee/100,from):'—';
    $('#cvFeeLabel').textContent='Veyra fee';
    $('#cvOut').value=currentQuote?(currentQuote.received/100).toFixed(2):'';$('#cvOut').placeholder='Quote required';
    $('#cvBtn').textContent=currentQuote?'Confirm exchange':'Review quote';
    $('#cvNote').textContent=currentQuote?'Reference rate dated '+currentQuote.rate_date+'. Confirm within 30 seconds; changing an amount or currency requires a new quote.':'Get a daily reference quote, review the exact amount and fee, then confirm.';
    return {from:from,to:to,amt:amt};
  }
  $('#cvNote').textContent='Demo exchange · illustrative rates and sample money only.';
  $('#cvFeeLabel').textContent='Demo fee (0.15%)';$('#cvBtn').textContent='Convert sample money';
  $('#cvRate').textContent='1 '+from+' = '+r.toFixed(r<0.1?5:4)+' '+to;
  $('#cvFee').textContent=money(fee,from);
  $('#cvOut').value=from===to?'—':out.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  return {from:from,to:to,amt:amt,fee:fee,out:Math.round(out*100)/100,rate:r};
}
['#cvAmt','#cvFrom','#cvTo'].forEach(function(s){$(s).addEventListener('input',calcConvert);$(s).addEventListener('change',calcConvert);});
$('#cvF').addEventListener('submit',async function(e){
  e.preventDefault();
  var c=calcConvert(), err=$('#cvErr');err.textContent='';
  if(c.from===c.to){err.textContent='Pick two different currencies.';return;}
  if(!(c.amt>0)){err.textContent='Enter an amount to convert.';return;}
  if(c.amt>S.wallets[c.from]){err.textContent='You only have '+money(S.wallets[c.from],c.from)+' in '+c.from+'.';return;}
  if(Session.mode==='live'){
    var source=Live.accounts.find(function(a){return a.kind==='current'&&a.currency===c.from;}),destination=Live.accounts.find(function(a){return a.kind==='current'&&a.currency===c.to;});
    if(!source||!destination){err.textContent='Create both settlement accounts before exchanging.';return;}
    var button=$('#cvBtn');if(button.disabled)return;button.disabled=true;
    try{
      if(!currentQuote){
        var quote=await api('/fx/quote',{method:'POST',body:{source_account_id:source.id,destination_account_id:destination.id,amount:Math.round(c.amt*100)}});
        if(!quote.ok){err.textContent=apiErr(quote);return;}
        if($('#cvFrom').value!==c.from||$('#cvTo').value!==c.to||parseAmt($('#cvAmt').value)!==c.amt)return;
        currentQuote=Object.assign({},quote.data,{from:c.from,to:c.to,expires:Date.now()+quote.data.expires_in*1000});calcConvert();return;
      }
      var quoteDate=currentQuote.rate_date;
      var swap=await api('/fx/swap',{method:'POST',body:{quote_id:currentQuote.quote_id}});
      if(!swap.ok){err.textContent=apiErr(swap);currentQuote=null;calcConvert();return;}
      currentQuote=null;await syncLive();Modals.close('m-convert');toast('Exchanged at the '+quoteDate+' reference rate.');return;
    }finally{button.disabled=false;}
  }
  adjust(c.from,-c.amt);adjust(c.to,c.out);
  logActivity({title:'Converted '+c.from+' to '+c.to,sub:'Demo currency exchange',cat:'fx',amt:-c.amt,cur:c.from});
  logActivity({title:'Converted '+c.from+' to '+c.to,sub:money(c.amt,c.from)+' at '+c.rate.toFixed(4),cat:'fx',amt:c.out,cur:c.to});
  refresh();Modals.close('m-convert');
  toast('Converted '+money(c.amt,c.from)+' → '+money(c.out,c.to)+'.');
});

/* =====================================================================
   14. LIMITS
   ===================================================================== */
function openLimits(){
  var L=S.card.limits;
  $('#lmDaily').value=L.daily;$('#lmNfc').value=L.nfc;$('#lmAtm').value=L.atm;
  paintLimits();Modals.open('m-limits');
  setTimeout(function(){$('#lmDaily').focus();},90);
}
function paintLimits(){
  $('#lmDailyO').textContent=money(+$('#lmDaily').value,'EUR').replace('.00','');
  $('#lmNfcO').textContent=money(+$('#lmNfc').value,'EUR').replace('.00','');
  $('#lmAtmO').textContent=money(+$('#lmAtm').value,'EUR').replace('.00','');
}
['#lmDaily','#lmNfc','#lmAtm'].forEach(function(s){$(s).addEventListener('input',paintLimits);});
$('#lmF').addEventListener('submit',async function(e){
  e.preventDefault();
  var limits={daily:+$('#lmDaily').value,nfc:+$('#lmNfc').value,atm:+$('#lmAtm').value};
  if(!await saveProfileSettings({contactless_limit:Math.round(limits.nfc*100),daily_limit:Math.round(limits.daily*100),atm_limit:Math.round(limits.atm*100)})){toast('Unable to save card limits.',true);return;}
  S.card.limits=limits;
  refresh();Modals.close('m-limits');toast('Card limits updated.');
});

/* =====================================================================
   15. SPACES
   ===================================================================== */
var spaceMove={id:null,dir:'add'};
function openNewSpace(){
  $('#snName').value='';$('#snGoal').value='';$('#snCur').value=S.active;$('#snErr').textContent='';
  Modals.open('m-space-new');
}
$('#snF').addEventListener('submit',async function(e){
  e.preventDefault();
  var name=$('#snName').value.trim(), goal=parseAmt($('#snGoal').value), cur=$('#snCur').value, icon=($('input[name=snIcon]:checked')||{}).value||'sun';
  var err=$('#snErr');err.textContent='';
  if(name.length<2){err.textContent='Give your space a name.';$('#snName').focus();return;}
  if(!(goal>0)){err.textContent='Set a goal amount.';$('#snGoal').focus();return;}
  if(Session.mode==='live'){
    var made=await api('/accounts',{method:'POST',body:{owner_name:name,currency:cur,kind:'space',goal:Math.round(goal*100),initial_balance:0}});
    if(!made.ok){err.textContent=apiErr(made);return;}await syncLive();
  }else S.spaces.push({id:'s'+Date.now().toString(36),name:name,goal:goal,saved:0,cur:cur,icon:icon});
  refresh();Modals.close('m-space-new');toast('Space “'+name+'” created.');
});
function openSpaceMove(id,dir){
  var sp=S.spaces.find(function(s){return s.id===id;});if(!sp) return;
  spaceMove.id=id;$('#smErr').textContent='';$('#smAmt').value='';
  $('#smH').textContent=sp.name;$('#smCur').textContent=sp.cur;
  setSpaceDir(dir||'add');Modals.open('m-space-move');
}
function setSpaceDir(dir){
  spaceMove.dir=dir;
  var sp=S.spaces.find(function(s){return s.id===spaceMove.id;});
  $$('#smF .tabs2 button').forEach(function(b){b.setAttribute('aria-pressed',b.dataset.dir===dir?'true':'false');});
  $('#smSub').textContent=money(sp.saved,sp.cur)+' of '+money(sp.goal,sp.cur);
  $('#smAvail').textContent=dir==='add'?('From '+sp.cur+' balance: '+money(S.wallets[sp.cur],sp.cur)):('In this space: '+money(sp.saved,sp.cur));
  $('#smBtn').textContent=dir==='add'?'Add to space':'Move to balance';
}
$$('#smF .tabs2 button').forEach(function(b){b.addEventListener('click',function(){setSpaceDir(b.dataset.dir);});});
$('#smF').addEventListener('submit',async function(e){
  e.preventDefault();
  var sp=S.spaces.find(function(s){return s.id===spaceMove.id;}), amt=parseAmt($('#smAmt').value), err=$('#smErr');
  err.textContent='';
  if(!(amt>0)){err.textContent='Enter an amount.';$('#smAmt').focus();return;}
  if(Session.mode==='live'&&sp.live){
    var currentAccount=Live.accounts.find(function(a){return a.kind==='current'&&a.currency===sp.cur;}),spaceAccount=Live.accounts.find(function(a){return String(a.id)===sp.id;});
    if(!currentAccount||!spaceAccount){err.textContent='The matching settlement account is unavailable.';return;}
    var source=spaceMove.dir==='add'?currentAccount:spaceAccount,destination=spaceMove.dir==='add'?spaceAccount:currentAccount;
    var moved=await api('/transfers',{method:'POST',body:{source_account_id:source.id,destination_account_id:destination.id,amount:Math.round(amt*100),idempotency_key:uuid()}});
    if(!moved.ok){err.textContent=apiErr(moved);return;}await syncLive();Modals.close('m-space-move');toast(money(amt,sp.cur)+' moved.');return;
  }
  if(spaceMove.dir==='add'){
    if(amt>S.wallets[sp.cur]){err.textContent='Not enough in your '+sp.cur+' balance.';return;}
    adjust(sp.cur,-amt);sp.saved=Math.round((sp.saved+amt)*100)/100;
    logActivity({title:'Moved to '+sp.name,sub:'Space',cat:'space',amt:-amt,cur:sp.cur});
  }else{
    if(amt>sp.saved){err.textContent='This space only holds '+money(sp.saved,sp.cur)+'.';return;}
    sp.saved=Math.round((sp.saved-amt)*100)/100;adjust(sp.cur,amt);
    logActivity({title:'From '+sp.name,sub:'Space',cat:'space',amt:amt,cur:sp.cur});
  }
  refresh();Modals.close('m-space-move');
  toast(spaceMove.dir==='add'?(money(amt,sp.cur)+' added to '+sp.name+'.'):(money(amt,sp.cur)+' moved back to your balance.'));
});

/* =====================================================================
   16. ENGINE INSPECTOR (hidden drawer)
   ===================================================================== */
var Drawer={
  isOpen:function(){return !$('#drawer').hidden&&$('#drawer').classList.contains('is-open');},
  open:function(){
    var d=$('#drawer'), s=$('#drawerScrim');
    Drawer.ret=document.activeElement;
    d.hidden=false;s.hidden=false;Engine.paintMode();Engine.paintAccounts();
    requestAnimationFrame(function(){d.classList.add('is-open');s.classList.add('is-open');});
    setTimeout(function(){$('#engRun').focus();},120);
  },
  close:function(){
    var d=$('#drawer'), s=$('#drawerScrim');
    if(d.hidden) return;
    d.classList.remove('is-open');s.classList.remove('is-open');
    setTimeout(function(){d.hidden=true;s.hidden=true;},380);
    if(Drawer.ret&&Drawer.ret.focus) Drawer.ret.focus();
  }
};
$('#drawerScrim').addEventListener('click',Drawer.close);

var Engine={
  running:false,
  sim:{src:{id:101,bal:1000000},dst:{id:202,bal:250000}},
  paintMode:function(){
    var live=Session.mode==='live', el=$('#engMode');
    el.classList.toggle('live',live);
    $('span',el).innerHTML=live
      ?'<b>Live API.</b> Fires real concurrent <b>POST /transfers</b> against your PostgreSQL accounts, then re-reads balances to prove nothing was lost or double-counted.'
      :'<b>Simulation.</b> No backend is connected, so the lock queue is modelled in the browser. Sign in against the running FastAPI server to fire real requests.';
  },
  paintAccounts:function(src,dst){
    if(!src){
      if(Session.mode==='live'&&Live.accounts.length){
        src=Live.accounts[0];dst=Live.accounts[1]||null;
      }else{src=this.sim.src;dst=this.sim.dst;}
    }
    $('#engSrcL').textContent='Source · account #'+src.id;
    $('#engSrc').textContent=money(src.balance!=null?src.balance/100:src.bal/100,'EUR');
    $('#engDstL').textContent=dst?('Pool · account #'+dst.id):'Pool · created on first run';
    $('#engDst').textContent=dst?money(dst.balance!=null?dst.balance/100:dst.bal/100,'EUR'):'—';
  },
  flash:function(){['#engSrc','#engDst'].forEach(function(s){var b=$(s);b.classList.add('flash');setTimeout(function(){b.classList.remove('flash');},260);});},
  log:function(cls,text){
    var el=$('#engLog'), d=document.createElement('div');
    d.className=cls||'';d.textContent=text;el.appendChild(d);el.scrollTop=el.scrollHeight;
  },
  lanes:function(n){
    $('#engLanes').innerHTML=Array.from({length:n},function(_,i){
      return '<li class="lane" id="lane'+i+'"><span class="lane-id">T'+(i+1)+'</span>'+
        '<span class="lane-track"><i class="w" style="width:0"></i><i class="x" style="width:0"></i></span>'+
        '<span class="lane-st"><span>Queued</span><b></b></span></li>';
    }).join('');
  },
  lane:function(i,status,ms,waitPct,execPct,kind){
    var li=$('#lane'+i);if(!li) return;
    var st=$('.lane-st',li);$('span',st).textContent=status;$('b',st).textContent=ms!=null?ms:'';
    var w=$('.lane-track .w',li), x=$('.lane-track i:last-child',li);
    if(waitPct!=null) w.style.width=waitPct+'%';
    if(execPct!=null) x.style.width=execPct+'%';
    if(kind) x.className=kind;
  },
  summary:function(ok,html){var s=$('#engSum');s.hidden=false;s.classList.toggle('fail',!ok);s.innerHTML=html;},
  start:async function(){
    if(this.running) return;
    this.running=true;
    var btn=$('#engRun');btnBusy(btn,true,'Running…');
    $('#engLog').innerHTML='';$('#engSum').hidden=true;
    var dup=$('#engDup').checked;
    try{
      if(Session.mode==='live') await this.runLive(dup);
      else await this.runSim(dup);
    }catch(err){
      this.log('err','Unexpected error: '+(err&&err.message||err));
    }finally{
      this.running=false;btnBusy(btn,false);
    }
  },
  runSim:async function(dup){
    var src=this.sim.src, dst=this.sim.dst, AMT=500;
    var before=src.bal+dst.bal, srcBefore=src.bal;
    var reqs=[];for(var i=0;i<5;i++) reqs.push({i:i,key:uuid(),arrive:Math.random()*2.4});
    if(dup) reqs.push({i:5,key:reqs[0].key,arrive:2.6,dup:true});
    this.lanes(reqs.length);
    this.log('hl','▶ '+reqs.length+' concurrent POST /transfers · €5.00 each · source #'+src.id+' → pool #'+dst.id);
    var order=reqs.slice().sort(function(a,b){return a.arrive-b.arrive;});
    order.forEach(function(r){Engine.log('dim','  T'+(r.i+1)+' arrives at +'+r.arrive.toFixed(2)+' ms · key '+r.key.slice(0,8)+'…');});
    await sleep(320);
    var seen={}, replays=[], work=[];
    order.forEach(function(r){if(seen[r.key]){r.replay=true;replays.push(r);}else{seen[r.key]=true;work.push(r);}});
    var clock=0, results=[], total=0;
    work.forEach(function(r){Engine.lane(r.i,'Waiting for lock',null);});
    for(var k=0;k<work.length;k++){
      var r=work[k];
      var waited=Math.max(0,clock-r.arrive);
      this.log('','  T'+(r.i+1)+' BEGIN · SELECT … FROM accounts WHERE id='+Math.min(src.id,dst.id)+' FOR UPDATE; … id='+Math.max(src.id,dst.id)+' FOR UPDATE');
      if(k===0&&work.length>1) this.log('dim','  '+work.slice(1).map(function(x){return 'T'+(x.i+1);}).join(', ')+' blocked on row lock #'+Math.min(src.id,dst.id)+' (held by T'+(r.i+1)+')');
      this.lane(r.i,'Lock acquired',null);
      await sleep(reduceMotion?60:280);
      var hold=1.4+Math.random()*2.2;
      clock=Math.max(clock,r.arrive)+hold;
      src.bal-=AMT;dst.bal+=AMT;this.paintAccounts(src,dst);this.flash();
      results.push({r:r,wait:waited,hold:hold,total:waited+hold});
      this.log('ok','  T'+(r.i+1)+' UPDATE balances · INSERT DEBIT + CREDIT · COMMIT · held lock '+hold.toFixed(1)+' ms');
      if(k===0&&replays.length){
        replays.forEach(function(rp){
          Engine.log('warn','  T'+(rp.i+1)+' SET NX idempotency:'+rp.key.slice(0,8)+'… → key exists → returns T1\'s cached result, no second debit');
        });
      }
      total=clock;
    }
    var maxT=Math.max.apply(null,results.map(function(x){return x.total;}))||1;
    results.forEach(function(x){Engine.lane(x.r.i,'Committed',x.total.toFixed(1)+' ms',x.wait/maxT*100,x.hold/maxT*100,'x');});
    replays.forEach(function(rp){Engine.lane(rp.i,'Replay · cached',(0.3).toFixed(1)+' ms',0,6,'r');});
    var after=src.bal+dst.bal, moved=srcBefore-src.bal, okSum=after===before&&moved===AMT*work.length;
    this.log(okSum?'ok':'err','■ Conservation check: '+money(before/100,'EUR')+' before = '+money(after/100,'EUR')+' after → '+(okSum?'PASS':'FAIL'));
    this.summary(okSum,'<b>'+work.length+'/'+work.length+' transfers committed</b>, strictly one at a time on the locked rows.'+
      (replays.length?' The replayed key was answered from Redis — <b>no double debit</b>.':'')+
      ' Total moved: <b>'+money(moved/100,'EUR')+'</b>. Zero deadlocks, zero lost updates.');
  },
  runLive:async function(dup){
    var AMT=500;
    this.log('hl','▶ GET /accounts/me');
    var acc=await api('/accounts/me');
    if(!acc.ok){this.log('err','  '+(acc.offline?'Backend unreachable.':apiErr(acc)));this.summary(false,'Couldn\'t load your accounts from the API.');return;}
    var list=acc.data;
    if(!list.length){this.log('err','  You have no ledger account yet.');this.summary(false,'Open an account first (OTP sign-up provisions one automatically).');return;}
    if(list.length<2){
      this.log('','  Only one account found → POST /accounts (Engine Test Pool, €0.00)');
      var mk=await api('/accounts',{method:'POST',body:{owner_name:'Engine Test Pool',initial_balance:0}});
      if(!mk.ok){this.log('err','  '+apiErr(mk));this.summary(false,'Couldn\'t create the pool account.');return;}
      list.push(mk.data);
    }
    var src=list[0], dst=list[1];
    this.paintAccounts(src,dst);
    var n=5;
    if(src.balance<AMT*n){this.log('err','  Source balance too low for 5 × €5.00.');this.summary(false,'Source account #'+src.id+' needs at least €25.00.');return;}
    var before=src.balance+dst.balance, srcBefore=src.balance;
    var keys=[];for(var i=0;i<n;i++) keys.push(uuid());
    var reqs=keys.map(function(k,i){return {i:i,key:k};});
    if(dup) reqs.push({i:n,key:keys[0],dup:true});
    this.lanes(reqs.length);
    this.log('hl','▶ Firing '+reqs.length+' requests in parallel · #'+src.id+' → #'+dst.id+' · €5.00 each');
    var t0=performance.now();
    var res=await Promise.all(reqs.map(function(r){
      Engine.lane(r.i,'In flight',null);
      return api('/transfers',{method:'POST',body:{source_account_id:src.id,destination_account_id:dst.id,amount:AMT,idempotency_key:r.key}})
        .then(function(x){x.req=r;x.at=performance.now()-t0;return x;});
    }));
    var maxMs=Math.max.apply(null,res.map(function(x){return x.ms||0;}))||1;
    var committed={}, replayed=0, rejected=0;
    res.forEach(function(x){
      var r=x.req, tag='T'+(r.i+1), ms=x.ms!=null?Math.round(x.ms)+' ms':'—', srv=x.serverMs!=null?' (server '+x.serverMs.toFixed(1)+' ms)':'';
      if(x.offline){rejected++;Engine.lane(r.i,'Network error','—',0,100,'e');Engine.log('err','  '+tag+' network error');return;}
      if(x.ok){
        var cached=/already processed/i.test(x.data.message||'');
        if(cached||committed[x.data.transaction_id]){replayed++;Engine.lane(r.i,'Replay · cached',ms,0,(x.ms/maxMs)*100,'r');
          Engine.log('warn','  '+tag+' 200 · tx '+x.data.transaction_id+' · '+x.data.message+' · '+ms+srv);}
        else{committed[x.data.transaction_id]=true;S.liveLabels[x.data.transaction_id]='Engine test · parallel transfer';
          Engine.lane(r.i,'Committed',ms,0,(x.ms/maxMs)*100,'x');
          Engine.log('ok','  '+tag+' 200 COMPLETED · tx '+x.data.transaction_id+' · key '+r.key.slice(0,8)+'… · '+ms+srv);}
      }else if(x.status===409&&r.dup){
        replayed++;Engine.lane(r.i,'Replay blocked',ms,0,(x.ms/maxMs)*100,'r');
        Engine.log('warn','  '+tag+' 409 · '+apiErr(x)+' · '+ms);
      }else{
        rejected++;Engine.lane(r.i,'HTTP '+x.status,ms,0,(x.ms/maxMs)*100,'e');
        Engine.log('err','  '+tag+' '+x.status+' · '+apiErr(x)+' · '+ms);
      }
    });
    this.log('hl','▶ GET /accounts/me — re-reading balances');
    var after=await api('/accounts/me');
    if(!after.ok){this.summary(false,'Transfers ran, but balances couldn\'t be re-read.');return;}
    var a=after.data.find(function(z){return z.id===src.id;}), b=after.data.find(function(z){return z.id===dst.id;});
    this.paintAccounts(a,b);this.flash();
    var nCommit=Object.keys(committed).length;
    var sumOk=(a.balance+b.balance)===before, debitOk=(srcBefore-a.balance)===AMT*nCommit;
    var pass=sumOk&&debitOk;
    this.log(pass?'ok':'err','■ Conservation: '+money(before/100,'EUR')+' → '+money((a.balance+b.balance)/100,'EUR')+' · source debited exactly '+nCommit+' × €5.00 → '+(pass?'PASS':'FAIL'));
    this.summary(pass,'<b>'+nCommit+' committed</b>'+(replayed?', <b>'+replayed+' idempotent replay</b> answered without a second debit':'')+
      (rejected?', <b>'+rejected+' rejected</b> (see log — the API rate limit is 10 transfers/min)':'')+
      '. Slowest round-trip '+Math.round(maxMs)+' ms. Ledger totals '+(pass?'match to the cent.':'do not match — investigate.'));
    await syncLive();
  }
};

/* Loaded into the app closure by the source assembly, not as a global script. */
var lastInteraction=Date.now(),syncInProgress=false;
function preferences(){return (Session.user&&Session.user.settings)||{};}
function persistSessionUser(){
  if(!Session.user)return;
  try{Session.storage().setItem('veyra_user',JSON.stringify(Session.user));if(Session.mode==='demo')localStorage.setItem('veyra-demo-profile',JSON.stringify(Session.user));}catch(e){}
}
function allActivity(){return (Session.mode==='live'?liveActivity():S.activity).slice().sort(function(a,b){return b.t-a.t;});}
function filteredActivity(){
  var q=$('#activitySearch').value.trim().toLocaleLowerCase(),direction=$('#activityDirection').value,period=$('#activityPeriod').value;
  var now=new Date(),cutoff=period==='month'?new Date(now.getFullYear(),now.getMonth(),1).getTime():period==='all'?0:Date.now()-Number(period)*86400000;
  return allActivity().filter(function(a){return (activityFilter!=='cur'||a.cur===S.active)&&(!q||[a.title,a.sub,a.cur].join(' ').toLocaleLowerCase().includes(q))&&(direction==='all'||(direction==='in'?a.amt>0:a.amt<0))&&a.t>=cutoff;});
}
function renderInsights(){
  var now=new Date(),month=new Date(now.getFullYear(),now.getMonth(),1).getTime(),incoming=0,outgoing=0;
  allActivity().filter(function(a){return a.cur===S.active&&a.t>=month;}).forEach(function(a){if(a.amt>0)incoming+=a.amt;else outgoing-=a.amt;});
  $('#monthIn').textContent=money(incoming,S.active);$('#monthOut').textContent=money(outgoing,S.active);$('#monthNet').textContent=money(incoming-outgoing,S.active,true);
  $('#insightsPeriod').textContent=now.toLocaleDateString('en-GB',{month:'long',year:'numeric'})+' · '+S.active+' account activity';
  var prefs=preferences(),budget=(prefs.monthly_budget||0)/100,cur=prefs.primary_currency||'EUR',same=cur===S.active;
  var used=same&&budget>0?Math.min(100,Math.round(outgoing/budget*100)):0;
  $('#budgetSummary').textContent=budget?(same?money(outgoing,cur)+' / ':'')+money(budget,cur):'Not set';
  $('#budgetProgress').setAttribute('aria-valuenow',used);$('#budgetBar').style.width=used+'%';
  $('#budgetHelp').textContent=!budget?'Set a monthly budget in Preferences to follow your spending.':!same?'Select your '+cur+' account to track this budget.':outgoing>budget?'You are '+money(outgoing-budget,cur)+' over your monthly budget.':money(budget-outgoing,cur)+' remaining this month. Transfers and exchanges count as account outflows.';
}
function applyPreferences(){
  var p=preferences(),hide=!!p.hide_balances;
  $('#app').classList.toggle('privacy-hidden',hide);$('#app').classList.toggle('compact-activity',!!p.compact_activity);
  $('#privacyButton').setAttribute('aria-pressed',hide?'true':'false');$('#privacyButton').setAttribute('aria-label',hide?'Show balances':'Hide balances');$('#privacyButton span').textContent=hide?'Show balances':'Hide balances';
}
function renderAvatar(){
  var u=Session.user;if(!u)return;var avatar=preferences().avatar||'slate';
  ['#uAvatar','#profilePreview'].forEach(function(selector){var el=$(selector);el.textContent='';if(/^data:image\/(png|jpeg|webp);base64,/.test(avatar)){var img=document.createElement('img');img.src=avatar;img.alt='';el.appendChild(img);}else el.textContent=avatar==='sage'?'V':initials(u.full_name);});
  $('#profileDisplayName').textContent=u.full_name;$('#profileDisplayEmail').textContent=u.email;
}
async function saveProfileSettings(extra){
  if(Session.mode!=='live'){
    var clean=Object.assign({},extra);delete clean.password;delete clean.code;
    Session.user.settings=Object.assign({},preferences(),clean);persistSessionUser();applyPreferences();renderAvatar();return true;
  }
  var r=await api('/auth/settings',{method:'PATCH',body:extra});
  if(r.status===428){$('#profileCodeField').hidden=false;$('#profileErr').textContent=apiErr(r);$('#profileCode').focus();return false;}
  if(!r.ok){var message=r.offline?'The service is unavailable. Please try again.':apiErr(r);$('#profileErr').textContent=message;$('#preferencesErr').textContent=message;toast(message,true);return false;}
  Session.user.settings=r.data;persistSessionUser();applyPreferences();renderAvatar();return true;
}
function settingsTab(tab){
  $$('[data-settings-tab]').forEach(function(b){var on=b.dataset.settingsTab===tab;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;$('#pane-'+b.dataset.settingsTab).hidden=!on;});
}
function openProfile(tab){
  var p=preferences(),u=Session.user;$('#profileName').value=u.full_name;$('#profileEmail').value=u.email;
  $('#profileEmail').previousElementSibling.textContent=Session.mode==='demo'?'Email address · demo account':'Email address · account identifier';
  $('#profile2fa').checked=!!p.two_factor;$('#profilePass').value='';$('#profileCode').value='';$('#profileCodeField').hidden=true;$('#profileErr').textContent='';$('#personalErr').textContent='';$('#preferencesErr').textContent='';$('#passwordErr').textContent='';
  $('#prefTheme').value=document.documentElement.dataset.theme||'dark';$('#prefCurrency').value=p.primary_currency||S.active;$('#prefHide').checked=!!p.hide_balances;$('#prefCompact').checked=!!p.compact_activity;$('#prefIdle').value=p.idle_timeout||15;$('#prefBudget').value=((p.monthly_budget||0)/100).toFixed(2);$('#budgetLabel').textContent='Monthly budget · '+$('#prefCurrency').value;
  $('#profileMember').textContent=Session.mode==='demo'?'Demo profile · changes are saved on this device.':u.created_at?'Member since '+new Date(u.created_at).toLocaleDateString('en-GB',{month:'long',year:'numeric'}):'Your personal Veyra account.';
  $('#sessionInfo').textContent=(Session.mode==='demo'?'Demo session':'Authenticated session')+' · '+(Session.remember?'Remembered on this device':'This browser session')+' · idle lock '+(p.idle_timeout||15)+' min';
  $('#profileAvatar').value='';$('#passwordF').reset();renderAvatar();settingsTab(tab||'personal');Modals.open('m-profile');
}
$$('[data-settings-tab]').forEach(function(b){b.addEventListener('click',function(){settingsTab(b.dataset.settingsTab);});});
$('.settings-tabs').addEventListener('keydown',function(e){if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;var tabs=$$('[data-settings-tab]'),i=tabs.indexOf(document.activeElement);if(i<0)return;i=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;settingsTab(tabs[i].dataset.settingsTab);tabs[i].focus();e.preventDefault();});
$('#personalF').addEventListener('submit',async function(e){
  e.preventDefault();var name=$('#profileName').value.trim(),err=$('#personalErr'),btn=$('#personalSave');err.textContent='';if(name.length<2){err.textContent='Enter at least two characters.';return;}
  btnBusy(btn,true,'Saving…');
  if(Session.mode==='live'){var r=await api('/auth/profile',{method:'PATCH',body:{full_name:name}});if(!r.ok){err.textContent=apiErr(r);btnBusy(btn,false);return;}Session.user=r.data;}else Session.user.full_name=name;
  persistSessionUser();renderAll();btnBusy(btn,false);toast('Your profile has been updated.');
});
$('#preferencesF').addEventListener('submit',async function(e){
  e.preventDefault();var btn=$('#preferencesSave'),err=$('#preferencesErr'),budget=Number($('#prefBudget').value);err.textContent='';if(!Number.isFinite(budget)||budget<0||budget>1000000){err.textContent='Enter a budget between 0 and 1,000,000.';return;}
  var p={theme:$('#prefTheme').value,primary_currency:$('#prefCurrency').value,hide_balances:$('#prefHide').checked,compact_activity:$('#prefCompact').checked,idle_timeout:Number($('#prefIdle').value),monthly_budget:Math.round(budget*100)};
  btnBusy(btn,true,'Saving…');var ok=await saveProfileSettings(p);btnBusy(btn,false);if(ok){setTheme(p.theme,false);S.active=p.primary_currency;refresh();toast('Your preferences have been saved.');}
});
$('#prefCurrency').addEventListener('change',function(){$('#budgetLabel').textContent='Monthly budget · '+this.value;});
$('#profileF').addEventListener('submit',async function(e){
  e.preventDefault();var btn=$('#profileSave'),changed=$('#profile2fa').checked!==!!preferences().two_factor;$('#profileErr').textContent='';
  if(!changed){toast('Your security settings are already up to date.');return;}
  var payload={two_factor:$('#profile2fa').checked};
  if(Session.mode==='live'){if($('#profilePass').value.length<8){$('#profileErr').textContent='Confirm your current password to continue.';return;}payload.password=$('#profilePass').value;payload.code=$('#profileCode').value||null;}
  btnBusy(btn,true,'Saving…');var ok=await saveProfileSettings(payload);btnBusy(btn,false);if(ok){$('#profilePass').value='';$('#profileCode').value='';$('#profileCodeField').hidden=true;renderAll();toast(Session.mode==='demo'?'Two-step sign-in preference saved for this demo.':'Your sign-in security has been updated.');}
});
$('#profileAvatar').addEventListener('change',function(){
  var file=this.files&&this.files[0];if(!file)return;var err=$('#personalErr');err.textContent='';
  if(!/^image\/(png|jpeg|webp)$/.test(file.type)||file.size>200000){err.textContent='Choose a PNG, JPEG or WebP image up to 200 KB.';this.value='';return;}
  var reader=new FileReader();reader.onload=async function(){if(await saveProfileSettings({avatar:reader.result}))toast('Your profile photo has been saved.');};reader.readAsDataURL(file);
});
$('#avatarPresets').addEventListener('click',async function(e){var b=e.target.closest('[data-avatar]');if(b&&await saveProfileSettings({avatar:b.dataset.avatar}))toast('Your profile appearance has been saved.');});
$('#passwordF').addEventListener('submit',async function(e){
  e.preventDefault();var err=$('#passwordErr'),old=$('#pwCurrent').value,next=$('#pwNew').value,btn=$('#passwordSave');err.textContent='';
  if(next.length<8){err.textContent='Use at least 8 characters.';return;}if(next!==$('#pwConfirm').value){err.textContent='Your new passwords do not match.';return;}if(next===old){err.textContent='Choose a different password.';return;}
  if(Session.mode!=='live'){err.textContent='Demo accounts have no password. Use a personal account to change your sign-in details.';return;}
  btnBusy(btn,true,'Updating…');var r=await api('/auth/password',{method:'POST',body:{current_password:old,new_password:next}});btnBusy(btn,false);
  if(!r.ok){err.textContent=apiErr(r);return;}Session.token=r.data.access_token;try{Session.storage().setItem('veyra_token',Session.token);}catch(e){}this.reset();toast('Password updated. All other sessions have been signed out.');
});
async function togglePrivacy(){if(await saveProfileSettings({hide_balances:!preferences().hide_balances}))applyPreferences();}
['#activitySearch','#activityDirection','#activityPeriod'].forEach(function(sel){$(sel).addEventListener(sel==='#activitySearch'?'input':'change',function(){activityLimit=8;renderActivity();});});
function exportActivity(){
  var rows=filteredActivity();if(!rows.length){toast('No transactions match these filters.');return;}
  function cell(v){var text=String(v==null?'':v);if(/^[=+@\-\t\r]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';}
  var csv='Date,Description,Details,Currency,Amount,Direction\r\n'+rows.map(function(a){return [new Date(a.t).toISOString(),a.title,a.sub,a.cur].map(cell).concat([a.amt.toFixed(2),a.amt>0?'In':'Out']).join(',');}).join('\r\n');
  var url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='veyra-activity-'+new Date().toISOString().slice(0,10)+'.csv';a.click();setTimeout(function(){URL.revokeObjectURL(url);},1000);toast('Your filtered activity has been exported.');
}
function openReset(){Modals.close('m-signin');$('#resetRequestF').hidden=false;$('#resetF').hidden=true;$('#resetEmail').value=$('#siEmail').value.trim();$('#resetErr').textContent='';$('#resetF').reset();Modals.open('m-reset');}
$('#resetRequestF').addEventListener('submit',async function(e){
  e.preventDefault();var btn=$('#resetRequestBtn'),err=$('#resetErr');err.textContent='';btnBusy(btn,true,'Requesting…');var r=await api('/auth/password/reset/request',{method:'POST',auth:false,body:{email:$('#resetEmail').value.trim().toLowerCase()}});btnBusy(btn,false);
  if(!r.ok){err.textContent=r.offline?'The service is unavailable. Please try again.':apiErr(r);return;}$('#resetNotice').textContent=r.data.message;$('#resetRequestF').hidden=true;$('#resetF').hidden=false;$('#resetCode').focus();
});
$('#resetF').addEventListener('submit',async function(e){
  e.preventDefault();var err=$('#resetErr'),btn=$('#resetBtn');err.textContent='';if($('#resetPassword').value!==$('#resetConfirm').value){err.textContent='Your new passwords do not match.';return;}btnBusy(btn,true,'Updating…');var r=await api('/auth/password/reset',{method:'POST',auth:false,body:{email:$('#resetEmail').value.trim().toLowerCase(),code:$('#resetCode').value,new_password:$('#resetPassword').value}});btnBusy(btn,false);
  if(!r.ok){err.textContent=apiErr(r);return;}this.reset();Modals.close('m-reset');openSignIn();toast('Password reset. Sign in with your new password.');
});
$('#rgPass').addEventListener('input',function(){var value=this.value,score=0;if(value.length>=8)score++;if(value.length>=12)score++;if(/[a-z]/.test(value)&&/[A-Z]/.test(value))score++;if(/\d/.test(value)&&/[^a-zA-Z0-9]/.test(value))score++;$('#strengthBar').style.width=Math.min(100,score*25)+'%';$('#strengthLabel').textContent=value.length<8?'Use at least 8 characters.':score<3?'Good start. Add length and a mix of characters.':'Strong password. Keep it unique to Veyra.';});
// Inactivity is shared across tabs, so an active tab keeps the session alive.
var lastSharedWrite=0;
function markInteraction(){lastInteraction=Date.now();if(Session.token&&lastInteraction-lastSharedWrite>5000){try{localStorage.setItem('veyra-last-active',String(lastInteraction));}catch(e){}lastSharedWrite=lastInteraction;}}
['pointerdown','keydown','scroll'].forEach(function(event){document.addEventListener(event,markInteraction,{passive:true,capture:true});});
window.addEventListener('storage',function(e){
  if(e.key==='veyra-last-active')lastInteraction=Math.max(lastInteraction,Number(e.newValue)||0);
  if(e.key==='veyra_token'&&Session.remember&&Session.token&&e.newValue!==Session.token){Session.token=Session.mode=Session.user=null;updateNavForSession();Modals.stack.slice().forEach(function(item){Modals.close(item.el.id);});App.close();toast('This device session changed in another tab. Please sign in again.');}
});
setInterval(function(){if(Session.token&&!$('#app').hidden&&Date.now()-lastInteraction>(preferences().idle_timeout||15)*60000){signOut();toast('Your workspace was locked after inactivity. Sign in to continue.');}},10000);
// Keep keyboard focus in the visible modal and hide the underlying work surface.
document.addEventListener('keydown',function(e){if(e.key!=='Tab'||!Modals.stack.length)return;var modal=Modals.stack[Modals.stack.length-1].el;var focusable=$$('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),[tabindex="0"]',modal).filter(function(el){return el.getClientRects().length>0;});if(!focusable.length)return;var first=focusable[0],last=focusable[focusable.length-1];if(e.shiftKey&&(document.activeElement===first||!modal.contains(document.activeElement))){last.focus();e.preventDefault();}else if(!e.shiftKey&&(document.activeElement===last||!modal.contains(document.activeElement))){first.focus();e.preventDefault();}});


/* =====================================================================
   17. GLOBAL ACTION DELEGATION
   ===================================================================== */
document.addEventListener('click',function(e){
  var el=e.target.closest('[data-action]');if(!el) return;
  var a=el.dataset.action;
  if(el.tagName==='A') e.preventDefault();
  switch(a){
    case 'home':
      Modals.stack.slice().forEach(function(item){Modals.close(item.el.id);});
      App.close();window.scrollTo({top:0,left:0,behavior:'instant'});$('.landing .logo').focus({preventScroll:true});break;
    case 'treasury':
      if(Session.token) App.open(); else {openSignIn();toast('Sign in to access your treasury.');}
      break;
    case 'signin': openSignIn();break;
    case 'register': openRegister();break;
    case 'theme': toggleTheme();break;
    case 'profile': openProfile('personal');break;
    case 'settings': openProfile('preferences');break;
    case 'security': openProfile('security');break;
    case 'budget-settings': openProfile('preferences');$('#prefBudget').focus();break;
    case 'privacy': togglePrivacy();break;
    case 'export-csv': exportActivity();break;
    case 'refresh-data': if(Session.mode==='live')syncLive();else{renderAll();toast('Your demo workspace is up to date.');}break;
    case 'password-visibility': var input=document.getElementById(el.dataset.target);input.type=input.type==='password'?'text':'password';el.textContent=input.type==='password'?'Show':'Hide';el.setAttribute('aria-pressed',input.type==='text'?'true':'false');break;
    case 'to-register': Modals.close('m-signin');setTimeout(openRegister,120);break;
    case 'to-signin': Modals.close('m-register');setTimeout(openSignIn,120);break;
    case 'forgot': openReset();break;
    case 'reset-again': $('#resetF').hidden=true;$('#resetRequestF').hidden=false;$('#resetErr').textContent='';break;
    case 'demo': openDemo();break;
    case 'resend':
      (async function(){el.disabled=true;var p=await sendOtp();if(p){$('#otpErr').textContent=p;return;}
        clearOtpBoxes();Otp.startTimers();if(Otp.code) Mail.show(Otp.code);toast('A new code is on its way.');otpBoxes[0].focus();})();
      break;
    case 'verify-otp': verifyOtp();break;
    case 'change-email': Otp.teardown();showRegStep(1);setTimeout(function(){$('#rgEmail').focus();},50);break;
    case 'mail-close': Mail.hide();break;
    case 'mail-copy':
      copyText($('#mailCode').textContent).then(function(){
        var s=$('span',el);s.textContent='Copied';setTimeout(function(){s.textContent='Copy Code';},1600);
        toast('Code copied — paste it into the boxes.');
      });
      break;
    case 'signout': signOut();break;
    case 'revoke-sessions':
      (async function(){el.disabled=true;if(Session.mode==='live'){var r=await api('/auth/sessions/revoke',{method:'POST',body:{}});if(!r.ok){toast(apiErr(r),true);el.disabled=false;return;}}el.disabled=false;signOut();toast('All sessions have been closed.');})();
      break;
    case 'send': openSend();break;
    case 'send-max': $('#sdAmt').value=S.wallets[$('#sdCur').value].toFixed(2);break;
    case 'pick-recip': $('#sdTo').value=/^\d+$/.test(el.dataset.key)?el.dataset.key:groupIban(el.dataset.key);resolveRecipient();$('#sdAmt').focus();break;
    case 'topup': openTopup();break;
    case 'convert': openConvert();break;
    case 'cv-max': $('#cvAmt').value=S.wallets[$('#cvFrom').value].toFixed(2);calcConvert();break;
    case 'cv-swap': var f=$('#cvFrom').value;$('#cvFrom').value=$('#cvTo').value;$('#cvTo').value=f;calcConvert();break;
    case 'goto-spaces': $('#d-spaces').scrollIntoView({behavior:reduceMotion?'auto':'smooth',block:'start'});break;
    case 'new-space': openNewSpace();break;
    case 'space-move': openSpaceMove(el.dataset.id,el.dataset.dir);break;
    case 'freeze': toggleFreeze();break;
    case 'online': toggleOnline();break;
    case 'details': toggleDetails();break;
    case 'limits': openLimits();break;
    case 'copy':
      var src=document.getElementById(el.dataset.copy);
      copyText(src.textContent.trim()).then(function(){toast('Copied to clipboard.');});
      break;
    case 'engine': Drawer.open();break;
    case 'close-drawer': Drawer.close();break;
    case 'engine-run': Engine.start();break;
  }
});

/* currency tabs (click + arrow keys) */
$('#curRow').addEventListener('click',function(e){
  var b=e.target.closest('.cur');if(!b) return;
  S.active=b.dataset.cur;
  Live.primary=Live.accounts.find(function(a){return a.kind==='current'&&a.currency===S.active;})||Live.primary;
  refresh();if(Session.mode==='live') syncLive();
});
$('#curRow').addEventListener('keydown',function(e){
  if(e.key!=='ArrowRight'&&e.key!=='ArrowLeft') return;
  var tabs=$$('#curRow .cur'), i=tabs.findIndex(function(t){return t.dataset.cur===S.active;});
  i=(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
  S.active=tabs[i].dataset.cur;Live.primary=Live.accounts.find(function(a){return a.kind==='current'&&a.currency===S.active;})||Live.primary;refresh();if(Session.mode==='live') syncLive();tabs[i].focus();e.preventDefault();
});
$$('.seg button').forEach(function(b){
  b.addEventListener('click',function(){
    activityFilter=b.dataset.filter;activityLimit=8;
    $$('.seg button').forEach(function(x){x.setAttribute('aria-pressed',x===b?'true':'false');});
    renderActivity();
  });
});
$('#activityMore').addEventListener('click',function(){activityLimit+=10;renderActivity();});
$$('.dnav a').forEach(function(a){
  a.addEventListener('click',function(e){
    e.preventDefault();
    if(a.hasAttribute('data-action'))return;
    var t=document.querySelector(a.getAttribute('href'));
    if(t) t.scrollIntoView({behavior:reduceMotion?'auto':'smooth',block:'start'});
    $$('.dnav a').forEach(function(x){if(x===a) x.setAttribute('aria-current','page'); else x.removeAttribute('aria-current');});
  });
});

/* =====================================================================
   18. BOOT
   ===================================================================== */
setTheme(document.documentElement.dataset.theme||'dark',false);
if(Session.load()){
  updateNavForSession();
  if(Session.mode==='live'){
    api('/auth/me').then(function(r){
      if(r.ok){Session.user=r.data;persistSessionUser();if(location.hash==='#workspace')App.open();}
      else if(r.status===401){Session.clear();}
      else toast('Your session could not be verified. Please try signing in again.',true);
    });
  }else if(location.hash==='#workspace')App.open();
}else updateNavForSession();

})();
