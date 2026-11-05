/* A shared, keyboard-accessible picker. Native controls remain the form's source of truth. */
(function(){
'use strict';
var controls=new Map(),active=null,sequence=0,queued=false;
var arrow='<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m6 8 4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
var check='<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 10 3 3 7-7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function options(c){return Array.from(c.select.options);}
function enabled(option){return !option.disabled&&!(option.parentElement.tagName==='OPTGROUP'&&option.parentElement.disabled)&&!option.hidden;}
function content(option){
 var fragment=document.createDocumentFragment(),text=option?option.textContent.trim():'Choose an option';
 var currency=text.match(/^(?:([€$£₺])\s*)?(EUR|USD|GBP|TRY|CHF|CAD|AUD)(?:\s*·\s*(.*))?$/);
 if(currency){
  var symbol=document.createElement('span');symbol.className='choice-symbol';symbol.setAttribute('aria-hidden','true');symbol.textContent=currency[1]||({EUR:'€',USD:'$',GBP:'£',TRY:'₺',CHF:'Fr',CAD:'C$',AUD:'A$'})[currency[2]];fragment.appendChild(symbol);
  var copy=document.createElement('span');copy.className='choice-copy';var title=document.createElement('span');title.textContent=currency[2];copy.appendChild(title);
  if(currency[3]){var detail=document.createElement('small');detail.textContent=currency[3];copy.appendChild(detail);}fragment.appendChild(copy);
 }else{var label=document.createElement('span');label.className='choice-copy';label.textContent=text;fragment.appendChild(label);}
 return fragment;
}
function label(c){
 var name=c.select.getAttribute('aria-label'),labelled=c.select.getAttribute('aria-labelledby');
 if(labelled){c.trigger.setAttribute('aria-labelledby',labelled);c.panel.setAttribute('aria-labelledby',labelled);return;}
 if(!name){var nativeLabel=c.select.labels&&c.select.labels[0];if(nativeLabel){var heading=nativeLabel.querySelector(':scope > span');name=Array.from((heading||nativeLabel).childNodes).filter(function(n){return n.nodeType===3;}).map(function(n){return n.textContent;}).join(' ').trim();}}
 name=name||'Choose an option';c.trigger.setAttribute('aria-label',name);c.panel.setAttribute('aria-label',name);
}
function sync(c){
 c.wrap.hidden=c.select.hidden;c.trigger.disabled=c.select.disabled;
 c.trigger.setAttribute('aria-required',String(c.select.required));
 if(c.select.getAttribute('aria-invalid')==='true')c.trigger.setAttribute('aria-invalid','true');else c.trigger.removeAttribute('aria-invalid');
 c.value.replaceChildren(content(c.select.options[c.select.selectedIndex]));label(c);
 if(active===c&&(c.select.hidden||c.select.disabled||c.select.closest('[hidden]')||c.select.closest('.modal:not(.is-open)')))close(false);
}
function syncAll(){queued=false;controls.forEach(function(c,select){if(!select.isConnected){if(active===c)close(false);c.panel.remove();controls.delete(select);}else sync(c);});if(active){var signature=optionSignature(active);if(signature!==active.signature)build(active);place(active);}}
function schedule(){if(!queued){queued=true;queueMicrotask(syncAll);}}
function optionSignature(c){return options(c).map(function(o){return [o.textContent,o.value,o.selected,enabled(o)].join('\u0000');}).join('\u0001');}
function build(c){
 c.panel.replaceChildren();var opts=options(c);c.signature=optionSignature(c);
 opts.forEach(function(option,i){
  var row=document.createElement('div');row.className='choice-option';row.id=c.id+'-option-'+i;row.setAttribute('role','option');row.setAttribute('aria-selected',String(option.selected));row.setAttribute('aria-disabled',String(!enabled(option)));row.hidden=option.hidden;row.dataset.index=i;
  row.appendChild(content(option));var mark=document.createElement('span');mark.className='choice-check';mark.innerHTML=check;row.appendChild(mark);c.panel.appendChild(row);
 });
 c.highlight=Math.max(0,opts.findIndex(function(o){return o.selected&&enabled(o);}));highlight(c,c.highlight);
}
function highlight(c,index){
 var opts=options(c);if(!opts[index]||!enabled(opts[index]))return;c.highlight=index;
 Array.from(c.panel.children).forEach(function(row,i){row.classList.toggle('is-highlighted',i===index);});
 var row=c.panel.children[index];c.trigger.setAttribute('aria-activedescendant',row.id);
 if(row.scrollIntoView)row.scrollIntoView({block:'nearest'});
}
function place(c){
 var rect=c.trigger.getBoundingClientRect(),gap=8,margin=12,vw=document.documentElement.clientWidth||innerWidth,vh=innerHeight;
 var width=Math.min(Math.max(rect.width,Math.min(300,vw-margin*2)),vw-margin*2),below=vh-rect.bottom-gap-margin,above=rect.top-gap-margin;
 var up=below<Math.min(c.panel.scrollHeight,240)&&above>below;
 c.panel.style.width=width+'px';c.panel.style.maxHeight=Math.max(80,Math.min(380,up?above:below))+'px';
 c.panel.style.left=Math.max(margin,Math.min(rect.left,vw-width-margin))+'px';
 c.panel.style.top=(up?Math.max(margin,rect.top-gap-c.panel.getBoundingClientRect().height):rect.bottom+gap)+'px';
 c.panel.dataset.side=up?'above':'below';
}
function open(c){
 if(c.select.disabled||c.select.hidden)return;if(active===c){close(false);return;}close(false);sync(c);active=c;clearTimeout(c.closeTimer);build(c);c.panel.hidden=false;c.trigger.setAttribute('aria-expanded','true');c.wrap.classList.add('is-open');place(c);
 requestAnimationFrame(function(){if(active===c){c.panel.classList.add('is-open');highlight(c,c.highlight);}});
}
function close(focus){
 if(!active)return;var c=active;active=null;c.trigger.setAttribute('aria-expanded','false');c.trigger.removeAttribute('aria-activedescendant');c.wrap.classList.remove('is-open');c.panel.classList.remove('is-open');
 c.closeTimer=setTimeout(function(){c.panel.hidden=true;},180);if(focus)c.trigger.focus();
}
function choose(c,index){
 var option=options(c)[index];if(!option||!enabled(option))return;
 var changed=c.select.selectedIndex!==index;c.select.selectedIndex=index;sync(c);close(true);
 if(changed){c.select.dispatchEvent(new Event('input',{bubbles:true}));c.select.dispatchEvent(new Event('change',{bubbles:true}));}
}
function move(c,key){
 var indexes=options(c).map(function(o,i){return enabled(o)?i:-1;}).filter(function(i){return i>=0;});if(!indexes.length)return;
 var pos=indexes.indexOf(c.highlight),next=key==='Home'?0:key==='End'?indexes.length-1:Math.max(0,Math.min(indexes.length-1,pos+(key==='ArrowUp'?-1:1)));highlight(c,indexes[next]);
}
function enhance(select){
 if(controls.has(select)||select.multiple||select.size>1)return;
 var wrap=document.createElement('div');wrap.className='choice';if(select.classList.contains('account-select'))wrap.classList.add('choice-account');
 var trigger=document.createElement('button');trigger.type='button';trigger.className='choice-trigger';trigger.id=(select.id||'select-'+(++sequence))+'-trigger';trigger.setAttribute('role','combobox');trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');
 var value=document.createElement('span');value.className='choice-value';trigger.appendChild(value);var chevron=document.createElement('span');chevron.className='choice-chevron';chevron.innerHTML=arrow;trigger.appendChild(chevron);
 var panel=document.createElement('div'),id=trigger.id+'-list';panel.id=id;panel.className='choice-menu';panel.setAttribute('role','listbox');panel.hidden=true;trigger.setAttribute('aria-controls',id);
 var c={select:select,wrap:wrap,trigger:trigger,value:value,panel:panel,id:id,highlight:0,search:'',searchAt:0};controls.set(select,c);
 select.before(wrap);wrap.append(select,trigger);document.body.appendChild(panel);select.classList.add('choice-native');select.tabIndex=-1;select.setAttribute('aria-hidden','true');sync(c);
 trigger.addEventListener('click',function(){open(c);});
 trigger.addEventListener('keydown',function(e){
  if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();var wasOpen=active===c;if(!wasOpen)open(c);if(wasOpen||e.key==='Home'||e.key==='End')move(c,e.key);}
  else if(e.key==='Enter'||e.key===' '){e.preventDefault();if(active===c)choose(c,c.highlight);else open(c);}
  else if(e.key.length===1&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();if(active!==c)open(c);var now=Date.now();c.search=now-c.searchAt>600?'':c.search;c.searchAt=now;c.search+=e.key.toLocaleLowerCase();var opts=options(c),start=c.highlight+1;for(var i=0;i<opts.length;i++){var n=(start+i)%opts.length;if(enabled(opts[n])&&opts[n].textContent.trim().replace(/^[€$£₺]\s*/,'').toLocaleLowerCase().startsWith(c.search)){highlight(c,n);break;}}}
 });
 panel.addEventListener('pointerdown',function(e){e.preventDefault();});
 panel.addEventListener('pointermove',function(e){var row=e.target.closest('.choice-option');if(row&&enabled(options(c)[+row.dataset.index]))highlight(c,+row.dataset.index);});
 panel.addEventListener('click',function(e){var row=e.target.closest('.choice-option');if(row)choose(c,+row.dataset.index);});
 select.addEventListener('focus',function(){trigger.focus();});select.addEventListener('change',function(){sync(c);});
 select.addEventListener('invalid',function(e){e.preventDefault();trigger.setAttribute('aria-invalid','true');trigger.focus();});
 trigger.addEventListener('blur',function(){if(active===c)close(false);});
}
function scan(node){if(node.nodeType!==1)return;if(node.matches('select'))enhance(node);node.querySelectorAll('select').forEach(enhance);}
scan(document.body);
new MutationObserver(function(records){
 records.forEach(function(r){if(r.type==='childList')r.addedNodes.forEach(scan);});
 if(records.some(function(r){return r.target.matches&&r.target.matches('select,option,optgroup,.modal,[role="tabpanel"]')||Array.from(r.removedNodes||[]).some(function(n){return n.nodeType===1&&(n.matches('select,option')||n.querySelector('select'));});}))schedule();
}).observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden','disabled','selected','label','aria-label','aria-invalid','class']});
document.addEventListener('pointerdown',function(e){if(active&&!active.wrap.contains(e.target)&&!active.panel.contains(e.target))close(false);},true);
document.addEventListener('keydown',function(e){if(!active)return;if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close(true);}else if(e.key==='Tab')close(false);},true);
['click','input','change','reset'].forEach(function(event){document.addEventListener(event,schedule);});
window.addEventListener('resize',function(){if(active)place(active);});
window.addEventListener('scroll',function(e){if(active&&!active.panel.contains(e.target))close(false);},true);
window.VeyraSelect={sync:syncAll,close:function(){close(false);}};
})();
