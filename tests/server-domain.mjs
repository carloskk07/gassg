import assert from 'node:assert/strict';
import {
  DomainError,normalizeAddress,normalizeCnpj,isValidCnpj,normalizeItems,isSupportedProductCode,
  assertTransition,merchantActionTarget,assertExpectedVersion,validateIdempotencyKey,
  canonicalJson,requestFingerprint,assertIdempotentReplay,assertPermanentMerchantUser,
  assertMerchantMembership,assertCatalogWriteMembership,anonymizeOffer,hasMerchantLeak,
  computeCashbackReservation,cashbackReservationEntries,cashbackReleaseEntries,
  referralPendingToAvailableEntries,validateDeliveryPin,shouldLockPin,readJsonBody,enforceApiQuota
} from '../supabase/functions/_shared/domain.js';
import {
  isOperationalMerchantRole,
  operationalMerchantMemberships,
  selectMerchantMembership
} from '../supabase/functions/_shared/merchant-membership.js';
import {chooseOffers} from '../supabase/functions/_shared/offer-ranking.js';
import {effectiveUnitPrice} from '../supabase/functions/_shared/pricing-policy.js';
import {
  normalizePostalCode,
  normalizeAddressNumber,
  canonicalAddress,
  validateServicePostalCode
} from '../supabase/functions/_shared/postal-code.js';

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
    ()=>readJsonBody(new Request('https://example.test',{
      method:'POST',
      body:'{"x":"'+('a'.repeat(17000))+'"}',
      headers:{'content-type':'application/json'}
    })),
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

test('CEP exige exatamente oito dígitos',()=>{
  assert.equal(normalizePostalCode('97300-000'),'97300000');
  throwsCode(()=>normalizePostalCode('9730'),'INVALID_POSTAL_CODE');
  throwsCode(()=>normalizePostalCode('abcdefgh'),'INVALID_POSTAL_CODE');
});

function postalAdmin({cached=null,cacheError=null}={}){
  const writes=[];
  return {
    writes,
    from(table){
      assert.equal(table,'postal_code_validation_cache');
      const chain={
        select(){return chain},
        eq(){return chain},
        gte(){return chain},
        maybeSingle:async()=>({data:cached,error:cacheError}),
        upsert:async(row)=>{writes.push(row);return {error:null}}
      };
      return chain;
    }
  };
}

await test('CEP em cache permitido não chama provedores externos',async()=>{
  const admin=postalAdmin({cached:{
    postal_code:'97300000',city:'São Gabriel',state:'RS',ibge_code:'4318309',
    provider:'brasilapi',service_area_allowed:true,street:'Rua General Câmara',
    neighborhood:'Centro',verified_at:new Date().toISOString()
  }});
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async()=>{throw new Error('fetch externo não deveria ser chamado')};
  try{
    const result=await validateServicePostalCode(admin,'97300-000');
    assert.equal(result.postalCode,'97300000');
    assert.equal(result.cached,true);
    assert.equal(admin.writes.length,0);
  }finally{globalThis.fetch=oldFetch}
});

await test('CEP cacheado fora de São Gabriel falha fechado',async()=>{
  const admin=postalAdmin({cached:{
    postal_code:'90000000',city:'Porto Alegre',state:'RS',ibge_code:'4314902',
    provider:'viacep',service_area_allowed:false,verified_at:new Date().toISOString()
  }});
  await assert.rejects(
    ()=>validateServicePostalCode(admin,'90000000'),
    e=>e instanceof DomainError&&e.code==='POSTAL_CODE_OUTSIDE_SERVICE_AREA'&&e.status===422
  );
});

await test('resolvedor usa ViaCEP quando BrasilAPI fica indisponível',async()=>{
  const admin=postalAdmin();
  const oldFetch=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async url=>{
    calls++;
    if(String(url).includes('brasilapi.com.br')){
      return new Response('{}',{status:503,headers:{'content-type':'application/json'}});
    }
    return new Response(JSON.stringify({
      cep:'97300-000',localidade:'São Gabriel',uf:'RS',ibge:'4318309',
      logradouro:'Rua General Câmara',bairro:'Centro'
    }),{status:200,headers:{'content-type':'application/json'}});
  };
  try{
    const result=await validateServicePostalCode(admin,'97300000');
    assert.equal(result.provider,'viacep');
    assert.equal(result.cached,false);
    assert.equal(calls,2);
    assert.equal(admin.writes.length,1);
    assert.equal(admin.writes[0].service_area_allowed,true);
    assert.equal(admin.writes[0].ibge_code,'4318309');
  }finally{globalThis.fetch=oldFetch}
});

