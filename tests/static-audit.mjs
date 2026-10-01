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
assert.ok(core.includes("return isLiveStateScope()?sessionStorage:localStorage"),'endereço/carrinho live devem permanecer tab-scoped em sessionStorage');
assert.ok(core.includes('freshLiveSeed'),'modo live não pode herdar carteira/endereço demonstrativo do localStorage');
assert.ok(backend.includes("storage:localStorage")&&backend.includes("storageKey:'chama-sg-customer-auth-v2'"),'cliente live deve persistir identidade anônima somente na origem dedicada');
assert.ok(backend.includes("localStorage.getItem(CHAMA_BACKEND.orderStorageKey)"),'pedido live precisa ser recuperável depois de fechar e reabrir o navegador');
assert.ok(!backend.includes("storageKey:'chama-sg-auth-v1'"),'chave legada compartilhada do cliente não pode voltar');

assert.ok(core.includes('ALLOWED='),'máquina de estados deve possuir autoridade explícita');
assert.ok(core.includes('MAX_PIN_FAILURES'),'PIN precisa de limite de tentativas');
assert.ok(core.includes('PRICE_FRESH_MS'),'preço precisa de validade explícita');
assert.ok(core.includes('if(globalThis.__CHAMA_TEST__)'),'API de testes precisa estar protegida no site público');
assert.ok(core.includes('isValidCnpjShape'),'core precisa suportar validação estrutural do CNPJ atual');
assert.ok(!merchant.includes('.stock'),'UI da revenda não deve depender do campo legado stock');
assert.ok(growth.includes('referralCode'),'link de indicação deve usar código pessoal');
assert.ok(!growth.includes('inputmode="numeric" maxlength="18"'),'campo CNPJ não pode forçar teclado somente numérico após adoção do CNPJ alfanumérico');
assert.ok(sw.includes("CACHE='chama-sg-v1.18'"),'cache do service worker precisa estar versionado');
assert.ok(sw.includes("./js/backend.js"),'runtime live precisa estar no cache da PWA');
assert.ok(sw.includes("./js/runtime-config.js"),'configuração pública de origins precisa estar no cache da PWA');
assert.ok(sw.includes("./js/turnstile.js"),'helper local do Turnstile precisa estar no cache da PWA');
assert.ok(html.indexOf('./js/turnstile.js')<html.indexOf('./js/backend.js'),'helper Turnstile deve carregar antes do backend');
assert.ok(html.indexOf('./js/runtime-config.js')<html.indexOf('./js/backend.js'),'runtime-config.js deve carregar antes do backend');
assert.ok(html.includes('http-equiv="Content-Security-Policy"'),'PWA precisa declarar CSP explícita');
assert.ok(html.includes("script-src-elem 'self' https://cdn.jsdelivr.net https://challenges.cloudflare.com"),'CSP deve bloquear script element inline e limitar origens');
assert.ok(html.includes("script-src-attr 'unsafe-inline'"),'CSP precisa preservar handlers legados até a refatoração');
assert.ok(html.includes("connect-src 'self' https://lgugwujpunhslavewffd.supabase.co"),'CSP deve limitar conexão ao backend Supabase conhecido');
assert.ok(html.includes("frame-src https://challenges.cloudflare.com"),'CSP deve permitir somente iframe Turnstile');
assert.ok(html.includes("object-src 'none'"),'CSP deve bloquear plugins/objetos');
assert.ok(html.includes("base-uri 'self'"),'CSP deve impedir base URL externa');
assert.ok(html.includes('name="referrer" content="strict-origin-when-cross-origin"'),'PWA precisa de política de referrer explícita');
const runtimeConfig=read('js/runtime-config.js');
assert.ok(runtimeConfig.includes("CHAMA_CUSTOMER_ORIGIN=''")&&runtimeConfig.includes("CHAMA_MERCHANT_ORIGIN=''")&&runtimeConfig.includes("CHAMA_ADMIN_ORIGIN=''"),'GitHub Pages deve falhar fechado sem origins privilegiadas');
assert.ok(runtimeConfig.includes("CHAMA_TURNSTILE_SITE_KEY=''"),'GitHub Pages não pode embutir site key de Turnstile do portal real');
assert.ok(!runtimeConfig.includes('github.io'),'config padrão não pode autorizar origin compartilhada');
assert.ok(backend.includes("sb_publishable_"),'frontend live deve usar publishable key explícita');
assert.ok(!backend.includes("sb_secret_"),'frontend jamais pode conter secret key');
assert.ok(!backend.includes("service_role"),'frontend jamais pode depender de service_role');
assert.ok(backend.includes("signInAnonymously"),'modo live do cliente precisa de Auth anônimo');
assert.ok(backend.includes("chamaTurnstile.challenge"),'nova identidade anônima deve exigir desafio Turnstile');
assert.ok(backend.includes("options:{captchaToken}"),'token Turnstile deve ser entregue ao Auth do Supabase');
const turnstile=read('js/turnstile.js');
assert.ok(turnstile.includes('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'),'Turnstile deve carregar a API oficial em modo explícito');
assert.ok(turnstile.includes('action:safeAction'),'helper Turnstile deve validar e encaminhar action específica');
assert.ok(turnstile.includes('CHAMA_TURNSTILE_SITE_KEY'),'helper deve depender da site key pública de runtime');

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
assert.ok(read('supabase/functions/merchant-ops/index.ts').includes('function glpKgForCode'),'merchant API deve reconhecer semanticamente GLP P1..P90');
assert.ok(read('supabase/functions/merchant-ops/index.ts').includes('return "Gás P"+kg'),'nome de cilindro GLP deve ser derivado do código validado');
assert.ok(core.includes("P20:{name:'Gás P20'")&&core.includes("P45:{name:'Gás P45'"),'cliente deve expor P20/P45 sem inventar oferta');
assert.ok(merchant.includes('merchantLiveAddGlp'),'painel real deve permitir adicionar cilindro GLP válido');
assert.ok(merchant.includes('serverOnly'),'catálogo real deve renderizar SKUs vindos do servidor além do mapa local');
assert.ok(read('supabase/functions/admin-ops/index.ts').includes('cnpj_verified_at')&&read('supabase/functions/admin-ops/index.ts').includes('anp_verified_at'),'admin deve projetar relógios independentes de compliance');
assert.ok(read('supabase/functions/merchant-ops/index.ts').includes('CNPJ_REVERIFICATION_REQUIRED'),'merchant ops deve traduzir CNPJ vencido');
assert.ok(read('supabase/functions/merchant-ops/index.ts').includes('ANP_REVERIFICATION_REQUIRED'),'merchant ops deve traduzir ANP vencida');
assert.ok(admin.includes('Última verificação:'),'admin UI deve exibir idade das evidências');


