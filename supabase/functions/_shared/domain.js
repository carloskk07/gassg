export const PRODUCT_CODES=Object.freeze(['P13','WATER20','CHARCOAL4','WOOD','ICE5']);
export const ORDER_STATUSES=Object.freeze([
  'OFFERED_TO_MERCHANT','MERCHANT_ACCEPTED','PREPARING','AT_RISK','REASSIGNING',
  'REQUOTE_REQUIRED','OUT_FOR_DELIVERY','ARRIVING','DELIVERED','SETTLED','CANCELLED'
]);

const TRANSITIONS=Object.freeze({
  OFFERED_TO_MERCHANT:new Set(['MERCHANT_ACCEPTED','REASSIGNING','CANCELLED']),
  MERCHANT_ACCEPTED:new Set(['PREPARING','CANCELLED']),
  PREPARING:new Set(['AT_RISK','OUT_FOR_DELIVERY','CANCELLED']),
  AT_RISK:new Set(['OUT_FOR_DELIVERY','REASSIGNING','CANCELLED']),
  REASSIGNING:new Set(['OFFERED_TO_MERCHANT','REQUOTE_REQUIRED','CANCELLED']),
  REQUOTE_REQUIRED:new Set(['OFFERED_TO_MERCHANT','REASSIGNING','CANCELLED']),
  OUT_FOR_DELIVERY:new Set(['ARRIVING','CANCELLED']),
  ARRIVING:new Set(['DELIVERED','CANCELLED']),
  DELIVERED:new Set(['SETTLED']),
  SETTLED:new Set(),
  CANCELLED:new Set()
});

const MERCHANT_ACTION_TARGET=Object.freeze({
  accept:'MERCHANT_ACCEPTED',reject:'REASSIGNING',dispatch:'OUT_FOR_DELIVERY',arriving:'ARRIVING'
});
const MERCHANT_ROLES=new Set(['owner','manager','operator','driver']);
const CATALOG_WRITE_ROLES=new Set(['owner','manager']);

export class DomainError extends Error{
  constructor(code,message,status=400){
    super(message);
    this.name='DomainError';
    this.code=code;
    this.status=status;
  }
}

export function invariant(condition,code,message,status=400){
  if(!condition) throw new DomainError(code,message,status);
}

export function normalizeAddress(value){
  const address=String(value??'').trim().replace(/\s+/g,' ');
  invariant(address.length>=5,'INVALID_ADDRESS','Endereço muito curto');
  invariant(address.length<=240,'INVALID_ADDRESS','Endereço muito longo');
  return address;
}

export function normalizeCnpj(value){
  return String(value??'').toUpperCase().replace(/[^0-9A-Z]/g,'');
}

export function isValidCnpj(value){
  return /^[0-9A-Z]{12}[0-9]{2}$/.test(normalizeCnpj(value));
}

export function asPositiveInt(value,name,{min=1,max=99}={}){
  const n=Number(value);
  invariant(Number.isSafeInteger(n),'INVALID_'+String(name).toUpperCase(),name+' precisa ser inteiro');
  invariant(n>=min&&n<=max,'INVALID_'+String(name).toUpperCase(),name+' fora do intervalo');
  return n;
}

export function asNonNegativeCents(value,name='amountCents'){
  const n=Number(value);
  invariant(Number.isSafeInteger(n),'INVALID_MONEY',name+' precisa ser inteiro em centavos');
  invariant(n>=0,'INVALID_MONEY',name+' não pode ser negativo');
  invariant(n<=100000000,'INVALID_MONEY',name+' excede o limite de segurança');
  return n;
}

export function normalizeItems(items){
  invariant(Array.isArray(items),'INVALID_ITEMS','Itens precisam ser uma lista');
  invariant(items.length>=1&&items.length<=20,'INVALID_ITEMS','Quantidade de linhas inválida');
  const aggregated=new Map();
  for(const raw of items){
    const code=String(raw?.productCode??'').toUpperCase();
    invariant(PRODUCT_CODES.includes(code),'INVALID_PRODUCT','Produto inválido');
    const qty=asPositiveInt(raw?.quantity,'quantity');
    const next=(aggregated.get(code)||0)+qty;
    invariant(next<=99,'INVALID_QUANTITY','Quantidade total do produto excede 99');
    aggregated.set(code,next);
  }
  return [...aggregated.entries()]
    .sort(([a],[b])=>a.localeCompare(b))
    .map(([productCode,quantity])=>({productCode,quantity}));
}

