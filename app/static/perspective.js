/* Scroll distance is the animation timeline. No wheel capture or scroll lock. */
(function(){
'use strict';
var root=document.documentElement,story=document.querySelector('.story-stage'),hero=document.querySelector('.hero'),manifesto=document.querySelector('.manifesto h2');
var chapters=Array.from(document.querySelectorAll('[data-story]')),preference=window.matchMedia('(prefers-reduced-motion: reduce)'),frame=0;
function reduced(){return preference.matches||root.dataset.reducedMotion==='true';}
function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
function update(){
 frame=0;if(document.body.classList.contains('app-open'))return;
 var vh=window.innerHeight,focus=vh*(window.innerWidth<=600?.72:.5);
 var centers=chapters.map(function(chapter){var rect=chapter.getBoundingClientRect();return rect.top+rect.height/2;});
 var progress=0;
 for(var i=0;i<centers.length-1;i++){if(focus>=centers[i])progress=i+clamp((focus-centers[i])/(centers[i+1]-centers[i]||1),0,1);}
 progress=clamp(progress,0,2);var selected=Math.round(progress);
 if(story){
  story.dataset.chapter=String(selected);
  var position=reduced()?selected:progress;
  story.style.setProperty('--scene-turn',(-18+position*20)+'deg');
  story.style.setProperty('--scene-tilt',(8-Math.sin(position*Math.PI/2)*9)+'deg');
  story.style.setProperty('--scene-roll',(-7+Math.sin(position*Math.PI/2)*13)+'deg');
  story.style.setProperty('--scene-lift',(-Math.sin(position*Math.PI/2)*2.5)+'rem');
  story.style.setProperty('--scene-scale',String(1-Math.max(0,position-1)*.15));
  story.style.setProperty('--move-visibility',String(clamp(1-Math.abs(position-1)*1.6,0,1)));
  story.style.setProperty('--save-visibility',String(clamp((position-1.15)/.65,0,1)));
 }
 if(hero){var rect=hero.getBoundingClientRect();hero.style.setProperty('--hero-drift',String(reduced()?0:clamp(-rect.top/(rect.height||vh),0,1)));}
 if(manifesto){var rect=manifesto.getBoundingClientRect();manifesto.style.setProperty('--reading-progress',String(clamp((vh*.9-rect.top)/(vh*.65),0,1)));}
}
function schedule(){if(!frame)frame=requestAnimationFrame(update);}
window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule,{passive:true});document.addEventListener('veyra:scene',schedule);
var samples={EUR:'€12,480',USD:'$8,250',GBP:'£3,640',TRY:'₺42,500'};
document.querySelectorAll('[data-preview-cur]').forEach(function(button){button.addEventListener('click',function(){
 document.querySelectorAll('[data-preview-cur]').forEach(function(item){item.setAttribute('aria-pressed',String(item===button));});
 var balance=document.getElementById('storyBalance');balance.textContent=samples[button.dataset.previewCur];var decimal=document.createElement('span');decimal.textContent='.00';balance.appendChild(decimal);
 if(balance.animate&&!reduced())balance.animate([{opacity:.2,transform:'translateY(10px)'},{opacity:1,transform:'translateY(0)'}],{duration:420,easing:'cubic-bezier(.22,1,.36,1)'});
});});
var tabs=document.querySelector('.story-currency-tabs');
if(tabs)tabs.addEventListener('keydown',function(event){if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;var buttons=Array.from(tabs.querySelectorAll('button')),index=buttons.indexOf(document.activeElement);if(index<0)return;event.preventDefault();index=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;buttons[index].focus();buttons[index].click();});
if(window.IntersectionObserver&&!reduced()){
 var observer=new IntersectionObserver(function(entries){entries.forEach(function(entry){if(entry.isIntersecting){entry.target.classList.add('is-revealed');observer.unobserve(entry.target);}});},{threshold:.12});
 document.querySelectorAll('.manifesto-bottom,.security-composition>div:last-child,.faq>div,.closing-story>h2').forEach(function(element){element.classList.add('reveal-ready');observer.observe(element);});
}
document.addEventListener('veyra:motion',function(){if(reduced())document.querySelectorAll('.reveal-ready').forEach(function(el){el.classList.add('is-revealed');});schedule();});
document.addEventListener('pointerdown',function(event){if(reduced()||event.button>0)return;var target=event.target.closest('button,a');if(!target||target.disabled)return;if(target.animate)target.animate([{scale:1},{scale:.965},{scale:1}],{duration:360,easing:'cubic-bezier(.22,1,.36,1)'});});
document.querySelectorAll('.faq details').forEach(function(details){details.addEventListener('toggle',function(){var content=details.querySelector('p');if(details.open&&content&&content.animate&&!reduced())content.animate([{opacity:0,transform:'translateY(-8px)'},{opacity:1,transform:'translateY(0)'}],{duration:420,easing:'cubic-bezier(.22,1,.36,1)'});});});
update();
})();
