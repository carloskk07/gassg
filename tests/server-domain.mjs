import assert from 'node:assert/strict';
import {
  DomainError,normalizeAddress,normalizeCnpj,isValidCnpj,normalizeItems,
  assertTransition,merchantActionTarget,assertExpectedVersion,validateIdempotencyKey,
  canonicalJson,requestFingerprint,assertIdempotentReplay,assertPermanentMerchantUser,
  assertMerchantMembership,assertCatalogWriteMembership,anonymizeOffer,hasMerchantLeak,
  computeCashbackReservation,cashbackReservationEntries,cashbackReleaseEntries,
  referralPendingToAvailableEntries,validateDeliveryPin,shouldLockPin,readJsonBody,enforceApiQuota
} from '../supabase/functions/_shared/domain.js';

let passed=0;
function test(name,fn){
  try{
    const out=fn();
    if(out&&typeof out.then==='function'){
      return out.then(()=>{passed++;console.log('✓',name)});
    }
    passed++;console.log('✓',name);
  }catch(e){console.error('✗',name);throw e}
}
function throwsCode(fn,code){
  assert.throws(fn,e=>e instanceof DomainError&&e.code===code);
}

await test('parser JSON limita tamanho e rejeita formas inválidas',async()=>{
  const req={
    headers:{get:()=>null},
    text:async()=>JSON.stringify({ok:true})
  };
  assert.deepEqual(await readJsonBody(req),{ok:true});

  await assert.rejects(
    ()=>readJsonBody({headers:{get:()=>String(20000)},text:async()=>''}),
    e=>e instanceof DomainError&&e.code==='PAYLOAD_TOO_LARGE'&&e.status===413
  );

  await assert.rejects(
    ()=>readJsonBody({headers:{get:()=>null},text:async()=>'[]'}),
    e=>e instanceof DomainError&&e.code==='INVALID_JSON'
  );
});

await test('quota server-side bloqueia excesso e falha fechada quando backend quebra',async()=>{
  const okAdmin={rpc:async()=>({data:{allowed:true,count:2,limit:10},error:null})};
  assert.equal((await enforceApiQuota(okAdmin,{userId:'u1',actionName:'get-order',limit:10,windowSeconds:60})).allowed,true);

  const limited={rpc:async()=>({data:{allowed:false,count:11,limit:10},error:null})};
  await assert.rejects(
    ()=>enforceApiQuota(limited,{userId:'u1',actionName:'get-order',limit:10,windowSeconds:60}),
    e=>e instanceof DomainError&&e.code==='RATE_LIMITED'&&e.status===429
  );

  const broken={rpc:async()=>({data:null,error:{message:'db unavailable'}})};
  await assert.rejects(
    ()=>enforceApiQuota(broken,{userId:'u1',actionName:'get-order',limit:10,windowSeconds:60}),
    e=>e instanceof DomainError&&e.code==='RATE_LIMIT_BACKEND_FAILED'&&e.status===503
  );
});

test('normaliza endereço sem aceitar vazio',()=>{
  assert.equal(normalizeAddress('  Rua   General Câmara, 123  '),'Rua General Câmara, 123');
  throwsCode(()=>normalizeAddress('x'),'INVALID_ADDRESS');
});

test('CNPJ atual aceita formato alfanumérico',()=>{
  assert.equal(normalizeCnpj('00.000.000/E08G-12'),'00000000E08G12');
  assert.equal(isValidCnpj('00.000.000/E08G-12'),true);
  assert.equal(isValidCnpj('00.000.000/E08G-AA'),false);
});

test('itens repetidos são agregados e ordenados deterministicamente',()=>{
  assert.deepEqual(
    normalizeItems([{productCode:'water20',quantity:1},{productCode:'P13',quantity:2},{productCode:'WATER20',quantity:3}]),
    [{productCode:'P13',quantity:2},{productCode:'WATER20',quantity:4}]
  );
});

test('produto e quantidade inválidos são bloqueados',()=>{
  throwsCode(()=>normalizeItems([{productCode:'XYZ',quantity:1}]),'INVALID_PRODUCT');
  throwsCode(()=>normalizeItems([{productCode:'P13',quantity:0}]),'INVALID_QUANTITY');
});

test('máquina de estados bloqueia atalhos impossíveis',()=>{
  assert.equal(assertTransition('OFFERED_TO_MERCHANT','MERCHANT_ACCEPTED'),'MERCHANT_ACCEPTED');
  throwsCode(()=>assertTransition('OFFERED_TO_MERCHANT','OUT_FOR_DELIVERY'),'INVALID_TRANSITION');
  throwsCode(()=>assertTransition('SETTLED','OUT_FOR_DELIVERY'),'INVALID_TRANSITION');
});

test('dispatch aceita PREPARING ou AT_RISK e rejeita estado inicial',()=>{
  assert.equal(merchantActionTarget('dispatch','PREPARING'),'OUT_FOR_DELIVERY');
  assert.equal(merchantActionTarget('dispatch','AT_RISK'),'OUT_FOR_DELIVERY');
  throwsCode(()=>merchantActionTarget('dispatch','OFFERED_TO_MERCHANT'),'INVALID_TRANSITION');
});

