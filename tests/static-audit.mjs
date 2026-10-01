import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(new URL('..',import.meta.url).pathname);
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const exists=p=>fs.existsSync(path.join(root,p));

const html=read('index.html');
const refs=[...html.matchAll(/(?:src|href)="(\.\/[^"#?]+)"/g)].map(m=>m[1].replace(/^\.\//,''));
for(const ref of refs) assert.ok(exists(ref),`asset ausente no index: ${ref}`);

const manifest=JSON.parse(read('manifest.webmanifest'));
for(const icon of manifest.icons||[]) assert.ok(exists(icon.src.replace(/^\.\//,'')),`ícone do manifest ausente: ${icon.src}`);

const sw=read('sw.js');
const swAssets=[...sw.matchAll(/'\.\/([^']*)'/g)].map(m=>m[1]).filter(Boolean);
for(const asset of swAssets){
  if(asset.includes('#')) continue;
  assert.ok(exists(asset),`asset do service worker ausente: ${asset}`);
}

const customer=read('js/customer.js');
const merchant=read('js/merchant.js');
const growth=read('js/growth.js');
const core=read('js/core.js');
const backend=read('js/backend.js');
const admin=read('js/admin.js');

assert.ok(!customer.includes('desktop-only" style="display:block"'),'desktop-only não pode ser forçado a display:block no mobile');
assert.ok(customer.includes('esc(o.address)'),'endereço do pedido deve ser escapado antes de entrar no HTML');
assert.ok(merchant.includes('esc(o.address)'),'endereço no painel da revenda deve ser escapado');
assert.ok(customer.includes('esc(o.supplierSnapshot.name)'),'nome do fornecedor deve ser escapado');
assert.ok(merchant.includes('esc(m.name)'),'nome da revenda deve ser escapado');
assert.ok(core.includes("const STORAGE='chama-sg-state-v2'"),'versão nova do storage deve estar ativa');
assert.ok(core.includes("return isLiveStateScope()?sessionStorage:localStorage"),'estado do cliente live deve usar sessionStorage em origem compartilhada');
assert.ok(core.includes('freshLiveSeed'),'modo live não pode herdar carteira/endereço demonstrativo do localStorage');
assert.ok(backend.includes("storage:sessionStorage")&&backend.includes("storageKey:'chama-sg-auth-v1'"),'token do cliente live deve ser tab-scoped em sessionStorage');
assert.ok(!backend.includes("localStorage.getItem(CHAMA_BACKEND.orderStorageKey)"),'ID do pedido live não pode persistir no localStorage compartilhado');

assert.ok(core.includes('ALLOWED='),'máquina de estados deve possuir autoridade explícita');
assert.ok(core.includes('MAX_PIN_FAILURES'),'PIN precisa de limite de tentativas');
assert.ok(core.includes('PRICE_FRESH_MS'),'preço precisa de validade explícita');
assert.ok(core.includes('if(globalThis.__CHAMA_TEST__)'),'API de testes precisa estar protegida no site público');
assert.ok(core.includes('isValidCnpjShape'),'core precisa suportar validação estrutural do CNPJ atual');
assert.ok(!merchant.includes('.stock'),'UI da revenda não deve depender do campo legado stock');
assert.ok(growth.includes('referralCode'),'link de indicação deve usar código pessoal');
assert.ok(!growth.includes('inputmode="numeric" maxlength="18"'),'campo CNPJ não pode forçar teclado somente numérico após adoção do CNPJ alfanumérico');
assert.ok(sw.includes("CACHE='chama-sg-v1.10'"),'cache do service worker precisa estar versionado');
assert.ok(sw.includes("./js/backend.js"),'runtime live precisa estar no cache da PWA');
assert.ok(backend.includes("sb_publishable_"),'frontend live deve usar publishable key explícita');
assert.ok(!backend.includes("sb_secret_"),'frontend jamais pode conter secret key');
assert.ok(!backend.includes("service_role"),'frontend jamais pode depender de service_role');
assert.ok(backend.includes("signInAnonymously"),'modo live do cliente precisa de Auth anônimo');
assert.ok(backend.includes("get-offers")&&backend.includes("create-order")&&backend.includes("get-order"),'runtime live precisa usar Edge Functions seguras');
assert.ok(backend.includes('@supabase/supabase-js@2.117.2'),'browser deve fixar versão exata do supabase-js');
assert.ok(!backend.includes('@supabase/supabase-js@2\''),'browser não pode usar major flutuante do supabase-js');
assert.ok(backend.includes('offerRequestSeq')&&backend.includes('orderRequestSeq'),'runtime live precisa bloquear respostas assíncronas obsoletas');
assert.ok(backend.includes('liveRuntime.actionPending'),'polling precisa respeitar ação em andamento');
assert.ok(read('supabase/functions/get-offers/index.ts').includes('create_quote_snapshot'),'ofertas devem persistir snapshot por RPC atômica');
assert.ok(!read('supabase/functions/get-offers/index.ts').includes('.from("quotes")\n        .insert'),'Edge não deve montar quote em duas gravações separadas');
assert.ok(read('supabase/functions/get-offers/index.ts').includes('get-offers-hour'),'consulta de oferta precisa também de quota horária');

assert.ok(backend.includes("customer-summary"),'frontend live deve usar projeção financeira mínima');
assert.ok(!backend.includes(".from('wallet_entries')"),'frontend não pode ler ledger financeiro bruto');
assert.ok(!backend.includes(".from('profiles')"),'frontend não pode ler tabela de perfis diretamente');
assert.ok(merchant.includes('Pagamento recebido'),'painel precisa exigir confirmação explícita de pagamento');
assert.ok(core.includes('paymentConfirmed!==true'),'autoridade demo deve bloquear settlement sem pagamento');
assert.ok(backend.includes("storageKey:'chama-sg-merchant-auth-v1'"),'sessão da revenda deve usar storage separado do cliente');
assert.ok(backend.includes('signInWithOtp'),'revenda deve usar login permanente por e-mail');
assert.ok(backend.includes("merchant-orders")&&backend.includes("merchant-action")&&backend.includes("merchant-ops"),'portal real deve operar somente pelas Edge Functions');
assert.ok(merchant.includes('merchantLivePage'),'UI deve possuir painel real da revenda');
assert.ok(merchant.includes('Endereço protegido até o aceite'),'painel real não pode expor endereço antes do aceite');
assert.ok(merchant.includes('Pagamento recebido'),'painel real deve exigir confirmação de pagamento');
assert.ok(core.includes('grossCents*100'),'demo deve calcular cashback proporcional ao pedido');
assert.ok(backend.includes('liveUpgradeAccount'),'cliente anônimo precisa poder vincular identidade permanente sem trocar de usuário');
assert.ok(growth.includes('Comissão em dinheiro exige conta permanente'),'UI deve explicar o gate de identidade para saque');
assert.ok(read('supabase/functions/customer-summary/index.ts').includes('cashEarningEligible'),'resumo financeiro precisa expor elegibilidade de comissão');
assert.ok(read('supabase/functions/merchant-ops/index.ts').includes('Seu papel não pode manter a operação ativa.'),'heartbeat não pode ser mantido por papel não operacional');
assert.ok(read('supabase/functions/merchant-orders/index.ts').includes('MERCHANT_ROLE_NOT_ENABLED'),'driver sem assignment não pode abrir painel operacional');
assert.ok(sw.includes("./js/admin.js"),'runtime admin precisa estar no cache da PWA');
assert.ok(admin.includes("storageKey:'chama-sg-admin-auth-v1'"),'sessão admin deve ser isolada das sessões cliente/revenda');
assert.ok(backend.includes("storage:sessionStorage")&&backend.includes("storageKey:'chama-sg-merchant-auth-v1'"),'sessão da revenda deve ser tab-scoped em sessionStorage');
assert.ok(admin.includes("storage:sessionStorage")&&admin.includes("storageKey:'chama-sg-admin-auth-v1'"),'sessão admin privilegiada deve ser tab-scoped em sessionStorage');
assert.ok(admin.includes("shouldCreateUser:false"),'login admin não deve criar contas automaticamente');
assert.ok(admin.includes("/functions/v1/admin-ops"),'admin deve operar somente pela Edge Function protegida');
assert.ok(!admin.includes("service_role")&&!admin.includes("sb_secret_"),'frontend admin jamais pode conter autoridade server-side');
assert.ok(read('supabase/functions/admin-ops/index.ts').includes('platform_admins'),'Edge admin deve exigir allowlist server-side');
assert.ok(read('supabase/functions/admin-ops/index.ts').includes('ADMIN_ACCESS_DENIED'),'Edge admin deve negar conta fora da allowlist');
const adminOpsSource=read('supabase/functions/admin-ops/index.ts');
assert.ok(adminOpsSource.includes('requestFingerprint'),'mutações admin devem possuir fingerprint canônico');
assert.ok(adminOpsSource.includes('Idempotency-Key'),'Edge admin deve exigir chave idempotente');
assert.ok(adminOpsSource.includes('admin_execute_action'),'Edge admin deve usar autoridade idempotente única');
assert.ok(adminOpsSource.includes('idempotency-key'),'CORS admin precisa aceitar o header idempotente');
assert.ok(!adminOpsSource.includes('.rpc("admin_financial_action"'),'Edge admin não pode contornar a autoridade idempotente financeira');
assert.ok(!adminOpsSource.includes('.rpc("admin_reverse_settled_order"'),'Edge admin não pode contornar a autoridade idempotente de reversão');
assert.ok(!adminOpsSource.includes('.rpc("admin_approve_merchant_application"'),'Edge admin não pode aprovar parceiro fora da autoridade idempotente');
assert.ok(admin.includes("headers['Idempotency-Key']"),'frontend admin precisa enviar chave idempotente');
assert.ok(admin.includes("adminIdempotency('admin-'+action)"),'cada mutação admin precisa criar uma chave própria');
assert.ok(admin.includes('adminOriginSafe'),'frontend admin precisa validar isolamento de origem');
assert.ok(admin.includes("status='unsafe-origin'")||admin.includes("status='unsafe-origin';"),'frontend admin precisa bloquear origem compartilhada');
assert.ok(adminOpsSource.includes('ADMIN_ALLOWED_ORIGIN'),'Edge admin precisa depender de origem dedicada configurável');
assert.ok(adminOpsSource.includes('MERCHANT_OWNERSHIP_CONFLICT'),'Edge admin precisa expor conflito de ownership sem erro genérico');
assert.ok(adminOpsSource.includes('INVALID_MERCHANT_STATUS_TRANSITION'),'Edge admin precisa expor transição administrativa inválida');
assert.ok(adminOpsSource.includes('GLP_REGULATORY_VERIFICATION_REQUIRED'),'Edge admin precisa reconhecer gate regulatório genérico de GLP');
assert.ok(adminOpsSource.includes('produto GLP ativo exige validação ANP'),'mensagem administrativa deve cobrir todos os produtos GLP');
assert.ok(admin.includes('Qualquer produto GLP ativo exige também validação ANP.'),'UI admin deve explicar gate ANP genérico');
const offerSource=read('supabase/functions/get-offers/index.ts');
const merchantOpsSource=read('supabase/functions/merchant-ops/index.ts');
const merchantOrdersSource=read('supabase/functions/merchant-orders/index.ts');
assert.ok(offerSource.includes('.gte("delivery_fee_confirmed_at", priceCutoff)'),'matching deve exigir taxa de entrega fresca');
assert.ok(offerSource.includes('.gte("price_confirmed_at", priceCutoff)'),'matching deve exigir preço fresco por SKU');
assert.ok(!offerSource.includes('.gte("price_confirmed_at", priceCutoff)\n      .gte("last_seen_at"'),'merchant global price clock não pode voltar a governar matching');
assert.ok(merchantOpsSource.includes('price_confirmed_at:now'),'edição de produto deve confirmar somente o SKU alterado');
assert.ok(merchantOpsSource.includes('delivery_fee_confirmed_at:now'),'edição logística deve confirmar a taxa separadamente');
assert.ok(!merchantOpsSource.includes('.update({price_confirmed_at:now,last_seen_at:now})'),'SKU não pode renovar relógio global da revenda');
assert.ok(merchantOrdersSource.includes('priceConfirmedAt:item.price_confirmed_at'),'painel precisa receber freshness por SKU');
assert.ok(merchantOrdersSource.includes('deliveryFeeConfirmedAt:merchant.delivery_fee_confirmed_at'),'painel precisa receber freshness da taxa');
assert.ok(merchant.includes('merchantLiveSaveProduct'),'painel live precisa editar/reconfirmar múltiplos SKUs');
assert.ok(merchant.includes('Cada SKU possui sua própria confirmação de preço'),'UI precisa explicar freshness independente');
assert.ok(offerSource.includes('filter_delivery_compatible_merchants'),'matching live deve filtrar revendas por compatibilidade logística');
assert.ok(offerSource.includes('deliveryCompatibilityBlocked:true'),'matching deve distinguir bloqueio logístico de indisponibilidade comum');
assert.ok(read('supabase/functions/merchant-action/index.ts').includes('DELIVERY_INCOMPATIBLE'),'revenda deve receber conflito logístico sem erro genérico');
assert.ok(read('supabase/functions/customer-action/index.ts').includes('DELIVERY_INCOMPATIBLE'),'cliente deve receber conflito logístico sem erro genérico');
assert.ok(backend.includes('deliveryCompatibilityBlocked'),'runtime cliente precisa transportar o motivo de bloqueio');
assert.ok(customer.includes('cesta mista'),'UI cliente deve explicar alternativa de entrega separada');
assert.ok(adminOpsSource.includes('merchant_delivery_capabilities'),'resumo admin precisa expor capabilities logísticas');
assert.ok(adminOpsSource.includes('admin_delivery_capability_action'),'Edge admin deve usar autoridade idempotente de capability');
assert.ok(admin.includes('Capacidade logística verificada para cesta mista com GLP'),'painel admin precisa mostrar capability GLP mista');




assert.ok(!adminOpsSource.includes('const PROD_ORIGIN="https://carloskk07.github.io"'),'Edge admin não pode confiar no origin compartilhado do GitHub Pages');



const getOrderSource=read('supabase/functions/get-order/index.ts');
assert.ok(getOrderSource.includes('["owner","manager","operator"].includes(membership.member_role)'),'driver sem assignment não pode ler pedido individual');
assert.ok(getOrderSource.includes('financial_state'),'projeção do pedido precisa expor estado financeiro seguro');
assert.ok(customer.includes('Liquidação financeira revertida'),'cliente precisa ver quando benefícios de pedido entregue foram revertidos');
assert.ok(read('supabase/functions/customer-summary/index.ts').includes('reversedOrders'),'resumo do cliente precisa conhecer settlements revertidos');





const functionRoot=path.join(root,'supabase/functions');
for(const entry of fs.readdirSync(functionRoot,{withFileTypes:true})){
  if(!entry.isDirectory()||entry.name==='_shared')continue;
  const file=path.join(functionRoot,entry.name,'index.ts');
  if(!fs.existsSync(file))continue;
  const source=fs.readFileSync(file,'utf8');
  assert.ok(source.includes('jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts'),entry.name+' precisa fixar functions-js');
  assert.ok(source.includes('npm:@supabase/supabase-js@2.117.2'),entry.name+' precisa fixar supabase-js');
  assert.ok(source.includes('readJsonBody(req)'),entry.name+' precisa limitar JSON');
  assert.ok(source.includes('enforceApiQuota(admin'),entry.name+' precisa aplicar quota server-side');
  if(entry.name==='complete-delivery'){
    assert.ok(source.includes('body.paymentConfirmed!==true'),'complete-delivery deve exigir confirmação de pagamento');
    assert.ok(source.includes('paymentConfirmed:true'),'fingerprint idempotente deve incluir confirmação de pagamento');
  }

}


console.log(`${refs.length} assets do index validados.`);
console.log(`${swAssets.length} assets do service worker validados.`);
console.log('Auditoria estática passou.');
