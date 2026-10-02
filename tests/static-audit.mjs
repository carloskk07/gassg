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
const bootstrap=read('js/bootstrap.js');
const core=read('js/core.js');
const backend=read('js/backend.js');
const admin=read('js/admin.js');
const financePolicy=read('supabase/migrations/20261001105000_financial_unit_economics_v1_6.sql');

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
assert.ok(bootstrap.includes('home,learn,earn'),'router público precisa expor jornadas de descoberta e renda');
assert.ok(customer.includes('Quero pedir agora')&&customer.includes('Quero entender melhor')&&customer.includes('Quero ganhar ou vender'),'home precisa priorizar compra e separar entendimento de oportunidades');
assert.ok(customer.includes('Botijão de cozinha 13 kg')&&customer.includes('startHomeOrder'),'home precisa iniciar a compra em linguagem humana sem depender de P13 como rótulo principal');
assert.ok(customer.includes('PROTEÇÃO CHAMA')&&customer.includes('qualquer alternativa mais cara'),'home precisa explicar rescue e requote como proteção compreensível ao cliente');
assert.ok(customer.includes('PRIMEIRO PARCEIRO PILOTO')&&customer.includes('Gas e Lenheira do JR'),'pré-lançamento deve mostrar o primeiro parceiro piloto sem fingir operação ativa');
assert.ok(customer.includes('PILOTO INTERNO — SEM PEDIDOS REAIS')&&customer.includes('R$ 115,90 entregue'),'GitHub Pages deve comunicar claramente o cenário interno do JR');
assert.ok(customer.includes('🧪 Simulação operacional')&&customer.includes('Sem validação jurídica nesta tela'),'oferta do piloto interno não pode fingir verificação regulatória');
assert.ok(merchant.includes('PAINEL DA REVENDA — PILOTO INTERNO')&&merchant.includes('Nenhuma ação é real.'),'painel simulado da revenda deve ser inequivocamente não operacional');
assert.ok(customer.includes('Há um parceiro elegível para esta cesta agora.')&&customer.includes('sem opções fictícias'),'modo single-supplier deve explicar ao cliente que existe apenas uma opção real');
assert.ok(backend.includes("available:'Disponível agora'")&&backend.includes("marketMode"),'runtime cliente precisa transportar e rotular mercado de fornecedor único');
assert.ok(customer.includes("go('learn')")&&customer.includes("go('earn')"),'home precisa possuir CTAs claros para descoberta e renda');
assert.ok(growth.includes('function learn()'),'jornada Saiba mais precisa existir');
assert.ok(growth.includes('function earn()'),'hub Ganhe com o Chama precisa existir');
assert.ok(growth.includes('REFERRAL_PILOT_RATE=0.02'),'exemplo de indicação deve estar ancorado na política atual do piloto');
assert.ok(growth.includes('MERCHANT_PILOT_FEE_RATE=0.075'),'simulador comercial deve usar a taxa real da política inicial do piloto');
assert.ok(growth.includes('merchantMarginExample'),'simulador comercial avançado precisa centralizar cálculo de margem');
assert.ok(growth.includes('gross-chamaFee-knownCosts'),'margem estimada precisa descontar taxa Chama e custos informados');
assert.ok(financePolicy.includes('platform_fee_bps=750'),'backend financeiro deve manter 7,5% enquanto a UX publica essa taxa');
assert.ok(financePolicy.includes('direct_referral_bps=200'),'backend financeiro deve manter 2% enquanto a UX publica essa comissão');
assert.ok(financePolicy.includes('cashback_bps=100'),'backend financeiro deve manter 1% como política inicial de cashback');
assert.ok(growth.includes('Taxa Chama: 7,5% por pedido concluído'),'landing de oportunidade deve expor o custo comercial do piloto');
assert.ok(growth.includes('SIMULADOR DE MARGEM INCREMENTAL')&&growth.includes('merchant-sim-fee'),'revenda precisa visualizar taxa e margem incremental');
assert.ok(growth.includes('merchant-sim-product-cost')&&growth.includes('merchant-sim-delivery-cost')&&growth.includes('merchant-sim-payment-cost')&&growth.includes('merchant-sim-tax-rate'),'simulador da revenda precisa aceitar custos próprios antes de estimar margem');
assert.ok(growth.includes('Receita não é lucro')&&growth.includes('não para prometer lucro'),'landing da revenda não pode confundir receita com lucro');
assert.ok(growth.includes("productCostRaw!==''")&&growth.includes("contribution.textContent='—'"),'simulador não pode exibir margem antes de o parceiro informar o custo do produto');
assert.ok(growth.includes('Obrigatório para estimar contribuição e margem.'),'UI deve explicar por que o custo do produto é necessário');
assert.ok(growth.includes('Sem exclusividade')&&growth.includes('canal adicional'),'parceria precisa deixar claro que não substitui telefone/WhatsApp/canais próprios');
assert.ok(growth.includes('Você não precisa ser sempre o mais barato')&&growth.includes('Distribuição saudável'),'landing precisa explicar distribuição sem prometer rodízio cego');
assert.ok(growth.includes('AUMENTE O TICKET DA ENTREGA')&&growth.includes('Uma corrida pode carregar mais que um botijão'),'multiproduto deve ser vendido como aumento de ticket');
assert.ok(growth.includes('COMO O DINHEIRO FUNCIONA')&&growth.includes('Repasse ainda em validação operacional'),'parceiro precisa entender separação entre pedido, pagamento, conclusão e conciliação');
assert.ok(growth.includes('PARCEIRO FUNDADOR — SÃO GABRIEL')&&growth.includes('não garante volume de pedidos nem renda'),'programa fundador precisa gerar oportunidade sem promessa de demanda');
assert.ok(growth.includes("internalPilot?'Experimentar painel da revenda'"),'piloto interno deve oferecer experiência do painel em vez de portal live indisponível');
assert.ok(customer.includes('✓ Operação elegível'),'oferta real deve comunicar elegibilidade operacional sem expor a revenda antes do aceite');
assert.ok(growth.includes('Não é promessa de renda'),'marketing de indicação precisa explicar que simulação não é renda garantida');
assert.ok(growth.includes('primeira compra qualificada de cada novo cliente indicado'),'marketing deve refletir aquisição apenas na primeira compra qualificada');
assert.ok(growth.includes('Compras repetidas do mesmo cliente não geram novas comissões'),'marketing não pode sugerir comissão recorrente do mesmo indicado');
assert.ok(growth.includes('indicador e cliente indicado em identidades permanentes'),'marketing deve expor o gate real de identidade para maturação');
assert.ok(growth.includes('Saque Pix ainda não disponível')&&growth.includes('disabled>Saque Pix ainda não disponível'),'UI não pode fingir saque ainda inexistente');
assert.ok(growth.includes('Você continua no controle'),'landing de revenda deve enfatizar autonomia operacional');
assert.ok(core.includes("['earn','💰','Ganhe','go']"),'navegação móvel precisa dar acesso direto ao hub de renda');
assert.ok(!growth.includes('inputmode="numeric" maxlength="18"'),'campo CNPJ não pode forçar teclado somente numérico após adoção do CNPJ alfanumérico');
assert.ok(sw.includes("CACHE='chama-sg-v1.31'"),'cache do service worker precisa estar versionado');
assert.ok(sw.includes("./js/backend.js"),'runtime live precisa estar no cache da PWA');
assert.ok(sw.includes("./js/runtime-config.js"),'configuração pública de origins precisa estar no cache da PWA');
assert.ok(sw.includes("./js/turnstile.js"),'helper local do Turnstile precisa estar no cache da PWA');
assert.ok(sw.includes('async function networkFirst')&&sw.includes("return (await cache.match(cacheKey))||res"),'PWA deve usar cache também quando servidor same-origin responde erro');
assert.ok(sw.includes("return (await cache.match(cacheKey))||Response.error()"),'PWA precisa responder de forma definida quando rede e cache falham');
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
assert.ok(html.includes('name="robots" content="noindex,nofollow,noarchive,nosnippet"'),'pré-lançamento interno não deve ser indexado por buscadores');
assert.ok(exists('robots.txt')&&read('robots.txt').includes('Disallow: /'),'pré-lançamento interno precisa bloquear crawling também por robots.txt');
assert.ok(sw.includes("./robots.txt"),'PWA precisa conservar a política de robots offline');
const runtimeConfig=read('js/runtime-config.js');
assert.ok(runtimeConfig.includes("CHAMA_CUSTOMER_ORIGIN=''")&&runtimeConfig.includes("CHAMA_MERCHANT_ORIGIN=''")&&runtimeConfig.includes("CHAMA_ADMIN_ORIGIN=''"),'GitHub Pages deve falhar fechado sem origins privilegiadas');
assert.ok(runtimeConfig.includes("CHAMA_TURNSTILE_SITE_KEY=''"),'GitHub Pages não pode embutir site key de Turnstile do portal real');
assert.ok(runtimeConfig.includes("CHAMA_INTERNAL_PILOT")&&runtimeConfig.includes("chamaHost==='carloskk07.github.io'"),'GitHub Pages deve ativar somente a simulação interna, nunca os portais live');
assert.ok(!runtimeConfig.includes("CHAMA_CUSTOMER_ORIGIN='https://carloskk07.github.io'")&&!runtimeConfig.includes("CHAMA_MERCHANT_ORIGIN='https://carloskk07.github.io'")&&!runtimeConfig.includes("CHAMA_ADMIN_ORIGIN='https://carloskk07.github.io'"),'GitHub Pages jamais pode virar origem live/privilegiada');
assert.ok(backend.includes("sb_publishable_"),'frontend live deve usar publishable key explícita');
assert.ok(!backend.includes("sb_secret_"),'frontend jamais pode conter secret key');
assert.ok(!backend.includes("service_role"),'frontend jamais pode depender de service_role');
assert.ok(backend.includes("signInAnonymously"),'modo live do cliente precisa de Auth anônimo');
assert.ok(backend.includes("customerPortalParams.get('merchant')!=='1'&&customerPortalParams.get('admin')!=='1'"),'cliente real deve ser o modo padrão fora dos portais privilegiados');
assert.ok(backend.includes('prelaunchExamplesEnabled'),'exemplos precisam de gate explícito de pré-lançamento');
assert.ok(backend.includes("liveInvoke('market-status'"),'frontend deve consultar autoridade server-side antes de decidir exemplos');
assert.ok(customer.includes('EXEMPLO — NÃO COMPRÁVEL'),'exemplo visual precisa ser rotulado como não comprável');
assert.ok(customer.includes('disabled>Disponível quando houver parceiro real'),'exemplo jamais pode acionar checkout');
assert.ok(customer.includes('prelaunchExamplesEnabled'),'cliente deve remover exemplos quando o backend indicar supply real');
assert.ok(customer.includes('ready&&!market')&&customer.includes('Não foi possível confirmar o panorama geral agora'),'falha de market-status não pode ser apresentada como ausência de parceiros');
assert.ok(core.includes('merchants:testDemo')&&core.includes("freshMerchant('JR-PILOT','Gas e Lenheira do JR — SIMULAÇÃO',115.90"),'revendas sintéticas devem existir somente no runtime de teste e o piloto interno deve usar o cenário JR');
assert.ok(core.includes("eligible[0].roles=['Disponível agora']"),'piloto interno com fornecedor único não pode criar concorrência fictícia');
assert.ok(core.includes('Never hydrate those fields from browser storage'),'produção não pode restaurar autoridade financeira/merchant de storage');
assert.ok(merchant.includes('A operação da revenda não possui modo fictício em produção.'),'rota merchant sem portal real deve falhar fechado');
assert.ok(!growth.includes('Lista de interesse Plus registrada — demonstração'),'produção não pode fingir registro de benefício futuro');
assert.ok(backend.includes("chamaTurnstile.challenge"),'nova identidade anônima deve exigir desafio Turnstile');
assert.ok(backend.includes("options:{captchaToken}"),'token Turnstile deve ser entregue ao Auth do Supabase');
const turnstile=read('js/turnstile.js');
assert.ok(turnstile.includes('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'),'Turnstile deve carregar a API oficial em modo explícito');
assert.ok(turnstile.includes('action:safeAction'),'helper Turnstile deve validar e encaminhar action específica');
assert.ok(turnstile.includes('CHAMA_TURNSTILE_SITE_KEY'),'helper deve depender da site key pública de runtime');

