import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const merchant=fs.readFileSync(new URL('../js/merchant.js',import.meta.url),'utf8');
const edge=fs.readFileSync(new URL('../supabase/functions/merchant-ops/index.ts',import.meta.url),'utf8');
const migration=fs.readFileSync(new URL('../supabase/migrations/20261105181000_merchant_benefits_contract_v1_842.sql',import.meta.url),'utf8');
const deferred=fs.readFileSync(new URL('../js/merchant-benefits-contract.js',import.meta.url),'utf8');
const from=deferred.indexOf('function merchantBenefitsContractRender(rt){');
const to=deferred.indexOf('async function merchantBenefitsContractAct(operation){',from);
assert.ok(from>=0&&to>from);
assert.ok(merchant.includes('merchant-benefits-contract.js'));
assert.ok(merchant.includes('function merchantBenefitsContractSection(r)'));
assert.ok(merchant.includes('${merchantBenefitsContractSection(rt)}'));
assert.match(edge,/"benefits-contract"/,'legacy contract action remains available');
assert.ok(edge.includes('p_actor:user.id,p_merchant:merchantId,p_operation:operation'));
assert.ok(edge.includes('merchant_benefits_contract_v1_842'));
assert.ok(edge.includes('role!=="owner"'));
for(const text of [
 'merchant_benefit_events_immutable_v1_842_trg',
 'merchant_benefit_participations_v1_842',
 'on conflict(merchant_id) do update',
 'MERCHANT_BENEFIT_VERSION_STALE',
 'MERCHANT_BENEFIT_REPLAY_CONFLICT',
 'MERCHANT_BENEFIT_OWNER_REQUIRED',
 'p_consent is distinct from true',
 "p_operation is null",
 'legacyCouponRightsPreserved',
 "'feeReductionEnabled',false",
 "'checkoutBenefitsEnabled',false",
 'from public,anon,authenticated'
])assert.ok(migration.includes(text),text);
assert.doesNotMatch(migration,/update public\.(?:orders|platform_receivables|merchant_cashback_reimbursements|clube_coupon_paid_order_applications|merchant_billing_plans)/i);

const id='11111111-1111-4111-8111-111111111111';
let emitted=[],calls=[],readState={optedIn:false,version:0},rendered=0;
const packet=(operation)=>({source:'merchant_benefits_contract_v1_842',merchantId:id,
 readOnly:operation==='view',optedIn:readState.optedIn,version:readState.version,
 termsVersion:1,termsText:'Condições verificadas sem ativação financeira '.repeat(9),
 normalFlexFeeBps:900,memberFlexFeeBps:800,maxWelcomeDiscountCents:100,
 checkoutBenefitsEnabled:false,feeReductionEnabled:false,
 noCurrentFinancialMutation:true,legacyCouponRightsPreserved:true,
 productWelcomeCheckoutEnabled:true,productWelcomeFeeReductionEnabled:true,
 productWelcomeOnlyWhenApplied:true,partnerFundedPaidCouponsEnabled:false,
 partnerFundedOtherCashbackEnabled:false});
const runtime={merchant:{merchantId:id,memberRole:'owner'}};
const ctx={globalThis:{merchantRuntime:runtime},Number,String,
 esc:s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
 toast:s=>emitted.push(s),
 render:()=>{rendered++},
 confirm:()=>true,
 document:{getElementById:()=>({checked:true})},
 crypto:{randomUUID:()=>String('33333333-3333-4333-8333-333333333333')},
 merchantInvoke:async(_,args)=>{calls.push(args);
  if(args.operation==='accept')readState={optedIn:true,version:1};
  if(args.operation==='revoke')readState={optedIn:false,version:2};
  return packet(args.operation);
 }};
vm.runInNewContext(deferred,ctx);
let html=ctx.merchantBenefitsContractRender(runtime);
assert.match(html,/Consultar condições/);
assert.doesNotMatch(html,/Confirmar adesão/);
await ctx.merchantBenefitsContractAct('view');
html=ctx.merchantBenefitsContractRender(runtime);
assert.match(html,/Confirmar adesão/);
assert.match(html,/9%/);assert.match(html,/8%/);
assert.match(html,/não gera Pix/);
assert.match(html,/8% vale só para o pedido/);
assert.match(html,/Cupons pagos e cashback anterior preservam seus direitos/);
assert.doesNotMatch(html,/Benefícios nas compras só serão ativados/);
assert.equal(calls.length,1);
await ctx.merchantBenefitsContractAct('accept');
assert.equal(calls.length,3,'write followed by authenticated readback');
assert.equal(runtime.merchantBenefitsContract.version,1);
assert.match(ctx.merchantBenefitsContractRender(runtime),/Revogar para novas compras/);
await ctx.merchantBenefitsContractAct('revoke');
assert.equal(calls.length,5);
assert.equal(runtime.merchantBenefitsContract.version,2);
assert.equal(runtime.merchantBenefitsContract.optedIn,false);
runtime.merchant.memberRole='manager';
await ctx.merchantBenefitsContractAct('accept');
assert.equal(calls.length,5,'manager cannot sign');
runtime.merchant.memberRole='operator';
assert.equal(ctx.merchantBenefitsContractRender(runtime),'','operator cannot see contract');
runtime.merchant.memberRole='owner';
runtime.merchantBenefitsContract={...packet('view'),termsText:'<script>alert(1)</script>'};
assert.doesNotMatch(ctx.merchantBenefitsContractRender(runtime),/<script>/);
runtime.merchant={merchantId:'22222222-2222-4222-8222-222222222222',memberRole:'owner'};
assert.doesNotMatch(ctx.merchantBenefitsContractRender(runtime),/<script>/);
assert.ok(rendered>=3);
console.log('TAMÃO #842: revenda consent UI, role gate, fresh readback, XSS protection, no premature financial activation.');

 // Deferred asset recovery: no mutation, no mixed release and no retry storm.
