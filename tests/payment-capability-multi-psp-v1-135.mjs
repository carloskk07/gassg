import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(path)=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const migration=read('supabase/migrations/20261009200000_multi_psp_payment_capability_v1_135.sql');
const merchantOrders=read('supabase/functions/merchant-orders/index.ts');
const merchantOps=read('supabase/functions/merchant-ops/index.ts');
const paymentConnect=read('supabase/functions/merchant-payment-connect/index.ts');
const oauthCallback=read('supabase/functions/merchant-payment-oauth-callback/index.ts');
const checkout=read('supabase/functions/order-payment-checkout/index.ts');
const getOrder=read('supabase/functions/get-order/index.ts');
const adminOps=read('supabase/functions/admin-ops/index.ts');
const backend=read('js/backend.js');
const merchant=read('js/merchant.js');
const admin=read('js/admin.js');
const css=read('css/components.css');

for(const provider of [
  'mercadopago','pagbank','stone','getnet','pagarme','asaas',
  'cielo','rede','woovi','nubank'
]){
  assert.ok(migration.includes("'"+provider+"'"),'catálogo multi-PSP precisa incluir '+provider);
}
assert.ok(
  migration.includes('create table if not exists public.payment_provider_catalog')
  &&migration.includes("funds_flow text not null default 'merchant_direct'")
  &&migration.includes("check (funds_flow='merchant_direct')"),
  'catálogo precisa fixar o fluxo da venda na própria revenda'
);
assert.ok(
  migration.includes('create table if not exists public.merchant_payment_routes')
  &&migration.includes("verification_mode in ('provider_api','device','merchant_confirmed','customer_receipt')")
  &&migration.includes("channel in ('online','delivery','external')"),
  'rotas precisam separar canal e força de verificação'
);
assert.ok(
  migration.includes('create table if not exists public.merchant_payment_route_history')
  &&migration.includes('PAYMENT_ROUTE_VERSION_CONFLICT')
  &&migration.includes('action_requests'),
  'configuração de rotas precisa ser versionada, idempotente e auditável'
);
assert.ok(
  migration.includes("directSalePaymentsEnabled')::boolean,false)<>true")
  &&migration.includes("canValidateProviderTransactions')::boolean,false)<>true")
  &&migration.includes('PAYMENT_ROUTE_NOT_HOMOLOGATED'),
  'rota automática só pode existir para conexão validável e homologada'
);
assert.ok(
  migration.includes("adapter_status='implemented'")
  &&migration.includes('admin_merchant_provider_payment_capability_action'),
  'Admin só pode homologar venda automática em adaptador plenamente implementado'
);
assert.ok(
  migration.includes("funds_owner text not null default 'merchant'")
  &&migration.includes("check (funds_owner='merchant')")
  &&migration.includes("tamaoReceivesSaleProceeds',false"),
  'tentativas, eventos e evidências precisam manter propriedade dos fundos na revenda'
);
assert.ok(
  migration.includes('create table if not exists public.merchant_sale_payment_verifications')
  &&migration.includes("verification_level in ('provider','device','merchant')")
  &&migration.includes("evidence_type in ('provider_webhook','provider_api','terminal','merchant_confirmation','customer_receipt')"),
  'proveniência da confirmação precisa distinguir provedor, terminal e confirmação humana'
);
assert.ok(
  migration.includes('record_order_payment_verification')
  &&migration.includes("'merchant_confirmation'")
  &&migration.includes("'order_settlement'"),
  'settlement manual precisa gerar evidência explícita, não fingir webhook'
);
assert.ok(
  migration.includes('alter table public.payment_provider_catalog enable row level security')
  &&migration.includes('alter table public.merchant_payment_routes enable row level security')
  &&migration.includes('alter table public.merchant_sale_payment_verifications enable row level security')
  &&migration.includes('revoke all on table public.payment_provider_catalog from public,anon,authenticated')
  &&migration.includes('revoke all on table public.merchant_payment_routes from public,anon,authenticated'),
  'nova autoridade financeira precisa permanecer server-only'
);
assert.ok(
  migration.includes('merchant_payment_route_sets_updated_by_idx')
  &&migration.includes('merchant_sale_payment_verifications_merchant_provider_idx'),
  'novas FKs operacionais precisam nascer indexadas'
);

assert.ok(
  merchantOrders.includes('receivingAccounts')
  &&merchantOrders.includes('paymentProviders')
  &&merchantOrders.includes('paymentRoutes')
  &&merchantOrders.includes('paymentRouteVersion'),
  'portal da revenda precisa receber estado multi-PSP sanitizado'
);
assert.ok(
  merchantOrders.includes('providerConnectReadiness'),
  'readiness pode expor somente booleanos/estado de configuração'
);
assert.ok(
  merchantOps.includes('"update-payment-routes"')
  &&merchantOps.includes('merchant_payment_routes_action')
  &&merchantOps.includes('.from("merchant_payment_routes")'),
  'merchant-ops precisa governar rotas e usar rotas ativas no gate online'
);

