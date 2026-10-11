import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(p)=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const migration=read('supabase/migrations/20261011043000_delivery_first_payment_boundary_v1_158_1.sql');
const offers=read('supabase/functions/get-offers/index.ts');
const orderCreate=read('supabase/functions/create-order/index.ts');
const orderRead=read('supabase/functions/get-order/index.ts');
const checkout=read('supabase/functions/order-payment-checkout/index.ts');
const merchant=read('js/merchant.js');
const customer=read('js/customer.js');

function ensureSourcePart(source, required, message){
  for(const fragment of required){
    assert.ok(source.includes(fragment),message+': '+fragment);
  }
}

ensureSourcePart(migration,[
  "add column if not exists payment_timing text not null default 'on_delivery'",
  "add column if not exists payment_timing_requested text not null default 'on_delivery'",
  "check (payment_timing in ('on_delivery','prepaid'))",
  'create or replace function public.merchant_delivery_payment_allowed',
  "and r.channel='delivery'",
  "and r.verification_mode='merchant_confirmed'",
  "and pm.payment_method=p_payment_method and pm.active",
  "create trigger guard_new_order_delivery_payment_trg",
  'ORDER_DELIVERY_PAYMENT_ROUTE_NOT_AUTHORIZED',
  'ORDER_PAYMENT_TIMING_IMMUTABLE',
  'create trigger guard_new_prepaid_attempt_trg',
  'PREPAID_PAYMENT_NOT_AUTHORIZED',
  "and o.payment_timing='prepaid'",
  "and r.channel='online'",
  "and r.verification_mode='provider_api'",
  "and catalog.adapter_status='implemented'",
  'create or replace function public.market_city_offer_scope',
  'public.merchant_delivery_payment_allowed(m.id,pm.payment_method)',
  'public.merchant_operational_compliance_current(m.id)',
  'public.merchant_financial_sales_allowed(m.id)',
  'mc.admin_paused',
  'revoke all on function public.merchant_delivery_payment_allowed',
  'grant execute on function public.merchant_delivery_payment_allowed',
], 'Server-only delivery and prepaid authorization must fail closed');

ensureSourcePart(offers,[
  '.from("merchant_payment_routes")',
  '.eq("channel","delivery")',
  '.eq("verification_mode","merchant_confirmed")',
  '.eq("active",true)',
  'paymentSet.has(m.id)&&deliveryPaymentSet.has(m.id)',
  'paymentMethod==="card"',
], 'Offer creation must be linked to the delivery capability, not just method flag');

ensureSourcePart(orderRead,[
  'payment_timing',
  'order.payment_timing==="prepaid"',
  '.eq("channel","online")',
  '.eq("verification_mode","provider_api")'
], 'Order read must not show a hosted checkout for delivery-only orders');

ensureSourcePart(checkout,[
  'orderAuthority.payment_timing!=="prepaid"',
  'ORDER_PAYMENT_ON_DELIVERY',
  '.eq("channel","online")',
  '.eq("verification_mode","provider_api")',
  'PREPAID_PAYMENT_NOT_AUTHORIZED',
  'NO_AUTOMATED_PAYMENT_ROUTE'
], 'Checkout must reject forged prepaid requests and delivery routes');

ensureSourcePart(orderCreate,[
  'ORDER_DELIVERY_PAYMENT_ROUTE_NOT_AUTHORIZED',
  'create_order_from_quote_v8'
], 'Order create must map capability loss to a recoverable 409');

ensureSourcePart(merchant,[
  "paymentMethod:'pix',provider:'manual',channel:'delivery'",
  "customerLabel:'Pix na entrega'",
  'merchantUpdatePaymentRoutesLive',
  "merchantDeclaredProvider:true",
  "automaticVerification:false"
], 'Merchant can opt into Pix on delivery without connecting any PSP');

ensureSourcePart(customer,[
  'Pix na entrega',
  'Cartão na maquininha da revenda',
  'Dinheiro na entrega',
  'Pagamento na entrega:',
  'o.paymentTiming==="prepaid"'
], 'Customer journey must describe who receives payment and when');

// Independent contract scenarios: verify intended modes against the route
// attributes used by both SQL and Edge. These are NOT database E2E tests.
const deliveryAllowed=(method,activeMethods,routes)=>
  ['cash','pix','card'].includes(method)
  &&activeMethods.includes(method)
  &&routes.some(route=>
    route.active===true && route.channel==='delivery'
    &&route.verificationMode==='merchant_confirmed'
    &&(route.paymentMethod===method
      ||(method==='card'&&['card_credit','card_debit'].includes(route.paymentMethod)))
  );
const manual=(paymentMethod,channel='delivery')=>
  ({active:true,paymentMethod,channel,verificationMode:'merchant_confirmed'});
const online=(paymentMethod)=>
  ({active:true,paymentMethod,channel:'online',verificationMode:'provider_api'});

const cases=[
  {title:'Pix manual na entrega',method:'pix',methods:['pix'],routes:[manual('pix')],allowed:true},
  {title:'Dinheiro na entrega',method:'cash',methods:['cash'],routes:[manual('cash')],allowed:true},
  {title:'Cartão em maquininha sem PSP integrado',method:'card',methods:['card'],routes:[manual('card')],allowed:true},
  {title:'Débito presencial declarado',method:'card',methods:['card'],routes:[manual('card_debit')],allowed:true},
  {title:'Pix externo não é Pix na entrega',method:'pix',methods:['pix'],routes:[manual('pix','external')],allowed:false},
  {title:'Pix online não libera recebimento presencial',method:'pix',methods:['pix'],routes:[online('pix')],allowed:false},
  {title:'PSP ativo não é autorização para dinheiro',method:'cash',methods:['cash'],routes:[online('card')],allowed:false},
  {title:'Método desativado prevalece sobre rota',method:'pix',methods:[],routes:[manual('pix')],allowed:false},
  {title:'Rota desativada não libera venda',method:'card',methods:['card'],routes:[{...manual('card'),active:false}],allowed:false},
  {title:'Método divergente deve falhar',method:'cash',methods:['cash'],routes:[manual('pix')],allowed:false},
];
for(const t of cases){
  assert.equal(deliveryAllowed(t.method,t.methods,t.routes),t.allowed,t.title);
}
console.log('V1.158.1 passou: 10 cenários de pagamento na entrega e guardas estáticas de backend, SQL e UI.');
