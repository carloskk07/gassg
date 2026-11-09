import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const merchant=read('js/merchant.js');
const discovery=read('js/discovery.js');
const admin=read('js/admin-clube-commercial.js');
for(const [name,source] of Object.entries({merchant,discovery,admin}))
 new vm.Script(source,{filename:name+'.js'});
const slice=(source,a,b)=>{
 const start=source.indexOf(a),end=source.indexOf(b,start+a.length);
 assert.ok(start>=0&&end>start,'Missing tested region '+a);
 return source.slice(start,end);
};
let writes=0;
// Merchant: deliberate select fills a local, editable price only.
const markup=merchant.match(/<select class="input" aria-label="Preço rápido opcional" onchange="([^"]+)">([^<]*(?:<[^>]+>[^<]*)+)<\/select>/);
assert.ok(markup,'Merchant price choices are visible next to the editable price field');
assert.ok(markup[1].includes('this.nextElementSibling.value=this.value'));
for(const [value,label] of [['','Escolha o preço que conferiu'],['10','R$ 10'],
 ['20','R$ 20'],['50','R$ 50'],['100','R$ 100']]){
 assert.ok(markup[2].includes('<option value="'+value+'">'+label+'</option>'));
}
const price={value:'25.50'};
const merchantContext={
 value:'100',nextElementSibling:price,
 merchantLiveAddRegisteredProduct:()=>{writes++}
};
vm.runInNewContext(markup[1],merchantContext);
assert.equal(price.value,'100');
merchantContext.value='';
vm.runInNewContext(markup[1],merchantContext);
assert.equal(price.value,'100','A blank shortcut cannot erase a manually entered or selected price');
assert.ok(merchant.includes('merchantLiveAddRegisteredProduct()'));
assert.ok(merchant.includes('type="number" min="0.01" max="10000"'));
assert.equal(writes,0,'price shortcut cannot add a product');

// Cliente: no request or search until explicit submit.
const occupation={value:'',disabled:false,focused:false,focus(){this.focused=true;}};
let canOverwrite=false,overwritePrompts=0;
const discoveryCtx=vm.createContext({
 document:{getElementById:id=>id==='discovery-occupation'?occupation:null},
 confirm:()=>{overwritePrompts++;return canOverwrite;},
 discoverySearchFromUi:()=>{writes++;throw Error('No automatic search')}
});
vm.runInContext(slice(discovery,
 '// V1.913 — selectable profession filter',
 '// V1.912 — purely local draft shortcuts')+
 'this.choose=discoveryOccupationQuick;this.options=discoveryOccupationQuickOptions;',discoveryCtx);
const select={value:'Eletricista'};
assert.equal(discoveryCtx.choose(select),true);
assert.equal(occupation.value,'Eletricista');
select.value='Diarista';
assert.equal(discoveryCtx.choose(select),false);
assert.equal(occupation.value,'Eletricista');
canOverwrite=true;
assert.equal(discoveryCtx.choose(select),true);
assert.equal(occupation.value,'Diarista');
select.value='__proto__';
assert.equal(discoveryCtx.choose(select),false);
assert.equal(occupation.value,'Diarista');
select.value='custom';
assert.equal(discoveryCtx.choose(select),true);
assert.equal(occupation.focused,true);
assert.equal(occupation.value,'Diarista');
occupation.disabled=true;select.value='Pedreiro';
assert.equal(discoveryCtx.choose(select),false);
const options=discoveryCtx.options();
for(const label of ['Eletricista','Encanador','Pedreiro','Pintor','Diarista','Jardineiro','Informar outra profissão'])
 assert.ok(options.includes(label),label);
assert.match(discovery,/discoveryOccupationQuickOptions\(\)\+'<label>Profissão ou especialidade/);
assert.match(discovery,/onsubmit="return discoverySearchFromUi\(event\)"/);
assert.equal(writes,0);

// Admin: authenticated and confirmed email may be reused only after an explicit button click.
const email={value:'contato@empresa.com.br',disabled:false};
let role='superadmin';
let confirmed=true;
let currentId='owner-1';
let supportConfirm=false,asked=0;
const adminCtx=vm.createContext({
 adminCurrentRole:()=>role,
 adminRuntime:{session:{user:{
  get id(){return currentId;},email:'conta.verificada@example.com',
  get email_confirmed_at(){return confirmed?'2026-11-09T10:00:00Z':null;}
 }}},
 clubeLaunchState:{userId:'owner-1'},
 document:{getElementById:id=>id==='clube-release-email'?email:null},
 window:{confirm:()=>{asked++;return supportConfirm;}},
 adminInvoke:()=>{writes++;throw Error('No API call should be made by prefill')}
});
vm.runInContext(
 slice(admin,'// V1.913 — optional reuse of the signed-in owner',
 'function adminClubeCommercialPanel(){')+
 'this.useVerifiedEmail=adminClubeCommercialUseVerifiedEmail;',adminCtx);
const use=adminCtx.useVerifiedEmail;
assert.equal(use(),false,'Do not silently overwrite custom support email');
assert.equal(email.value,'contato@empresa.com.br');
supportConfirm=true;
assert.equal(use(),true);
assert.equal(email.value,'conta.verificada@example.com');
assert.equal(asked,2);
confirmed=false;email.value='';
assert.equal(use(),false,'Unverified account email must not be assumed');
confirmed=true;currentId='another-user';
assert.equal(use(),false,'Switching accounts invalidates shortcut');
currentId='owner-1';role='operations';
assert.equal(use(),false,'Only owner Admin can reuse support email');
role='superadmin';email.disabled=true;
assert.equal(use(),false,'Disabled field cannot be filled');
assert.match(admin,/Usar o e-mail verificado desta conta/);
for(const token of ["input('name'","input('doc'","input('address'","check('identity'","check('terms'","check('refund'","check('merchant'","check('availability'","window.confirm('Autorizar agora cobranças reais"])
 assert.ok(admin.includes(token),'Legal facts and manual consents must remain: '+token);
assert.equal(writes,0,'No merchant product, customer search or commercial activation side effects');
assert.match(read('.github/workflows/audit.yml'),/tests\/marked-shortcuts-v1-913\.mjs/);
console.log('V1.913 PASS — merchant price, client profession and Admin verified email are opt-in drafts; no backend mutation, identity inference or automatic sale.');