export function assertTransition(current,next){
  invariant(ORDER_STATUSES.includes(current),'INVALID_STATUS','Estado atual inválido');
  invariant(ORDER_STATUSES.includes(next),'INVALID_STATUS','Próximo estado inválido');
  invariant(TRANSITIONS[current]?.has(next),'INVALID_TRANSITION','Transição inválida: '+current+' → '+next,409);
  return next;
}

export function merchantActionTarget(action,currentStatus){
  const target=MERCHANT_ACTION_TARGET[action];
  invariant(Boolean(target),'INVALID_ACTION','Ação de revenda inválida');
  if(action==='dispatch'){
    invariant(['PREPARING','AT_RISK'].includes(currentStatus),'INVALID_TRANSITION','Saída só pode ocorrer após preparação/risco',409);
    return target;
  }
  assertTransition(currentStatus,target);
  return target;
}

export function assertExpectedVersion(actual,expected){
  const a=asPositiveInt(actual,'actualVersion',{min:1,max:Number.MAX_SAFE_INTEGER});
  const e=asPositiveInt(expected,'expectedVersion',{min:1,max:Number.MAX_SAFE_INTEGER});
  invariant(a===e,'VERSION_CONFLICT','O pedido mudou; recarregue antes de tentar novamente',409);
  return a;
}

export function validateIdempotencyKey(value){
  const key=String(value??'').trim();
  invariant(key.length>=12&&key.length<=120,'INVALID_IDEMPOTENCY_KEY','Chave idempotente fora do tamanho permitido');
  invariant(/^[A-Za-z0-9._:-]+$/.test(key),'INVALID_IDEMPOTENCY_KEY','Chave idempotente contém caracteres inválidos');
  return key;
}

function canonicalValue(value){
  if(value===null||typeof value!=='object') return value;
  if(Array.isArray(value)) return value.map(canonicalValue);
  const out={};
  for(const key of Object.keys(value).sort()){
    const v=value[key];
    if(v!==undefined) out[key]=canonicalValue(v);
  }
  return out;
}

export function canonicalJson(value){
  return JSON.stringify(canonicalValue(value));
}

