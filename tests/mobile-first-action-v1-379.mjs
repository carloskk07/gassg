import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const customer=read('js/customer.js');
const acquisition=read('js/acquisition.js');
const bootstrap=read('js/bootstrap.js');
const css=read('css/marketing-premium.css');
new vm.Script(customer,{filename:'customer.js'});
new vm.Script(acquisition,{filename:'acquisition.js'});

const start=customer.indexOf('function homeChooseProduct(code){');
const end=customer.indexOf('// Consulta ofertas reais',start);
assert.ok(start>=0&&end>start);
const selectorCode=customer.slice(start,end);
function select({input='97300-000',current='11111111',demo=false,hidden=false,code='WATER20'}={}){
 const live={offers:[{id:'previous'}],postalValidated:true,lastCityCheck:{postalCode:current},lastSyncAt:'old',error:'old'};
 const state={postalCode:current,address:'Outra rua',addressNumber:'12',cart:{P13:2}};
 const actions={focus:0,save:0,product:[],toast:[]};
 const field={value:input,focus:()=>{actions.focus++}};
 const ctx=vm.createContext({
   state,liveRuntime:live,globalThis:{__CHAMA_TEST__:demo,liveRuntime:live},
   document:{querySelector:sel=>sel==='#home-address'?field:null},
   products:{WATER20:{name:'Água',hidden},P13:{name:'Gás'}},
   save:()=>{actions.save++},quickProduct:k=>actions.product.push(k),
   toast:msg=>actions.toast.push(msg)
 });
 vm.runInContext(selectorCode+'\nthis.choose=homeChooseProduct;',ctx);
 return {ok:ctx.choose(code),state,live,actions};
}
let got=select();
assert.equal(got.ok,true);
assert.equal(got.state.postalCode,'97300000');
assert.equal(got.state.address,'');
assert.equal(got.state.addressNumber,'');
assert.equal(got.live.postalValidated,false);
assert.equal(got.live.lastCityCheck,null);
assert.equal(got.live.lastSyncAt,null);
assert.equal(got.live.offers.length,0);
assert.equal(got.actions.product.join(','),'WATER20');
assert.equal(got.actions.save,1);
assert.equal(got.state.cart.P13,2,'only existing quickProduct changes the basket');
for(const input of ['973000000','97 30-000','a1234567','0000']){
 got=select({input});
 assert.equal(got.ok,false,'malformed CEP must be rejected: '+input);
 assert.equal(got.state.postalCode,'11111111');
 assert.equal(got.live.offers.length,1);
 assert.equal(got.actions.product.length,0);
 assert.equal(got.actions.save,0);
 assert.equal(got.actions.focus,1);
}
for(const input of ['', '97300-000']){
 got=select({input,current:'97300000'});
 assert.equal(got.ok,true,'optional or unchanged CEP still permits choice');
 assert.equal(got.state.postalCode,'97300000');
 assert.equal(got.live.offers.length,1,'existing valid quote preserved for unchanged region');
}
assert.equal(select({hidden:true}).ok,false);
assert.equal(select({code:'UNKNOWN1'}).ok,false);
got=select({demo:true,input:'Rua das Flores 123'});
assert.equal(got.ok,true);
assert.equal(got.state.address,'Rua das Flores 123');
assert.equal(got.actions.product.join(','),'WATER20');
assert.ok(customer.includes("const postalCode=value.replace(/\\D/g,'');"),
 'existing generic CEP entry must not truncate nine digits');
const home=customer.slice(customer.indexOf('function home(){'),customer.indexOf('\nfunction orderPage(){'));
assert.ok(home.includes('onclick="homeChooseProduct('));
assert.ok(home.includes('class="quick-card" onclick="homeChooseProduct('));
assert.ok(bootstrap.includes('quickProduct,homeChooseProduct,startHomeBrowse'),
 'public inline action must be registered');

const feedbackStart=acquisition.indexOf('function prelaunchMerchantFieldError(');
const feedbackEnd=acquisition.indexOf('async function submitPrelaunchMerchantLead(){',feedbackStart);
assert.ok(feedbackStart>=0&&feedbackEnd>feedbackStart);
const feedbackCode=acquisition.slice(feedbackStart,feedbackEnd);
function checkFeedback(fieldId){
 const attrs={};
 let focused=false;
 const options={open:false};
 const inline=[];
 const parent={insertAdjacentElement:(where,node)=>inline.push({where,node})};
 const field={
  getAttribute:k=>attrs[k],setAttribute:(k,v)=>{attrs[k]=v},
  removeAttribute:k=>{delete attrs[k]},focus:()=>{focused=true},
  closest:selector=>selector==='details'?options:parent
 };
 const status={textContent:'',className:''};
 const document={
  getElementById:id=>id===fieldId?field:null,
  querySelector:s=>s==='#partner-result'?status:null,
  querySelectorAll:()=>[],
  createElement:tag=>({id:'',className:'',textContent:'',
    setAttribute:(name,value)=>{attrs['error-'+name]=value}})
 };
 const ctx=vm.createContext({document});
 vm.runInContext(feedbackCode+'\nthis.feedback=prelaunchMerchantFieldError;',ctx);
 assert.equal(ctx.feedback(fieldId,'Revise este campo.'),false);
 assert.equal(attrs['aria-invalid'],'true');
 assert.equal(attrs['aria-describedby'],'partner-inline-feedback');
 assert.equal(attrs['error-role'],'alert');
 assert.equal(status.textContent,'Revise este campo.');
 assert.equal(status.className,'lead-result error');
 assert.equal(inline[0].where,'afterend');
 assert.equal(inline[0].node.className,'partner-inline-error');
 assert.equal(focused,true);
 assert.equal(options.open,true);
}
checkFeedback('partner-postal');
checkFeedback('partner-phone');

const fsStart=acquisition.indexOf('function prelaunchMerchantLeadSection(){');
const fsEnd=acquisition.indexOf('function openPrelaunchMerchantLead(){',fsStart);
const formCtx=vm.createContext({prelaunchLeadSent:()=>false});
vm.runInContext(acquisition.slice(fsStart,fsEnd)+'\nthis.page=prelaunchMerchantLeadSection;',formCtx);
const html=formCtx.page();
assert.match(html,/id="partner-interest-categories" class="lead-interests" tabindex="-1"/);
for(const field of ['partner-business','partner-name','partner-phone','partner-postal','partner-interest-categories','partner-consent']){
 assert.ok(acquisition.includes("prelaunchMerchantFieldError('"+field+"'"),'no inline merchant feedback: '+field);
}
assert.ok(acquisition.includes("leadType:'merchant'"));
assert.ok(acquisition.includes('if(button?.disabled)return;'));
for(const token of ['.partner-inline-error','[aria-invalid="true"]','@media(max-width:620px)'])
 assert.ok(css.includes(token),'missing responsive feedback styling: '+token);
console.log('TAMÃO V1.379 PASS — exact CEP, stale quote prevention, mobile product choice and inline merchant validation.');
