const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM,VirtualConsole}=require('jsdom');

function phone(options={}) {
  const errors=[],requests=[];
  const console=new VirtualConsole(); console.on('jsdomError',e=>errors.push(e));
  const dom=new JSDOM(fs.readFileSync('app/static/index.html','utf8'),{
    url:options.url||'http://localhost:8000/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:console
  });
  const w=dom.window;
  const media={matches:options.phone!==false,addEventListener(event,fn){this.changed=fn;}};
  w.matchMedia=query=>query==='(max-width: 600px)'?media:{matches:true};
  w.HTMLElement.prototype.scrollIntoView=function(){};
  w.HTMLElement.prototype.scrollTo=function(){};
  w.scrollTo=function(){};
  w.AbortSignal.timeout=()=>undefined;
  const viewport=new w.EventTarget(); viewport.height=844; viewport.offsetTop=0;
  Object.defineProperty(w,'visualViewport',{value:viewport});
  Object.defineProperty(w,'innerHeight',{value:844});
  w.fetch=async(path,opts)=>{
    requests.push({path,body:opts.body?JSON.parse(opts.body):null});
    const result=options.fetch?await options.fetch(path,opts):{status:503,data:{detail:'Unavailable'}};
    return {ok:result.status>=200&&result.status<300,status:result.status,headers:new Map([['content-type','application/json']]),json:async()=>result.data};
  };
  ['app','select-controls','mobile'].forEach(name=>w.eval(fs.readFileSync(`app/static/${name}.js`,'utf8')));
  const $=selector=>w.document.querySelector(selector);
  const click=selector=>$(selector).click();
  const input=(selector,value)=>{$(selector).value=value;$(selector).dispatchEvent(new w.Event('input',{bubbles:true}));};
  const submit=()=>$('#signinForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  return {dom,w,$,click,input,submit,errors,requests,media,viewport};
}
const flush=()=>new Promise(resolve=>setTimeout(resolve,35));

test('mobile dock switches existing sections, restores the selected view after profile, and resets after sign-out',async()=>{
  const x=phone();try{
    x.click('.hero [data-action="demo"]');await flush();
    assert.equal(x.$('#app').dataset.mobileView,'home');
    assert.equal(x.$('#balAmt').textContent,'€0.00');
    x.click('.mobile-dock [data-mobile-view="card"]');
    assert.equal(x.$('#app').dataset.mobileView,'card');
    assert.equal(x.w.document.activeElement.id,'d-card');
    assert.equal(x.$('.mobile-dock [aria-current]').textContent.trim(),'Cards');
    x.click('.mobile-dock [data-mobile-profile]');await flush();
    assert.equal(x.$('#m-profile').hidden,false);
    assert.ok(x.$('.mobile-dock [aria-current]').hasAttribute('data-mobile-profile'));
    x.click('#m-profile [data-close]');await flush();
    assert.equal(x.$('.mobile-dock [aria-current]').dataset.mobileView,'card');
    x.click('.mobile-dock [data-mobile-view="activity"]');
    assert.equal(x.w.document.activeElement.id,'d-activity');
    assert.equal(x.w.document.querySelectorAll('#balAmt').length,1);
    x.click('[data-action="signout"]');await flush();
    x.click('.hero [data-action="demo"]');await flush();
    assert.equal(x.$('#app').dataset.mobileView,'home');
    assert.equal(x.errors.length,0);
  }finally{x.dom.window.close();}
});

test('mobile validation blocks incomplete credentials and gives described format errors without an API request',async()=>{
  const x=phone();try{
    x.click('#navSignIn');x.input('#siEmail','invalid');x.submit();
    assert.equal(x.$('#siEmail').getAttribute('aria-invalid'),'true');
    assert.equal(x.$('#siEmail').getAttribute('aria-describedby'),'siEmail-mobile-status');
    assert.equal(x.w.document.activeElement.id,'siEmail');
    assert.equal(x.requests.length,0);
    x.input('#siEmail','person@example.com');x.input('#siPass','Password123');
    assert.equal(x.$('#siEmail').getAttribute('aria-invalid'),'false');
    assert.match(x.$('#siEmail-mobile-status').textContent,/format/);
    x.submit();await flush();
    assert.equal(x.requests[0].path,'/auth/login');
    assert.deepEqual(x.requests[0].body,{email:'person@example.com',password:'Password123',code:null});
    assert.match(x.$('#siErr').textContent,/Unavailable/);
    assert.equal(x.w.sessionStorage.getItem('veyra_token'),null);
    assert.equal(x.$('#siBtn').disabled,false);
    assert.equal(x.errors.length,0);
  }finally{x.dom.window.close();}
});

test('mobile sign-in retains loading, email OTP and authenticated workspace requests',async()=>{
  let release;
  const user={id:8,full_name:'Mobile User',email:'person@example.com',settings:{}};
  const x=phone({fetch:async(path,opts)=>{
    if(path==='/auth/login'){
      const body=JSON.parse(opts.body);
      if(!body.code){await new Promise(resolve=>release=resolve);return {status:428,data:{detail:'Email verification required'}};}
      return {status:200,data:{access_token:'mobile-fixture'}};
    }
    if(path==='/auth/me')return {status:200,data:user};
    if(path==='/workspace')return {status:200,data:{user,accounts:[{id:11,kind:'current',currency:'EUR',balance:12345,account_number:'DE111'}],entries:[],recipients:[]}};
    return {status:200,data:{}};
  }});
  try{
    x.click('#navSignIn');x.input('#siEmail',' Person@Example.com ');x.input('#siPass','Password123');x.submit();
    assert.equal(x.$('#siBtn').disabled,true);
    assert.ok(x.$('#siBtn .spin'));
    release();await flush();
    assert.equal(x.$('#siCodeField').hidden,false);
    assert.match(x.$('#siBtn').textContent,/Verify/);
    x.input('#siCode','12');x.submit();
    assert.equal(x.requests.filter(r=>r.path==='/auth/login').length,1);
    assert.equal(x.w.document.activeElement.id,'siCode');
    x.input('#siCode','123456');x.submit();await flush();
    assert.equal(x.$('#app').hidden,false);
    assert.equal(x.$('#balAmt').textContent,'€123.45');
    assert.equal(x.w.sessionStorage.getItem('veyra_token'),'mobile-fixture');
    assert.ok(x.requests.some(r=>r.path==='/workspace'));
    assert.equal(x.errors.length,0);
  }finally{x.dom.window.close();}
});

test('password visibility is reset when mobile sign-in closes and no extra credentials are stored',async()=>{
  const x=phone();try{
    x.click('#navSignIn');await flush();x.input('#siPass','TemporarySecret');x.click('[data-target="siPass"]');
    assert.equal(x.$('#siPass').type,'text');
    x.click('#m-signin [data-close]');await flush();
    assert.equal(x.$('#siPass').type,'password');
    assert.equal(x.$('#siPass').value,'');
    assert.equal(x.$('[data-target="siPass"]').getAttribute('aria-pressed'),'false');
    assert.equal(x.$('#siPass-mobile-status').textContent,'');
    assert.equal(x.w.localStorage.getItem('password'),null);
  }finally{x.dom.window.close();}
});

test('avatar reflects the existing renderer and keyboard viewport changes remain presentation-only',async()=>{
  const x=phone();try{
    x.click('.hero [data-action="demo"]');await flush();
    assert.equal(x.$('.mobile-profile .avatar').textContent,x.$('#uAvatar').textContent);
    x.$('#uAvatar').textContent='XY';await flush();
    assert.equal(x.$('.mobile-profile .avatar').textContent,'XY');
    x.$('#activitySearch').focus();x.viewport.height=450;x.viewport.offsetTop=15;
    x.viewport.dispatchEvent(new x.w.Event('resize'));
    assert.equal(x.w.document.documentElement.style.getPropertyValue('--mobile-viewport-height'),'450px');
    assert.ok(x.$('#app').classList.contains('mobile-keyboard'));
    x.$('#activitySearch').blur();
    assert.equal(x.$('#app').classList.contains('mobile-keyboard'),false);
    x.click('.mobile-dock [data-mobile-view="card"]');
    x.media.matches=false;x.media.changed();x.media.matches=true;x.media.changed();
    assert.equal(x.$('#app').dataset.mobileView,'home');
    assert.equal(x.requests.length,0);
  }finally{x.dom.window.close();}
});

test('Home Screen launch opens the existing sign-in flow only for a fresh phone session',()=>{
  const x=phone({url:'http://localhost:8000/?launch=app#workspace'});
  const desktop=phone({phone:false,url:'http://localhost:8000/?launch=app#workspace'});
  try{
    assert.equal(x.$('#m-signin').hidden,false);
    assert.equal(x.$('#app').hidden,true);
    assert.equal(desktop.$('#m-signin').hidden,true);
    assert.equal(x.requests.length,0);
  }finally{x.dom.window.close();desktop.dom.window.close();}
});

test('install metadata resolves to included PNG assets and CSS is scoped to phones',()=>{
  const dom=new JSDOM(fs.readFileSync('app/static/index.html','utf8'));
  try{
    const doc=dom.window.document;
    assert.match(doc.querySelector('meta[name="viewport"]').content,/viewport-fit=cover/);
    assert.equal(doc.querySelector('meta[name="apple-mobile-web-app-capable"]').content,'yes');
    const manifest=JSON.parse(fs.readFileSync('app/static/manifest.webmanifest','utf8'));
    assert.equal(manifest.display,'standalone');
    manifest.icons.forEach(icon=>{
      const png=fs.readFileSync('app'+icon.src);
      const size=Number(icon.sizes.split('x')[0]);
      assert.equal(png.readUInt32BE(16),size);assert.equal(png.readUInt32BE(20),size);
    });
    const css=fs.readFileSync('app/static/mobile.css','utf8');
    const style=doc.createElement('style');style.textContent=css;doc.head.appendChild(style);
    const rules=Array.from(style.sheet.cssRules);
    assert.equal(rules.length,2);
    assert.equal(rules[0].selectorText,'.mobile-only');
    assert.equal(rules[1].conditionText,'(max-width: 600px)');
    assert.match(css,/env\(safe-area-inset-top\)/);assert.match(css,/env\(safe-area-inset-bottom\)/);
  }finally{dom.window.close();}
});
