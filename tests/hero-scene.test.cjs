const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM,VirtualConsole}=require('jsdom');
const html=fs.readFileSync('app/static/index.html','utf8'),source=fs.readFileSync('app/static/hero-scene.js','utf8');
function scene({reduced=false,canvas=true}={}){
 const errors=[],v=new VirtualConsole();v.on('jsdomError',e=>errors.push(e));
 const dom=new JSDOM(html,{url:'http://localhost:8000/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:v}),w=dom.window;
 const preference={matches:reduced,addEventListener:()=>{}};w.matchMedia=()=>preference;
 let observer;w.IntersectionObserver=class{constructor(callback){observer=callback;}observe(){}};
 const frames=new Map();let frameId=0,draws=0;
 w.requestAnimationFrame=callback=>{frames.set(++frameId,callback);return frameId;};w.cancelAnimationFrame=id=>frames.delete(id);
 const context=new Proxy({clearRect:()=>draws++,createLinearGradient:()=>({addColorStop(){}})},{get:(target,key)=>key in target?target[key]:()=>{}});
 w.HTMLCanvasElement.prototype.getContext=()=>canvas?context:null;
 w.eval(source);
 return {dom,w,frames,errors,preference,draws:()=>draws,button:w.document.getElementById('heroMotion'),hero:w.document.querySelector('.hero'),intersection:visible=>observer([{isIntersecting:visible}])};
}
test('galaxy draws without loading Earth images or video, and has a persistent pause control',()=>{
 const x=scene();try{assert.equal(x.hero.dataset.renderer,'galaxy');assert.ok(x.draws()>0);assert.equal(x.frames.size,1);assert.equal(x.w.document.querySelector('video'),null);assert.equal(x.w.document.getElementById('earthCanvas'),null);x.button.click();assert.equal(x.frames.size,0);assert.equal(x.button.getAttribute('aria-pressed'),'true');assert.equal(x.w.localStorage.getItem('veyra-motion-paused'),'true');x.button.click();assert.equal(x.frames.size,1);assert.equal(x.errors.length,0);}finally{x.dom.window.close();}
});
test('galaxy stops in workspace and outside viewport, then resumes without duplicate animation loops',()=>{
 const x=scene();try{x.w.VeyraScene.pause();assert.equal(x.frames.size,0);x.w.VeyraScene.resume();assert.equal(x.frames.size,1);x.w.VeyraScene.resume();assert.equal(x.frames.size,1);x.intersection(false);assert.equal(x.frames.size,0);x.w.VeyraScene.resume();assert.equal(x.frames.size,0);x.intersection(true);assert.equal(x.frames.size,1);}finally{x.dom.window.close();}
});
test('reduced motion renders a static galaxy and never schedules movement',()=>{
 const x=scene({reduced:true});try{assert.ok(x.draws()>0);assert.equal(x.frames.size,0);assert.equal(x.button.getAttribute('aria-pressed'),'true');x.button.click();x.w.VeyraScene.resume();assert.equal(x.frames.size,0);assert.equal(x.errors.length,0);}finally{x.dom.window.close();}
});
test('unavailable canvas leaves the CSS nebula and usable home actions',()=>{
 const x=scene({canvas:false});try{assert.equal(x.hero.dataset.renderer,'css');assert.equal(x.frames.size,0);assert.ok(x.w.document.querySelector('.nebula'));x.button.click();assert.equal(x.errors.length,0);assert.ok(x.w.document.querySelector('.hero [data-action="register"]'));}finally{x.dom.window.close();}
});
