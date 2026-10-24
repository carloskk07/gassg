import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const edge=read('supabase/functions/merchant-orders/index.ts');
const merchant=read('js/merchant.js');
const start=edge.indexOf('async function merchantBusinessDraftFromApprovedApplication(');
const end=edge.indexOf('const ACTIVE_STATUSES=[',start);
assert.ok(start>=0&&end>start,'extract owner-only draft helper');
const code=edge.slice(start,end)
  .replaceAll(':any','').replaceAll(':string','')
  .replaceAll(':boolean','').replaceAll(':number','');
const ctx=vm.createContext({String,Number});
vm.runInContext(code+';this.suggest=merchantBusinessDraftFromApprovedApplication;',ctx);
const id='11111111-1111-4111-8111-111111111111';
const merchantRec={id,name:'Revenda modelo',cnpj:'12345678000190',status:'pending',address_text:'Rua de exemplo, 123'};
let requests=[],err=null,application={
 company_name:'Comercio Exemplo Ltda',
 responsible_name:'Proprietario Modelo',
 phone:'(55) 99999-8888',
 address_text:'Rua de exemplo, 123'
};
const db={from(table){
  assert.equal(table,'merchant_applications');
  const steps=[['from',table]];
  const builder={
    select(fields){steps.push(['select',fields]);return builder;},
    eq(key,value){steps.push(['eq',key,value]);return builder;},
    order(key,opts){steps.push(['order',key,opts]);return builder;},
    limit(n){steps.push(['limit',n]);return builder;},
    async maybeSingle(){requests.push(steps);return {data:application,error:err};}
  };
  return builder;
}};
const result=await ctx.suggest(db,id,merchantRec,'owner',false);
assert.equal(result.source,'previous_owner_application');
assert.equal(result.suggested,true);
assert.equal(result.verified,false);
assert.equal(result.legalName,'Comercio Exemplo Ltda');
assert.equal(result.tradeName,'Revenda modelo');
assert.equal(result.responsibleName,'Proprietario Modelo');
assert.equal(result.phone,'55999998888');
assert.equal(result.whatsapp,'55999998888');
assert.equal(result.addressText,'Rua de exemplo, 123');
assert.equal(result.postalCode,'');
assert.equal(result.city,'');
assert.equal(result.state,'');
assert.equal(requests.length,1);
assert.deepEqual(requests[0].filter(x=>x[0]==='eq').map(x=>[x[1],x[2]]),[
 ['applicant_user_id',id],['cnpj',merchantRec.cnpj],['status','approved']
]);
assert.deepEqual(requests[0].filter(x=>x[0]==='limit'),[['limit',1]]);
assert.doesNotMatch(code,/\.insert\(|\.update\(|\.delete\(|\.rpc\(/,
 'helper MUST NOT auto-create or verify a merchant');
assert.match(edge,/businessDraft=await merchantBusinessDraftFromApprovedApplication/);
assert.match(edge,/businessDraft,\s*status:merchant.status/);
assert.match(edge,/selected.member_role==="owner"/);
assert.match(edge,/assertPermanentMerchantUser/);
assert.match(edge,/selectMerchantMembership\(memberships,requestedMerchantId\)/);
const initialCalls=requests.length;
for(const [role,stored,status,cnpj] of [
 ['manager',false,'pending',merchantRec.cnpj],
 ['driver',false,'pending',merchantRec.cnpj],
 ['owner',true,'pending',merchantRec.cnpj],
 ['owner',false,'active',merchantRec.cnpj],
 ['owner',false,'pending','invalid-cnpj'],
]){
  const out=await ctx.suggest(db,id,{...merchantRec,status,cnpj},role,stored);
  assert.equal(out,null);assert.equal(requests.length,initialCalls,
    'no application read for non-owner, existing profile or active merchant');
}
application=null;
assert.equal(await ctx.suggest(db,id,merchantRec,'owner',false),null);
application={company_name:'<script>alert(1)</script>',responsible_name:'X',
  phone:'000-000',address_text:'<div>Injected</div>'};
const unsafe=await ctx.suggest(db,id,merchantRec,'owner',false);
assert.equal(unsafe.legalName,'');
assert.equal(unsafe.responsibleName,'');
assert.equal(unsafe.phone,'');
assert.equal(unsafe.whatsapp,'');
assert.equal(unsafe.addressText,'Rua de exemplo, 123',
  'unsafe application address falls back to existing merchant address, still unverified');
const noSafeAddress=await ctx.suggest(db,id,{
  ...merchantRec,address_text:'<script>bad address</script>'
},'owner',false);
assert.equal(noSafeAddress.addressText,'',
  'unsafe application and fallback addresses must both be ignored');
err={message:'connection down'};
assert.equal(await ctx.suggest(db,id,merchantRec,'owner',false),null,
  'draft lookup failure must not block merchant orders');
err=null;
const uiStart=merchant.indexOf('function merchantBusinessProfileView(rt){');
const uiEnd=merchant.indexOf('function merchantBusinessProfileFocus(){',uiStart);
assert.ok(uiStart>=0&&uiEnd>uiStart);
const htmlCode=merchant.slice(uiStart,uiEnd);
const view=vm.createContext({
  esc:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
});
vm.runInContext(htmlCode+';this.draw=merchantBusinessProfileView;',view);
const pending={merchant:{memberRole:'owner',status:'pending',businessDetails:null,
 businessDraft:result},actionPending:false};
const html=view.draw(pending);
assert.match(html,/Dados sugeridos do seu cadastro anterior/);
assert.match(html,/value="Comercio Exemplo Ltda"/);
assert.match(html,/value="55999998888"/);
assert.match(html,/Complete CEP, cidade e UF/);
assert.match(html,/Nenhum campo foi aprovado automaticamente/);
assert.match(html,/Salvar meus dados para conferência/);
assert.ok(!html.includes('value="São Gabriel"'),'city must not be invented');
const saved={city:'São Gabriel',state:'RS',postalCode:'97300000',
 addressText:'Centro 123',legalName:'Empresa Confirmada'};
const savedHtml=view.draw({...pending,merchant:{...pending.merchant,businessDetails:saved}});
assert.match(savedHtml,/Empresa Confirmada/);
assert.doesNotMatch(savedHtml,/Dados sugeridos do seu cadastro anterior/);
assert.doesNotMatch(view.draw({...pending,merchant:{...pending.merchant,memberRole:'manager'}}),
 /Razão social/,'manager must not see owner form');
const safeHtml=view.draw({...pending,merchant:{...pending.merchant,businessDraft:{
  ...result,legalName:'<svg onload=alert(1)>'
}}});
assert.doesNotMatch(safeHtml,/<svg onload/);
assert.match(safeHtml,/&lt;svg/);
console.log('PASS owner-only prior application suggestion is read-only, identity-bound, non-authoritative and safely rendered');
