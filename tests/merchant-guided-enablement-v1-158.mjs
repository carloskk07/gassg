import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261010200000_merchant_guided_enablement_v1_158.sql');
const original=read('supabase/migrations/20261010163000_merchant_enablement_diagnostic_v1_157.sql');
const edge=read('supabase/functions/merchant-ops/index.ts');
const backend=read('js/backend.js');
const ui=read('js/merchant.js');
assert.ok(sql.includes('function public.merchant_enablement_diagnostic_v1_158(p_actor_user_id uuid,p_merchant_id uuid)'));
assert.ok(sql.includes('m.id=p_merchant_id'));
assert.ok(sql.includes('mm.merchant_id=m.id and mm.user_id=p_actor_user_id'));
assert.ok(sql.includes("mm.active and mm.member_role in ('owner','manager')"));
assert.ok(sql.includes('limit 1'));
assert.ok(sql.includes('public.market_city_offer_scope(t.city,t.state)'),'canonical offer scope decides readiness');
assert.ok(sql.includes("revoke all on function public.merchant_enablement_diagnostic_v1_158(uuid,uuid)"));
assert.ok(sql.includes('from public,anon,authenticated'));
assert.ok(sql.includes('grant execute on function public.merchant_enablement_diagnostic_v1_158(uuid,uuid)'));
assert.ok(sql.includes('to service_role'));
assert.ok(!/update public\.|insert into public\.|delete from public\./i.test(sql));
for(const gate of ["merchant_allowed_in_operation_mode","merchant_cnpj_compliance_current",
  "merchant_anp_compliance_current","merchant_financial_sales_allowed","catalog_items",
  "merchant_payment_methods","merchant_payment_routes","market_cities","platform_launch_control",
  "public.market_city_offer_scope"]){
  assert.ok(sql.includes(gate),'missing gated check '+gate);
  assert.ok(original.includes(gate),'not present in admin baseline '+gate);
}
assert.ok(edge.includes('"enablement","heartbeat"'));
assert.ok(edge.includes('if(action==="enablement")'));
assert.ok(edge.includes('if(!canManage(role))'),'owner/manager gate before RPC');
assert.ok(edge.includes('.eq("merchant_id",merchantId)'));
assert.ok(edge.includes('.eq("user_id",user.id)'));
assert.ok(edge.includes('.eq("active",true)'));
assert.ok(edge.includes('p_actor_user_id:user.id,p_merchant_id:merchantId'));
assert.ok(edge.includes('x.merchant_id===merchantId'));
assert.ok(edge.includes('readOnly:true,source:"market_city_offer_scope"'));
assert.ok(!edge.includes('action:"activate-merchant"'),'merchant may never activate via assistant');

assert.ok(backend.includes('merchantLoadEnablement({force=false}={})'));
assert.ok(backend.includes("merchantInvoke('merchant-ops',{merchantId,action:'enablement'})"));
assert.ok(backend.includes('String(merchantRuntime.session?.user?.id||'));
assert.ok(backend.includes('attemptSeq!==merchantRuntime.enablementSeq'));
assert.ok(backend.includes('merchantRuntime.enablementSeq++'));
assert.ok(backend.includes('MERCHANT_ENABLEMENT_CACHE_MS=3*60*1000'));
assert.ok(backend.includes('&&!merchantRuntime.enablementFetchedAt'),'never repoll diagnostic on every 15s merchant order refresh');
assert.ok(backend.includes('merchantClearEnablement();'),'logout and merchant switch clear state');
assert.ok(backend.includes('merchantEnablementAfterChange();'));
assert.ok(backend.includes('merchantLoadEnablement({force:true})'));
assert.ok(ui.includes('merchantEnablementAssistantView(rt)'));
assert.ok(ui.includes('merchantEnablementFocus(key)'));
assert.ok(ui.includes("if(key==='inventory'){go('catalog');return}"));
assert.ok(ui.includes("merchantEnablementRecheck()"));
assert.ok(ui.includes('Somente')===false||ui.includes('Preparar minha revenda'));
assert.ok(ui.includes('Este roteiro não aprova documentos, não libera pagamentos'));
assert.ok(ui.includes('Atende minha cidade'),'no municipality hardcoding');
assert.ok(!ui.includes('Atende São Gabriel'));

function excerpt(source,signature){
  const start=source.indexOf(signature);
  assert.ok(start>=0,signature);
  const next=source.indexOf('\n}',start);
  assert.ok(next>start,signature+' has closing brace');
  return source.slice(start,next+2);
}
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const sandbox={esc,formatDateTime:()=> '10/10/2026'};
vm.runInNewContext(excerpt(ui,'function merchantEnablementCheckView(')+
 '\n'+excerpt(ui,'function merchantEnablementAssistantView(')+
 ';this.draw=merchantEnablementAssistantView;',sandbox);
const rt={merchant:{merchantId:'c1',memberRole:'owner'},enablement:{
 merchant_id:'c1',ready:false,checked_at:new Date().toISOString(),checks:[
  {key:'payment_route',label:'<script>alert(1)</script>',ok:false,
   owner:'merchant',action:'<img src=x onerror=alert(1)>',scope:'merchant'},
  {key:'cnpj',label:'CNPJ',ok:false,owner:'admin',action:'Validar',scope:'merchant'},
  {key:'online',label:'Disponibilidade',ok:true,owner:'merchant',action:'',scope:'realtime'}]
 }};
const html=sandbox.draw(rt);
assert.ok(html.includes('O que sua revenda pode resolver'));
assert.ok(html.includes('Validações e condições adicionais'));
assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
assert.ok(!html.includes('<script>')&&!html.includes('<img'));
assert.ok(html.includes('Ir para configuração'));
assert.ok(!sandbox.draw({...rt,merchant:{merchantId:'c1',memberRole:'operator'}}),'operator does not view sensitive readiness');
assert.ok(!sandbox.draw({...rt,merchant:{merchantId:'c1',memberRole:'driver'}}),'driver denied');
const missing=sandbox.draw({...rt,enablement:{...rt.enablement,merchant_id:'different'}});
assert.ok(missing.includes('Verificação ainda não concluída'),'stale data of other merchant never displayed');
console.log('V1.158: isolation owner/manager, canonical readiness, fast poll budget, secure UI and XSS validated.');
