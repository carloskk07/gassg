import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const src=read('js/admin.js');
new vm.Script(src,{filename:'js/admin.js'});
function extract(name){
 const a=src.indexOf('function '+name+'(');
 const start=a<0?-1:src.lastIndexOf('\n',a)+1;
 assert.ok(start>=0,'Missing '+name);
 const end=src.indexOf('\n}',a);
 assert.ok(end>a,'Unterminated '+name);
 return src.slice(start,end+2);
}
const requestId='11111111-1111-4111-8111-111111111111';
const eventId='22222222-2222-4222-8222-222222222222';
const expected=12590;
const request={id:requestId,merchant_id:'33333333-3333-4333-8333-333333333333',
 request_kind:'statement_payment',expected_amount_cents:expected,status:'pending',
 merchant_reference:'Pedido 135'};
const evidence={id:eventId,status:'matched_exact',payment_request_id:requestId,
 provider:'mercadopago',provider_event_id:'mp_event_123',amount_cents:expected,
 payment_method:'pix',reconciliation_key:'E1234567890987654321'};
const bill={paymentRequests:[request],paymentEvents:[]};
const rt={status:'ready',lastSyncAt:new Date().toISOString(),data:{merchantBilling:bill}};
let role='finance',actions=[],toasts=[],confirms=[],prompts=0,confirmation=true;
const money=n=>'R$ '+(n/100).toFixed(2).replace('.',',');
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const fields={checked:{checked:true},note:{value:'Extrato bancário verificado'},
 amount:{value:'125,90'},method:{value:'pix'},key:{value:'E1234567890987654321'}};
const root={querySelector:sel=>{
 const key=['checked','note','amount','method','key'].find(x=>sel.endsWith('-'+x));
 return fields[key]||null;
}};
const ctx=vm.createContext({
 adminRuntime:rt,adminMoney:money,esc,Date,Number,
 adminRoleCanSection:key=>key==='finance'&&['finance','superadmin'].includes(role),
 adminMerchantName:()=> 'Revenda Alfa',adminPaymentMethodLabel:x=>x,
 adminPerform:async(action,body)=>actions.push({action,body}),
 toast:x=>toasts.push(x),prompt:()=>{prompts++;throw Error('Guided review must not prompt')},
 confirm:txt=>{confirms.push(txt);return confirmation},
 document:{getElementById:id=>id==='admin-billing-review-'+requestId?root:null}
});
vm.runInContext(['adminNormalizePaymentMethod','adminParseMoneyToCents',
 'adminBillingGuidedReview','adminResolveBillingPaymentRequest',
 'adminSubmitBillingGuidedReview'].map(extract).join('\n')
 +'\nthis.guide=adminBillingGuidedReview;this.submit=adminSubmitBillingGuidedReview;',ctx);
let html=ctx.guide(request,null);
for(const label of ['Revisar recebimento em 3 etapas','Confira a cobrança',
 'Confira a origem do dinheiro','Registre a evidência','Revenda Alfa',
 'R$ 125,90','Meio de pagamento realmente recebido','Identificador único',
 'Conferi o recebimento','Confirmar recebimento com revisão'])
 assert.ok(html.toLowerCase().includes(label.toLowerCase()),'Missing '+label);