assert.ok(backend.includes('merchantOriginSafe'),'frontend da revenda precisa bloquear origem compartilhada');
assert.ok(backend.includes('CHAMA_MERCHANT_ORIGIN'),'origem dedicada da revenda precisa ser configurável');
for(const fn of ['merchant-orders','merchant-action','merchant-ops','complete-delivery']){
  const source=read('supabase/functions/'+fn+'/index.ts');
  assert.ok(source.includes('MERCHANT_ALLOWED_ORIGIN'),fn+' precisa exigir origem dedicada');
  assert.ok(!source.includes('const PROD_ORIGIN="https://carloskk07.github.io"'),fn+' não pode confiar no GitHub Pages compartilhado');
}
assert.ok(read('supabase/functions/get-order/index.ts').includes('MERCHANT_ORIGIN_REQUIRED'),'leitura individual da revenda deve exigir origem dedicada');
assert.ok(read('supabase/functions/get-order/index.ts').includes('merchantOriginAllowed'),'get-order precisa distinguir origem cliente de origem merchant');
assert.ok(merchant.includes('Origem da revenda não isolada'),'UI deve explicar o bloqueio de origem da revenda');
assert.ok(backend.includes('customerOriginSafe'),'frontend cliente live precisa bloquear origem compartilhada');
assert.ok(backend.includes('CHAMA_CUSTOMER_ORIGIN'),'origem dedicada do cliente precisa ser configurável');
for(const fn of ['get-offers','create-order','customer-action','customer-summary','submit-merchant-application']){
  const source=read('supabase/functions/'+fn+'/index.ts');
  assert.ok(source.includes('CUSTOMER_ALLOWED_ORIGIN'),fn+' precisa exigir origem dedicada do cliente');
  assert.ok(!source.includes('carloskk07.github.io'),fn+' não pode confiar na origem compartilhada do GitHub Pages');
}
assert.ok(read('supabase/functions/get-order/index.ts').includes('CUSTOMER_ORIGIN_REQUIRED'),'get-order precisa exigir origem dedicada para papel customer');
assert.ok(read('supabase/functions/get-order/index.ts').includes('CUSTOMER_ALLOWED_ORIGIN'),'get-order precisa separar origem customer de merchant');
assert.ok(core.includes('Piloto real bloqueado nesta origem compartilhada'),'UI deve explicar que GitHub Pages é apenas demonstração');
assert.ok(sw.includes("./js/admin.js"),'runtime admin precisa estar no cache da PWA');
assert.ok(admin.includes("storageKey:'chama-sg-admin-auth-v1'"),'sessão admin deve ser isolada das sessões cliente/revenda');
assert.ok(backend.includes("storage:sessionStorage")&&backend.includes("storageKey:'chama-sg-merchant-auth-v1'"),'sessão da revenda deve ser tab-scoped em sessionStorage');
assert.ok(admin.includes("storage:sessionStorage")&&admin.includes("storageKey:'chama-sg-admin-auth-v1'"),'sessão admin privilegiada deve ser tab-scoped em sessionStorage');
assert.ok(admin.includes("shouldCreateUser:false"),'login admin não deve criar contas automaticamente');
assert.ok(backend.includes("challenge('merchant_login')"),'login da revenda deve resolver Turnstile antes do magic link');
assert.ok(backend.includes('shouldCreateUser:true,captchaToken'),'magic link da revenda deve enviar captchaToken ao Supabase');
assert.ok(admin.includes("challenge('admin_login')"),'login admin deve resolver Turnstile antes do magic link');
assert.ok(admin.includes('shouldCreateUser:false,captchaToken'),'magic link admin deve enviar captchaToken sem criar conta');

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
assert.ok(backend.includes('return result;'),'runtime da revenda precisa devolver o resultado real da ação');
assert.ok(merchant.includes('result?.autoRescued'),'UI da revenda precisa distinguir aceite real de rescue automático');
assert.ok(merchant.includes('stock_changed_before_accept'),'UI deve explicar corrida de estoque sem falso aceite');