assert.ok(backend.includes("get-offers")&&backend.includes("create-order")&&backend.includes("get-order"),'runtime live precisa usar Edge Functions seguras');
assert.ok(backend.includes('CHAMA_NETWORK_TIMEOUT_MS=15000')&&backend.includes("timeoutError.code='NETWORK_TIMEOUT'"),'requisições do frontend precisam de deadline explícito');
assert.ok(backend.includes('global:{fetch:chamaFetch}')&&admin.includes('global:{fetch:globalThis.chamaFetch}'),'Supabase Auth/SDK também precisa respeitar o fetch com timeout');
assert.ok(backend.includes('supabaseLoadPromise=null')&&backend.includes("Tempo limite ao carregar Supabase JS"),'loader do SDK precisa poder se recuperar de falha e timeout');
assert.ok(turnstile.includes('scriptPromise=null')&&turnstile.includes("Tempo limite ao carregar a verificação anti-bot"),'loader Turnstile não pode ficar permanentemente rejeitado após falha');
assert.ok(backend.includes("const pathname=local?")&&backend.includes(":'/'"),'navegação cross-origin deve começar na raiz da origem dedicada, sem herdar path do site atual');
assert.ok(backend.includes("const idempotencyKey=liveIdempotency('create-order')"),'criação de pedido precisa fixar a chave idempotente antes da primeira tentativa');
assert.ok(backend.includes("liveInvoke('create-order',payload,{idempotencyKey})"),'retry de create-order precisa reutilizar a mesma chave idempotente');
assert.ok(backend.includes("toast('Pedido recuperado com segurança após uma falha de conexão.')"),'frontend precisa recuperar pedido após ACK perdido');
assert.ok(backend.includes("Number.isFinite(Number(error?.status))&&Number(error.status)>=500"),'retry idempotente deve cobrir também erro transitório 5xx');
assert.ok(!backend.includes('}else if(liveRuntime.order&&["SETTLED","CANCELLED"].includes(liveRuntime.order.status)){'),'sincronização financeira não pode apagar o último pedido terminal necessário para reload/suporte');
assert.ok(backend.includes("SUPABASE_BROWSER_URL='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js'"),'browser deve fixar arquivo exato do supabase-js');
assert.ok(backend.includes("SUPABASE_BROWSER_SRI='sha384-Rj26LVGvoeRVR6+mwQmFfcR3QOBEwT+ZmuCWpuiqeTzJpCs0ER4ITAWGb4Hiy3Ok'"),'browser deve fixar integridade SHA384 do SDK');
assert.ok(backend.includes('script.integrity=SUPABASE_BROWSER_SRI'),'loader dinâmico precisa aplicar SRI antes de anexar o script');
assert.ok(!backend.includes('@supabase/supabase-js@2\''),'browser não pode usar major flutuante do supabase-js');
assert.ok(backend.includes('offerRequestSeq')&&backend.includes('orderRequestSeq'),'runtime live precisa bloquear respostas assíncronas obsoletas');
assert.ok(backend.includes('liveRuntime.actionPending'),'polling precisa respeitar ação em andamento');
assert.ok(read('supabase/functions/get-offers/index.ts').includes('create_quote_snapshot'),'ofertas devem persistir snapshot por RPC atômica');
assert.ok(!read('supabase/functions/get-offers/index.ts').includes('.from("quotes")\n        .insert'),'Edge não deve montar quote em duas gravações separadas');
assert.ok(read('supabase/functions/get-offers/index.ts').includes('get-offers-hour'),'consulta de oferta precisa também de quota horária');