export async function sha256Hex(value){
  const bytes=new TextEncoder().encode(typeof value==='string'?value:canonicalJson(value));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

export async function requestFingerprint(action,payload){
  invariant(typeof action==='string'&&action.length>0,'INVALID_ACTION','Ação ausente');
  return sha256Hex({action,payload:canonicalValue(payload)});
}

export function assertIdempotentReplay(existing,{userId,actionName,requestHash}){
  invariant(existing&&typeof existing==='object','IDEMPOTENCY_STATE_INVALID','Registro idempotente inválido',500);
  invariant(existing.user_id===userId,'IDEMPOTENCY_CONFLICT','Chave já pertence a outro usuário',409);
  invariant(existing.action_name===actionName,'IDEMPOTENCY_CONFLICT','Chave já foi usada em outra ação',409);
  invariant(existing.request_hash===requestHash,'IDEMPOTENCY_CONFLICT','Chave já foi usada com outro payload',409);
  invariant(existing.completed_at&&existing.result_json!==undefined,'IDEMPOTENCY_INCOMPLETE','Ação idempotente ainda está em processamento',409);
  return structuredClone(existing.result_json);
}

export function assertAuthenticatedUser(user){
  invariant(user?.id,'UNAUTHORIZED','Usuário não autenticado',401);
  return user;
}

export function assertPermanentMerchantUser(user){
  assertAuthenticatedUser(user);
  invariant(user.is_anonymous!==true,'PERMANENT_IDENTITY_REQUIRED','Revenda exige conta permanente',403);
  return user;
}

export function assertMerchantMembership(membership,{allowDriver=true}={}){
  invariant(membership?.active===true,'MERCHANT_ACCESS_DENIED','Vínculo de revenda inativo ou ausente',403);
  invariant(MERCHANT_ROLES.has(membership.member_role),'MERCHANT_ACCESS_DENIED','Papel de revenda inválido',403);
  if(!allowDriver) invariant(CATALOG_WRITE_ROLES.has(membership.member_role),'MERCHANT_ACCESS_DENIED','Ação exige owner/manager',403);
  return membership;
}

export function assertCatalogWriteMembership(membership){
  return assertMerchantMembership(membership,{allowDriver:false});
}

export function anonymizeOffer(quote){
  invariant(quote?.id,'INVALID_QUOTE','Quote sem id');
  const out={
    quoteId:String(quote.id),
    label:String(quote.label??'recommended'),
    totalCents:asNonNegativeCents(quote.total_cents??quote.gross_total_cents,'totalCents'),
    etaMinMinutes:asPositiveInt(quote.eta_min_minutes,'etaMinMinutes',{min:1,max:1440}),
    etaMaxMinutes:asPositiveInt(quote.eta_max_minutes,'etaMaxMinutes',{min:1,max:1440}),
    trustScore:asPositiveInt(quote.trust_score,'trustScore',{min:1,max:100}),
    expiresAt:String(quote.expires_at??'')
  };
  invariant(out.etaMaxMinutes>=out.etaMinMinutes,'INVALID_ETA','ETA máximo menor que o mínimo');
  invariant(!Number.isNaN(Date.parse(out.expiresAt)),'INVALID_QUOTE','Quote sem expiração válida');
  return out;
}

export function hasMerchantLeak(value){
  if(value===null||value===undefined) return false;
  const forbidden=new Set([
    'merchantid','merchant_id','merchantname','merchant_name','cnpj','companyname','company_name',
    'phone','merchantphone','merchant_phone','merchantaddress','merchant_address'
  ]);
  if(Array.isArray(value)) return value.some(hasMerchantLeak);
  if(typeof value!=='object') return false;
  return Object.entries(value).some(([k,v])=>forbidden.has(k.toLowerCase())||hasMerchantLeak(v));
}

export function computeCashbackReservation(balanceCents,grossTotalCents,useCashback){
  const balance=asNonNegativeCents(balanceCents,'balanceCents');
  const gross=asNonNegativeCents(grossTotalCents,'grossTotalCents');
  if(!useCashback) return {reservedCents:0,totalCents:gross};
  const reserved=Math.min(balance,gross);
  return {reservedCents:reserved,totalCents:gross-reserved};
}

export function cashbackReservationEntries({userId,orderId,reservedCents,idempotencyKey}){
  const cents=asNonNegativeCents(reservedCents,'reservedCents');
  if(cents===0) return [];
  const key=validateIdempotencyKey(idempotencyKey);
  return [{
    user_id:userId,order_id:orderId,bucket:'cashback',
    entry_type:'cashback_reserve',amount_cents:-cents,
    idempotency_key:key+':cashback-reserve'
  }];
}

export function cashbackReleaseEntries({userId,orderId,reservedCents,idempotencyKey}){
  const cents=asNonNegativeCents(reservedCents,'reservedCents');
  if(cents===0) return [];
  const key=validateIdempotencyKey(idempotencyKey);
  return [{
    user_id:userId,order_id:orderId,bucket:'cashback',
    entry_type:'cashback_release',amount_cents:cents,
    idempotency_key:key+':cashback-release'
  }];
}

export function referralPendingToAvailableEntries({userId,orderId,amountCents,idempotencyKey}){
  const cents=asNonNegativeCents(amountCents,'amountCents');
  invariant(cents>0,'INVALID_MONEY','Comissão precisa ser positiva');
  const key=validateIdempotencyKey(idempotencyKey);
  return [
    {
      user_id:userId,order_id:orderId,bucket:'commission_pending',
      entry_type:'referral_pending_release',amount_cents:-cents,
      idempotency_key:key+':pending-release'
    },
    {
      user_id:userId,order_id:orderId,bucket:'commission_available',
      entry_type:'referral_available',amount_cents:cents,
      idempotency_key:key+':available'
    }
  ];
}

export function validateDeliveryPin(value){
  const pin=String(value??'').trim();
  invariant(/^\d{4}$/.test(pin),'INVALID_PIN_FORMAT','PIN precisa ter quatro dígitos');
  return pin;
}

export function shouldLockPin(failures,maxFailures=5){
  const count=asPositiveInt(failures,'pinFailures',{min:0,max:1000});
  return count>=maxFailures;
}