test('número de endereço é normalizado e limitado',()=>{
  assert.equal(normalizeAddressNumber(' 123 a '),'123A');
  assert.equal(normalizeAddressNumber('42'),'42');
  throwsCode(()=>normalizeAddressNumber('s/n'),'INVALID_ADDRESS_NUMBER');
  throwsCode(()=>normalizeAddressNumber('12-3'),'INVALID_ADDRESS_NUMBER');
});

test('endereço canônico vem da rua do CEP e limita apenas o bairro opcional',()=>{
  const result=canonicalAddress({
    postalCode:'97300000',
    street:'Rua General Câmara',
    neighborhood:'Centro',
    city:'São Gabriel',
    state:'RS'
  },'123');
  assert.equal(result,'Rua General Câmara, 123 - Centro, São Gabriel - RS, CEP 97300-000');
  assert.ok(result.length<=240);

  const long=canonicalAddress({
    postalCode:'97300000',
    street:'Rua '+('A'.repeat(150)),
    neighborhood:'B'.repeat(160),
    city:'São Gabriel',
    state:'RS'
  },'999');
  assert.ok(long.length<=240);
  assert.ok(long.includes('São Gabriel - RS, CEP 97300-000'));
});

await test('CEP sem logradouro específico falha fechado',async()=>{
  const admin=postalAdmin();
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async url=>{
    if(String(url).includes('brasilapi.com.br')){
      return new Response(JSON.stringify({
        cep:'97300-000',city:'São Gabriel',state:'RS',
        neighborhood:'',street:''
      }),{status:200,headers:{'content-type':'application/json'}});
    }
    return new Response(JSON.stringify({
      cep:'97300-000',localidade:'São Gabriel',uf:'RS',ibge:'4318309',
      logradouro:'',bairro:''
    }),{status:200,headers:{'content-type':'application/json'}});
  };
  try{
    await assert.rejects(
      ()=>validateServicePostalCode(admin,'97300000'),
      e=>e instanceof DomainError&&e.code==='POSTAL_CODE_NOT_STREET_LEVEL'&&e.status===422
    );
    assert.equal(admin.writes.length,0);
  }finally{globalThis.fetch=oldFetch}
});