assert.ok(offerSource.includes('filter_delivery_compatible_merchants'),'matching live deve filtrar revendas por compatibilidade logística');
assert.ok(offerSource.includes('deliveryCompatibilityBlocked:true'),'matching deve distinguir bloqueio logístico de indisponibilidade comum');
assert.ok(read('supabase/functions/merchant-action/index.ts').includes('DELIVERY_INCOMPATIBLE'),'revenda deve receber conflito logístico sem erro genérico');
assert.ok(read('supabase/functions/customer-action/index.ts').includes('DELIVERY_INCOMPATIBLE'),'cliente deve receber conflito logístico sem erro genérico');
assert.ok(read('supabase/functions/customer-action/index.ts').includes('cancel-before-dispatch'),'Edge cliente precisa expor cancelamento antes da saída');
assert.ok(read('supabase/functions/customer-action/index.ts').includes('TOO_LATE_TO_CANCEL'),'Edge cliente precisa traduzir corrida perdida para o despacho');
assert.ok(read('supabase/functions/customer-action/index.ts').includes('STOCK_RESTORE_FAILED'),'Edge cliente precisa falhar fechado se a recomposição do estoque falhar');
assert.ok(customer.includes('Cancelar antes da saída'),'acompanhamento precisa oferecer cancelamento apenas antes do despacho');
assert.ok(customer.includes('cancelBeforeDispatch'),'UI precisa usar ação específica de cancelamento pré-saída');
assert.ok(backend.includes('deliveryCompatibilityBlocked'),'runtime cliente precisa transportar o motivo de bloqueio');
assert.ok(customer.includes('cesta mista'),'UI cliente deve explicar alternativa de entrega separada');
assert.ok(adminOpsSource.includes('merchant_delivery_capabilities'),'resumo admin precisa expor capabilities logísticas');
assert.ok(adminOpsSource.includes('admin_delivery_capability_action'),'Edge admin deve usar autoridade idempotente de capability');
assert.ok(admin.includes('Capacidade logística verificada para cesta mista com GLP'),'painel admin precisa mostrar capability GLP mista');
assert.ok(adminOpsSource.includes('referral_reward_reviews'),'resumo admin precisa carregar fila de risco de indicação');
assert.ok(adminOpsSource.includes('admin_referral_review_action'),'review de referral deve usar autoridade idempotente dedicada');
assert.ok(admin.includes('Revisão de indicações'),'painel admin precisa mostrar fila de indicações suspeitas');
assert.ok(admin.includes('adminReviewReferral'),'painel admin precisa permitir decisão auditada sobre referral');
assert.ok(adminOpsSource.includes('financial_state'),'resumo admin de referral precisa carregar estado financeiro do pedido');
assert.ok(admin.includes('Pedido financeiramente revertido.'),'painel admin deve sinalizar referral já revertido');
assert.ok(admin.includes("x.financialState!=='reversed'"),'fila pendente não pode oferecer ação financeira em reward revertido');
assert.ok(adminOpsSource.includes('REFERRAL_REWARD_ALREADY_REVERSED'),'Edge admin deve traduzir aprovação tardia de reward revertido');
assert.ok(adminOpsSource.includes('reward_processing_failures'),'admin deve carregar dívida operacional de rewards');
assert.ok(adminOpsSource.includes('admin_reward_retry_action'),'retry de reward deve usar autoridade idempotente');
assert.ok(admin.includes('Fila de benefícios'),'painel admin precisa mostrar dívida de reward');
assert.ok(admin.includes('DEAD LETTER'),'painel admin precisa distinguir retry interrompido');
assert.ok(admin.includes('adminRetryReward'),'painel admin precisa permitir recuperação auditada');
assert.ok(adminOpsSource.includes('settlement_accounting_failures'),'admin precisa carregar dívida contábil de settlement');
assert.ok(adminOpsSource.includes('admin_settlement_accounting_retry_action'),'retry contábil deve usar autoridade idempotente');
assert.ok(!adminOpsSource.includes('cashback_reimbursement:["paid","offset"]'),'Edge admin não pode permitir offset sem autoridade de netting');
assert.ok(!admin.includes('>Compensado</button>'),'UI admin não pode oferecer compensação opaca de cashback');
assert.ok(admin.includes('Fila contábil de settlement'),'painel admin precisa exibir falhas contábeis');
assert.ok(admin.includes('adminRetryAccounting'),'painel admin precisa permitir retry contábil auditado');
assert.ok(adminOpsSource.includes('platform_admins'),'resumo admin precisa listar continuidade administrativa');
assert.ok(adminOpsSource.includes('admin_platform_admin_action'),'gestão de admin deve usar autoridade idempotente dedicada');
assert.ok(adminOpsSource.includes('LAST_ADMIN_CANNOT_BE_REMOVED'),'Edge deve traduzir proteção do último admin');
assert.ok(admin.includes('Administradores da plataforma'),'painel admin precisa mostrar administradores');
assert.ok(admin.includes('adminSetPlatformAdmin'),'painel admin precisa permitir gestão protegida de admins');





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