const loaderStart=merchant.indexOf('const merchantDeferredBenefitStates=new Map();');
const loaderEnd=merchant.indexOf('function merchantBillingLiveView(rt){',loaderStart);
const receiptStart=merchant.indexOf('function merchantOrderBenefitDisclosure(o,demo=false){');
const receiptEnd=merchant.indexOf('function merchantLiveOrder(o){',receiptStart);
assert.ok(loaderStart>=0&&loaderEnd>loaderStart&&receiptStart>=0&&receiptEnd>receiptStart);
const scripts=[];
let redraws=0;
let timerSequence=0;
const timers=new Map();
const loaderCtx=vm.createContext({URL,location:{href:'https://parceiro.tamao.com.br/'},
 setTimeout:(fn,ms)=>{assert.equal(ms,20000);const id=++timerSequence;timers.set(id,fn);return id;},
 clearTimeout:id=>timers.delete(id),
 document:{querySelector:()=>({src:'https://parceiro.tamao.com.br/js/merchant.js?v=release-123'}),
 createElement:()=>({remove(){this.removed=true;}}),head:{append:s=>scripts.push(s)}},
 render:()=>redraws++});
vm.runInContext(merchant.slice(loaderStart,loaderEnd)+merchant.slice(receiptStart,receiptEnd),loaderCtx);
const own={merchant:{memberRole:'owner'}};
assert.equal(loaderCtx.merchantBenefitsContractSection({merchant:{memberRole:'driver'}}),'');
assert.equal(scripts.length,0);
assert.match(loaderCtx.merchantBenefitsContractSection(own),/Carregando/);
assert.equal(scripts[0].src,'./js/merchant-benefits-contract.js?v=release-123');
loaderCtx.merchantBenefitsContractSection(own);
assert.equal(scripts.length,1);
scripts[0].onerror();
assert.equal(scripts[0].removed,true);
assert.match(loaderCtx.merchantBenefitsContractSection(own),/Tentar novamente/);
assert.equal(scripts.length,1,'render must not cause automatic retries');
loaderCtx.merchantRetryBenefitModule('contract');
assert.equal(scripts.length,2);
scripts[1].onload();
assert.match(loaderCtx.merchantBenefitsContractSection(own),/Tentar novamente/,'missing export is failure');
loaderCtx.merchantRetryBenefitModule('contract');
loaderCtx.merchantBenefitsContractRender=()=>'<div>Contrato carregado</div>';
scripts[2].onload();
assert.match(loaderCtx.merchantBenefitsContractSection(own),/Contrato carregado/);
assert.equal(loaderCtx.merchantOrderBenefitDisclosure({cashbackReservedCents:0}),'');
assert.match(loaderCtx.merchantOrderBenefitDisclosure({cashbackReservedCents:100}),/Benefício em conferência/);
assert.equal(scripts[3].src,'./js/merchant-order-benefits.js?v=release-123');
scripts[3].onerror();
assert.match(loaderCtx.merchantOrderBenefitDisclosure({cashbackReservedCents:100}),/Tentar novamente/);
loaderCtx.merchantRetryBenefitModule('receipt');
loaderCtx.merchantOrderBenefitDisclosureImpl=()=>'<div>Benefício conferido</div>';
scripts[4].onload();
assert.match(loaderCtx.merchantOrderBenefitDisclosure({cashbackReservedCents:100}),/Benefício conferido/);
loaderCtx.merchantRetryBenefitModule('../other');
assert.equal(scripts.length,5,'unknown asset must never load');
assert.ok(redraws>=5);
assert.equal(timers.size,0,'all settled attempts must clear their timeout');
// Simulate a stalled download and a late callback after an explicit retry.
delete loaderCtx.merchantBenefitsContractRender;
assert.match(loaderCtx.merchantBenefitsContractSection(own),/Carregando/);
assert.equal(scripts.length,6);
assert.equal(timers.size,1);
const oldScript=scripts[5];
const timeout=[...timers.values()][0];
timeout();
assert.equal(oldScript.removed,true);
assert.equal(timers.size,0);
assert.match(loaderCtx.merchantBenefitsContractSection(own),/Tentar novamente/);
assert.equal(scripts.length,6,'timeout must not trigger automatic retry');
loaderCtx.merchantRetryBenefitModule('contract');
assert.equal(scripts.length,7);
const beforeLate=redraws;
oldScript.onerror();
oldScript.onload();
assert.equal(redraws,beforeLate,'late callbacks cannot redraw or settle newer attempt');
assert.match(loaderCtx.merchantBenefitsContractSection(own),/Carregando/);
assert.equal(timers.size,1);
loaderCtx.merchantBenefitsContractRender=()=>'<div>Contrato recuperado</div>';
scripts[6].onload();
assert.match(loaderCtx.merchantBenefitsContractSection(own),/Contrato recuperado/);
assert.equal(timers.size,0);
// A synchronous insertion error also clears the timer without recursive render.
delete loaderCtx.merchantBenefitsContractRender;
loaderCtx.document.head.append=()=>{throw new Error('blocked insertion');};
const beforeInsertion=redraws;
assert.match(loaderCtx.merchantBenefitsContractSection(own),/Tentar novamente/);
assert.equal(timers.size,0);
assert.equal(redraws,beforeInsertion);
console.log('PASS: versioned deferred benefits, explicit recovery, timeout, stale callbacks and valid export check.');
