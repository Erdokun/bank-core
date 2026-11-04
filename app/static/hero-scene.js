/* Perspective stars and a tilted spiral galaxy; no remote textures. */
(function(){
'use strict';
var canvas=document.getElementById('galaxyCanvas'),hero=document.querySelector('.hero');
if(!canvas||!hero)return;
var ctx;try{ctx=canvas.getContext('2d');}catch(e){}
var control=document.getElementById('heroMotion'),preference=window.matchMedia('(prefers-reduced-motion: reduce)');
var paused=preference.matches,active=true,visible=true,frame=0,last=0,time=0,width=0,height=0;
try{paused=paused||localStorage.getItem('veyra-motion-paused')==='true';}catch(e){}
var pointer={x:0,y:0},target={x:0,y:0},seed=719;
function random(){seed=(seed*16807)%2147483647;return (seed-1)/2147483646;}
var stars=Array.from({length:720},function(){return {x:random(),y:random(),z:.2+random()*.8,r:random(),phase:random()*6.28};});
var spiral=Array.from({length:1150},function(_,i){var r=Math.pow(random(),.65);return {r:r,a:r*8+(i%3)*Math.PI*2/3+(random()-.5)*.8,z:(random()-.5)*.12,size:random()};});
function draw(){
 if(!ctx)return;ctx.clearRect(0,0,width,height);
 var px=pointer.x*18,py=pointer.y*12;
 stars.forEach(function(s){var x=((s.x*width+time*(2+s.z*4)+px*s.z)%width+width)%width,y=(s.y*height+py*s.z+height)%height,alpha=(.23+s.z*.58)*(.8+.2*Math.sin(time*.7+s.phase));ctx.fillStyle='rgba(214,227,255,'+alpha+')';ctx.beginPath();ctx.arc(x,y,.35+s.r*1.1*s.z,0,Math.PI*2);ctx.fill();});
 var scale=Math.max(width*.48,height*.57),cx=width*.54+px,cy=height*.68+py;
 spiral.forEach(function(s){var a=s.a+time*.012,x=Math.cos(a)*s.r,y=Math.sin(a)*s.r,depth=1/(1+y*.22),sx=cx+(x*.94-y*.18)*scale*depth,sy=cy+(x*.2+y*.26+s.z)*scale*depth,alpha=(1-s.r*.6)*(.16+s.size*.45);ctx.fillStyle=s.r>.48?'rgba(169,181,255,'+alpha+')':'rgba(244,212,255,'+alpha+')';ctx.beginPath();ctx.arc(sx,sy,(.35+s.size*.9)*depth,0,Math.PI*2);ctx.fill();});
 var phase=time%11;if(phase>6&&phase<7.1){var progress=(phase-6)/1.1,x=width*(.85-progress*.4),y=height*(.12+progress*.28),gradient=ctx.createLinearGradient(x,y,x+100,y-60);gradient.addColorStop(0,'rgba(230,239,255,'+Math.sin(progress*Math.PI)+')');gradient.addColorStop(1,'rgba(180,200,255,0)');ctx.strokeStyle=gradient;ctx.lineWidth=1.3;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+100,y-60);ctx.stroke();}
}
function resize(){width=window.innerWidth;height=window.innerHeight;var dpr=Math.min(window.devicePixelRatio||1,1.5);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);if(ctx)ctx.setTransform(dpr,0,0,dpr,0,0);draw();}
function stop(){if(frame)cancelAnimationFrame(frame);frame=0;last=0;}
function canAnimate(){return !!ctx&&!paused&&!preference.matches&&active&&visible&&!document.hidden;}
function tick(now){frame=0;if(!canAnimate())return;if(!last||now-last>=32){time+=last?Math.min((now-last)/1000,.1):0;last=now;pointer.x+=(target.x-pointer.x)*.045;pointer.y+=(target.y-pointer.y)*.045;draw();}frame=requestAnimationFrame(tick);}
function sync(){stop();hero.classList.toggle('motion-paused',paused||preference.matches);control.setAttribute('aria-pressed',String(paused||preference.matches));control.setAttribute('aria-label',paused?'Resume scene animation':'Pause scene animation');control.querySelector('span').textContent=paused?'Resume motion':'Pause motion';if(canAnimate())frame=requestAnimationFrame(tick);else if(active)draw();}
control.addEventListener('click',function(){paused=!paused;try{localStorage.setItem('veyra-motion-paused',String(paused));}catch(e){}sync();});
window.addEventListener('resize',resize,{passive:true});window.addEventListener('pointermove',function(e){target.x=(e.clientX/width-.5)*2;target.y=(e.clientY/height-.5)*2;},{passive:true});document.addEventListener('visibilitychange',sync);
if(preference.addEventListener)preference.addEventListener('change',sync);
if(window.IntersectionObserver)new IntersectionObserver(function(entries){visible=entries[0].isIntersecting;sync();}).observe(hero);
window.VeyraScene={pause:function(){active=false;sync();},resume:function(){active=true;sync();}};
hero.dataset.renderer=ctx?'galaxy':'css';resize();sync();
})();