assert.ok(backend.includes("customer-summary"),'frontend live deve usar projeção financeira mínima');
assert.ok(backend.includes('lastFinancialSyncAttemptAt')&&backend.includes('now-liveRuntime.lastFinancialSyncAttemptAt<60000'),'resumo financeiro deve ter retry periódico limitado');
assert.ok(backend.includes('changed=(await liveSyncFinancialProfile())||changed'),'polling deve atualizar cashback/comissão mesmo sem pedido ativo');
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
assert.ok(growth.includes('Vincule um e-mail à sua conta')&&growth.includes('Conta habilitada para comissão.'),'UI deve explicar o gate de identidade para comissão disponível');
assert.ok(read('supabase/functions/customer-summary/index.ts').includes('cashEarningEligible'),'resumo financeiro precisa expor elegibilidade de comissão');
assert.ok(read('supabase/functions/customer-summary/index.ts').includes('ACTIVE_ORDER_STATUSES'),'customer-summary precisa recuperar pedido ativo server-side');
assert.ok(read('supabase/functions/customer-summary/index.ts').includes('activeOrderId'),'projeção mínima precisa devolver o pedido ativo para recuperação após ACK perdido');
assert.ok(backend.includes('summary?.activeOrderId')&&backend.includes('localStorage.setItem(CHAMA_BACKEND.orderStorageKey,liveRuntime.orderId)'),'cliente deve persistir pedido ativo recuperado pelo servidor');
assert.ok(read('supabase/functions/merchant-ops/index.ts').includes('Seu papel não pode manter a operação ativa.'),'heartbeat não pode ser mantido por papel não operacional');
assert.ok(backend.includes('merchantRuntime.heartbeatError')&&backend.includes('await merchantHeartbeat();\n    await merchantRefresh({silent:true});'),'polling da revenda deve confirmar presença antes de projetar o estado atualizado');
assert.ok(merchant.includes('heartbeatFresh')&&merchant.includes('SEM CONEXÃO'),'painel não pode exibir ONLINE quando heartbeat já ficou velho');
assert.ok(read('supabase/functions/merchant-orders/index.ts').includes('MERCHANT_ROLE_NOT_ENABLED'),'driver sem assignment não pode abrir painel operacional');
assert.ok(read('supabase/functions/merchant-orders/index.ts').includes('selectMerchantMembership'),'seleção default de revenda deve preferir membership operacional');
assert.ok(backend.includes("localStorage.removeItem('chama-merchant-selected-v1')"),'logout/fallback deve limpar seleção de revenda persistida');
assert.ok(backend.includes('recoverSelection=true')&&backend.includes('staleSelected&&recoverSelection'),'frontend deve recuperar seleção antiga pertencente a outra conta');
assert.ok(merchant.includes("MERCHANT_ROLE_NOT_ENABLED"),'UI deve distinguir papel ainda não habilitado de ausência de vínculo');
assert.ok(read('supabase/functions/merchant-ops/index.ts').includes('function glpKgForCode'),'merchant API deve reconhecer semanticamente GLP P1..P90');
assert.ok(read('supabase/functions/merchant-ops/index.ts').includes('return "Gás P"+kg'),'nome de cilindro GLP deve ser derivado do código validado');
assert.ok(core.includes("P20:{name:'Gás P20'")&&core.includes("P45:{name:'Gás P45'"),'cliente deve expor P20/P45 sem inventar oferta');
assert.ok(core.includes('function ensureProductDefinition'),'cliente precisa materializar dinamicamente SKUs GLP reais');
assert.ok(core.includes("products[code]={name:'Gás P'+kg,icon:'🔥'}"),'cliente deve derivar nome de GLP P1..P90 sem hardcode');
assert.ok(backend.includes('ensureProductDefinition?.(code)'),'market-status deve hidratar no cliente os GLPs configurados pelas revendas');
assert.ok(merchant.includes('merchantLiveAddGlp'),'painel real deve permitir adicionar cilindro GLP válido');
const sharedDomain=read('supabase/functions/_shared/domain.js');
assert.ok(sharedDomain.includes('isSupportedProductCode'),'domínio server-side precisa de autoridade explícita de SKU suportado');
assert.ok(sharedDomain.includes('kg>=1&&kg<=90'),'domínio server-side deve aceitar GLP P1..P90');
assert.ok(sharedDomain.includes("invariant(isSupportedProductCode(code),'INVALID_PRODUCT'"),'normalização de itens deve usar a autoridade GLP generalizada');
const generalizedProducts=read('supabase/migrations/20261001162000_generalized_product_code_contract.sql');
for(const table of ['catalog_items','quote_items','order_items','order_requote_items']){
  assert.ok(generalizedProducts.includes('alter table public.'+table),table+' precisa receber contrato generalizado de product_code');
}
assert.ok(generalizedProducts.includes("^P([1-9]|[1-8][0-9]|90)$"),'constraint deve aceitar exatamente GLP P1..P90');
assert.ok(merchant.includes('serverOnly'),'catálogo real deve renderizar SKUs vindos do servidor além do mapa local');
assert.ok(read('supabase/functions/admin-ops/index.ts').includes('cnpj_verified_at')&&read('supabase/functions/admin-ops/index.ts').includes('anp_verified_at'),'admin deve projetar relógios independentes de compliance');
assert.ok(read('supabase/functions/merchant-ops/index.ts').includes('CNPJ_REVERIFICATION_REQUIRED'),'merchant ops deve traduzir CNPJ vencido');
assert.ok(read('supabase/functions/merchant-ops/index.ts').includes('ANP_REVERIFICATION_REQUIRED'),'merchant ops deve traduzir ANP vencida');
assert.ok(admin.includes('Última verificação:'),'admin UI deve exibir idade das evidências');
assert.ok(read('supabase/functions/merchant-orders/index.ts').includes('merchant_cnpj_compliance_current'),'painel da revenda deve receber compliance CNPJ vigente');
assert.ok(read('supabase/functions/merchant-orders/index.ts').includes('merchant_anp_compliance_current'),'painel da revenda deve receber compliance ANP vigente');
assert.ok(merchant.includes('Compliance vigente.'),'painel deve mostrar compliance vigente');
assert.ok(merchant.includes('Revalidação necessária antes de operar.'),'painel deve explicar compliance vencido');
assert.ok(merchant.includes('canGoOnline'),'botão online deve considerar compliance e confirmação comercial');
assert.ok(merchant.includes("m.acceptsCitywide!==false"),'UI não pode permitir ONLINE quando a área atendida do piloto está desativada');
assert.ok(merchant.includes('atendimento em São Gabriel desativado'),'painel deve explicar por que a operação não pode voltar online');
assert.ok(read('supabase/functions/merchant-ops/index.ts').includes('DELIVERY_AREA_REQUIRED'),'backend deve bloquear ONLINE sem atendimento em São Gabriel no piloto');
assert.ok(read('supabase/functions/merchant-ops/index.ts').includes('if(!acceptsCitywide)logisticsPatch.online=false'),'desativar a área do piloto deve pausar novos pedidos atomicamente');



