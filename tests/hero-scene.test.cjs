const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM,VirtualConsole}=require('jsdom');
const html=fs.readFileSync('app/static/index.html','utf8');
const source=fs.readFileSync('app/static/hero-scene.js','utf8');

function scene({reduced=false,blocked=false,webgl=false,failTexture=false}={}){
  const errors=[],console=new VirtualConsole();console.on('jsdomError',e=>errors.push(e));
  const dom=new JSDOM(html,{url:'http://localhost:8000/',pretendToBeVisual:true,runScripts:'outside-only',virtualConsole:console});
  const w=dom.window;
  const counts={play:0,pause:0,load:0,draw:0};
  const preference={matches:reduced,addEventListener:()=>{}};
  const video=w.document.getElementById('earthVideo');
  video.play=()=>{counts.play++;return blocked?Promise.reject(new Error('Autoplay blocked')):Promise.resolve();};
  video.pause=()=>counts.pause++;
  video.load=()=>counts.load++;
  w.matchMedia=()=>preference;
  let observer;
  w.IntersectionObserver=class{constructor(callback){observer=callback;}observe(){}};
  const frames=new Map();let frameId=0;
  w.requestAnimationFrame=callback=>{frames.set(++frameId,callback);return frameId;};
  w.cancelAnimationFrame=id=>frames.delete(id);
  if(webgl){
    w.WebGLRenderingContext=function(){};
    const gl=new Proxy({getShaderParameter:()=>true,getProgramParameter:()=>true,getShaderPrecisionFormat:()=>({precision:23}),isContextLost:()=>false,drawArrays:()=>counts.draw++},{get:(target,key)=>key in target?target[key]:()=>({})});
    w.HTMLCanvasElement.prototype.getContext=()=>gl;
    w.Image=class{set src(value){if(failTexture)this.onerror();else this.onload();}};
  }
  w.eval(source);
  return {dom,w,counts,errors,video,hero:w.document.querySelector('.hero'),button:w.document.getElementById('heroMotion'),frames,intersection:visible=>observer([{isIntersecting:visible}])};
}

test('unsupported WebGL restores the original looping video and provides a persistent pause control',()=>{
  const x=scene();
  try{
    assert.equal(x.hero.dataset.renderer,'video');assert.equal(x.counts.play,1);
    assert.equal(x.video.querySelector('source').getAttribute('src'),'/static/assets/earth-orbit.mp4');
    assert.ok(x.video.hasAttribute('loop'));assert.ok(x.video.hasAttribute('playsinline'));
    x.button.click();assert.equal(x.button.getAttribute('aria-pressed'),'true');
    assert.equal(x.w.localStorage.getItem('veyra-motion-paused'),'true');
    assert.equal(x.counts.play,1);
    x.button.click();assert.equal(x.counts.play,2);assert.equal(x.button.getAttribute('aria-pressed'),'false');
    assert.equal(x.errors.length,0);
  }finally{x.dom.window.close();}
});

test('video pauses in the dashboard and outside the viewport, then resumes on returning home',()=>{
  const x=scene();
  try{
    x.w.VeyraScene.pause();assert.equal(x.counts.play,1);
    assert.ok(x.counts.pause>=1);x.w.VeyraScene.resume();assert.equal(x.counts.play,2);
    x.intersection(false);const count=x.counts.play;
    x.w.VeyraScene.resume();assert.equal(x.counts.play,count);
    x.intersection(true);assert.equal(x.counts.play,count+1);
    assert.equal(x.errors.length,0);
  }finally{x.dom.window.close();}
});

test('reduced motion does not load or autoplay the fallback video',()=>{
  const x=scene({reduced:true});
  try{
    assert.equal(x.counts.play,0);assert.equal(x.counts.load,0);
    assert.equal(x.video.querySelector('source').hasAttribute('src'),false);
    assert.equal(x.button.getAttribute('aria-pressed'),'true');
    assert.equal(x.video.poster,'http://localhost:8000/static/assets/earth-poster.png');
    x.w.VeyraScene.resume();assert.equal(x.counts.play,0);
    assert.equal(x.errors.length,0);
  }finally{x.dom.window.close();}
});

test('autoplay rejection leaves a usable static Earth and working motion control',async()=>{
  const x=scene({blocked:true});
  try{
    await Promise.resolve();
    assert.equal(x.hero.dataset.renderer,'video');
    assert.ok(x.hero.querySelector('.hero-art').style.backgroundImage.includes('earth-poster.png'));
    assert.equal(x.hero.classList.contains('video-playing'),false);
    x.button.click();assert.equal(x.button.getAttribute('aria-pressed'),'true');
    assert.equal(x.errors.length,0);
  }finally{x.dom.window.close();}
});

test('WebGL renders a frame, schedules animation, and stops drawing in the workspace',()=>{
  const x=scene({webgl:true});
  try{
    assert.equal(x.hero.dataset.renderer,'webgl');assert.equal(x.counts.load,0);
    assert.ok(x.counts.draw>0);assert.equal(x.frames.size,1);
    x.w.VeyraScene.pause();assert.equal(x.frames.size,0);
    x.w.VeyraScene.resume();assert.equal(x.frames.size,1);
    x.button.click();assert.equal(x.frames.size,0);
    assert.equal(x.errors.length,0);
  }finally{x.dom.window.close();}
});

test('failed texture loading and a lost GPU context both recover to the original video',()=>{
  const failed=scene({webgl:true,failTexture:true});
  try{assert.equal(failed.hero.dataset.renderer,'video');assert.equal(failed.counts.play,1);}finally{failed.dom.window.close();}
  const x=scene({webgl:true});
  try{
    x.w.document.getElementById('earthCanvas').dispatchEvent(new x.w.Event('webglcontextlost',{cancelable:true}));
    assert.equal(x.hero.dataset.renderer,'video');assert.equal(x.frames.size,0);
    assert.equal(x.counts.play,1);assert.equal(x.errors.length,0);
  }finally{x.dom.window.close();}
});
