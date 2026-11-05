const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM,VirtualConsole}=require('jsdom');
const source=fs.readFileSync('app/static/select-controls.js','utf8');
function setup(){
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e));
 const dom=new JSDOM('<form><label><span>Currency</span><select id="currency" name="currency" required><option value="EUR">€ EUR · Euro</option><option value="USD" disabled>$ USD · US Dollar</option><option value="GBP">£ GBP · British Pound</option><option value="TRY">₺ TRY · Türk Lirası</option></select></label><button id="next">Next</button></form>',{runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc});
 const w=dom.window;w.requestAnimationFrame=fn=>fn();w.eval(source);
 const d=w.document,trigger=d.querySelector('[role=combobox]'),select=d.querySelector('select');
 function key(key){trigger.dispatchEvent(new w.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));}
 return {dom,w,d,trigger,select,key,errors};
}
test('picker preserves form values, skips disabled choices and emits a single change',()=>{
 const x=setup();try{let changes=0;x.select.addEventListener('change',()=>changes++);x.trigger.focus();x.key('ArrowDown');assert.equal(x.trigger.getAttribute('aria-expanded'),'true');x.key('ArrowDown');x.key('Enter');assert.equal(x.select.value,'GBP');assert.equal(new x.w.FormData(x.d.querySelector('form')).get('currency'),'GBP');assert.equal(changes,1);assert.equal(x.trigger.getAttribute('aria-expanded'),'false');assert.equal(x.d.activeElement,x.trigger);assert.match(x.trigger.textContent,/British Pound/);assert.equal(x.errors.length,0);}finally{x.dom.window.close();}
});
test('Escape dismisses the picker before the surrounding modal handles the key',()=>{
 const x=setup();try{let modalEscapes=0;x.d.addEventListener('keydown',e=>{if(e.key==='Escape')modalEscapes++;});x.trigger.click();x.key('Escape');assert.equal(modalEscapes,0);assert.equal(x.trigger.getAttribute('aria-expanded'),'false');x.key('Escape');assert.equal(modalEscapes,1);assert.equal(x.select.value,'EUR');}finally{x.dom.window.close();}
});
test('typeahead, Home/End, outside click and Tab behave consistently',()=>{
 const x=setup();try{x.key('g');assert.equal(x.d.getElementById(x.trigger.getAttribute('aria-activedescendant')).textContent.includes('GBP'),true);x.key('End');x.key('Enter');assert.equal(x.select.value,'TRY');x.key('Home');x.key('Home');x.key('Enter');assert.equal(x.select.value,'EUR');x.trigger.click();x.key('Tab');assert.equal(x.trigger.getAttribute('aria-expanded'),'false');x.trigger.click();x.d.querySelector('#next').dispatchEvent(new x.w.Event('pointerdown',{bubbles:true}));assert.equal(x.trigger.getAttribute('aria-expanded'),'false');}finally{x.dom.window.close();}
});
test('dynamically inserted and updated selects retain labels, values and visibility',async()=>{
 const x=setup();try{const host=x.d.createElement('div');host.innerHTML='<label>Account<select id="account"><option value="1">First</option></select></label>';x.d.body.append(host);await new Promise(resolve=>setImmediate(resolve));const trigger=x.d.querySelector('#account-trigger'),select=x.d.querySelector('#account');assert.ok(trigger);assert.equal(trigger.getAttribute('aria-label'),'Account');select.innerHTML='<option value="2">Second account</option><option value="3" selected>Third account</option>';await new Promise(resolve=>setImmediate(resolve));assert.match(trigger.textContent,/Third account/);select.value='2';x.w.VeyraSelect.sync();assert.match(trigger.textContent,/Second account/);select.disabled=true;await new Promise(resolve=>setImmediate(resolve));assert.equal(trigger.disabled,true);select.hidden=true;await new Promise(resolve=>setImmediate(resolve));assert.equal(trigger.parentElement.hidden,true);host.remove();await new Promise(resolve=>setImmediate(resolve));assert.equal(x.d.querySelector('#account-trigger-list'),null);assert.equal(x.errors.length,0);}finally{x.dom.window.close();}
});
test('required-field validation focuses the visible trigger',()=>{
 const x=setup();try{x.select.insertAdjacentHTML('afterbegin','<option value="">Choose a currency</option>');x.select.value='';x.w.VeyraSelect.sync();assert.equal(x.select.checkValidity(),false);assert.equal(x.d.activeElement,x.trigger);assert.equal(x.trigger.getAttribute('aria-invalid'),'true');x.key('ArrowDown');x.key('End');x.key('Enter');assert.equal(x.select.checkValidity(),true);assert.equal(x.trigger.hasAttribute('aria-invalid'),false);}finally{x.dom.window.close();}
});