assert.ok(backend.includes('merchantOriginSafe'),'frontend da revenda precisa bloquear origem compartilhada');
assert.ok(backend.includes('CHAMA_MERCHANT_ORIGIN'),'origem dedicada da revenda precisa ser configurável');
assert.ok(backend.includes('function buildPortalHref'),'navegação entre portais precisa de autoridade explícita de origem');
assert.ok(backend.includes("buildPortalHref(globalThis.CHAMA_MERCHANT_ORIGIN,'merchant')"),'CTA de revenda precisa navegar para a origem dedicada configurada');
assert.ok(backend.includes("buildPortalHref(globalThis.CHAMA_CUSTOMER_ORIGIN,'customer')"),'retorno ao cliente precisa navegar para a origem dedicada configurada');
assert.ok(admin.includes("buildPortalHref?.(globalThis.CHAMA_ADMIN_ORIGIN,'admin')"),'entrada administrativa precisa navegar para a origem dedicada configurada');
assert.ok(!backend.includes("const url=new URL(location.href);\n  url.search='';\n  url.searchParams.set('merchant','1')"),'portal merchant não pode reutilizar cegamente a origem atual');
for(const fn of ['merchant-orders','merchant-action','merchant-ops','complete-delivery','submit-merchant-application']){
  const source=read('supabase/functions/'+fn+'/index.ts');
  assert.ok(source.includes('MERCHANT_ALLOWED_ORIGIN'),fn+' precisa exigir origem dedicada');
  assert.ok(!source.includes('const PROD_ORIGIN="https://carloskk07.github.io"'),fn+' não pode confiar no GitHub Pages compartilhado');
}
assert.ok(read('supabase/functions/submit-merchant-application/index.ts').includes('MERCHANT_ALLOWED_ORIGIN'),'cadastro de empresa deve aceitar a origem dedicada da revenda, não a origem do cliente');
assert.ok(!read('supabase/functions/submit-merchant-application/index.ts').includes('CUSTOMER_ALLOWED_ORIGIN'),'cadastro de empresa não pode ficar preso à origem do cliente');
assert.ok(read('supabase/functions/get-order/index.ts').includes('MERCHANT_ORIGIN_REQUIRED'),'leitura individual da revenda deve exigir origem dedicada');
assert.ok(read('supabase/functions/get-order/index.ts').includes('merchantOriginAllowed'),'get-order precisa distinguir origem cliente de origem merchant');
assert.ok(merchant.includes('Origem da revenda não isolada'),'UI deve explicar o bloqueio de origem da revenda');
assert.ok(backend.includes('customerOriginSafe'),'frontend cliente live precisa bloquear origem compartilhada');
assert.ok(backend.includes('CHAMA_CUSTOMER_ORIGIN'),'origem dedicada do cliente precisa ser configurável');
for(const fn of ['get-offers','create-order','customer-action','customer-summary','market-status']){
  const source=read('supabase/functions/'+fn+'/index.ts');
  assert.ok(source.includes('CUSTOMER_ALLOWED_ORIGIN'),fn+' precisa exigir origem dedicada do cliente');
  assert.ok(!source.includes('carloskk07.github.io'),fn+' não pode confiar na origem compartilhada do GitHub Pages');
}
assert.ok(read('supabase/functions/get-order/index.ts').includes('CUSTOMER_ORIGIN_REQUIRED'),'get-order precisa exigir origem dedicada para papel customer');
assert.ok(read('supabase/functions/get-order/index.ts').includes('CUSTOMER_ALLOWED_ORIGIN'),'get-order precisa separar origem customer de merchant');
assert.ok(core.includes('compras reais serão liberadas na abertura oficial desta experiência'),'pré-lançamento deve deixar claro que compras reais ainda não estão liberadas');
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
assert.ok(adminOpsSource.includes('pilot_partner_drafts'),'admin precisa projetar parceiros piloto ainda sem cadastro jurídico');
assert.ok(admin.includes('AGUARDANDO DADOS REAIS')&&admin.includes('Gate de ativação preservado.'),'admin deve distinguir interesse comercial de merchant verificado');
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
assert.ok(backend.includes('function retryAmbiguousOnce(operation)'),'runtime precisa centralizar retry de falhas de transporte ambíguas');
assert.ok(backend.includes("const idempotencyKey=liveIdempotency('customer-action')")&&backend.includes("()=>liveInvoke('customer-action'"),'ação do cliente precisa reutilizar a mesma chave idempotente no retry');
assert.ok(backend.includes("const idempotencyKey=liveIdempotency('merchant-action')")&&backend.includes("()=>merchantInvoke('merchant-action'"),'ação operacional da revenda precisa reutilizar a mesma chave idempotente no retry');
assert.ok(backend.includes("const idempotencyKey=liveIdempotency('complete-delivery')"),'conclusão de entrega precisa fixar a chave antes do retry');
assert.ok(admin.includes("const idempotencyKey=adminIdempotency('admin-'+action)")&&admin.includes('globalThis.retryAmbiguousOnce'),'mutações administrativas precisam reaproveitar a mesma chave no retry');
assert.ok(backend.includes("retryAmbiguousOnce(()=>merchantInvoke('submit-merchant-application'"),'cadastro de parceiro precisa sobreviver a timeout/ACK perdido');
assert.ok(backend.includes("retryAmbiguousOnce(\n      ()=>merchantInvoke('merchant-ops',{merchantId,action:'set-online'"),'toggle online deve repetir uma vez falha de transporte ambígua');
assert.ok(merchant.includes('result?.autoRescued'),'UI da revenda precisa distinguir aceite real de rescue automático');
assert.ok(merchant.includes('stock_changed_before_accept'),'UI deve explicar corrida de estoque sem falso aceite');