await test('falha dos dois provedores não transforma CEP em válido',async()=>{
  const admin=postalAdmin();
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async()=>new Response('{}',{status:503,headers:{'content-type':'application/json'}});
  try{
    await assert.rejects(
      ()=>validateServicePostalCode(admin,'97300000'),
      e=>e instanceof DomainError&&e.code==='POSTAL_CODE_VALIDATION_UNAVAILABLE'&&e.status===503
    );
    assert.equal(admin.writes.length,0);
  }finally{globalThis.fetch=oldFetch}
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

test('parser de SKU valida forma segura; existência fica no registro server-side',()=>{
  assert.equal(isSupportedProductCode('P1'),true);
  assert.equal(isSupportedProductCode('p20'),true);
  assert.equal(isSupportedProductCode('P45'),true);
  assert.equal(isSupportedProductCode('P90'),true);
  assert.equal(isSupportedProductCode('P0'),true);
  assert.equal(isSupportedProductCode('P91'),true);
  assert.equal(isSupportedProductCode('XYZ'),true);
  assert.equal(isSupportedProductCode('P13_CONTAINER'),true);
  assert.equal(isSupportedProductCode(''),false);
  assert.equal(isSupportedProductCode('A'),false);
  assert.equal(isSupportedProductCode('BAD-CODE'),false);
  assert.equal(isSupportedProductCode('bad code'),false);
  assert.deepEqual(
    normalizeItems([{productCode:'P45',quantity:1},{productCode:'p20',quantity:2},{productCode:'xyz',quantity:1}]),
    [{productCode:'P20',quantity:2},{productCode:'P45',quantity:1},{productCode:'XYZ',quantity:1}]
  );
});

test('formato de produto e quantidade inválidos são bloqueados',()=>{
  throwsCode(()=>normalizeItems([{productCode:'BAD-CODE',quantity:1}]),'INVALID_PRODUCT');
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

test('seleção padrão ignora membership driver quando existe operação autorizada',()=>{
  const memberships=[
    {merchant_id:'m-driver',member_role:'driver',active:true},
    {merchant_id:'m-owner',member_role:'owner',active:true},
    {merchant_id:'m-manager',member_role:'manager',active:true}
  ];
  assert.equal(selectMerchantMembership(memberships)?.merchant_id,'m-owner');
  assert.deepEqual(
    operationalMerchantMemberships(memberships).map(x=>x.merchant_id),
    ['m-owner','m-manager']
  );
});

test('seleção explícita preserva revenda pedida e permite negar papel sem trocar silenciosamente',()=>{
  const memberships=[
    {merchant_id:'m-driver',member_role:'driver',active:true},
    {merchant_id:'m-owner',member_role:'owner',active:true}
  ];
  const selected=selectMerchantMembership(memberships,'m-driver');
  assert.equal(selected?.merchant_id,'m-driver');
  assert.equal(isOperationalMerchantRole(selected?.member_role),false);
  assert.equal(isOperationalMerchantRole('operator'),true);
  assert.equal(selectMerchantMembership(memberships,'m-inexistente'),null);
});

test('preço fixo ignora pressão operacional',()=>{
  assert.equal(effectiveUnitPrice({
    pricingMode:'fixed',preferredPriceCents:12000,minPriceCents:11590,maxPriceCents:12500,
    availableStock:1,requestedQuantity:1,activeOrders:99,recentOrders7d:999
  }),12000);
});

test('faixa automática nunca sai dos limites autorizados',()=>{
  for(const pricingStrategy of ['volume','balanced','margin']){
    for(const activeOrders of [0,1,5,20]){
      for(const stock of [1,2,5,20,100]){
        const price=effectiveUnitPrice({
          pricingMode:'range',pricingStrategy,
          minPriceCents:11590,preferredPriceCents:12000,maxPriceCents:12500,
          availableStock:stock,requestedQuantity:1,activeOrders,recentOrders7d:activeOrders*10
        });
        assert.ok(price>=11590&&price<=12500);
      }
    }
  }
});

test('estratégia volume fica abaixo de equilibrado e margem em condições iguais',()=>{
  const base={
    pricingMode:'range',minPriceCents:11590,preferredPriceCents:12000,maxPriceCents:12500,
    availableStock:20,requestedQuantity:1,activeOrders:1,recentOrders7d:10
  };
  const volume=effectiveUnitPrice({...base,pricingStrategy:'volume'});
  const balanced=effectiveUnitPrice({...base,pricingStrategy:'balanced'});
  const margin=effectiveUnitPrice({...base,pricingStrategy:'margin'});
  assert.ok(volume<=balanced&&balanced<=margin);
});

test('mais pressão da própria operação nunca reduz o preço automático',()=>{
  const base={
    pricingMode:'range',pricingStrategy:'balanced',
    minPriceCents:11590,preferredPriceCents:12000,maxPriceCents:12500,
    requestedQuantity:1
  };
  const quiet=effectiveUnitPrice({...base,availableStock:50,activeOrders:0,recentOrders7d:0});
  const busy=effectiveUnitPrice({...base,availableStock:2,activeOrders:5,recentOrders7d:80});
  assert.ok(busy>=quiet);
});

test('marketplace com um único fornecedor gera somente opção disponível',()=>{
  const selected=chooseOffers([{
    merchantId:'m1',totalCents:11590,etaMinMinutes:20,trustScore:95,
    activeOrders:0,recentOrders7d:0
  }]);
  assert.equal(selected.length,1);
  assert.equal(selected[0].label,'available');
  assert.equal(selected[0].candidate.merchantId,'m1');
});

test('balanceamento distribui recomendação apenas entre ofertas equivalentes',()=>{
  const selected=chooseOffers([
    {
      merchantId:'m-loaded',totalCents:11590,etaMinMinutes:20,trustScore:95,
      activeOrders:5,recentOrders7d:30
    },
    {
      merchantId:'m-new',totalCents:11690,etaMinMinutes:21,trustScore:95,
      activeOrders:0,recentOrders7d:0
    }
  ]);
  assert.equal(selected[0].label,'recommended');
  assert.equal(selected[0].candidate.merchantId,'m-new');
  assert.ok(selected[0].candidate.rankScore<=0.10);
});

test('balanceamento nunca promove fornecedor claramente pior só por ter pouca carga',()=>{
  const selected=chooseOffers([
    {
      merchantId:'m-quality',totalCents:11590,etaMinMinutes:20,trustScore:96,
      activeOrders:8,recentOrders7d:60
    },
    {
      merchantId:'m-poor',totalCents:13990,etaMinMinutes:40,trustScore:82,
      activeOrders:0,recentOrders7d:0
    }
  ]);
  assert.equal(selected[0].label,'recommended');
  assert.equal(selected[0].candidate.merchantId,'m-quality');
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
