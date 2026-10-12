import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const growth=read('js/growth.js');
const merchant=read('js/merchant.js');
const css=read('css/components.css');
function functionSource(source,name){
  let start=source.indexOf('function '+name+'(');
  assert.ok(start>=0,'Missing function '+name);
  if(source.slice(start-6,start)==='async ')start-=6;
  const end=source.indexOf('\n}',start);
  assert.ok(end>start,'Missing closing brace for '+name);
  return source.slice(start,end+2);
}
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const app={status:'pending',company_name:'Revenda <script>alert(1)</script>',
  cnpj:'12345678000190',responsible_name:'João',phone:'55999999999',
  address_text:'Rua <img src=x onerror=alert(1)>'};
const userGlobal={
  merchantPortalRequested:()=>true,merchantRuntime:{status:'no-access',session:{access_token:'fake'}},
  merchantOwnApplicationForInvite:()=>app
};
const pageContext=vm.createContext({
  globalThis:userGlobal,esc,shell:markup=>markup,
  currentMerchantProspectInviteToken:()=>'',currentMerchantPilotInviteToken:()=>''
});
vm.runInContext(functionSource(growth,'merchantJoin')+';this.drawMerchantJoin=merchantJoin;',pageContext);
const form=pageContext.drawMerchantJoin();
assert.ok(form.includes('<form class="card flat form-stack merchant-join-form"'));
assert.ok(form.includes('onsubmit="event.preventDefault();joinMerchant()"'),'Enter must submit without reload');
assert.ok(form.includes('type="submit"'),'submit button must be semantic');
assert.ok(form.includes('id="j-cnpj"')&&form.includes('id="j-name"'));
assert.ok(form.includes('id="j-owner"')&&form.includes('id="j-phone"')&&form.includes('id="j-address"'));
assert.ok(form.includes('autocomplete="organization"')&&form.includes('autocomplete="street-address"'));
assert.ok(form.includes('Informe o CNPJ real'),'CNPJ help must support valid alphanumeric identifiers');
assert.ok(form.includes('não gera cobrança nem coloca a revenda online'),'No false launch promise');
assert.ok(!form.includes('<script>')&&!form.includes('<img'),'Saved PII must be escaped');
assert.ok(form.includes('&lt;script&gt;')&&form.includes('&lt;img'),'Saved data remains visible safely');
assert.ok(form.includes('Salvar meus dados atualizados'),'Resume pending application');
assert.ok(form.indexOf('Dados da empresa')<form.indexOf('Como falar com você')
  &&form.indexOf('Como falar com você')<form.indexOf('Onde fica sua empresa'),
 'Form groups should follow natural reading order');
app.status='approved';
assert.ok(pageContext.drawMerchantJoin().includes('disabled title="Empresa já aprovada"'),
 'Approved application must remain blocked from resubmission');
app.status='rejected';
assert.ok(pageContext.drawMerchantJoin().includes('Reenviar meus dados corrigidos'));

const runtime={merchant:{memberRole:'operator'},deliveryTeam:[]};
const orderContext=vm.createContext({
  globalThis:{merchantRuntime:runtime},BRL:{format:value=>'R$ '+Number(value).toFixed(2)},
  esc,statusCopy:{},paymentLabel:()=> 'Dinheiro',
  merchantScheduledDispatchState:()=>({scheduled:false,ready:true}),
  merchantDeliveryMemberLabel:()=> 'Responsável'
});
vm.runInContext(functionSource(merchant,'merchantDeliveryCandidates')+'\n'+functionSource(merchant,'merchantOrderEventDate')+'\n'+functionSource(merchant,'merchantOrderProgressView')+'\n'+functionSource(merchant,'merchantLiveOrder')+';this.drawMerchantOrder=merchantLiveOrder;',orderContext);
const draw=status=>orderContext.drawMerchantOrder({
  orderId:'00000000-0000-4000-8000-000000000013',publicCode:'TAM-13',
  status,items:[{quantity:1,productName:'Botijão 13 kg'}],
  address:'Rua <img src=x>',addressVisible:false,paymentMethod:'cash',totalCents:11990
});
for(const status of ['OFFERED_TO_MERCHANT','MERCHANT_ACCEPTED','PREPARING','AT_RISK','OUT_FOR_DELIVERY','ARRIVING']){
 const markup=draw(status);
 assert.ok(markup.includes('Próxima ação'),'Missing simple next step: '+status);
 assert.ok(markup.includes('merchant-live-actions'),'Missing mobile action surface: '+status);
 assert.ok(!markup.includes('<img'),'Protected address or unescaped text: '+status);
}
const preparing=draw('PREPARING');
assert.ok(preparing.includes('<details class="merchant-order-exception">'),
 'Failure action should be accessible without competing with dispatch');
assert.ok(preparing.includes('merchantLiveCannotFulfill('),'Failure recovery remains available');
assert.ok(preparing.includes('Confirmar saída'),'Dispatch confirmation remains explicit');
assert.ok(!draw('OFFERED_TO_MERCHANT').includes('Qual foi o problema?'),
 'No post-acceptance failure action before acceptance');
assert.ok(draw('ARRIVING').includes('Pagamento recebido')&&draw('ARRIVING').includes('live-pin-'),
 'PIN and payment proof must remain mandatory');
assert.ok(css.includes('.merchant-join-form')&&css.includes('.merchant-order-next'));
assert.ok(css.includes('@media(max-width:520px)'),'Mobile layout must have a narrow breakpoint');

let submitted=0, release;
const held=new Promise(resolve=>{release=resolve;});
const fields={'#j-cnpj':'12345678000190','#j-name':'Minha Revenda','#j-owner':'João',
 '#j-phone':'55999999999','#j-address':'Rua das Flores, 100'};
const button={disabled:false,textContent:'Enviar cadastro',dataset:{}};
const focused=[];
const document={
 querySelector(selector){
  if(selector in fields)return {value:fields[selector]};
  if(selector==='.merchant-join-form button[type="submit"]')return button;
  return null;
 },
 querySelectorAll:()=>[],
 getElementById:id=>({setAttribute:()=>{},focus:()=>focused.push(id)})
};
const submitContext=vm.createContext({
 document,globalThis:userGlobal,onlyDigits:v=>String(v).replace(/\D/g,''),
 isValidCnpjShape:()=>true,isValidPhoneShape:v=>{const n=String(v).replace(/[^0-9]/g,'');return n.length===10||n.length===11;},
 merchantJoinInvalid:(id)=>focused.push(id),toast:()=>{},go:()=>{},render:()=>{},
 merchantSubmitApplicationLive:()=>{submitted++;return held;},
 currentMerchantProspectInviteToken:()=>'',currentMerchantPilotInviteToken:()=>''
});
vm.runInContext(functionSource(growth,'joinMerchant')+';this.submit=joinMerchant;',submitContext);
const first=submitContext.submit();
const duplicate=submitContext.submit();
assert.equal(submitted,1,'Double tap must not create duplicate submissions');
assert.equal(button.disabled,true,'Submit must be disabled during request');
release({companyName:'Minha Revenda'});
await Promise.all([first,duplicate]);
assert.equal(button.disabled,false,'Submit must recover after request');
assert.equal(button.dataset.submitting,'false');

fields['#j-phone']='xx';
await submitContext.submit();
assert.equal(focused.at(-1),'j-phone','Invalid phone should receive focus');
assert.equal(submitted,1,'Invalid phone must not hit backend');

console.log('V1.169: merchant one-screen forms, safe prefill, resubmission states, duplicate guard, focus and status-driven order actions passed.');