assert.ok(offerSource.includes('filter_delivery_compatible_merchants'),'matching live deve filtrar revendas por compatibilidade logística');
assert.ok(offerSource.includes('deliveryCompatibilityBlocked:true'),'matching deve distinguir bloqueio logístico de indisponibilidade comum');
assert.ok(offerSource.includes('merchant_offer_load'),'matching deve considerar carga operacional recente sem expor isso ao cliente');
assert.ok(offerSource.includes('marketMode:candidates.length===1?"single_supplier":"marketplace"'),'Edge deve declarar explicitamente fornecedor único vs marketplace');
assert.ok(offerSource.includes('distributionPolicy:candidates.length===1?"single_supplier":"quality_first_balanced"'),'resposta deve declarar política de distribuição aplicada');
const offerRanking=read('supabase/functions/_shared/offer-ranking.js');
assert.ok(offerRanking.includes("label:'available'"),'ranking com um fornecedor deve gerar somente opção disponível');
assert.ok(offerRanking.includes('bestBase+0.10'),'balanceamento só pode operar dentro de faixa de qualidade próxima');
assert.ok(offerRanking.includes('priceMeaningfulDelta')&&offerRanking.includes('etaMeaningfulDelta'),'ranking não pode transformar diferença mínima entre dois parceiros em extremos artificiais');
assert.ok(read('supabase/functions/merchant-action/index.ts').includes('DELIVERY_INCOMPATIBLE'),'revenda deve receber conflito logístico sem erro genérico');
assert.ok(read('supabase/functions/customer-action/index.ts').includes('DELIVERY_INCOMPATIBLE'),'cliente deve receber conflito logístico sem erro genérico');
assert.ok(read('supabase/functions/customer-action/index.ts').includes('cancel-before-dispatch'),'Edge cliente precisa expor cancelamento antes da saída');
assert.ok(read('supabase/functions/customer-action/index.ts').includes('TOO_LATE_TO_CANCEL'),'Edge cliente precisa traduzir corrida perdida para o despacho');
assert.ok(read('supabase/functions/customer-action/index.ts').includes('STOCK_RESTORE_FAILED'),'Edge cliente precisa falhar fechado se a recomposição do estoque falhar');
assert.ok(customer.includes('Cancelar antes da saída'),'acompanhamento precisa oferecer cancelamento apenas antes do despacho');
assert.ok(customer.includes('cancelBeforeDispatch'),'UI precisa usar ação específica de cancelamento pré-saída');
assert.ok(backend.includes('deliveryCompatibilityBlocked'),'runtime cliente precisa transportar o motivo de bloqueio');
assert.ok(customer.includes('combinação de itens'),'UI cliente deve explicar alternativa de entrega separada em linguagem humana');
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