assert.ok(
  paymentConnect.includes('providerDefinition')
  &&paymentConnect.includes('startMercadoPago')
  &&paymentConnect.includes('startPagBank')
  &&paymentConnect.includes('PROVIDER_CONNECT_SETUP_REQUIRED'),
  'orquestrador de conexão precisa ser provider-aware e falhar fechado'
);
assert.ok(
  paymentConnect.includes('https://connect.pagseguro.uol.com.br')
  &&paymentConnect.includes('PAGBANK_CLIENT_SECRET')
  &&paymentConnect.includes('PAGBANK_AUTH_TOKEN')
  &&paymentConnect.includes('payments.read payments.create accounts.read'),
  'PagBank Connect precisa usar configuração server-side e escopo mínimo previsto'
);
assert.ok(
  oauthCallback.includes('exchangePagBankCode')
  &&oauthCallback.includes('verifyPagBankSellerToken')
  &&oauthCallback.includes('x-client-token')
  &&oauthCallback.includes('PAGBANK_OAUTH_TOKEN_SHAPE_INVALID'),
  'callback PagBank precisa validar token e identidade antes de ativar a conta'
);
assert.ok(
  oauthCallback.includes('directSalePaymentsEnabled:false')
  &&oauthCallback.includes('canValidateProviderTransactions:true'),
  'conectar conta nunca pode ativar automaticamente a venda direta'
);

assert.ok(
  checkout.includes('prepare_merchant_sale_payment_attempt_v2')
  &&checkout.includes('paymentRouteId')
  &&checkout.includes('payment_provider_catalog')
  &&checkout.includes('PAYMENT_ADAPTER_NOT_IMPLEMENTED'),
  'checkout deve resolver rota/provedor e bloquear adaptador incompleto antes de chamar PSP'
);
assert.ok(
  checkout.indexOf('if(!directPaymentsEnabled())')<checkout.indexOf('authenticatedUser(req)'),
  'kill switch global precisa bloquear antes de autenticação, DB e mutação financeira'
);
assert.ok(
  !checkout.includes('marketplace_fee')
  &&checkout.includes('tamaoReceivesSaleProceeds:false')
  &&checkout.includes('fundsOwner:"merchant"'),
  'checkout não pode introduzir split, comissão ou custódia da venda'
);
assert.ok(
  getOrder.includes('merchant_payment_routes')
  &&getOrder.includes('payment_provider_catalog')
  &&getOrder.includes('paymentRouteId')
  &&getOrder.includes('fundsOwner:"merchant"'),
  'cliente precisa receber disponibilidade automática derivada das rotas, sem escolher PSP manualmente'
);

assert.ok(
  backend.includes("merchantPaymentConnectLive(provider='mercadopago',action='status')")
  &&backend.includes('merchantUpdatePaymentRoutesLive')
  &&backend.includes("'connect.pagseguro.uol.com.br'"),
  'browser da revenda precisa conectar providers genericamente com allowlist de redirect'
);
assert.ok(
  merchant.includes('Mercado Pago não é obrigatório.')
  &&merchant.includes('Conexões para confirmação automática')
  &&merchant.includes('merchantConnectProviderFromUi')
  &&merchant.includes('merchantUpdatePaymentRoutesLive'),
  'UX da revenda deve deixar explícito que PSP é opcional e confirmação automática é uma camada separada'
);
assert.ok(
  merchant.includes("provider:'manual'")
  &&merchant.includes("verificationMode:'merchant_confirmed'")
  &&merchant.includes("customerLabel:'Pix'"),
  'Pix/dinheiro/cartão manuais precisam continuar funcionando sem conta PSP'
);
assert.ok(
  merchant.includes("account?.capabilities?.directSalePaymentsEnabled!==true")
  &&merchant.includes("provider.adapterStatus!=='implemented'")
  &&merchant.includes("metadata:{autoManaged:true}"),
  'PSP homologado deve virar rota automática por trás da escolha simples Pix/cartão, sem exigir configuração técnica da revenda'
);
assert.ok(
  css.includes('TAMÃO V1.135 — Multi-PSP merchant capability')
  &&css.includes('.merchant-psp-grid'),
  'UI multi-PSP precisa permanecer responsiva'
);

assert.ok(
  adminOps.includes('merchantPaymentProvidersPromise')
  &&adminOps.includes('merchantPaymentRoutesPromise')
  &&adminOps.includes('paymentAccountsByMerchant')
  &&adminOps.includes('admin_merchant_provider_payment_capability_action'),
  'Admin precisa enxergar múltiplas conexões e homologar por provider'
);
assert.ok(
  admin.includes('Recebimento direto multi-PSP')
  &&admin.includes('Arquitetura agnóstica de provedor.')
  &&admin.includes('adminMerchantPaymentProviderCatalog')
  &&admin.includes('provider:String(provider'),
  'Admin não pode continuar comunicando Mercado Pago como requisito universal'
);
assert.ok(
  admin.includes('AUTOMAÇÃO GLOBAL')
  &&admin.includes('nenhuma venda passa pela conta do TAMÃO')
  &&admin.includes('Mercado Pago não é obrigatório'),
  'Admin deve manter kill switch e propriedade dos fundos semanticamente explícitos'
);

assert.ok(!merchant.includes('PAGBANK_CLIENT_SECRET')&&!admin.includes('PAGBANK_CLIENT_SECRET'),
  'credenciais de PSP não podem chegar ao browser');

console.log('Payment Capability Layer V1.135 passou: multi-PSP, fundos da revenda, homologação independente, fallback manual e fail-closed protegidos.');
