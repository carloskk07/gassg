import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261120190000_ads_credit_wallet_v1_1097.sql');
const edge=read('supabase/functions/ads-credit/index.ts');
const webhook=read('supabase/functions/ads-payment-webhook-mercadopago/index.ts');
const client=read('js/ads-credits.js');
const planner=read('js/ads-planner.js');
const css=read('css/ads-credits.css');
const config=read('supabase/config.toml');
const sponsor=read('js/sponsors-premium.js');
assert.doesNotThrow(()=>new vm.Script(client));
assert.doesNotThrow(()=>new vm.Script(planner));
assert.doesNotThrow(()=>new vm.Script(sponsor));
for(const phrase of [
 'recharge_enabled boolean NOT NULL DEFAULT false',
 'view_debit_enabled boolean NOT NULL DEFAULT false',
 'evidence_audited boolean NOT NULL DEFAULT false',
 'CHECK (NOT view_debit_enabled OR (recharge_enabled AND evidence_audited))',
 'ads_credit_wallets_v1_1097','ads_credit_topups_v1_1097',
 'ads_credit_ledger_v1_1097','ads_credit_verified_views_v1_1097',
 'ads_credit_topup_claim_v1_1097','ads_credit_topup_attach_v1_1097',
 'ads_credit_payment_fact_v1_1097','ads_credit_debit_verified_v1_1097',
 'ADS_CREDIT_AUDITED_PROOF_REQUIRED','ADS_CREDIT_RECHARGE_DISABLED',
 'ADS_CREDIT_PENDING_TOPUP_EXISTS','ENABLE ROW LEVEL SECURITY',
 'FROM PUBLIC,anon,authenticated','GRANT EXECUTE ON FUNCTION',
 'FOR UPDATE','UNIQUE','payment_id','view','reversal'
])assert.ok(sql.includes(phrase),'Prepaid ledger guard missing: '+phrase);
assert.ok(sql.includes('recharge_enabled AND view_debit_enabled'));
assert.ok(sql.includes("status IN('reserved','creating','pix_pending')"));
assert.ok(sql.includes("frozen=true"));
assert.ok(sql.includes('GREATEST')||sql.includes('least(w.balance_cents'));
assert.ok(!sql.includes('UPDATE public.ads_independent_checkouts_v1_886'));
assert.ok(!sql.includes('UPDATE public.ads_independent_campaigns_v1_884'));
for(const phrase of [
 'auth.getUser','is_anonymous','email_confirmed_at',
 'independentAdsCredentialConfig','verifyIndependentAdsSeller',
 'adsPixProof','selectIndependentAdsPayment','readMercadoPagoJson',
 'ads_credit_topup_reserve_v1_1097','ads_credit_topup_claim_v1_1097',
 'ads_credit_topup_attach_v1_1097','ads_credit_payment_fact_v1_1097',
 'idempotencyKey','getPayment','ADS_CREDIT_PAYMENT_PENDING',
 'ADS_CREDIT_PAYMENT_NOT_CONFIGURED'
])assert.ok(edge.includes(phrase),'Secure credit endpoint guard missing: '+phrase);
assert.match(webhook,/tamao-ads-credit-\[0-9a-f\]/);
assert.match(webhook,/ads_credit_payment_fact_v1_1097/);
assert.match(webhook,/verifyMercadoPagoWebhook/);
assert.match(webhook,/payment\?\.live_mode!==true\|\|payment\?\.payment_method_id!=="pix"/);
assert.ok(config.includes('[functions.ads-credit]\nverify_jwt = false'));
assert.ok(planner.includes('ads-credits.js'));
assert.ok(sponsor.includes('id="tamao-credit-mount"'));
assert.ok(css.includes('.tamao-credit-wallet')||css.includes('.tamao-credit-workspace'));
for(const p of ['tamaoCreditRefresh','tamaoCreditTopup','tamaoCreditChoose',
 'tamaoCreditCopyPix','tamaoCreditActor','acceptCreditTerms:true','tamaoCreditBoot',
 'Não foi possível consultar o saldo','Créditos de publicidade'])assert.ok(client.includes(p));
assert.ok(!client.includes('MERCADOPAGO_ACCESS_TOKEN'));
assert.ok(!client.includes('service_role'));
assert.match(client,/rechargeEnabled===true&&d\.billingEnabled===true/);
const dom={getElementById:()=>null};
const context={document:dom,globalThis:{liveRuntime:{session:null}},Date,Intl,console};
vm.createContext(context);
vm.runInContext(client+';this.money=tamaoCreditMoney;this.choose=tamaoCreditChoose;',context);
assert.equal(context.money(1990),'R$ 19,90');
assert.equal(context.choose(999),false);
assert.equal(context.choose(19990),true);

assert.ok(sql.includes("'pixCode',CASE WHEN t.status='pix_pending'"),
 'Owner must be able to recover a valid Pix after page refresh');
assert.ok(client.includes("tamaoCreditDraftSave")&&client.includes("tamaoCreditDraftRestore"),
 'The campaign draft must survive credit plan changes and wallet refreshes');
assert.ok(client.includes('tamaoCreditReconcile(&quot;'),
 'Pending Pix confirmation must be reachable directly from payment history');
const ids={
 'tamao-credit-c-advertiser':{value:'Minha loja'},
 'tamao-credit-c-title':{value:'Campanha especial do comércio'},
 'tamao-credit-c-description':{value:'Conheça nossa empresa e nossos serviços na região.'},
 'tamao-credit-c-city':{value:'São Gabriel'},
 'tamao-credit-c-state':{value:'RS'},
 'tamao-credit-c-destination':{value:'https://example.com'},
 'tamao-credit-c-terms':{checked:true}
};
const ui={
 document:{getElementById:key=>ids[key]||null},
 globalThis:{liveRuntime:{session:{user:{id:'owner-1'}}}},
 tamaoAdsAccountVerified:()=>true,
 Date,Intl,console
};
vm.createContext(ui);
vm.runInContext(client+';this.draftReset=tamaoCreditDraftReset;'+
 'this.draftSave=tamaoCreditDraftSave;this.draftRestore=tamaoCreditDraftRestore;',ui);
ui.draftReset('owner-1');
ui.draftSave();
ids['tamao-credit-c-title'].value='';
ids['tamao-credit-c-terms'].checked=false;
ui.draftRestore();
assert.equal(ids['tamao-credit-c-title'].value,'Campanha especial do comércio');
assert.equal(ids['tamao-credit-c-terms'].checked,true);
ui.draftReset('owner-2');
ui.draftRestore();
assert.equal(ids['tamao-credit-c-title'].value,'');
assert.equal(ids['tamao-credit-c-terms'].checked,false,
 'Campaign consent must not leak to another advertiser');

console.log('PASS V1.1097: privacy, false-by-default financial gates, idempotent credit reconciliation, private wallet and no legacy financial mutation.');
