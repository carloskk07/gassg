import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src=fs.readFileSync(new URL('../js/mobility.js',import.meta.url),'utf8');
const backend=fs.readFileSync(new URL('../supabase/functions/mobility-fee-pix/index.ts',import.meta.url),'utf8');
const ctx={console,Date,Intl,URL,URLSearchParams,FormData,
 BRL:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),
 document:{querySelector:()=>null,createElement:()=>({}),head:{appendChild(){}},addEventListener(){}},
 route:()=> 'mobility',render(){},
 esc:s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),
 CHAMA_BACKEND:{url:'https://project.supabase.co',publishableKey:'public-test'}};
ctx.globalThis=ctx;
vm.runInNewContext(src+';this.rt=mobilityRuntime;',ctx);
const s=ctx.rt,owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const benefits={eligibleDriver:true,version:2,normalFeeBps:900,memberFeeBps:800,
 termsText:'Condições de benefícios'};
const plans=[{key:'flex',name:'Flex',mode:'postpaid',amountCents:null,feeBps:900,purchaseEnabled:false},
 {key:'essential',name:'Essencial',mode:'prepaid',amountCents:990,feeBps:600,purchaseEnabled:true},
 {key:'popular',name:'Popular',mode:'prepaid',amountCents:2490,feeBps:550,purchaseEnabled:true},
 {key:'professional',name:'Profissional',mode:'prepaid',amountCents:4990,feeBps:500,purchaseEnabled:true}];
let prepaid={availableCents:0,reservedCents:0,spentCents:0,underReviewCents:0};
const billing={recordedCount:0,accruedCents:0,collectedCents:0,outstandingCents:0,
 collectionStatus:'not_collected',entries:[]};
s.user={id:owner};
s.program={plans,benefits,billing,prepaid};
s.client={auth:{getSession:async()=>({data:{session:{user:{id:owner},access_token:'test-jwt'}},error:null})},
 rpc:async(name)=>{assert.equal(name,'mobility_billing_catalog_v1_826');
  return {data:{plans,benefits,billing,prepaid},error:null}}};
let requests=0;
ctx.fetch=async(url,args)=>{requests++;
 assert.equal(url,'https://project.supabase.co/functions/v1/mobility-fee-pix');
 assert.equal(args.headers.Authorization,'Bearer test-jwt');
 assert.deepEqual(JSON.parse(args.body),{action:'plan',planKey:'essential'});
 return {ok:true,json:async()=>({ok:true,charge:{
  invoiceId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  invoiceKind:'prepaid_credit',planKey:'essential',planFeeBps:600,
  status:'active',amountCents:990,brCode:'0002010102110000000000000000000000000000000',
  qrDataUri:'data:image/png;base64,aGVsbG8=',
  expiresAt:'2099-01-01T00:00:00.000Z',paidByProvider:false}})};
};
const initial=ctx.mobilityPrepaidPlansPanel();
assert.match(initial,/Essencial/);
assert.match(initial,/R\$\s*9,90/);
assert.match(initial,/6%/);
assert.match(initial,/R\$\s*24,90/);
assert.match(initial,/R\$\s*49,90/);
assert.match(initial,/Comprar recarga Essencial/);
assert.equal(await ctx.mobilityFeePixRequest('plan','essential'),false);
assert.equal(requests,1);
assert.match(ctx.mobilityFeePixPanel(),/Pix para recarga do plano/);
assert.match(ctx.mobilityFeePixPanel(),/Pix copia e cola/);
assert.doesNotMatch(ctx.mobilityFeePixPanel(),/Recarga confirmada pelo Mercado Pago/);
prepaid={availableCents:990,reservedCents:0,spentCents:0,underReviewCents:0};
ctx.fetch=async(url,args)=>{requests++;
 assert.deepEqual(JSON.parse(args.body),{action:'status'});
 return {ok:true,json:async()=>({ok:true,charge:{
  invoiceId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  invoiceKind:'prepaid_credit',planKey:'essential',planFeeBps:600,
  status:'paid',amountCents:990,brCode:null,paidByProvider:true}})};
};
assert.equal(await ctx.mobilityFeePixRequest('status'),false);
assert.match(ctx.mobilityPrepaidPlansPanel(),/Saldo disponível: R\$\s*9,90/);
assert.match(ctx.mobilityFeePixPanel(),/Recarga confirmada pelo Mercado Pago/);
assert.doesNotMatch(ctx.mobilityFeePixPanel(),/Pix copia e cola/);
s.pixBusy=true;const old=requests,seq=s.pixSeq;
await ctx.mobilityFeePixRequest('plan','popular');
assert.equal(requests,old);
assert.equal(seq,s.pixSeq,'Busy must not cancel first request');
s.pixBusy=false;
plans[1].purchaseEnabled=false;
assert.doesNotMatch(ctx.mobilityPrepaidPlansPanel(),/Comprar recarga Essencial/);
prepaid={...prepaid,availableCents:0,underReviewCents:990};
s.program.prepaid=prepaid;
assert.match(ctx.mobilityPrepaidPlansPanel(),/está em revisão/);
s.program.benefits={...benefits,eligibleDriver:false};
assert.equal(ctx.mobilityPrepaidPlansPanel(),'','Rider cannot buy driver plans');
s.program.benefits=benefits;
ctx.mobilityClearSession();
assert.equal(s.pix,null);
assert.equal(s.program,null);
assert.match(backend,/mobility_fee_pix_prepare_credit_v1_838/);
assert.match(backend,/invoice_kind/);
assert.match(backend,/\["charge","status","plan"\]/);
assert.match(src,/\['essential','popular','professional'\]/);
console.log('TAMÃO #838: recargas não são assinaturas, Pix confirma antes do saldo, validação por conta e não repete cobrança.');