const adminFinanceSource=read('supabase/functions/admin-ops/index.ts');
const adminFinancialStart=adminFinanceSource.indexOf('}else if(action==="financial-action"){');
const adminFinancialEnd=adminFinanceSource.indexOf('}else{',adminFinancialStart+1);
assert.ok(adminFinancialStart>=0&&adminFinancialEnd>adminFinancialStart,'bloco financial-action precisa existir');
const adminFinancialBlock=adminFinanceSource.slice(adminFinancialStart,adminFinancialEnd);
assert.ok(adminFinancialBlock.includes('referência de conciliação'),'ação financeira admin deve exigir referência de conciliação no boundary HTTP');
assert.ok(adminFinanceSource.includes('FINANCIAL_REFERENCE_REQUIRED'),'admin-ops deve mapear falta de referência sem erro 500');
assert.ok(!adminFinancialBlock.includes('reference:body.reference==null?null'),'financial-action não pode aceitar baixa sem evidência');

console.log('Admin financial reconciliation boundary passou.');


const forbiddenWalletTypes=['manual_adjustment','commission_withdrawal'];
for(const forbidden of forbiddenWalletTypes){
  for(const file of fs.readdirSync(path.join(root,'supabase/functions'),{withFileTypes:true})){
    if(!file.isDirectory()||file.name==='_shared')continue;
    const p=path.join(root,'supabase/functions',file.name,'index.ts');
    if(fs.existsSync(p)){
      assert.ok(!fs.readFileSync(p,'utf8').includes(forbidden),file.name+' não pode usar '+forbidden+' sem autoridade dedicada');
    }
  }
}