test('versão otimista detecta concorrência',()=>{
  assert.equal(assertExpectedVersion(4,4),4);
  throwsCode(()=>assertExpectedVersion(5,4),'VERSION_CONFLICT');
});

test('idempotency key exige formato estável',()=>{
  assert.equal(validateIdempotencyKey('order:1234567890'),'order:1234567890');
  throwsCode(()=>validateIdempotencyKey('curta'),'INVALID_IDEMPOTENCY_KEY');
  throwsCode(()=>validateIdempotencyKey('bad key with spaces'),'INVALID_IDEMPOTENCY_KEY');
});

test('JSON canônico independe da ordem das propriedades',()=>{
  assert.equal(canonicalJson({b:2,a:{d:4,c:3}}),canonicalJson({a:{c:3,d:4},b:2}));
});

await test('fingerprint é estável para payload semanticamente idêntico',async()=>{
  const a=await requestFingerprint('create-order',{b:2,a:1});
  const b=await requestFingerprint('create-order',{a:1,b:2});
  const c=await requestFingerprint('create-order',{a:1,b:3});
  assert.equal(a,b);
  assert.notEqual(a,c);
  assert.match(a,/^[a-f0-9]{64}$/);
});

test('replay idempotente exige mesmo usuário ação e hash',()=>{
  const existing={user_id:'u1',action_name:'create-order',request_hash:'abc',completed_at:'2026-10-01',result_json:{orderId:'o1'}};
  assert.deepEqual(assertIdempotentReplay(existing,{userId:'u1',actionName:'create-order',requestHash:'abc'}),{orderId:'o1'});
  throwsCode(()=>assertIdempotentReplay(existing,{userId:'u2',actionName:'create-order',requestHash:'abc'}),'IDEMPOTENCY_CONFLICT');
  throwsCode(()=>assertIdempotentReplay(existing,{userId:'u1',actionName:'x',requestHash:'abc'}),'IDEMPOTENCY_CONFLICT');
});

test('revenda exige identidade permanente',()=>{
  assert.equal(assertPermanentMerchantUser({id:'u1',is_anonymous:false}).id,'u1');
  throwsCode(()=>assertPermanentMerchantUser({id:'u1',is_anonymous:true}),'PERMANENT_IDENTITY_REQUIRED');
});

test('membership separa operação de edição de catálogo',()=>{
  assert.equal(assertMerchantMembership({active:true,member_role:'driver'}).member_role,'driver');
  throwsCode(()=>assertCatalogWriteMembership({active:true,member_role:'driver'}),'MERCHANT_ACCESS_DENIED');
  assert.equal(assertCatalogWriteMembership({active:true,member_role:'manager'}).member_role,'manager');
});

test('oferta pública não contém identidade da revenda',()=>{
  const source={
    id:'q1',merchant_id:'m-secret',merchant_name:'Revenda X',cnpj:'00000000E08G12',
    total_cents:11990,eta_min_minutes:18,eta_max_minutes:25,trust_score:97,
    expires_at:'2026-10-01T15:00:00Z',label:'recommended'
  };
  const out=anonymizeOffer(source);
  assert.deepEqual(Object.keys(out),['quoteId','label','totalCents','etaMinMinutes','etaMaxMinutes','trustScore','expiresAt']);
  assert.equal(hasMerchantLeak(out),false);
  assert.equal(hasMerchantLeak(source),true);
});

test('cashback nunca torna total negativo',()=>{
  assert.deepEqual(computeCashbackReservation(750,11690,true),{reservedCents:750,totalCents:10940});
  assert.deepEqual(computeCashbackReservation(20000,11690,true),{reservedCents:11690,totalCents:0});
  assert.deepEqual(computeCashbackReservation(750,11690,false),{reservedCents:0,totalCents:11690});
});

test('reserva e devolução de cashback usam sinais opostos',()=>{
  const base={userId:'u1',orderId:'o1',reservedCents:750,idempotencyKey:'order:1234567890'};
  const reserve=cashbackReservationEntries(base);
  const release=cashbackReleaseEntries(base);
  assert.equal(reserve[0].amount_cents,-750);
  assert.equal(release[0].amount_cents,750);
  assert.equal(reserve[0].bucket,'cashback');
  assert.notEqual(reserve[0].idempotency_key,release[0].idempotency_key);
});

test('liberação de comissão move saldo entre buckets sem criar dinheiro',()=>{
  const rows=referralPendingToAvailableEntries({
    userId:'u1',orderId:'o1',amountCents:300,idempotencyKey:'referral:123456'
  });
  assert.equal(rows.length,2);
  assert.equal(rows[0].bucket,'commission_pending');
  assert.equal(rows[0].amount_cents,-300);
  assert.equal(rows[1].bucket,'commission_available');
  assert.equal(rows[1].amount_cents,300);
  assert.equal(rows.reduce((sum,x)=>sum+x.amount_cents,0),0);
});

test('PIN exige quatro dígitos e bloqueia na quinta falha',()=>{
  assert.equal(validateDeliveryPin('1234'),'1234');
  throwsCode(()=>validateDeliveryPin('12A4'),'INVALID_PIN_FORMAT');
  assert.equal(shouldLockPin(4),false);
  assert.equal(shouldLockPin(5),true);
});

console.log('\n'+passed+' testes do núcleo server-side passaram.');