assert.ok(html.includes('<select')&&html.includes('<textarea'));
assert.ok(html.includes("type='checkbox'"));
assert.ok(!html.includes('adminPerform('));
assert.ok(!html.includes(' disabled'));
await ctx.submit(requestId);
assert.equal(actions.length,1);
assert.equal(actions[0].action,'merchant-billing-payment-request');
assert.equal(actions[0].body.paymentRequestId,requestId);
assert.equal(actions[0].body.receivedAmountCents,expected);
assert.equal(actions[0].body.requestAction,'approve');
assert.equal(actions[0].body.paymentMethod,'pix');
assert.equal(actions[0].body.reconciliationKey,'E1234567890987654321');
assert.equal(actions[0].body.reference,'Extrato bancário verificado');
assert.equal(actions[0].body.paymentEventId,null);
assert.equal(confirms.length,1,'Final confirm must remain');
assert.equal(prompts,0,'Single form replaces serial prompts');
fields.checked.checked=false;
await ctx.submit(requestId);
assert.equal(actions.length,1,'Unchecked evidence must fail');
fields.checked.checked=true;
fields.amount.value='125,91';
await ctx.submit(requestId);
assert.equal(actions.length,1,'Wrong amount must fail');
fields.amount.value='125,90';fields.method.value='';
await ctx.submit(requestId);
assert.equal(actions.length,1,'Missing payment method must fail');
fields.method.value='pix';fields.key.value='ab';
await ctx.submit(requestId);
assert.equal(actions.length,1,'Transaction id must be unique-style');
fields.key.value='E1234567890987654321';fields.note.value='x';
await ctx.submit(requestId);
assert.equal(actions.length,1,'Audit reference required');
fields.note.value='Extrato bancário verificado';
confirmation=false;
await ctx.submit(requestId);
assert.equal(actions.length,1,'Cancelled final confirmation must not move funds');
confirmation=true;
bill.paymentEvents=[evidence];
html=ctx.guide(request,evidence);
assert.ok(html.includes('Prova PSP vinculada'));
assert.ok(html.includes(evidence.reconciliation_key));
assert.ok(!html.includes("id='admin-billing-review-"+requestId+"-amount'"),'PSP proof not editable');
await ctx.submit(requestId);
assert.equal(actions.length,2);
assert.equal(actions[1].body.paymentEventId,eventId);
assert.equal(actions[1].body.receivedAmountCents,expected);
assert.equal(actions[1].body.reconciliationKey,evidence.reconciliation_key);
const twin={...evidence,id:'44444444-4444-4444-8444-444444444444'};
bill.paymentEvents=[evidence,twin];
assert.ok(ctx.guide(request,null,true).includes('A confirmação está bloqueada'));
assert.ok(ctx.guide(request,null,true).includes('disabled'));
await ctx.submit(requestId);
assert.equal(actions.length,2,'Two exact matches cannot be chosen');
bill.paymentEvents=[evidence];
evidence.amount_cents=expected+1;
await ctx.submit(requestId);
assert.equal(actions.length,2,'Wrong PSP amount blocks');
evidence.amount_cents=expected;
request.status='approved';await ctx.submit(requestId);
assert.equal(actions.length,2,'Resolved request blocks replay');
request.status='pending';
rt.lastSyncAt=new Date(Date.now()-12*60000).toISOString();
assert.ok(ctx.guide(request,evidence).includes('desatualizado'));
await ctx.submit(requestId);
assert.equal(actions.length,2,'Stale data blocks');
rt.lastSyncAt=new Date().toISOString();
role='operations';assert.equal(ctx.guide(request,evidence),'');
await ctx.submit(requestId);assert.equal(actions.length,2);
role='readonly';assert.equal(ctx.guide(request,evidence),'');
role='superadmin';assert.ok(ctx.guide(request,evidence));
await ctx.submit('bad-id');assert.equal(actions.length,2);
rt.status='unauthenticated';await ctx.submit(requestId);assert.equal(actions.length,2);
const card=extract('adminBillingPaymentRequestCard');
assert.ok(card.includes('adminBillingGuidedReview(request,matchedEvent,hasConflict)'));
assert.ok(card.includes('Rejeitar com justificativa'));
const evCard=extract('adminBillingPaymentEventCard');
assert.ok(evCard.includes('adminFocusFinanceRecord'));
assert.ok(src.includes('globalThis.adminSubmitBillingGuidedReview=adminSubmitBillingGuidedReview;'));
assert.ok(src.includes('if(!confirm(message))return;'));
assert.ok(src.includes("await adminPerform('merchant-billing-payment-request'"));
assert.ok(!src.includes('admin_finance_merchant_performance_v1_190'));
const css=read('css/components.css');
assert.ok(css.includes('.admin-billing-guided-review'));
assert.ok(css.includes('@media(max-width:500px)'));
assert.ok(css.includes('.admin-billing-guide-check input'));
assert.ok(read('.github/workflows/audit.yml').includes('node tests/admin-finance-guided-review-v1-194.mjs'));
console.log('V1.194: guided 3-step review, form proof, exact amount/PSP matching, mandatory confirmation, RBAC and freshness.');
