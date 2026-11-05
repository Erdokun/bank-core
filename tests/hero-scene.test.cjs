const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM,VirtualConsole}=require('jsdom');
const html=fs.readFileSync('app/static/index.html','utf8'),source=fs.readFileSync('app/static/hero-scene.js','utf8');
function scene(reduced=false){
 const errors=[],v=new VirtualConsole();v.on('jsdomError',e=>errors.push(e));
 const dom=new JSDOM(html,{url:'http://localhost:8000/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:v}),w=dom.window;
 w.matchMedia=()=>({matches:reduced});let frames=0;w.requestAnimationFrame=()=>{frames++;return frames;};
 w.eval(source);const object=w.document.querySelector('.hero-object');object.getBoundingClientRect=()=>({left:0,top:0,width:400,height:500});
 return {dom,w,object,errors,frames:()=>frames,move(){object.dispatchEvent(new w.MouseEvent('pointermove',{clientX:350,clientY:100}));}};
}
test('sculptural hero has no playback controls, canvas, or autonomous animation loop',()=>{
 const x=scene();try{assert.equal(x.w.document.getElementById('heroMotion'),null);assert.equal(x.w.document.querySelector('canvas'),null);assert.equal(x.w.document.querySelector('.hero').dataset.renderer,'css-3d');assert.equal(x.frames(),0);assert.equal(x.errors.length,0);}finally{x.dom.window.close();}
});
test('pointer lighting and perspective stop in the workspace and resume on return',()=>{
 const x=scene();try{x.move();assert.equal(x.object.style.getPropertyValue('--object-x'),'0.75');x.w.VeyraScene.pause();x.move();assert.equal(x.object.style.getPropertyValue('--object-x'),'0');x.w.VeyraScene.resume();x.move();assert.equal(x.object.style.getPropertyValue('--object-x'),'0.75');assert.equal(x.frames(),0);}finally{x.dom.window.close();}
});
test('system and account reduced-motion preferences suppress input-driven motion',()=>{
 const x=scene(true),y=scene();try{x.move();assert.equal(x.object.style.getPropertyValue('--object-x'),'');y.w.document.documentElement.dataset.reducedMotion='true';y.move();assert.equal(y.object.style.getPropertyValue('--object-x'),'');assert.equal(x.errors.length+y.errors.length,0);}finally{x.dom.window.close();y.dom.window.close();}
});
