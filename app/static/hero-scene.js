/* Motion follows input. There is no autonomous loop or playback control. */
(function(){
'use strict';
var hero=document.querySelector('.hero'),object=document.querySelector('.hero-object');
if(!hero||!object)return;
var active=true,preference=window.matchMedia('(prefers-reduced-motion: reduce)');
function reset(){object.style.setProperty('--object-x',0);object.style.setProperty('--object-y',0);}
object.addEventListener('pointermove',function(event){
 if(!active||preference.matches||document.documentElement.dataset.reducedMotion==='true')return;
 var rect=object.getBoundingClientRect();
 object.style.setProperty('--object-x',((event.clientX-rect.left)/rect.width-.5)*2);
 object.style.setProperty('--object-y',((event.clientY-rect.top)/rect.height-.5)*-2);
},{passive:true});
object.addEventListener('pointerleave',reset);
document.addEventListener('veyra:motion',reset);
window.VeyraScene={pause:function(){active=false;reset();},resume:function(){active=true;document.dispatchEvent(new Event('veyra:scene'));}};
hero.dataset.renderer='css-3d';
})();
