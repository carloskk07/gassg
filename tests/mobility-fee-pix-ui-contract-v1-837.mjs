import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../js/mobility.js',import.meta.url),'utf8');
const edge=fs.readFileSync(new URL('../supabase/functions/mobility-fee-pix/index.ts',import.meta.url),'utf8');
const webhook=fs.readFileSync(new URL('../supabase/functions/billing-payment-webhook-mercadopago/index.ts',import.meta.url),'utf8');
const sql=fs.readFileSync(new URL('../supabase/migrations/20261105133000_mobility_fee_pix_invoices_v1_837.sql',import.meta.url),'utf8');
const model=fs.readFileSync(new URL('../supabase/migrations/20261105133100_mobility_fee_provider_balances_v1_837.sql',import.meta.url),'utf8');
const cfg=fs.readFileSync(new URL('../supabase/config.toml',import.meta.url),'utf8');
const ctx={console,Date,Intl,URL,URLSearchParams,FormData,
 BRL:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),
 document:{querySelector:()=>null,createElement:()=>({}),head:{appendChild(){}},addEventListener(){}},
 route:()=> 'mobility',render(){},esc:v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),
 CHAMA_BACKEND:{url:'https://project.supabase.co',publishableKey:'test-publicable'}};
ctx.globalThis=ctx;
vm.runInNewContext(source+';this.rt=mobilityRuntime;',ctx);
const s=ctx.rt,owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const benefits={eligibleDriver:true,version:2,normalFeeBps:900,memberFeeBps:800,
 termsText:'Termos de descontos para motoristas participantes'};
const fee={recordedCount:2,accruedCents:592,collectedCents:0,
 outstandingCents:592,collectionStatus:'not_collected',entries:[]};
s.user={id:owner};
s.program={plans:[],benefits,billing:fee};
let calls=0,slowResolve;
s.client={auth:{getSession:async()=>({data:{session:{user:{id:owner},access_token:'fixture.jwt'}},error:null})},
 rpc:async(name)=>{assert.equal(name,'mobility_billing_catalog_v1_826');
 return {data:{plans:[],benefits,billing:fee},error:null}}};
ctx.fetch=async(url,args)=>{
 calls++;
 assert.equal(url,'https://project.supabase.co/functions/v1/mobility-fee-pix');
 assert.equal(args.method,'POST');
 assert.equal(args.headers.Authorization,'Bearer fixture.jwt');
 assert.deepEqual(JSON.parse(args.body),{action:'charge'});
 return {ok:true,json:async()=>({ok:true,charge:{
  invoiceId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  status:'active',amountCents:592,
  brCode:'0002010102110000000000000000000000000000000',
  qrDataUri:'data:image/png;base64,aGVsbG8=',
  expiresAt:'2099-01-01T00:00:00.000Z',
  paidByProvider:false
 }})};
};
assert.match(ctx.mobilityFeeLedgerPanel(),/Gerar Pix das taxas acumuladas/);
assert.equal(await ctx.mobilityFeePixRequest('charge'),false);
assert.equal(calls,1);
const rendered=ctx.mobilityFeePixPanel();
assert.match(rendered,/Pix copia e cola/);
assert.match(rendered,/R\$\s*5,92/);
assert.match(rendered,/QR Code Pix/);
assert.doesNotMatch(rendered,/Pagamento de taxas confirmado pela consulta/);
ctx.fetch=async()=>{calls++;return {ok:true,json:async()=>({
 ok:true,charge:{invoiceId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 status:'paid',amountCents:592,brCode:null,paidByProvider:true}})}};
fee={...fee,collectedCents:592,outstandingCents:0};
assert.equal(await ctx.mobilityFeePixRequest('status'),false);
assert.match(ctx.mobilityFeeLedgerPanel(),/5,92 confirmado pelo provedor/);
assert.doesNotMatch(ctx.mobilityFeePixPanel(),/Pix copia e cola/);
s.pix=null;s.pixBusy=true;const before=calls,seq=s.pixSeq;
await ctx.mobilityFeePixRequest('status');
assert.equal(calls,before);
assert.equal(s.pixSeq,seq,'busy must not invalidate in-flight request');
s.pixBusy=false;
ctx.mobilityClearSession();
assert.equal(s.pix,null);
assert.equal(s.program,null);
for(const token of ['mobility_fee_pix_prepare_v1_837','mobility_fee_pix_commit_v1_837',
 'mobility_fee_pix_apply_proof_v1_837','mobility_fee_one_unresolved_invoice_v1_837_idx',
 'MOBILITY_PIX_EVIDENCE_IMMUTABLE','MOBILITY_PIX_INVOICE_LINE_IMMUTABLE'])
 assert.ok(sql.includes(token),token);
for(const token of ['mobility_fee_pix_invoices_v1_837','mobility_fee_pix_evidence_v1_837',
 'paidInvoiceCount','outstandingCents'])
 assert.ok(model.includes(token),token);
assert.match(edge,/auth\.getUser\(jwt\)/);
assert.match(edge,/validatePixBrCode/);
assert.match(edge,/mercadoPagoFetch\("\/v1\/orders"/);
assert.match(webhook,/verifyMercadoPagoWebhook\(req,webhookSecret,dataId\)/);
assert.match(webhook,/handleMobilityFeeOrder/);
assert.ok(webhook.indexOf('handleMobilityFeeOrder(admin,dataId,mobilityInvoice)')
 <webhook.indexOf('return await handlePlatformBillingOrder('),'exact router before merchant fallback');
assert.match(cfg,/\[functions\.mobility-fee-pix\]\nverify_jwt = false/);
console.log('TAMÃO #837: Pix real separado, autenticação, saldo provado, UI e roteamento HMAC fail closed.');
