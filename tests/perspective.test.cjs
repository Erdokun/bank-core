const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM,VirtualConsole}=require('jsdom');
const html=fs.readFileSync('app/static/index.html','utf8');
const source=fs.readFileSync('app/static/perspective.js','utf8');
function setup(){
 const errors=[],virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',e=>errors.push(e));
 const dom=new JSDOM(html,{url:'http://localhost:8000',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole});
 const w=dom.window,frames=[];w.matchMedia=()=>({matches:false});w.requestAnimationFrame=fn=>{frames.push(fn);return frames.length;};
 let chapter=0;w.document.querySelectorAll('[data-story]').forEach((el,i)=>{el.getBoundingClientRect=()=>({top:w.innerHeight/2-100+(i-chapter)*800,height:200});});
 w.eval(source);
 return {dom,w,errors,select(i){chapter=i;w.dispatchEvent(new w.Event('scroll'));frames.splice(0).forEach(fn=>fn());}};
}
test('scroll changes the pinned scene chapter and stops updating when the workspace is open',()=>{
 const x=setup();try{const stage=x.w.document.querySelector('.story-stage');assert.equal(stage.dataset.chapter,'0');x.select(.5);assert.equal(stage.style.getPropertyValue('--scene-turn'),'-8deg');assert.equal(stage.style.getPropertyValue('--move-visibility'),'0.19999999999999996');x.select(1);assert.equal(stage.dataset.chapter,'1');assert.equal(stage.style.getPropertyValue('--move-visibility'),'1');x.select(2);assert.equal(stage.dataset.chapter,'2');assert.equal(stage.style.getPropertyValue('--save-visibility'),'1');x.w.document.body.classList.add('app-open');x.select(0);assert.equal(stage.dataset.chapter,'2');assert.equal(x.errors.length,0);}finally{x.dom.window.close();}
});
test('preview currency controls work with clicks and keyboard without changing actual accounts',()=>{
 const x=setup();try{const d=x.w.document;d.querySelector('[data-preview-cur="USD"]').click();assert.equal(d.getElementById('storyBalance').textContent,'$8,250.00');const usd=d.querySelector('[data-preview-cur="USD"]');usd.focus();usd.dispatchEvent(new x.w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));assert.equal(d.activeElement.dataset.previewCur,'GBP');assert.equal(d.getElementById('storyBalance').textContent,'£3,640.00');assert.equal(d.querySelector('[data-preview-cur="GBP"]').getAttribute('aria-pressed'),'true');assert.equal(d.querySelector('[data-bal="EUR"]').textContent,'€450.00');assert.equal(x.errors.length,0);}finally{x.dom.window.close();}
});