console.log('Wallet runtime surface audit passou.');


const customerSummarySource=read('supabase/functions/customer-summary/index.ts');
assert.ok(customerSummarySource.includes('cashbackDebtCents'),'Edge summary deve expor dívida agregada de cashback');
assert.ok(backend.includes('state.user.cashbackDebt='),'frontend deve persistir compensação separada do saldo gastável');
assert.ok(growth.includes('em compensação.'),'Clube deve explicar cashback revertido em compensação');
assert.ok(growth.includes('Novos créditos reduzem essa compensação'),'UI deve explicar amortização futura sem esconder o passivo');

console.log('Cashback compensation projection audit passou.');

const sequenceHardening=read('supabase/migrations/20261002200242_server_only_sequence_and_pilot_fk_hardening.sql').toLowerCase();
assert.ok(sequenceHardening.includes('revoke all on all sequences in schema public from anon, authenticated'),'sequências existentes devem ser fechadas para browser');
assert.ok(sequenceHardening.includes('pilot_partner_drafts_merchant_idx'),'FK do staging para merchant precisa de índice de cobertura');
assert.ok(schema.includes('revoke all on all sequences in schema public from anon, authenticated'),'baseline deve fechar sequências legadas além dos defaults futuros');

const pilotMigration=read('supabase/migrations/20261002183357_first_real_merchant_pilot.sql');
assert.ok(pilotMigration.includes('create table if not exists public.pilot_partner_drafts'),'piloto precisa de staging server-only antes do cadastro real');
assert.ok(pilotMigration.includes("'Gas e Lenheira do JR','P13',11590"),'rascunho do primeiro parceiro precisa registrar somente os dados comerciais informados');
assert.ok(pilotMigration.includes("'proposed','awaiting_legal_data'"),'preço informado não pode nascer como confirmado nem como operação ativa');
assert.ok(!pilotMigration.includes('insert into public.merchants('),'migration de staging não pode fabricar merchant/CNPJ');
assert.ok(pilotMigration.includes('revoke all on table public.pilot_partner_drafts from public, anon, authenticated'),'rascunho comercial não pode ficar acessível no browser');
assert.ok(pilotMigration.includes('revoke all on function public.merchant_offer_load(uuid[]) from public, anon, authenticated'),'sinal de distribuição deve permanecer server-only');
const merchantApplicationSource=read('supabase/functions/submit-merchant-application/index.ts');
assert.ok(merchantApplicationSource.includes('existing?.status==="approved"'),'cadastro aprovado não pode ser reaberto silenciosamente');
assert.ok(merchantApplicationSource.includes('resubmitted:existing.status==="rejected"'),'cadastro rejeitado deve poder ser corrigido e reenviado');
assert.ok(merchantApplicationSource.includes('retryExisting?.status==="pending"'),'retry após ACK perdido deve recuperar cadastro pendente do mesmo solicitante');
assert.ok(merchant.includes('Cadastro recebido.')&&merchant.includes('Cadastrar / atualizar empresa'),'feedback de onboarding deve persistir após o toast');

console.log('First merchant pilot safety audit passou.');


const defaultPrivilegeLock=read('supabase/migrations/20261002173404_lock_default_data_api_privileges.sql').toLowerCase();
const maintainLock=read('supabase/migrations/20261002173435_revoke_default_maintain_privilege.sql').toLowerCase();
assert.ok(defaultPrivilegeLock.includes('alter default privileges for role postgres in schema public'),'migration precisa governar privilégios padrão do owner real');
assert.ok(defaultPrivilegeLock.includes('revoke execute on functions from public, anon, authenticated'),'funções futuras devem nascer server-only');
assert.ok(defaultPrivilegeLock.includes('to service_role'),'service_role precisa manter autoridade explícita');
assert.ok(maintainLock.includes('revoke maintain on tables from anon, authenticated'),'PostgreSQL 17 MAINTAIN precisa ser removido dos defaults do browser');
console.log('Default Data API privilege audit passou.');
