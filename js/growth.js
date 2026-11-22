const DEFAULT_REFERRAL_PILOT_RATE=0.02;
const DEFAULT_MERCHANT_PILOT_FEE_RATE=0.075;
// Tabela comercial de revendas, validada em merchant_billing_plans (21/11/2026).
// reward_policy (7,5%) NAO representa a taxa do Flex Diario (9%).
const MERCHANT_PUBLIC_BILLING_PLANS=Object.freeze([
Object.freeze({key:'flex_daily',name:'Flex Diário',bps:900,cents:0}),
Object.freeze({key:'credit_01990',name:'Essencial',bps:800,cents:1990}),
Object.freeze({key:'credit_04990',name:'Popular',bps:750,cents:4990}),
Object.freeze({key:'credit_09990',name:'Profissional',bps:700,cents:9990}),
Object.freeze({key:'credit_19990',name:'Alto Volume',bps:650,cents:19990})
]);

function currentCommercialRate(field,fallback){
const policy=globalThis.liveRuntime?.marketStatus?.commercialPolicy;
const raw=policy&&typeof policy==='object'?Number(policy[field]):NaN;
if(Number.isFinite(raw)&&raw>=0&&raw<=5000)return raw/10000;
return fallback;
}
function referralPilotRate(){
return currentCommercialRate('directReferralBps',DEFAULT_REFERRAL_PILOT_RATE);
}
function merchantPilotFeeRate(){
return currentCommercialRate('platformFeeBps',DEFAULT_MERCHANT_PILOT_FEE_RATE);
}
function policyPercent(rate){
const pct=Math.round(Math.max(0,Number(rate)||0)*10000)/100;
return pct.toLocaleString('pt-BR',{maximumFractionDigits:2})+'%';
}


// V1.365: accessible, local jumps keep visitors on their chosen public page.
// Whitelist prevents arbitrary DOM selectors or external navigation.
function publicLandingJump(sectionId){
if(!['merchant-benefits','merchant-terms','merchant-plans','merchant-margin','merchant-how','merchant-faq','buyer-guide-steps','buyer-guide-questions'].includes(sectionId))return false;
const section=document.getElementById(sectionId);
if(!section)return false;
section.scrollIntoView({block:'start',behavior:globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches?'auto':'smooth'});
section.focus({preventScroll:true});
return true;
}

// Paid coupons share the customer's authenticated Supabase session.
// Club purchase buttons live in deferred catalog; wallet is read-only.
const clubePaidCouponView={
userId:null,status:'idle',purchases:[],vouchers:[],error:null,
checkoutEnabled:false
};
const clubePaidCheckoutSelection={userId:null,voucherId:null};
function clubePaidCouponOptions(){
const userId=String(globalThis.liveRuntime?.session?.user?.id||'');
if(!userId||clubePaidCouponView.userId!==userId||
clubePaidCouponView.status!=='ready'||
clubePaidCouponView.checkoutEnabled!==true)return [];
const now=Date.now();
return clubePaidCouponView.vouchers.filter(v=>
v.status==='issued'&&
/^[0-9a-f-]{36}$/i.test(String(v.voucherId||''))&&
Number.isSafeInteger(Number(v.faceCents))&&v.faceCents>0&&
Number.isFinite(Date.parse(v.expiresAt))&&
Date.parse(v.expiresAt)>now
);
}
function clubePaidCouponSelectedIntent(){
const userId=String(globalThis.liveRuntime?.session?.user?.id||'');
return userId&&clubePaidCheckoutSelection.userId===userId?
clubePaidCheckoutSelection.voucherId:null;
}
function clubePaidCouponVoucherForQuote(quoteTotalCents){
const userId=String(globalThis.liveRuntime?.session?.user?.id||'');
if(clubePaidCheckoutSelection.userId!==userId||!userId||
state.checkout.useCashback!==true)return null;
const balanceCents=Math.round(Math.max(0,Number(state.user?.cashback||0))*100);
const voucher=clubePaidCouponOptions().find(v=>
v.voucherId===clubePaidCheckoutSelection.voucherId);
const min=Number(voucher?.minOrderCents??0);
if(!voucher||!Number.isSafeInteger(quoteTotalCents)||!Number.isSafeInteger(min)||min<0||
quoteTotalCents<Math.max(balanceCents+voucher.faceCents,min))return null;
return voucher;
}
function clubePaidCouponCheckoutPanel(){
if(!globalThis.liveReady?.()||!globalThis.liveRuntime?.session?.user?.id)return '';
const userId=String(globalThis.liveRuntime.session.user.id);
globalThis.ca?.(userId);
const valid=clubePaidCouponView.userId===userId;
const options=clubePaidCouponOptions();
const current=clubePaidCheckoutSelection.userId===userId?
clubePaidCheckoutSelection.voucherId:null;
const select=options.length?
'<label for="tamao-paid-coupon">Cupom pré-pago</label>'+
'<select id="tamao-paid-coupon" onchange="clubeChoosePaidCheckoutVoucher(this.value)">'+
'<option value="">Sem cupom de compra</option>'+
options.map(v=>'<option value="'+esc(v.voucherId)+'" '+
(current===v.voucherId?'selected':'')+'>'+
esc(BRL.format(v.faceCents/100))+' • válido até '+
esc(new Date(v.expiresAt).toLocaleDateString('pt-BR'))+
(Number(v.minOrderCents)>0?' • mín. '+esc(BRL.format(v.minOrderCents/100)):'')+
'</option>').join('')+
'</select><small>Confirmado no pedido.</small>':'';
return '<div class="tamao-checkout-voucher-picker">'+
'<strong>Cupons da sua conta</strong>'+

(select||'<p class="muted">'+(valid&&clubePaidCouponView.status==='loading'?
'Consultando cupons…':'Sem cupons pré-pagos disponíveis para aplicar.')+'</p>')+
'<button type="button" class="secondary" onclick="clubePaidCouponsRefresh()" '+
(valid&&clubePaidCouponView.status==='loading'?'disabled':'')+
'>Atualizar meus cupons</button></div>';
}
function clubeChoosePaidCheckoutVoucher(id){
const userId=String(globalThis.liveRuntime?.session?.user?.id||'');
if(!userId)return;
if(id&&!clubePaidCouponOptions().some(v=>v.voucherId===id)){
toast('Este cupom não está disponível. Atualize sua carteira.');
return;
}
clubePaidCheckoutSelection.userId=userId;
clubePaidCheckoutSelection.voucherId=id||null;
if(id){state.checkout.useCashback=true;save();}
render();
}
function clubeClearPaidCheckoutVoucher(){
clubePaidCheckoutSelection.userId=null;
clubePaidCheckoutSelection.voucherId=null;
}

function clubePaidCouponPanel(){
const userId=String(globalThis.liveRuntime?.session?.user?.id||'');
if(!userId||typeof liveReady!=='function'||!liveReady())
return '<section class="section"><h2>Seus cupons TAMÃO</h2>'+
'<p>Entre para ver seus cupons.</p></section>';
globalThis.ca?.(userId);
const valid=clubePaidCouponView.userId===userId;
const status=valid?clubePaidCouponView.status:'idle';
const money=value=>BRL.format(Math.max(0,Number(value)||0)/100);
const expire=value=>{
const d=new Date(String(value||''));
return Number.isFinite(d.getTime())?d.toLocaleDateString('pt-BR'):'—';
};
const labels={
issued:'Emitido',reserved:'Reservado',redeemed:'Utilizado',
void:'Cancelado',review_required:'Em revisão financeira'
};
const cards=valid&&status==='ready'
?clubePaidCouponView.vouchers.slice(0,30).map(item=>
'<article class="card flat">'+
'<strong>'+esc(money(item.faceCents))+'</strong>'+
'<p> Cupom '+esc(String(item.ordinal))+' · '+esc(labels[item.status]||'Em análise')+'</p>'+
'<small>Validade: '+esc(expire(item.expiresAt))+'</small>'+
(Number(item.minOrderCents)>0?'<small> · Mín.: '+esc(money(item.minOrderCents))+'</small>':'')+
'</article>').join('')
:'';
const invoices=globalThis.clubeCouponPurchasesPanel?.()||'';
const empty=valid&&status==='ready'&&!clubePaidCouponView.vouchers.length
?'<p class="muted">Você ainda não possui cupons confirmados.</p>':'';
const issue=valid&&status==='failed'
?'<p role="alert" class="notice danger">Não conseguimos consultar seus cupons agora. Tente novamente.</p>':'';
return '<section class="section" aria-label="Meus cupons TAMÃO">'+
'<div class="section-head"><div><span class="section-kicker">SEUS BENEFÍCIOS</span>'+
'<h2>Meus cupons TAMÃO</h2>'+
'<p>Confira valor e validade de cada cupom.</p></div>'+
'<button class="secondary" type="button" onclick="clubePaidCouponsRefresh()" '+
(status==='loading'?'disabled':'')+'>'+
(status==='loading'?'Consultando…':'Consultar meus cupons')+'</button></div>'+
issue+empty+(cards?'<div class="grid cards-3">'+cards+'</div>':'')+
(invoices?'<h3>Histórico de pacotes</h3><div class="grid cards-2">'+invoices+'</div>':'')+
'</section>';
}
async function clubePaidCouponsRefresh(){
const userId=String(globalThis.liveRuntime?.session?.user?.id||'');
if(!userId||typeof liveReady!=='function'||!liveReady())
return toast('Entre na sua conta para consultar os cupons.');
if(clubePaidCouponView.userId===userId&&clubePaidCouponView.status==='loading')return;
Object.assign(clubePaidCouponView,{userId,status:'loading',error:null,
checkoutEnabled:false,purchases:[],vouchers:[]});
if(route()==='club')render();
try{
const result=await liveInvoke('coupon-credit-pix',{action:'my-vouchers'});
if(result?.source!=='clube_coupon_paid_my_vouchers_v1'||result.ok!==true||
!Array.isArray(result.vouchers)||!Array.isArray(result.purchases))
throw Error('COUPON_DATA_UNVERIFIED');
if(String(globalThis.liveRuntime?.session?.user?.id||'')!==userId)return;
Object.assign(clubePaidCouponView,{
status:'ready',vouchers:result.vouchers,purchases:result.purchases,
checkoutEnabled:result.couponCheckoutEnabled===true
});
}catch(err){
if(String(globalThis.liveRuntime?.session?.user?.id||'')!==userId)return;
clubePaidCouponView.status='failed';
clubePaidCouponView.error=String(err?.message||err);
}finally{if(route()==='club'||route()==='order')render();}
}

function club(){
const u=globalThis.liveRuntime?.session?.user;
const member=globalThis.__CHAMA_TEST__||(globalThis.liveReady?.()&&u?.id&&u.email_confirmed_at&&u.is_anonymous!==true);
if(globalThis.document&&!globalThis.cshop){
globalThis.cshop=1;import('/js/clube-coupon-shop.js').then(render,()=>globalThis.cshop=0);
}
globalThis.clubeCouponWatchAuth?.();
// V1.969: the verified package is the destination, not a third generic
// benefit pitch. Hidden until the public catalog confirms real prices.
if(!member)return shell(`<section class="page tamao-club-visitor">
<div class="tamao-club-visitor-focus">
<div class="tamao-club-visitor-hero">
<span class="eyebrow">CLUBE TAMÃO</span>
<h1>Suas compras podem render muito mais no Clube TAMÃO.</h1>
<p>Cupons, cashback e suas vantagens em um só lugar. Entre no Clube e conheça o que pode aproveitar.</p>
<form class="form-stack tamao-club-access" data-tamao-account-context="club" onsubmit="return tamaoWelcomeRegister(event)">
<label for="clube-visitor-coupon-name">Nome e sobrenome (para criar conta)</label>
<input id="clube-visitor-coupon-name" name="full_name" class="input" type="text" autocomplete="name" placeholder="Nome e sobrenome" maxlength="100">
<label for="clube-visitor-coupon-phone">Telefone com DDD (para criar conta)</label>
<input id="clube-visitor-coupon-phone" name="phone" class="input" type="tel" inputmode="tel" autocomplete="tel" placeholder="(55) 99999-9999" maxlength="18">
<label for="clube-visitor-coupon-email">Seu e-mail</label>
<input id="clube-visitor-coupon-email" name="email" class="input" type="email" autocomplete="email" placeholder="voce@email.com" maxlength="160" required>
<button type="submit" class="primary" name="intent" value="login">Entrar no meu Clube →</button>
<button type="submit" class="secondary tamao-club-register" name="intent" value="register">Primeiro acesso? Criar minha conta</button>
<p data-welcome-signup-status role="status"></p>
<small>Confira sua caixa de entrada para confirmar o acesso.</small>
</form>
</div>
<aside class="tamao-coupon-price-board card form-stack" hidden aria-label="Pacote de cupons com preço confirmado">
<span class="section-kicker">PACOTE DE CUPONS</span>
<h2>Pacote disponível</h2>
<p class="tamao-club-face" data-coupon-face></p>
<p class="tamao-club-offer-label">Preço do pacote: <strong data-coupon-price></strong></p>
<p data-coupon-minimum></p>
<p data-coupon-availability></p>
<details class="tamao-benefits-details"><summary>Detalhes de uso do pacote</summary><p class="tiny">Ter um pacote não garante ofertas ou revendas disponíveis no seu CEP. Veja validade e condições ao usar. Entrar não gera cobrança.</p></details>
</aside>
</div>
<div class="grid cards-3 tamao-club-visitor-grid" aria-label="Vantagens do Clube">
<article class="card"><span class="feature-icon" aria-hidden="true">🎟️</span><h2>Descontos para aproveitar</h2><p>Descubra os cupons disponíveis e acompanhe os que você já conquistou.</p></article>
<article class="card"><span class="feature-icon" aria-hidden="true">💚</span><h2>Cashback para voltar</h2><p>Acompanhe o crédito das compras participantes e use o saldo disponível em novas compras.</p></article>
<article class="card"><span class="feature-icon" aria-hidden="true">🔎</span><h2>Mais controle da sua economia</h2><p>Compare o preço total por CEP e veja seus benefícios registrados na conta.</p></article>
</div>
</section>`);
const purchases=Math.max(0,Number(state.user.purchases)||0);
const cycle=purchases===0?0:(purchases%5||5);
const pct=cycle*20;
const next=purchases>0&&cycle===5?'Ciclo completo — a próxima compra inicia um novo ciclo':`${cycle} de 5 compras no ciclo atual`;
const debt=Math.max(0,Number(state.user.cashbackDebt)||0);
const comparisonSavings=Math.max(0,Number(globalThis.liveRuntime?.comparisonSavingsCents||0))/100;
const cashbackEarned=Math.max(0,Number(globalThis.liveRuntime?.cashbackEarnedCents||0))/100;
return shell(`<section class="page">
<span class="eyebrow">CLUBE TAMÃO</span>
<h1 class="page-title">Compre com mais vantagens. Acompanhe sua economia e seu cashback.</h1>
<p class="muted page-lead">Compare ofertas pelo preço total para seu CEP, veja a economia registrada nas compras concluídas e consulte seus créditos de cashback. Tudo em um só lugar.</p>
<div class="reward-hero"><div class="tiny" style="opacity:.75">SEU CASHBACK DISPONÍVEL</div><div class="balance">${BRL.format(state.user.cashback)}</div><div class="tiny">crédito para usar em novas compras</div><div class="progress"><div style="width:${pct}%"></div></div><strong>${esc(next)}</strong></div>
<div class="earn-summary" style="margin-top:14px">
<div class="earn-balance-card"><span>Economia nas comparações</span><strong>${BRL.format(comparisonSavings)}</strong><small>diferença acumulada contra a opção mais cara realmente exibida nas consultas que viraram pedidos concluídos</small></div>
<div class="earn-balance-card"><span>Cashback já gerado</span><strong>${BRL.format(cashbackEarned)}</strong><small>créditos válidos historicamente, mesmo que parte já tenha sido usada</small></div>
</div>
${debt>0?`<div class="notice" style="margin-top:14px"><strong>${BRL.format(debt)} em compensação.</strong><br>Esse valor corresponde a cashback de uma compra posteriormente revertida. Novos créditos reduzem essa compensação antes de ficarem disponíveis.</div>`:''}
${clubePaidCouponPanel()}
<button class="ghost small" onclick="go('refer')">Meu extrato de vantagens →</button>
${typeof clubeCouponShopPanel==='function'?clubeCouponShopPanel():''}
<section class="tamao-club-shop-now" aria-label="Usar as vantagens do Clube">
<div><span class="section-kicker">SEU CLUBE NA PRÁTICA</span>
<h2>Compare, faça seu pedido e acompanhe o que você economizou.</h2>
<p>Consulte as revendas que atendem seu endereço, escolha pelo preço total e aproveite seu saldo de cashback quando for elegível.</p>
</div>
<button type="button" class="primary" onclick="go('home')">Encontrar produtos para comprar <span aria-hidden="true">→</span></button>
</section>
<section class="section"><div class="grid cards-3">
<div class="card"><div class="feature-icon">💵</div><h3>Cashback que volta para você</h3><p class="muted tiny">Nas compras elegíveis, parte do valor pode voltar como crédito para sua próxima compra. Tudo fica registrado em sua conta.</p></div>
<div class="card"><div class="feature-icon">⭐</div><h3>Seus pedidos, suas vantagens</h3><p class="muted tiny">Tenha seu histórico à mão e saiba quando vale a pena repetir aquela compra do dia a dia.</p></div>
<div class="card"><div class="feature-icon">🤝</div><h3>Sua rede também cresce</h3><p class="muted tiny">Convide amigos com seu link pessoal, apresente revendas da região e acompanhe as indicações qualificadas.</p><button class="ghost small" onclick="go('earn')">Ver como ganhar →</button></div>
</div></section>
</section>`)
}

// V1.1040 — one first-touch invite code, distinct allowlisted destinations.
// This is discovery/attribution, NOT authorization to accrue cross-module rewards.
const TAMAO_NETWORK_INVITE_TARGETS=Object.freeze({
customer:Object.freeze({route:'home',label:'Clientes e produtos',message:'Consulte gás, água e essenciais no TAMÃO'}),
merchant:Object.freeze({route:'merchants',label:'Revendas',message:'Conheça o TAMÃO para revendas'}),
mobility:Object.freeze({route:'mobility',label:'Moto e carro',message:'Conheça os serviços de moto e carro no TAMÃO'}),
professional:Object.freeze({route:'advertise',label:'Profissionais',message:'Cadastre seu serviço ou conheça os profissionais no TAMÃO'}),
rides:Object.freeze({route:'rides',label:'Caronas',message:'Consulte caronas anunciadas no TAMÃO'}),
club:Object.freeze({route:'club',label:'Clube e cupons',message:'Conheça o Clube TAMÃO e seus benefícios'}),
sponsor:Object.freeze({route:'sponsors',label:'Anunciantes e marcas',message:'Divulgue sua marca no TAMÃO'})
});
// V1.1071: light URL/link contract remains in startup; the editor is deferred.
function tamaoNetworkPageVerifiedCode(portal='customer'){
 if(portal==='merchant'){
const runtime=globalThis.merchantRuntime||{},m=runtime.merchant||{},n=runtime.growthNetwork||{};
return n.merchantId===m.merchantId&&m.merchantId&&
n.source==='merchant_network_v1_226'&&n.rewardEnabled===false&&
/^TMR[A-F0-9]{24}$/.test(String(n.inviteCode||''))?n.inviteCode:'';
 }
 const code=String(state.user?.referralCode||'').trim().toUpperCase();
 return /^[A-Z0-9]{5,40}$/.test(code)?code:'';
}
function tamaoNetworkPageLink(code,options={}){
 const value=String(code||'').trim().toUpperCase();
 if(!/^[A-Z0-9]{5,40}$/.test(value))return '';
 const audience=Object.hasOwn(TAMAO_NETWORK_INVITE_TARGETS,options.audience)?
options.audience:'customer';
 const theme=['clean','gold','rose'].includes(options.theme)?
options.theme:'clean';
 const name=String(options.name||'').trim().slice(0,48);
 const message=String(options.message||'').trim().slice(0,140);
 const u=new URL('https://tamao.com.br/convite/');
 u.searchParams.set('ref',value);u.searchParams.set('a',audience);
 if(theme!=='clean')u.searchParams.set('t',theme);
 if(name&&/^[\p{L}\p{M}0-9 .&'\-]{1,48}$/u.test(name))u.searchParams.set('n',name);
 if(message&&!/[\u0000-\u001f<>]/.test(message))u.searchParams.set('m',message);
 return u.href;
}

let tamaoNetworkPageEditorLoading=false,tamaoNetworkPageEditorFailed=false;
function tamaoNetworkPageBuilderPanel(portal='customer'){
 if(typeof globalThis.tamaoNetworkPageBuilder==='function')return globalThis.tamaoNetworkPageBuilder(portal);
 if(tamaoNetworkPageEditorFailed)return '<p class="muted tiny">Não foi possível carregar a personalização. Seu link comum continua disponível.</p>';
 if(!tamaoNetworkPageEditorLoading&&typeof document!=='undefined'){
tamaoNetworkPageEditorLoading=true;
const reference=document.querySelector('script[src*="growth.js"]')?.src||location.origin+'/js/growth.js';
const v=new URL(reference);
const version=v.search;
const css=document.createElement('link');css.rel='stylesheet';
css.href=new URL('/css/network-pages.css'+version,location.origin).href;
document.head.appendChild(css);
const js=document.createElement('script');
js.src=new URL('/js/network-pages-editor.js'+version,location.origin).href;
js.onload=()=>{tamaoNetworkPageEditorLoading=false;render();};
js.onerror=()=>{tamaoNetworkPageEditorLoading=false;tamaoNetworkPageEditorFailed=true;render();};
document.head.appendChild(js);
 }
 return '<p class="muted tiny" aria-live="polite">Preparando sua página de divulgação…</p>';
}

// V1.1072 — real owner page loaded only in a participant workspace.
let tamaoParticipantNativeLoading=false,tamaoParticipantNativeFailed=false;
function tamaoParticipantNativePanel(kind,id=''){
 if(typeof globalThis.tamaoNativePagePanel==='function')
return globalThis.tamaoNativePagePanel(kind,id);
 if(tamaoParticipantNativeFailed)return '<p class="tiny muted">A página do participante está temporariamente indisponível.</p>';
 if(!tamaoParticipantNativeLoading&&typeof document!=='undefined'){
tamaoParticipantNativeLoading=true;
const source=document.querySelector('script[src*="/js/growth.js"]')?.src||'';
const version=source.match(/\?v=[A-Za-z0-9._-]+/)?.[0]||'';
const tag=document.createElement('script');
tag.src='/js/participant-native-owner.js'+version;
tag.onload=()=>{tamaoParticipantNativeLoading=false;render();};
tag.onerror=()=>{tamaoParticipantNativeLoading=false;tamaoParticipantNativeFailed=true;render();};
document.head.appendChild(tag);
 }
 return '<section class="card flat"><h2>Minha página TAMÃO</h2><p role="status">Preparando sua página com os dados do cadastro…</p></section>';
}

function tamaoGrowthInviteUrl(audience='customer'){
const target=Object.hasOwn(TAMAO_NETWORK_INVITE_TARGETS,audience)
?TAMAO_NETWORK_INVITE_TARGETS[audience]:TAMAO_NETWORK_INVITE_TARGETS.customer;
const code=String(state.user?.referralCode||'').trim().toUpperCase();
const activeCode=/^[A-Z0-9]{5,40}$/.test(code)?code:'';
return activeCode?tamaoNetworkPageLink(activeCode,{audience}):'https://tamao.com.br/#'+target.route;
}
async function shareTamaoGrowthInvite(audience='customer'){
const code=String(state.user?.referralCode||'').trim().toUpperCase();
if(!/^[A-Z0-9]{5,40}$/.test(code)){
toast('Entre na sua conta para obter um convite com indicação.');
return false;
}
const kind=Object.hasOwn(TAMAO_NETWORK_INVITE_TARGETS,audience)?audience:'customer';
const url=tamaoGrowthInviteUrl(kind);
const message=TAMAO_NETWORK_INVITE_TARGETS[kind].message+': '+url;
try{
if(navigator.share){await navigator.share({title:'Rede TAMÃO',text:message,url});return true;}
if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(message);toast('Convite copiado para compartilhar');return true;}
toast('Compartilhe o endereço: '+url);return true;
}catch(e){
if(e?.name!=='AbortError')toast('Não foi possível compartilhar; copie o endereço da página');
return false;
}
}
function tamaoShareSelectedNetworkInvite(){
const target=String(document.getElementById('tamao-network-invite-target')?.value||'customer');
return shareTamaoGrowthInvite(target);
}
function tamaoNetworkInvitePicker(){
const hasCode=/^[A-Z0-9]{5,40}$/.test(String(state.user?.referralCode||'').trim().toUpperCase());
const options=Object.entries(TAMAO_NETWORK_INVITE_TARGETS)
.map(([key,target])=>'<option value="'+key+'">'+target.label+'</option>').join('');
return '<section class="card flat tamao-universal-invite" aria-label="Convide para qualquer modalidade do TAMÃO">'+
'<h2>Um convite para cada oportunidade</h2>'+
'<p class="muted tiny">Seu código é o mesmo para todos os módulos. Escolha o destino de quem você quer convidar.</p>'+
'<div class="field-row" style="align-items:flex-end;gap:10px;flex-wrap:wrap">'+
'<div class="input-wrap" style="flex:1;min-width:190px">'+
'<label for="tamao-network-invite-target">Quem você quer convidar?</label>'+
'<select class="input" id="tamao-network-invite-target">'+options+'</select>'+
'</div>'+
'<button type="button" class="primary" onclick="tamaoShareSelectedNetworkInvite()"'+(!hasCode?' disabled':'')+'>Compartilhar convite</button>'+
'</div>'+
'<p class="muted tiny">O link registra a origem do convite, sujeito à verificação. Comissões não são pagas por simples cadastro ou clique; cada modalidade depende das condições financeiras aplicáveis. Hospedagens seguem suspensas.</p>'+
'</section>';
}
function referralUrl(){
if(!state.user.referralCode)return '';
const own=typeof globalThis.tamaoNativePagePublicLink==='function'?tamaoNativePagePublicLink('customer',''):'';
if(own)return own;
return typeof globalThis.tamaoNetworkPageCurrentLink==='function'
?tamaoNetworkPageCurrentLink('customer')
:tamaoNetworkPageLink(tamaoNetworkPageVerifiedCode('customer'),{audience:'customer'});
}
// A verified participation event requires an explicit visit to Rede,
 // a permanent account and the authenticated customer-summary Edge route.
 // No background heartbeat or marketing impression ever qualifies.
let tamaoNetworkLastVisitAt=0;
async function tamaoNetworkVisitFromUi(){
const now=Date.now();
if(!globalThis.liveReady?.()||now-tamaoNetworkLastVisitAt<10*60*1000)return;
if(!['refer','earn'].includes(String(route())))return;
const actor=globalThis.liveRuntime?.session?.user?.id;
if(!actor)return;
tamaoNetworkLastVisitAt=now;
try{
const data=await liveInvoke('customer-summary',{networkVisit:true});
if(!globalThis.liveReady?.()||globalThis.liveRuntime?.session?.user?.id!==actor)return;
const network=data?.networkPackage;
if(network?.source==='network_fee_package_user_v1_1030'&&
network.available===true&&network.readOnly===true&&
network.payoutsEnabled===false){
const before=JSON.stringify(globalThis.liveRuntime.networkPackage||null);
globalThis.liveRuntime.networkPackage=network;
if(before!==JSON.stringify(network)&&['refer','earn'].includes(String(route())))render();
}
const c=data?.networkCelebra;
if(c?.available&&c.items?.length){
globalThis.liveRuntime.networkCelebra=c;
import('/js/growth-celebra.js').then(render).catch(()=>{});
}
}catch(e){
console.warn('Registro de participação indisponível; nenhum saldo foi creditado',e);
}
}
// V1.1034 — Manual payout UI is deferred to protect startup budgets.
const tamaoManualPayoutScriptUrl=(()=>{
try{
const own=document.currentScript;
if(!own?.src)return null;
const path=new URL(own.src,document.baseURI);
if(path.origin!==location.origin||!path.pathname.endsWith('/js/growth.js'))return null;
const next=new URL('growth-manual-payout.js',path);
next.search=path.search;
return next.href;
}catch{return null}
})();
let tamaoManualPayoutLoadPromise=null;
async function tamaoManualPayoutLoad(){
if(!globalThis.liveReady?.()||!globalThis.liveRuntime?.session?.user?.id)return;
if(typeof globalThis.tamaoNetworkManualPayoutDetailsPanel!=='function'){
if(!tamaoManualPayoutLoadPromise){
tamaoManualPayoutLoadPromise=new Promise((resolve,reject)=>{
if(!tamaoManualPayoutScriptUrl){reject(Error('Módulo de saques indisponível.'));return;}
const tag=document.createElement('script');
tag.src=tamaoManualPayoutScriptUrl;tag.async=true;
tag.onload=()=>globalThis.tamaoNetworkManualPayoutDetailsPanel
?resolve(true):reject(Error('O módulo de saques não iniciou.'));
tag.onerror=()=>reject(Error('Não foi possível carregar o extrato de saques.'));
document.head.appendChild(tag);
}).finally(()=>{tamaoManualPayoutLoadPromise=null});
}
try{await tamaoManualPayoutLoadPromise}catch(e){
toast(String(e?.message||e));return;
}
}
await globalThis.tamaoManualPayoutRefresh?.();
}
function tamaoNetworkManualPayoutPanel(){
if(!globalThis.liveReady?.()||!globalThis.liveRuntime?.session?.user?.id)return '';
if(typeof globalThis.tamaoNetworkManualPayoutDetailsPanel==='function')
return globalThis.tamaoNetworkManualPayoutDetailsPanel();
return '<section class="card flat network-manual-payout">'+
'<h3>Saques da Rede TAMÃO</h3>'+
'<p class="tiny muted">Pagamento manual após atingir o limite e conferir os dados. Prazo de até 3 dias corridos após aprovação.</p>'+
'<button type="button" class="secondary small" onclick="tamaoManualPayoutLoad()">Consultar ou solicitar saque</button></section>';
}

function tamaoNetworkFeePackagePanel(){
const raw=globalThis.liveRuntime?.networkPackage;
const valid=raw?.source==='network_fee_package_user_v1_1030'&&
raw.readOnly===true&&raw.payoutsEnabled===false&&raw.available===true&&
['pendingCents','validatedCents','awardSources'].every(k=>
Number.isSafeInteger(Number(raw[k]))&&Number(raw[k])>=0);
if(!valid)return '<section class="card flat"><h3>Participação nos pacotes de taxas</h3>'+
'<p class="muted tiny">O extrato desta modalidade ainda não está disponível. Nenhum ganho foi presumido.</p></section>';
const pending=BRL.format(Number(raw.pendingCents)/100);
const validated=BRL.format(Number(raw.validatedCents)/100);
const sources=Number(raw.awardSources);
return '<section class="card flat network-fee-package-statement" aria-label="Participação no fundo dos pacotes de taxas">'+
'<span class="section-kicker">REDE TAMÃO • PACOTES DE TAXAS REDUZIDAS</span>'+
'<h3>Seu resultado na distribuição dos pacotes</h3>'+
'<p class="muted tiny">O fundo usa até 10% do valor líquido de pacotes elegíveis de revendas e moto/carro. '+
'A participação considera visitas verificadas nas 24 horas da janela de distribuição. '+
'Pacotes de cupons não entram.</p>'+
'<div class="merchant-kpis network-package-kpis"><div class="kpi"><span class="label">Em apuração</span><strong>'+pending+'</strong>'+
'<small>Depende da validação do crédito pré-pago</small></div>'+
'<div class="kpi"><span class="label">Validado</span><strong>'+validated+'</strong>'+
'<small>Disponibilidade conforme limite e conferência</small></div>'+
'<div class="kpi"><span class="label">Pacotes com participação</span><strong>'+sources+'</strong>'+
'<small>Somente fontes financeiras comprovadas</small></div></div>'+
(!raw.accrualEnabled?'<div class="notice">A distribuição financeira dos pacotes ainda aguarda ativação das condições do programa.</div>':'')+
'<p class="tiny muted">Valores abaixo de R$ 0,01 permanecem contabilizados em frações. '+
'Participar não garante ganhos diários; os pagamentos de saque são manuais.</p></section>'+tamaoNetworkManualPayoutPanel();
}

let referralQrLoader=null;
function ensureReferralQrLibrary(){
if(typeof globalThis.qrcode==='function')return Promise.resolve(true);
if(referralQrLoader)return referralQrLoader;
referralQrLoader=new Promise((resolve)=>{
const script=document.createElement('script');
script.src='https://cdn.jsdelivr.net/npm/qrcode-generator@2.0.4/dist/qrcode.js';
script.async=true;
script.crossOrigin='anonymous';
let done=false;
const finish=(ok)=>{
if(done)return;
done=true;
clearTimeout(timer);
if(!ok)referralQrLoader=null;
resolve(ok&&typeof globalThis.qrcode==='function');
};
const timer=setTimeout(()=>finish(false),8000);
script.onload=()=>finish(true);
script.onerror=()=>finish(false);
document.head.appendChild(script);
});
return referralQrLoader;
}
async function renderReferralQr(){
const target=document.getElementById('referral-qr');
const url=referralUrl();
if(!target||!url)return;
const ready=await ensureReferralQrLibrary();
if(!document.body.contains(target))return;
if(!ready){
target.innerHTML='<div class="tiny muted">QR indisponível agora. O link e o código continuam funcionando normalmente.</div>';
return;
}
try{
const qr=globalThis.qrcode(0,'M');
qr.addData(url);
qr.make();
target.innerHTML=qr.createSvgTag({cellSize:5,margin:2,scalable:true});
const svg=target.querySelector('svg');
if(svg){
svg.setAttribute('role','img');
svg.setAttribute('aria-label','QR Code do seu link pessoal do TAMÃO');
svg.style.maxWidth='220px';
svg.style.width='100%';
svg.style.height='auto';
}
}catch{
target.innerHTML='<div class="tiny muted">Não foi possível gerar o QR agora. Use o link pessoal exibido acima.</div>';
}
}
async function copyReferralCode(){
const code=String(state.user.referralCode||'');
if(!code)return toast('Código ainda indisponível');
try{
if(navigator.clipboard?.writeText){
await navigator.clipboard.writeText(code);
toast('Código copiado');
return;
}
}catch{}
toast('Copie o código exibido no cartão');
}

function referralExample(orderReais,count=1){
const amount=Math.max(0,Number(orderReais)||0);
const qty=Math.max(1,Math.trunc(Number(count)||1));
return roundMoney(amount*referralPilotRate()*qty);
}
function merchantEconomicsExample(orderReais,count=1){
const amount=Math.max(0,Number(orderReais)||0);
const qty=Math.max(1,Math.trunc(Number(count)||1));
const gross=roundMoney(amount*qty);
const verifiedPlans=globalThis.tamaoMerchantPublicPlans?.status==='ready'?globalThis.tamaoMerchantPublicPlans.plans:MERCHANT_PUBLIC_BILLING_PLANS;
const fee=roundMoney(gross*verifiedPlans[0].bps/10000);
return {gross,fee,merchantNet:roundMoney(gross-fee)};
}
function merchantMarginExample({salePrice,orders=1,productCost=0,deliveryCost=0,paymentCost=0,taxRate=0,feeRate=(globalThis.tamaoMerchantPublicPlans?.status==='ready'?globalThis.tamaoMerchantPublicPlans.plans:MERCHANT_PUBLIC_BILLING_PLANS)[0].bps/10000}={}){
const price=Math.max(0,Number(salePrice)||0);
const qty=Math.min(10000,Math.max(1,Math.trunc(Number(orders)||1)));
const unitProductCost=Math.max(0,Number(productCost)||0);
const unitDeliveryCost=Math.max(0,Number(deliveryCost)||0);
const unitPaymentCost=Math.max(0,Number(paymentCost)||0);
const taxPct=Math.min(100,Math.max(0,Number(taxRate)||0));
const gross=roundMoney(price*qty);
const safeRate=Number.isFinite(Number(feeRate))&&Number(feeRate)>=0&&Number(feeRate)<=0.5?Number(feeRate):MERCHANT_PUBLIC_BILLING_PLANS[0].bps/10000;
const chamaFee=roundMoney(gross*safeRate);
const productCosts=roundMoney(unitProductCost*qty);
const deliveryCosts=roundMoney(unitDeliveryCost*qty);
const paymentCosts=roundMoney(unitPaymentCost*qty);
const taxes=roundMoney(gross*(taxPct/100));
const knownCosts=roundMoney(productCosts+deliveryCosts+paymentCosts+taxes);
const contribution=roundMoney(gross-chamaFee-knownCosts);
const unitContribution=qty?roundMoney(contribution/qty):0;
const marginPct=gross>0?Math.round((contribution/gross)*1000)/10:0;
return {gross,chamaFee,productCosts,deliveryCosts,paymentCosts,taxes,knownCosts,contribution,unitContribution,marginPct};
}
function updateReferralSimulator(){
const clients=Math.min(500,Math.max(1,Math.trunc(Number(document.querySelector('#ref-sim-clients')?.value)||1)));
const ticket=Math.min(100000,Math.max(1,Number(document.querySelector('#ref-sim-ticket')?.value)||1));
const total=referralExample(ticket,clients);
const out=document.querySelector('#ref-sim-total');
if(out)out.textContent=BRL.format(total);
const detail=document.querySelector('#ref-sim-detail');
if(detail)detail.textContent=clients+' '+(clients===1?'compra elegível':'compras elegíveis')+' × '+BRL.format(ticket)+' × '+policyPercent(referralPilotRate());
}
function updateMerchantSimulator(){
const orders=Math.min(10000,Math.max(1,Math.trunc(Number(document.querySelector('#merchant-sim-orders')?.value)||1)));
const salePrice=Math.min(100000,Math.max(0.01,Number(document.querySelector('#merchant-sim-ticket')?.value)||0.01));
const productCostRaw=String(document.querySelector('#merchant-sim-product-cost')?.value??'').trim();
const parsedProductCost=Number(productCostRaw);
const hasProductCost=productCostRaw!==''&&Number.isFinite(parsedProductCost)&&parsedProductCost>=0;
const productCost=hasProductCost?Math.min(100000,parsedProductCost):0;
const deliveryCost=Math.min(100000,Math.max(0,Number(document.querySelector('#merchant-sim-delivery-cost')?.value)||0));
const paymentCost=Math.min(100000,Math.max(0,Number(document.querySelector('#merchant-sim-payment-cost')?.value)||0));
const taxRate=Math.min(100,Math.max(0,Number(document.querySelector('#merchant-sim-tax-rate')?.value)||0));
const activePlans=globalThis.tamaoMerchantPublicPlans?.status==='ready'?globalThis.tamaoMerchantPublicPlans.plans:MERCHANT_PUBLIC_BILLING_PLANS;
const selectedPlan=activePlans.find(p=>p.key===document.querySelector('#merchant-sim-plan')?.value)||activePlans[0];
const e=merchantMarginExample({salePrice,orders,productCost,deliveryCost,paymentCost,taxRate,feeRate:selectedPlan.bps/10000});
const selectedLabel=document.querySelector('#merchant-sim-plan-label');
if(selectedLabel)selectedLabel.textContent='Taxa TAMÃO ('+policyPercent(selectedPlan.bps/10000)+')';
const gross=document.querySelector('#merchant-sim-gross');
const fee=document.querySelector('#merchant-sim-fee');
const costs=document.querySelector('#merchant-sim-costs');
const contribution=document.querySelector('#merchant-sim-contribution');
const unit=document.querySelector('#merchant-sim-unit');
const margin=document.querySelector('#merchant-sim-margin');
if(gross)gross.textContent=BRL.format(e.gross);
if(fee)fee.textContent=BRL.format(e.chamaFee);
if(!hasProductCost){
if(costs)costs.textContent='Informe o custo do produto';
if(contribution)contribution.textContent='—';
if(unit)unit.textContent='—';
if(margin)margin.textContent='—';
return;
}
if(costs)costs.textContent=BRL.format(e.knownCosts);
if(contribution)contribution.textContent=BRL.format(e.contribution);
if(unit)unit.textContent=BRL.format(e.unitContribution);
if(margin)margin.textContent=(Number.isFinite(e.marginPct)?e.marginPct:0).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%';
}
// Server-verified milestones by vertical. These are counts, never paid coins.
function tamaoNetworkModuleBenefitsPanel(){
const p=globalThis.liveRuntime?.moduleBenefits;
const items=[
['products','Produtos'],['merchants','Revendas'],['mobility','Moto e carro'],
['professionals','Profissionais'],['rides','Caronas'],
['club','Clube'],['advertising','Publicidade']
];
if(p?.available!==true||p?.readOnly!==true||p?.cashPayoutsEnabled!==false)
return '<section class="card flat" aria-label="Benefícios da Rede"><h2>Conquistas da Rede</h2>'+
'<p class="muted">Entre na sua conta para consultar indicações verificadas por modalidade.</p></section>';
const modules=p.modules||{};
const cells=items.map(([key,label])=>{
const value=Number(modules[key]);
return '<div class="kpi"><span class="label">'+label+
'</span><strong>'+(Number.isSafeInteger(value)&&value>=0?value:0)+
'</strong></div>';
}).join('');
const confirmed=Number.isSafeInteger(p.verifiedConversions)?p.verifiedConversions:0;
const invited=Number.isSafeInteger(p.invitedAccounts)?p.invitedAccounts:0;
const ads=Number.isSafeInteger(p.adsBonusValidatedCents)?p.adsBonusValidatedCents:0;
return '<section class="card flat" aria-label="Benefícios comprovados por modalidade">'+
'<div class="section-head"><div><span class="section-kicker">REDE COMPLETA</span>'+
'<h2>Conquistas dos seus indicados</h2>'+
'<p>Um mesmo convite pode conectar pessoas a todos os serviços ativos.</p></div></div>'+
'<div class="merchant-kpis"><div class="kpi"><span class="label">Contas vinculadas</span><strong>'+invited+
'</strong></div><div class="kpi"><span class="label">Conversões verificadas</span><strong>'+confirmed+
'</strong></div></div>'+
'<div class="merchant-kpis" style="margin-top:12px">'+cells+'</div>'+
(ads>0?'<p class="muted tiny">Bonificações de publicidade contabilizadas: '+
BRL.format(ads/100)+'. Ainda não disponíveis para saque ou abatimento.</p>':'')+
'<p class="muted tiny"><strong>Mais oportunidades:</strong> Moto/Carro e Clube parceiro, além de publicidade. Bonificações verificadas não integram o saldo sacável.</p>'+
'</section>';
}
function refer(){
const url=referralUrl();
const live=globalThis.liveRequested?.()===true;
const permanent=state.user.cashEarningEligible===true;
const hasReferral=Boolean(state.user.referralCode);
const referredCount=live?Math.max(0,Number(globalThis.liveRuntime?.referredCount||0)):0;
const qualifiedReferralCount=live?Math.max(0,Number(globalThis.liveRuntime?.qualifiedReferralCount||0)):0;
const referralCard=hasReferral
? `<div class="card flat referral-share-card"><div class="tiny muted">SEU LINK PESSOAL</div><div class="share-box">${esc(url)}</div><div class="field-row" style="align-items:center;margin-top:14px"><div id="referral-qr" class="card flat" style="display:flex;align-items:center;justify-content:center;min-height:190px;flex:0 0 220px"><div class="tiny muted">Gerando QR...</div></div><div style="flex:1"><div class="tiny muted">SEU CÓDIGO</div><div class="balance" style="font-size:1.4rem">${esc(state.user.referralCode)}</div><p class="muted tiny">Seu código é pessoal. Comissões podem ocorrer em todas as compras elegíveis dos clientes indicados.</p><button class="secondary small" onclick="copyReferralCode()">Copiar código</button></div></div><button class="primary full" style="margin-top:12px" onclick="shareReferral()">Compartilhar meu link</button></div>`
: '<div class="notice"><strong>Seu link ainda não está disponível.</strong><br>Ele aparece quando sua identidade real for carregada pelo serviço do TAMÃO.</div>';
const identityCard=live&&!permanent
? `<div class="notice" style="margin-top:14px"><strong>Quer transformar comissão em saldo disponível?</strong><br>Vincule um e-mail à sua conta. Seu histórico, pedidos e cashback continuam no mesmo usuário.</div><div class="card flat form-stack" style="margin-top:14px"><div class="input-wrap"><label for="cash-email">Seu e-mail</label><input id="cash-email" type="email" autocomplete="email" maxlength="160" class="input" placeholder="voce@email.com"></div><button class="primary" onclick="activateCashAccount()">Vincular meu e-mail</button></div>`
: live&&permanent
? '<div class="notice success" style="margin-top:14px"><strong>Conta habilitada para comissão.</strong><br>Vendas elegíveis ainda passam pela janela de validação antes de se tornarem saldo disponível.</div>'
: '';

if(hasReferral)setTimeout(renderReferralQr,0);
if(globalThis.liveReady?.())setTimeout(tamaoNetworkVisitFromUi,0);

const referralRateLabel=policyPercent(referralPilotRate());
return shell(`<section class="page">
<button class="back" onclick="go('earn')">← Ganhar ou vender</button>
<span class="eyebrow">CONVIDE ALGUÉM PARA CONHECER</span>
<h1 class="page-title">Seu próximo convite pode abrir novas portas.</h1>
<p class="muted page-lead">Compartilhe seu link e acompanhe os benefícios das indicações verificadas.</p>
<div class="earn-summary">
<div class="earn-balance-card"><span>Disponível</span><strong>${BRL.format(state.user.commissionAvailable)}</strong><small>saldo já liberado</small></div>
<div class="earn-balance-card"><span>A liberar</span><strong>${BRL.format(state.user.commissionPending)}</strong><small>em validação</small></div>
<div class="earn-balance-card"><span>Indicados</span><strong>${referredCount}</strong><small>novos usuários vinculados</small></div>
<div class="earn-balance-card"><span>Qualificados</span><strong>${qualifiedReferralCount}</strong><small>com ao menos uma compra qualificada</small></div>
</div>
${referralCard}
${typeof tamaoNetworkInvitePicker==='function'?tamaoNetworkInvitePicker():''}
${hasReferral?tamaoParticipantNativePanel('customer',''):''}
<details class="card flat" style="margin:18px 0"><summary>Convidar para outras áreas do TAMÃO</summary>${tamaoNetworkPageBuilderPanel('customer')}</details>
${typeof tamaoNetworkModuleBenefitsPanel==='function'?tamaoNetworkModuleBenefitsPanel():''}
${globalThis.tamaoNetworkCelebraPanel?.()||''}
${identityCard}
${tamaoNetworkFeePackagePanel()}

<section class="section"><div class="section-head"><div><span class="section-kicker">FAÇA UMA SIMULAÇÃO</span><h2>Veja como funciona a comissão de ${referralRateLabel}.</h2><p>Simule benefícios por compras válidas, incluindo recompras de um mesmo cliente.</p></div></div>
<div class="calculator-card">
<div class="calculator-inputs">
<div class="input-wrap"><label for="ref-sim-clients">Compras elegíveis dos clientes indicados</label><input id="ref-sim-clients" class="input" type="number" inputmode="numeric" min="1" max="500" value="10" oninput="updateReferralSimulator()" list="rqn"><datalist id="rqn"><option value="5"><option value="10"><option value="50"></datalist></div>
<div class="input-wrap"><label for="ref-sim-ticket">Valor médio por compra elegível (R$)</label><input id="ref-sim-ticket" class="input" type="number" inputmode="decimal" min="1" step="0.01" value="120" oninput="updateReferralSimulator()"></div>
</div>
<div class="calculator-result"><small>Resultado da simulação</small><strong id="ref-sim-total">${BRL.format(referralExample(120,10))}</strong><span id="ref-sim-detail">10 compras elegíveis × ${BRL.format(120)} × ${referralRateLabel}</span></div>
</div>
<div class="notice" style="margin-top:12px"><strong>Uma indicação qualificada faz a diferença.</strong><br>A comissão de ${referralRateLabel} pode se repetir a cada compra válida do mesmo cliente indicado, após conclusão e validação. A compra deve ter lastro financeiro elegível; cadastro e compartilhamento isolados não geram comissão.</div>
</section>

<section class="section"><div class="section-head"><div><h2>Quando a indicação pode gerar comissão</h2></div></div><div class="how-grid">
<div class="how-card"><span>1</span><div><strong>Compartilhe seu link</strong><p>Envie para quem realmente possa se interessar pelo TAMÃO.</p></div></div>
<div class="how-card"><span>2</span><div><strong>O cliente indicado faz uma compra válida</strong><p>Compras posteriores também podem gerar comissão, desde que elegíveis.</p></div></div>
<div class="how-card"><span>3</span><div><strong>A venda é concluída</strong><p>A entrega e o pagamento precisam ser confirmados.</p></div></div>
<div class="how-card"><span>4</span><div><strong>A comissão é validada</strong><p>Após validação das contas envolvidas, a comissão pode ser liberada.</p></div></div>
</div></section>

<div class="card flat payout-card"><div><span class="section-kicker">EXTRATO DE BENEFÍCIOS</span><h3>Tudo acompanhado em um só lugar.</h3><p class="muted">Origem das suas comissões e vantagens. Os meios de recebimento são informados na conta conforme a disponibilidade.</p><button class="secondary" onclick="import('/js/growth-benefits-statement.js').then(()=>tamaoBenefitsStatementOpen())">Ver extrato</button></div></div>
${globalThis.tamaoBenefitsStatementPanel?.()||''}
</section>`)
}

function growthNetworkIntro(){
const authenticated=Boolean(state.user?.referralCode);
return `<section class="section growth-network-intro" aria-label="Convide pessoas e revendas">
<div class="section-head"><div><span class="section-kicker">REDE TAMÃO</span>
<h2>Um convite para conectar toda a cidade.</h2>
<p>Indique produtos, revendas, serviços, caronas, Clube ou marcas. Acompanhe seus convites e conquistas.</p></div></div>
<div class="grid cards-3">
<article class="card"><div class="feature-icon">🤝</div>
<h3>Convide amigos</h3><p class="muted tiny">Compartilhe produtos e convide pessoas. Você também pode escolher serviços e outros módulos em Minhas indicações.</p>
<button class="secondary full" onclick="shareTamaoGrowthInvite('customer')">Compartilhar com amigos</button></article>
<article class="card"><div class="feature-icon">🏪</div>
<h3>Conhece uma revenda?</h3><p class="muted tiny">Apresente o TAMÃO a uma empresa. Ela poderá se cadastrar e atender clientes após as verificações necessárias.</p>
<button class="primary full" onclick="shareTamaoGrowthInvite('merchant')">Convidar uma revenda</button></article>
<article class="card"><div class="feature-icon">📋</div><h3>Acompanhe suas indicações</h3>
<p class="muted tiny">${authenticated?'Seu link pessoal está disponível. Os benefícios financeiros só são liberados conforme as regras.':'Seu código pessoal aparece após entrar na sua conta. Compartilhamentos sem código não geram atribuição.'}</p>
<button class="ghost full" onclick="go('refer')">Minhas indicações →</button></article>
</div>
</section>`;
}
function earn(){
if(typeof earnPremiumPage==='function')return earnPremiumPage({rateLabel:policyPercent(referralPilotRate()),exampleAmount:BRL.format(referralExample(120,5))});
if(typeof tamaoMerchantExecutiveStyles==='function')tamaoMerchantExecutiveStyles();
if(globalThis.liveReady?.())setTimeout(tamaoNetworkVisitFromUi,0);
const merchantSample=merchantEconomicsExample(120);
const referralRateLabel=policyPercent(referralPilotRate());
const merchantFeeLabel=policyPercent((globalThis.tamaoMerchantPublicPlans?.status==='ready'?globalThis.tamaoMerchantPublicPlans.plans:MERCHANT_PUBLIC_BILLING_PLANS)[0].bps/10000);
return shell(`<section class="page tamao-earn-page">
<div class="tamao-network-hero">
<div class="tamao-network-intro">
<span class="eyebrow">REDE TAMÃO • COMPARTILHAR E CRESCER</span>
<h1 class="page-title">Compartilhe o TAMÃO. Veja sua Rede ganhar vida.</h1>
<p class="page-lead">Convide amigos e empresas. Veja suas indicações, conquistas e benefícios em um só lugar.</p>
<div class="conversion-mini-proof"><span>✓ Compras e convites separados</span><span>✓ Acompanhamento pelo seu código</span><span>✓ Benefícios por campanha</span></div>

</div>
<aside class="tamao-network-illustration" aria-label="Como a Rede TAMÃO aproxima consumidores e revendas">
<span class="tamao-network-illustration-kicker">CRESCER JUNTO FAZ SENTIDO</span>
<h2>Você compartilha.<br><em>A cidade se conecta.</em></h2>
<div class="tamao-network-connections" aria-hidden="true">
<div class="tamao-network-center"><span>🤝</span><strong>Seu convite</strong></div>
<div class="tamao-network-node tamao-network-node--buyer"><span>🛍️</span><strong>Quem compra</strong></div>
<div class="tamao-network-node tamao-network-node--seller"><span>🏪</span><strong>Quem vende</strong></div>
</div>
<p>Seus convites e conquistas podem ser acompanhados na sua conta.</p>
</aside>
</div>
<div class="tamao-network-choice-head"><div><span class="section-kicker">ESCOLHA POR ONDE COMEÇAR</span><h2>Qual é o seu próximo passo?</h2></div></div>
<nav class="tamao-cro-paths" aria-label="Escolha como participar da Rede TAMÃO">
<button type="button" onclick="go('refer')"><span aria-hidden="true">🤝</span><strong>Quero indicar</strong><small>Compartilhe seu link e acompanhe indicações elegíveis.</small><b aria-hidden="true">→</b></button>
<button type="button" onclick="go('club')"><span aria-hidden="true">🎁</span><strong>Quero meus benefícios</strong><small>Confira o que você conquistou e as condições de uso.</small><b aria-hidden="true">→</b></button>
<button type="button" onclick="go('merchants')"><span aria-hidden="true">🏪</span><strong>Tenho uma empresa</strong><small>Conheça o canal de vendas para revendas locais.</small><b aria-hidden="true">→</b></button>
</nav>

<details class="tamao-network-clarity"><summary>Como funcionam os benefícios financeiros?</summary><p>O Clube reúne cupons e cashback de compras elegíveis; a Rede acompanha convites e indicações. Comissões exigem eventos reais, programa habilitado e validação. Um compartilhamento ou cadastro isolado não gera pagamento; empresas vendem após habilitação comercial.</p></details>
<div class="opportunity-grid main-opportunities">
<article class="opportunity-card person-opportunity"><div class="opportunity-icon">🤝</div><span class="section-kicker">PARA QUEM GOSTA DE COMPARTILHAR</span><h2>Conhece alguém que gostaria de usar o TAMÃO?</h2><p>Seu link aproxima pessoas de boas opções. Acompanhe suas indicações e eventuais comissões de compras qualificadas.</p>
<ul class="clean-list"><li>Política comercial atual: ${referralRateLabel} em cada compra qualificada</li><li>Vínculo de indicação persistente, com comissões nas recompras elegíveis</li><li>Saldo “a liberar” separado do saldo disponível</li><li>Histórico de conquistas e origem dos benefícios no extrato</li></ul>
<div class="opportunity-example"><small>Exemplo matemático</small><strong>R$ 120 × ${referralRateLabel} = ${BRL.format(referralExample(120))}</strong><span>Simulação de uma compra elegível e validada, inclusive recorrente, conforme a política comercial.</span></div>
<button class="primary full" onclick="go('refer')">Conhecer as indicações →</button>
</article>
<article class="opportunity-card business-opportunity"><div class="opportunity-icon">🏪</div><span class="section-kicker">PARA QUEM JÁ TEM UM NEGÓCIO</span><h2>Sua empresa pode vender por mais um canal.</h2><p>Ganhe outra vitrine sem abandonar seus canais atuais.</p>
<ul class="clean-list"><li>Você define preços, estoque e taxa de entrega</li><li>Escolhe quando ficar online</li><li>Decide se aceita cada pedido</li><li>Pode aumentar o ticket com vários produtos na mesma entrega</li></ul>
<div class="opportunity-example"><small>Plano Flex Diário, sem recarga</small><strong>Taxa TAMÃO: ${merchantFeeLabel} por pedido concluído</strong><span>Ex.: R$ 120 bruto → ${BRL.format(merchantSample.fee)} de taxa → ${BRL.format(merchantSample.merchantNet)} antes dos custos próprios e impostos.</span></div>
<button class="primary full" onclick="go('merchants')">Quero conhecer a parceria →</button>
</article>
</div>


</section>`)
}

function learn(){
return typeof learnPremiumPage==='function'?learnPremiumPage():shell(`<section class="page"><span class="eyebrow">COMO FUNCIONA O TAMÃO</span><h1 class="page-title">Escolha o que precisa. Confira a entrega. Acompanhe seu pedido.</h1><p class="muted page-lead">Veja primeiro os produtos e escolha o que precisa. Consulte a disponibilidade para seu endereço, confira o valor e aguarde a confirmação da revenda.</p><div class="dual-cta"><button class="primary" onclick="startHomeBrowse()">Escolher produtos →</button><button class="secondary" onclick="go('contact')">Falar com o TAMÃO</button></div></section>`);
}

async function activateCashAccount(){
const email=document.querySelector('#cash-email')?.value.trim()||'';
try{
const result=await liveUpgradeAccount(email);
if(result?.alreadyPermanent){
state.user.cashEarningEligible=true;
state.user.identityType='permanent';
save();render();toast('Sua conta já está habilitada');
return;
}
toast('Enviamos a confirmação para seu e-mail');
const el=document.querySelector('#cash-email');
if(el)el.value='';
}catch(e){
const msg=String(e?.message||e);
toast(/manual linking|identity linking/i.test(msg)?'A ativação por e-mail está temporariamente indisponível':msg);
}
}

function referralSharePayload(url,region){
  const city=String(region?.city||'').trim().slice(0,80);
  const state=String(region?.state||'').trim().toUpperCase();
  const place=city&&/^[A-Z]{2}$/.test(state)?`em ${city}/${state}`:'na sua região';
  return {
    title:'TAMÃO — Pediu? Tá na mão.',
    text:`Conheça o TAMÃO! Consulte gás, água e itens essenciais ${place}, confira a disponibilidade pelo CEP e compartilhe: ${url}`,
    url
  };
}

async function shareReferral(){
  const url=referralUrl();
  if(!url)return toast('Link de indicação indisponível no momento');
  const region=typeof rememberedMarketRegion==='function'?rememberedMarketRegion():null;
  const payload=referralSharePayload(url,region);
  try{
    if(navigator.share){
      await navigator.share(payload);
      return;
    }
    if(navigator.clipboard?.writeText){
      await navigator.clipboard.writeText(payload.text);
      toast('Link copiado');
      return;
    }
    toast('Copie o link exibido acima');
  }catch(e){
    if(e?.name!=='AbortError')toast('Não foi possível compartilhar automaticamente');
  }
}

// V1.243 — honest sponsor discovery; no paid ads or funded Clube campaign is sold from this page.
// V1.301 — send partnership interest into the existing protected contact channel,
// without new storage, third-party redirects or a fake sponsor activation.
function openSponsorContact(format='general',quoteBrief=''){
  // Carry only the visitor's public contact intent for anonymous page metrics.
  // No campaign is activated and no identity is included in analytics.
  globalThis.tamaoPublicContactAudience='merchant';
  const messages={
    general:'Tenho interesse em uma parceria de divulgação com o TAMÃO. Gostaria de conversar sobre minha região, categorias e formatos disponíveis.',
    visibility:'Minha marca quer conversar sobre divulgação identificada no TAMÃO. Gostaria de informar cidade, categoria e objetivo da campanha.',
    relationship:'Minha marca quer avaliar uma ação de benefícios para clientes do TAMÃO. Gostaria de conversar sobre público, orçamento e limites da campanha.',
    local:'Minha marca quer estudar uma ação regional em parceria com revendas do TAMÃO. Gostaria de informar cidade e categoria de interesse.'
  };
  const focus=()=>{
    if(route()!=='contact')return;
    const type=document.getElementById('public-request-kind');
    if(type){type.value='sponsor';globalThis.contactKindChanged?.()}
    const message=document.getElementById('public-request-message');
    if(message&&!String(message.value||'').trim()){
      message.value=messages[Object.prototype.hasOwnProperty.call(messages,format)?format:'general']+
        (quoteBrief?'\n'+String(quoteBrief).trim().slice(0,450):'');
    }
    document.querySelector('.public-contact-card')?.scrollIntoView({behavior:'smooth',block:'start'});
    document.getElementById('public-contact-name')?.focus({preventScroll:true});
  };
  if(route()!=='contact'){go('contact');setTimeout(focus,160);return}
  focus();
}
function tamaoAdsPlannerLoad(){
if(globalThis.tamaoAdsPlannerSection||globalThis.tamaoAdsLoading)return;
globalThis.tamaoAdsLoading=true;
const s=document.createElement('script');
const current=document.querySelector('script[src*="growth.js"]')?.src;
s.src=new URL('ads-planner.js'+(current?new URL(current).search:''),current||location.origin+'/js/growth.js').href;
s.onload=()=>{if(route()==='sponsors')render()};
s.onerror=()=>{globalThis.tamaoAdsLoading=false};
document.head.append(s);
}


// The commercial story is not downloaded on the first customer/home visit.
let tamaoSponsorPremiumLoading=false;
function tamaoSponsorPremiumLoad(){
 if(typeof globalThis.tamaoSponsorPremiumLanding==='function'||tamaoSponsorPremiumLoading)return;
 tamaoSponsorPremiumLoading=true;
 const script=document.createElement('script');
 const current=document.querySelector('script[src*="growth.js"]')?.src;
 script.src=new URL('sponsors-premium.js'+(current?new URL(current).search:''),current||location.origin+'/js/growth.js').href;
 script.async=true;
 script.onload=()=>{
tamaoSponsorPremiumLoading=false;
if(route()==='sponsors')render();
 };
 script.onerror=()=>{
tamaoSponsorPremiumLoading=false;
if(route()==='sponsors'){
const note=document.getElementById('tamao-sponsor-load-status');
if(note)note.textContent='Não foi possível abrir as opções de publicidade. Atualize a página e tente novamente.';
}
 };
 document.head.appendChild(script);
}
function sponsorsLanding(){
 if(typeof globalThis.tamaoSponsorPremiumLanding==='function')
return globalThis.tamaoSponsorPremiumLanding();
 tamaoSponsorPremiumLoad();
 return shell('<section class="page tamao-sponsors-page sponsor-premium-v1090">'+
'<div class="tamao-sponsor-hero sponsor-premium-hero">'+
'<span class="sponsor-premium-eyebrow">PUBLICIDADE LOCAL NO TAMÃO</span>'+
'<h1 class="page-title">Sua marca merece uma apresentação profissional.</h1>'+
'<p id="tamao-sponsor-load-status" role="status">Preparando as opções de divulgação da sua empresa…</p>'+
'</div></section>');
}

function tamaoMerchantExecutiveStyles(){
if(typeof document==='undefined')return;
if(!document.getElementById('merchant-executive-styles')){
const link=document.createElement('link');
link.id='merchant-executive-styles';
link.rel='stylesheet';
link.href='./css/merchant-landing-executive.css?v=1123';
document.head.appendChild(link);
}
if(!document.getElementById('merchant-public-plans-script')){
const script=document.createElement('script');
script.id='merchant-public-plans-script';
script.src='./js/merchant-public-plans.js?v=1123';
script.async=true;
document.head.appendChild(script);
}else globalThis.tamaoMerchantPublicPlansLoad?.();
}
function merchantsLanding(){
tamaoMerchantExecutiveStyles();
if(globalThis.merchantPlanReceiptHydrate)setTimeout(globalThis.merchantPlanReceiptHydrate,0);
const portal=globalThis.merchantPortalRequested?.()===true;
const internalPilot=globalThis.CHAMA_INTERNAL_PILOT===true;
const cta=internalPilot?"setMode('merchant')":"openMerchantPortal(true)";
const ctaLabel=internalPilot?'Abrir ambiente interno':'Cadastrar minha empresa';
const referenceTicket=120.00;
const verified=globalThis.tamaoMerchantPublicPlans?.status==='ready';
const plans=verified?globalThis.tamaoMerchantPublicPlans.plans:MERCHANT_PUBLIC_BILLING_PLANS;
const flex=plans[0];
const cheapest=Math.min(...plans.map(p=>p.bps));
const cheapestPlan=plans.find(p=>p.bps===cheapest)||flex;
const tariffStamp=verified?'Condições conferidas no catálogo oficial':'Valores de referência. Confira as taxas no Financeiro antes de contratar';
const safePlanName=value=>String(value||'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]);
const planSummary=plans.slice(1).map(p=>safePlanName(p.name)+' '+policyPercent(p.bps/10000)).join(', ');
const merchantFeeLabel=policyPercent(flex.bps/10000);
const initial=merchantMarginExample({salePrice:referenceTicket,orders:50,feeRate:flex.bps/10000});
const planOptions=plans.map(p=>'<option value="'+p.key+'">'+safePlanName(p.name)+' • '+policyPercent(p.bps/10000)+'</option>').join('');
const planCards=plans.slice(1).map(p=>{
const rate=p.bps/10000,saving=(flex.bps-p.bps)/10000;
return '<article class="merchant-v1115-plan merchant-v1117-plan'+(p.bps===cheapest&&p.key!==flex.key?' merchant-v1115-plan-featured':'')+'">'+
'<div class="merchant-v1115-plan-top"><span>'+safePlanName(p.name)+'</span>'+(p.bps===cheapest&&p.key!==flex.key?'<em>MAIOR REDUÇÃO DE TAXA</em>':'')+'</div>'+
'<div class="merchant-v1117-plan-rate"><strong class="merchant-v1115-plan-rate">'+policyPercent(rate)+'</strong><small>por pedido concluído</small></div>'+
'<div class="merchant-v1115-plan-credit"><span>Crédito antecipado</span><b>'+BRL.format(p.cents/100)+'</b></div>'+
'<div class="merchant-v1115-plan-savings"><span>Economia na taxa por venda de <span data-merchant-order-ticket>'+BRL.format(referenceTicket)+'</span></span><strong data-merchant-saving-bps="'+(flex.bps-p.bps)+'">'+BRL.format(referenceTicket*saving)+'</strong></div>'+
'</article>';
}).join('');


return shell(`<section class="page merchant-landing merchant-landing-v1112 merchant-landing-v1113 merchant-landing-v1114 merchant-landing-v1115 merchant-landing-v1117">
<div class="merchant-landing-premium merchant-v1112-hero">
<div class="merchant-landing-premium-copy">
<span class="merchant-v1112-kicker"><span class="merchant-v1112-kicker-mark" aria-hidden="true"></span> TAMÃO NEGÓCIOS <span>PARA REVENDAS</span></span>
<h1 class="page-title">Sua revenda mais visível. <span class="merchant-v1112-accent">Seu negócio no controle.</span></h1>
<p class="page-lead">Mostre seus produtos a novos clientes, organize pedidos e participe da Rede. <strong>Você controla preços, estoque, pagamentos e entregas.</strong></p>
<p class="merchant-v1113-positioning">Sua empresa em um canal local adicional, com atendimento na região em que você atua.</p>
<div class="hero-actions merchant-hero-actions">
<button type="button" class="primary merchant-v1112-primary" onclick="${cta}">${internalPilot?ctaLabel:'Quero cadastrar minha revenda'} <span aria-hidden="true">→</span></button>
<button type="button" class="secondary merchant-v1112-secondary" onclick="publicLandingJump('merchant-plans')">Comparar taxas e pacotes</button>
<button type="button" class="merchant-panel-link" onclick="openMerchantPortal()">Já sou parceiro • Acessar painel ↗</button>
</div>
<div class="merchant-v1112-promise" aria-label="Condições da parceria">
<span><b aria-hidden="true">✓</b> Sem mensalidade no modelo atual</span>
<span><b aria-hidden="true">✓</b> Recebimento direto na sua revenda</span>
<span><b aria-hidden="true">✓</b> Sem exclusividade</span>
<span><b aria-hidden="true">✓</b> Taxas menores com crédito antecipado</span>
</div>
<p class="merchant-v1112-approval">Cadastro sem cobrança. A liberação das vendas depende da conferência dos dados e das autorizações aplicáveis.</p>
</div>
<aside class="merchant-landing-premium-visual merchant-v1112-visual" aria-label="O que a revenda organiza no Portal TAMÃO">
<div class="merchant-v1112-window">
<div class="merchant-v1112-window-head">
<span class="merchant-v1112-brand"><span class="merchant-v1112-brand-icon" aria-hidden="true">T</span> PORTAL DA REVENDA</span>
<span class="merchant-v1112-dot-label">SUA OPERAÇÃO</span>
</div>
<div class="merchant-v1112-window-intro">
<small>UMA VITRINE PARA SEUS PRODUTOS</small>
<h2>O que sua região precisa. <em>Com a identidade da sua revenda.</em></h2>
</div>
<div class="merchant-v1113-products" aria-label="Exemplos visuais de produtos do catálogo TAMÃO">
<div class="merchant-v1113-product merchant-v1113-product-main">
<span class="tamao-product-photo product-gas" role="img" aria-label="Foto ilustrativa de botijão de gás"></span>
<span class="merchant-v1113-product-name">Gás de cozinha</span>
</div>
<div class="merchant-v1113-product">
<span class="tamao-product-photo product-water" role="img" aria-label="Foto ilustrativa de água mineral"></span>
<span class="merchant-v1113-product-name">Água</span>
</div>
<div class="merchant-v1113-product">
<span class="tamao-product-photo product-charcoal" role="img" aria-label="Foto ilustrativa de carvão"></span>
<span class="merchant-v1113-product-name">Carvão</span>
</div>
</div>
<div class="merchant-v1113-controlbar">
<div><span class="merchant-v1113-control-mark" aria-hidden="true">✓</span><span><strong>Você continua no comando</strong><small>Preços, estoque e entregas definidos pela sua empresa</small></span></div>
</div>
<div class="merchant-v1112-window-footer">
<div><small>MODELO COMERCIAL ATUAL</small><strong>Sem mensalidade</strong></div>
<div><small>FLEX DIÁRIO · SEM RECARGA</small><strong>${merchantFeeLabel}</strong></div>
</div><p class="merchant-v1115-tariff-state" role="status">${tariffStamp}</p>
<p class="merchant-v1112-caption">Visão ilustrativa dos recursos. Fotos de produtos; não representam ofertas ou revendas cadastradas. A ativação depende de aprovação.</p>
</div>
</aside>
</div>
<section class="merchant-v1112-trust" aria-label="Por que participar do TAMÃO">
<div><span aria-hidden="true">01 /</span><strong>Mais um canal de vendas</strong><p>Seja uma opção para clientes que ainda não conhecem sua revenda.</p></div>
<div><span aria-hidden="true">02 /</span><strong>Autonomia de verdade</strong><p>Você define preços, área atendida e quando pode receber novos pedidos.</p></div>
<div><span aria-hidden="true">03 /</span><strong>Parceria com transparência</strong><p>Condições comerciais claras, antes de começar a operar.</p></div>
</section>
${internalPilot?'':`<section class="merchant-conversion-start" aria-label="Apresente sua empresa ao TAMÃO">
<div class="merchant-conversion-intro">
<span class="section-kicker">SEU PRÓXIMO PASSO</span>
<h2>Comece com um cadastro simples.</h2>
<p>Entre com seu e-mail, informe os dados da empresa e prepare produtos, preços e entregas no Portal das Revendas.</p>
<div class="merchant-conversion-proof" aria-label="Como começar">
<span><b>01</b> Acesse com seu e-mail</span><span><b>02</b> Cadastre a empresa</span><span><b>03</b> Prepare seu catálogo</span>
</div>
<div class="merchant-v1119-conversion-actions">
<button type="button" class="primary merchant-live-signup-cta" onclick="openMerchantPortal(true)">Cadastrar minha revenda →</button>
<button type="button" class="secondary merchant-share" onclick="shareTamaoGrowthInvite('merchant')">Indicar revenda ↗</button>
</div>
</div>
<details class="merchant-secondary-lead"><summary>Prefiro deixar meu contato para conversar sobre a parceria</summary>
${prelaunchMerchantLeadSection()}
</details>
</section>`}

<nav class="merchant-v1114-index" aria-label="Navegue pela proposta comercial">
<span class="merchant-v1114-index-heading">CONHEÇA A PARCERIA</span>
<button type="button" onclick="publicLandingJump('merchant-benefits')"><b>01</b><span>Benefícios</span><span aria-hidden="true">↗</span></button>
<button type="button" onclick="publicLandingJump('merchant-terms')"><b>02</b><span>Condições claras</span><span aria-hidden="true">↗</span></button>
<button type="button" onclick="publicLandingJump('merchant-plans')"><b>03</b><span>Pacotes e economia</span><span aria-hidden="true">↗</span></button>
<button type="button" onclick="publicLandingJump('merchant-how')"><b>04</b><span>Como funciona</span><span aria-hidden="true">↗</span></button>
<button type="button" onclick="publicLandingJump('merchant-faq')"><b>05</b><span>Dúvidas frequentes</span><span aria-hidden="true">↗</span></button>
</nav>

${internalPilot?`<div class="notice success" style="margin-top:14px"><strong>Você está no laboratório interno do TAMÃO.</strong><br>Abra o painel da Gas e Lenheira do JR, simule pedidos e veja a operação antes de qualquer cadastro real.</div>`:''}




<section class="merchant-v1112-value merchant-v1114-benefits" id="merchant-benefits" tabindex="-1" aria-label="Benefícios para sua revenda">
<div class="merchant-v1112-section-heading">
<span class="section-kicker">FEITO PARA NEGÓCIOS LOCAIS</span>
<h2>Uma presença digital à altura da sua revenda.</h2>
<p>Um novo canal de vendas com a identidade e a autonomia da sua revenda.</p>
</div>
<div class="merchant-v1112-value-grid">
<article><span class="merchant-v1112-value-number">01</span><h3>Sua própria vitrine</h3><p>Apresente seu catálogo, preços e disponibilidade a clientes que procuram produtos na região atendida pela sua revenda.</p><span class="merchant-v1114-card-note">VITRINE E CATÁLOGO</span></article>
<article><span class="merchant-v1112-value-number">02</span><h3>Operação sob seu controle</h3><p>Defina quando receber pedidos, onde entregar e quais produtos estão disponíveis. Sem abandonar telefone ou WhatsApp.</p><span class="merchant-v1114-card-note">PAINEL DO PARCEIRO</span></article>
<article><span class="merchant-v1112-value-number">03</span><h3>Uma página para compartilhar</h3><p>Divulgue sua página e acompanhe os vínculos da sua Rede. Benefícios e comissões seguem as regras das campanhas efetivamente habilitadas.</p><span class="merchant-v1114-card-note">PÁGINA E REDE</span></article>
</div>
</section>

<section class="merchant-v1114-pricing" id="merchant-terms" tabindex="-1" aria-label="Condições comerciais da parceria">
<div class="merchant-v1114-pricing-heading"><span class="section-kicker">TRANSPARÊNCIA COMERCIAL</span><h2>Saiba exatamente o que a plataforma cobra.</h2><p>Sem assinatura mensal no modelo atual. Você recebe o pagamento do cliente pela forma disponibilizada pela sua revenda.</p></div>
<div class="merchant-v1114-pricing-grid">
<div class="merchant-v1114-pricing-rate"><span>FLEX DIÁRIO · SEM RECARGA</span><strong>${merchantFeeLabel}</strong><small>por pedido concluído; com pacotes, a taxa pode cair até ${policyPercent(cheapest/10000)}</small></div>
<div class="merchant-v1114-pricing-example">
<span>EXEMPLO ILUSTRATIVO DA TAXA</span>
<div><span>Valor da venda</span><strong>${BRL.format(referenceTicket)}</strong></div>
<div><span>Taxa TAMÃO (${merchantFeeLabel})</span><strong>${BRL.format(referenceTicket * flex.bps/10000)}</strong></div>
<p>Exemplo com o Flex Diário (${merchantFeeLabel}). Nos pacotes pré-pagos a taxa é menor e debitada dos créditos confirmados. Custos próprios e tributos não estão incluídos.</p>
</div>
<div class="merchant-v1114-pricing-assurance"><span>QUEM RECEBE A VENDA?</span><strong>A sua revenda.</strong><p>O TAMÃO não retém o valor do pedido para fazer um repasse depois. A cobrança da plataforma é tratada separadamente.</p></div>
</div>
</section>

<section class="merchant-v1115-plans" id="merchant-plans" tabindex="-1" aria-label="Pacotes de redução de taxas">
<div class="merchant-v1115-plans-head">
<div><span class="section-kicker">MAIS CONTROLE SOBRE O QUE VOCÊ PAGA</span><h2>Uma taxa menor faz diferença em cada venda.</h2><p>No Flex Diário não há recarga. Com créditos antecipados, sua tarifa por pedido pode ser menor.</p></div>
<div class="merchant-v1115-plans-hero-stat"><span>TAXA A PARTIR DE</span><strong>${policyPercent(cheapest/10000)}</strong><small>${cheapestPlan.key===flex.key?'por pedido concluído':'com '+safePlanName(cheapestPlan.name)+' ativo e saldo disponível'}</small></div>
</div>
<p class="merchant-v1115-plans-fine" role="status">${tariffStamp}</p>
<div class="merchant-v1117-ticketbar">
<div class="merchant-v1117-ticketbar-copy"><span>COMPARE EM SEGUNDOS</span><strong>Veja quanto a taxa diminui na sua venda.</strong><small>Escolha um valor ilustrativo de pedido para comparar os planos.</small></div>
<div class="merchant-v1117-ticketbar-controls" role="group" aria-label="Valor ilustrativo do pedido">
<button type="button" data-merchant-ticket="100" aria-pressed="false" onclick="globalThis.merchantPlanTicketPreview?.(100)">R$ 100</button>
<button type="button" data-merchant-ticket="120" aria-pressed="true" onclick="globalThis.merchantPlanTicketPreview?.(120)">R$ 120</button>
<button type="button" data-merchant-ticket="200" aria-pressed="false" onclick="globalThis.merchantPlanTicketPreview?.(200)">R$ 200</button>
</div>
</div>
<div class="merchant-v1115-plans-grid">${planCards}</div>
<div class="merchant-v1115-plans-bottom">
<div><strong>Como funciona o pré-pago?</strong><p>Escolha um pacote no Financeiro do Portal da Revenda, pague a recarga e aguarde a confirmação. Os créditos pagam taxas; o valor da venda segue com a revenda. Consulte saldo e condições no painel.</p></div>
<button class="secondary merchant-v1115-plans-cta" type="button" onclick="openMerchantPortal(true)">Conhecer os planos no Portal <span aria-hidden="true">→</span></button>
</div>
<p class="merchant-v1115-plans-fine">Economia ilustrativa por pedido de <span data-merchant-order-ticket>${BRL.format(referenceTicket)}</span>, em comparação com o Flex Diário de ${merchantFeeLabel}. Só existe economia quando a tarifa reduzida é efetivamente aplicada. Recargas não garantem pedidos ou lucro; condições podem ser alteradas pelo administrador.</p>
</section>
<section class="section merchant-v1114-simulator" id="merchant-margin" tabindex="-1"><div class="section-head"><div><span class="section-kicker">FAÇA AS CONTAS DO SEU JEITO</span><h2>Quer analisar sua margem com mais detalhes?</h2><p>O cálculo completo fica disponível para quem quiser informar os próprios custos e avaliar cenários sem promessas de lucro.</p></div></div>
<details class="merchant-v1114-simulator-details">
<summary><span><strong>Abrir calculadora de margem</strong><small>Inclua valor médio, custos, entrega, impostos e forma de pagamento</small></span><span aria-hidden="true">+</span></summary>
<div class="merchant-v1114-simulator-body">
<div class="calculator-card merchant-calculator merchant-margin-calculator">
<div class="calculator-inputs merchant-margin-inputs">
<div class="input-wrap merchant-v1115-plan-select"><label for="merchant-sim-plan">Plano para simular</label><select id="merchant-sim-plan" class="input" onchange="updateMerchantSimulator()">${planOptions}</select><small>Simulação com plano ativo e crédito suficiente, quando aplicável.</small></div>
<div class="input-wrap"><label for="merchant-sim-orders">Pedidos adicionais</label><input id="merchant-sim-orders" class="input" type="number" inputmode="numeric" min="1" max="10000" value="50" oninput="updateMerchantSimulator()" list="mqn"><datalist id="mqn"><option value="10"><option value="20"><option value="50"></datalist></div>
<div class="input-wrap"><label for="merchant-sim-ticket">Preço médio por pedido (R$)</label><input id="merchant-sim-ticket" class="input" type="number" inputmode="decimal" min="0.01" step="0.01" value="120.00" oninput="updateMerchantSimulator()"></div>
<div class="input-wrap"><label for="merchant-sim-product-cost">Custo do produto por pedido (R$)</label><input id="merchant-sim-product-cost" class="input" type="number" inputmode="decimal" min="0" step="0.01" placeholder="Informe seu custo real" oninput="updateMerchantSimulator()"><small>Obrigatório para estimar contribuição e margem.</small></div>
<div class="input-wrap"><label for="merchant-sim-delivery-cost">Custo médio de entrega (R$)</label><input id="merchant-sim-delivery-cost" class="input" type="number" inputmode="decimal" min="0" step="0.01" value="0" oninput="updateMerchantSimulator()"></div>
<div class="input-wrap"><label for="merchant-sim-payment-cost">Custo médio do pagamento (R$)</label><input id="merchant-sim-payment-cost" class="input" type="number" inputmode="decimal" min="0" step="0.01" value="0" oninput="updateMerchantSimulator()"></div>
<div class="input-wrap"><label for="merchant-sim-tax-rate">Tributos sobre a venda (%)</label><input id="merchant-sim-tax-rate" class="input" type="number" inputmode="decimal" min="0" max="100" step="0.1" value="0" oninput="updateMerchantSimulator()"></div>
</div>
<div class="economics-results merchant-margin-results">
<div><small>Vendas brutas</small><strong id="merchant-sim-gross">${BRL.format(initial.gross)}</strong></div>
<div><small id="merchant-sim-plan-label">Taxa TAMÃO (${merchantFeeLabel})</small><strong id="merchant-sim-fee">${BRL.format(initial.chamaFee)}</strong></div>
<div><small>Custos próprios informados</small><strong id="merchant-sim-costs">Informe o custo do produto</strong></div>
<div class="highlight"><small>Contribuição estimada após os custos informados</small><strong id="merchant-sim-contribution">—</strong></div>
<div><small>Contribuição estimada por pedido</small><strong id="merchant-sim-unit">—</strong></div>
<div><small>Margem estimada sobre a venda</small><strong id="merchant-sim-margin">—</strong></div>
</div>
</div>
<div class="notice" style="margin-top:12px"><strong>Use os seus custos reais.</strong><br>O simulador não conhece seu custo de compra, folha, combustível, impostos, manutenção ou despesas fixas. Ele serve para testar cenários — não para prometer lucro.</div>
</div></details>
</section>

<section class="merchant-v1114-distribution"><details><summary><span><small>CRITÉRIOS DE OFERTA</small><strong>Como o TAMÃO apresenta as opções aos clientes?</strong><em>Preço, prazo e capacidade de atendimento são considerados.</em></span><span aria-hidden="true">+</span></summary>
<div class="merchant-v1114-distribution-body">
<div class="distribution-grid"><div class="distribution-card"><strong>Preço total</strong></div><div class="distribution-card"><strong>Prazo de entrega</strong></div><div class="distribution-card"><strong>Estoque e confiança</strong></div><div class="distribution-card"><strong>Pedidos bem distribuídos</strong></div></div>
<div class="notice" style="margin-top:12px"><strong>Regra importante:</strong> o TAMÃO não coloca uma oferta claramente pior na frente só para distribuir pedidos. Esse ajuste vale para opções parecidas.</div>
</div></details>
</section>

<section class="merchant-v1114-catalogue" aria-label="Categorias disponíveis na plataforma">
<div class="merchant-v1114-catalogue-intro"><span class="section-kicker">CATÁLOGO MAIS COMPLETO</span><h2>Uma entrega. Mais possibilidades.</h2><p>Apresente os itens que sua empresa já comercializa. Categorias e produtos dependem de catálogo, disponibilidade e autorizações aplicáveis.</p></div>
<div class="merchant-v1114-catalogue-grid">
<div><span class="tamao-product-photo product-gas" role="img" aria-label="Botijão de gás ilustrativo"></span><strong>Gás</strong><small>Conforme cadastro e validação</small></div>
<div><span class="tamao-product-photo product-water" role="img" aria-label="Água mineral ilustrativa"></span><strong>Água</strong><small>Galões e formatos disponíveis</small></div>
<div><span class="tamao-product-photo product-charcoal" role="img" aria-label="Carvão ilustrativo"></span><strong>Carvão</strong><small>Complementos de cesta</small></div>
<div><span class="tamao-product-photo product-wood" role="img" aria-label="Lenha ilustrativa"></span><strong>Lenha</strong><small>Venda adicional autorizada</small></div>
<div><span class="tamao-product-photo product-ice" role="img" aria-label="Gelo ilustrativo"></span><strong>Gelo</strong><small>Mais opções no catálogo</small></div>
</div>
<small class="merchant-v1114-catalogue-caption">Imagens ilustrativas de categorias; não representam estoque ou ofertas cadastradas.</small>
</section>

<div class="merchant-v1114-operations">
<section class="section" id="merchant-how" tabindex="-1"><div class="section-head"><div><span class="section-kicker">DO PEDIDO À ENTREGA</span><h2>Você decide como atender cada pedido.</h2></div></div><div class="how-grid">
<div class="how-card"><span>1</span><div><strong>Cliente consulta</strong><p>O TAMÃO busca revendas que tenham os produtos e atendam o endereço informado.</p></div></div>
<div class="how-card"><span>2</span><div><strong>Você aceita ou recusa</strong><p>Recusar antes de aceitar é permitido. Se não puder atender, diga não ou fique offline.</p></div></div>
<div class="how-card"><span>3</span><div><strong>Prepare e confirme a saída</strong><p>Depois que você aceita, o cliente conta com a entrega. O status “A caminho” aparece quando você confirma a saída.</p></div></div>
<div class="how-card"><span>4</span><div><strong>Conclua com prova</strong><p>Pagamento confirmado e código de recebimento encerram a entrega com rastreabilidade.</p></div></div>
</div></section>

<section class="section"><div class="section-head"><div><span class="section-kicker">COMO O DINHEIRO FUNCIONA</span><h2>Venda, recebimento e taxa TAMÃO são separados.</h2><p>O valor da venda pertence à revenda. Quando o cliente paga por um meio cadastrado pela empresa, o recebimento acontece diretamente na conta ou operação da própria revenda; o TAMÃO registra e concilia somente o que precisa para operar a plataforma.</p></div></div>
<div class="money-flow">
<div><span>1</span><strong>Pedido</strong><small>Preço e política financeira ficam registrados.</small></div>
<b>→</b>
<div><span>2</span><strong>Pagamento</strong><small>O cliente paga pela forma disponível da própria revenda.</small></div>
<b>→</b>
<div><span>3</span><strong>Conclusão</strong><small>Pagamento + código confirmam a entrega.</small></div>
<b>→</b>
<div><span>4</span><strong>Conciliação</strong><small>A venda da revenda e as cobranças do TAMÃO permanecem separadas.</small></div>
</div>
<div class="notice success" style="margin-top:12px"><strong>O TAMÃO não recebe a venda para depois repassar.</strong><br>O recebimento do cliente fica com a revenda. Taxas e créditos devidos ao TAMÃO são tratados separadamente no financeiro da plataforma.</div>
</section>

</div>


<section class="section"><div class="merchant-requirements"><div><span class="section-kicker light">COMECE COM O BÁSICO</span><h2>Comece pelo cadastro. As verificações vêm depois.</h2><p>Cadastre-se agora. A ativação depende de conferência dos dados e das licenças aplicáveis.</p></div>
<div class="requirement-list"><span>✓ Dados e CNPJ da empresa</span><span>✓ Responsável autorizado</span><span>✓ Endereço e área de atendimento</span><span>✓ ANP vigente para comercializar GLP</span></div>
</div></section>

<section class="section merchant-v1114-faq" id="merchant-faq" tabindex="-1"><div class="section-head"><div><span class="section-kicker">RESPOSTAS PARA DECIDIR COM TRANQUILIDADE</span><h2>O que você precisa saber antes de começar.</h2></div></div><div class="faq-list">
<details open><summary>Sou obrigado a aceitar todo pedido?</summary><p>Não. Você decide pedido por pedido e pode ficar offline. Recusar antes do aceite é melhor do que assumir uma entrega que já sabe que não conseguirá cumprir.</p></details>
<details><summary>Se eu não for o mais barato, fico sem pedidos?</summary><p>Não. Preço total, prazo e confiança são considerados na seleção.</p></details>
<details><summary>Posso continuar vendendo pelo WhatsApp e telefone?</summary><p>Sim. A proposta atual não exige exclusividade. O TAMÃO é um canal adicional.</p></details>
<details><summary>Qual é a taxa de cada plano?</summary><p>No Flex Diário, a taxa da plataforma incide sobre o valor bruto de cada pedido concluído. A tarifa é de ${merchantFeeLabel}. Com créditos antecipados: ${planSummary}, conforme plano ativo e saldo disponível. Verifique as condições atuais no Financeiro antes de contratar.</p></details>
<details><summary>Quem define preço, estoque e entrega?</summary><p>A sua revenda. Você define o preço de cada produto, o estoque, o frete, a previsão de entrega e quando pode atender.</p></details>
<details><summary>Como recebo o dinheiro da venda?</summary><p>O cliente paga diretamente à sua revenda. O TAMÃO não retém a venda.</p></details>
<details><summary>Preciso ter Mercado Pago ou contratar um novo serviço?</summary><p>Não para receber na entrega. Você pode receber na entrega por dinheiro, Pix ou cartão, conforme sua operação.</p></details>
<details><summary>Tenho que pagar para começar?</summary><p>Não. O cadastro é gratuito. O Flex Diário funciona sem recarga antecipada: a taxa de ${merchantFeeLabel} é apurada sobre pedidos concluídos. Os pacotes são opcionais.</p></details>
<details><summary>Comprar crédito significa pagar uma taxa extra?</summary><p>Não. A recarga é um adiantamento usado para pagar taxas da plataforma. Ela não compra produtos nem garante pedidos; a tarifa reduzida depende do plano ativo e do saldo disponível.</p></details>
<details><summary>O que acontece se eu aceitar e depois não conseguir entregar?</summary><p>Avise antes da saída; o TAMÃO poderá procurar outra revenda.</p></details>
<details><summary>Posso vender além do P13?</summary><p>Sim. O catálogo suporta outros tamanhos de GLP e produtos como água, carvão, lenha e gelo, sujeitos às validações aplicáveis.</p></details>
</div></section>

<section class="section merchant-v1114-last-cta"><div class="soft-band"><div><span class="section-kicker">${internalPilot?'AMBIENTE INTERNO':'SUA REVENDA TEM ESPAÇO AQUI'}</span><h2>${internalPilot?'Conheça a rotina operacional.':'Pronto para apresentar seu negócio?'}</h2><p>${internalPilot?'Este ambiente é reservado à validação interna e não altera a operação pública.':'Cadastro gratuito, sujeito à aprovação. Sem promessa de pedidos ou exclusividade.'}</p></div><button class="primary" onclick="${cta}">${internalPilot?ctaLabel:'Cadastrar minha revenda →'}</button></div></section>
</section>`)
}
function currentMerchantPilotInviteToken(){
return String(globalThis.merchantPilotInviteToken?.()||'').trim();
}
function clearCurrentMerchantPilotInviteToken(){
globalThis.clearMerchantPilotInviteToken?.();
}
function currentMerchantProspectInviteToken(){
return String(globalThis.merchantProspectInviteToken?.()||'').trim();
}
function clearCurrentMerchantProspectInviteToken(){
globalThis.clearMerchantProspectInviteToken?.();
}
function merchantPickOwnApplicationFromUi(value){
const rt=globalThis.merchantRuntime;
if(!globalThis.merchantPortalRequested?.()||!rt?.session?.access_token)return;
const id=String(value||'');
if(id==='__new__'){
// An existing prospect/pilot invitation belongs to its own company.
if(currentMerchantPilotInviteToken()||currentMerchantProspectInviteToken())return;
rt.newApplicationMode=true;
rt.selectedApplicationId=null;
}else{
// Never accept an arbitrary company ID from HTML; only the user's
// applications returned by the authenticated backend may be selected.
if(!(rt.ownApplications||[]).some(a=>String(a.id)===id))return;
rt.newApplicationMode=false;
rt.selectedApplicationId=id;
}
if(route()!=='merchant-join')go('merchant-join');
else render();
}
function merchantJoin(){
  if(globalThis.merchantPortalRequested?.()){
    const rt=globalThis.merchantRuntime||{};
    if(['disabled','loading'].includes(rt.status)){
      return shell('<section class="page"><h1 class="page-title">Cadastro de parceiro</h1><div class="empty card">Conectando à sua conta…</div></section>');
    }
    if(rt.status==='unsafe-origin')return merchantLivePage();
    if(rt.status==='unavailable'||(rt.status==='no-access'&&rt.applicationFetchError)){
      // Do not collect registration data while auth or the applicant's own
      // records are unverified: a retry must recheck the real session first.
      return shell('<section class="page"><h1 class="page-title">Continuar cadastro da revenda</h1>'+
        '<div class="notice danger" role="alert">Não foi possível confirmar sua conta e os cadastros já enviados. Nenhum novo cadastro foi registrado.</div>'+
        '<button type="button" class="primary" onclick="location.reload()">Tentar novamente com segurança</button></section>');
    }
    if(rt.status==='unauthenticated')return merchantLiveLoginView();
  }
  if(globalThis.__CHAMA_TEST__!==true&&!globalThis.merchantPortalRequested?.()){
    // The customer bundle excludes merchant.js; retain the exact public
    // handoff without loading partner operations or authentication code.
    return typeof merchantRealPortalRequired==='function'
      ?merchantRealPortalRequired()
      :shell('<section class="page"><span class="eyebrow">ÁREA DA REVENDA</span><h1 class="page-title">Área da minha revenda</h1><p class="muted">Entre ou cadastre sua empresa para configurar produtos, entregas e recebimentos.</p><button class="primary full" onclick="openMerchantPortal()">Entrar ou cadastrar minha revenda</button></section>');
  }
  const prospectInvite=globalThis.merchantPortalRequested?.()?currentMerchantProspectInviteToken():'';
  const pilotInvite=prospectInvite?'':globalThis.merchantPortalRequested?.()?currentMerchantPilotInviteToken():'';
  const prospectDetails=prospectInvite?globalThis.merchantProspectInviteDetails?.():null;
  const rt=globalThis.merchantRuntime||{};
  const ownApplications=globalThis.merchantPortalRequested?.()&&Array.isArray(rt.ownApplications)
    ?rt.ownApplications:[];
  const newApplication=rt.newApplicationMode===true&&!prospectInvite&&!pilotInvite;
  const ownApplication=newApplication?null:globalThis.merchantOwnApplicationForInvite?.()||null;
  const ownSelector=!prospectInvite&&!pilotInvite&&ownApplications.length
    ?'<div class="card flat form-stack" style="margin-bottom:14px"><label for="merchant-existing-application">Escolha a empresa que deseja cadastrar ou revisar</label>'+
      '<select id="merchant-existing-application" class="input" onchange="merchantPickOwnApplicationFromUi(this.value)">'+
      ownApplications.map(a=>'<option value="'+esc(a.id)+'"'+(!newApplication&&a.id===ownApplication?.id?' selected':'')+'>'+
        esc(a.company_name||'Empresa')+' — '+esc(a.status==='approved'?'aprovada':a.status==='rejected'?'corrigir cadastro':'em análise')+
        '</option>').join('')+
      '<option value="__new__"'+(newApplication?' selected':'')+'>Cadastrar outra empresa</option></select>'+
      '<small class="muted">Cada CNPJ tem seu próprio cadastro. A autorização de vendas é separada.</small></div>'
    :'';
  const ownStatus=String(ownApplication?.status||'');
  const ownNotice=ownStatus==='pending'
    ?'<div class="notice" style="margin-bottom:14px"><strong>Cadastro já recebido.</strong> '+esc(ownApplication.company_name||'Sua empresa')+' está aguardando análise. Você pode revisar e atualizar os dados sem abrir outro cadastro.</div>'
    :ownStatus==='rejected'
      ?'<div class="notice" style="margin-bottom:14px"><strong>Cadastro precisa de correção.</strong> Confira os dados e reenvie para nova análise.</div>'
      :ownStatus==='approved'
        ?'<div class="notice success" style="margin-bottom:14px"><strong>Cadastro aprovado.</strong> O recebimento de pedidos exige outras validações operacionais.</div>'
        :'';
  const prefillCnpj=String(prospectDetails?.cnpj||ownApplication?.cnpj||'');
  const prefillCompany=String(ownApplication?.company_name||prospectDetails?.companyName||'');
  return shell(`<section class="page"><button class="back" onclick="go('merchants')">← Para revendas</button><h1 class="page-title">Sua empresa tem lugar no TAMÃO.</h1><p class="muted">${globalThis.merchantPortalRequested?.()?'Conte um pouco sobre seu negócio. Nossa equipe poderá validar os dados e orientar a habilitação comercial.':'Acesse o portal de parceiros e comece o cadastro da sua empresa.'}</p>${pilotInvite?'<div class="notice success" style="margin-bottom:14px"><strong>Convite de parceiro reconhecido.</strong><br>Seus dados serão vinculados às condições comerciais já registradas. A operação continuará offline até aprovação, compliance, estoque e disponibilidade serem confirmados.</div>':''}${prospectInvite?'<div class="notice success" style="margin-bottom:14px"><strong>Convite de revenda reconhecido.</strong><br>Preencha os dados reais da empresa identificada na ANP. O cadastro será associado ao CNPJ convidado para análise, sem ativar vendas automaticamente.</div>':''}${ownSelector}${ownNotice}<form class="card flat form-stack merchant-join-form" onsubmit="event.preventDefault();joinMerchant()" novalidate><div class="merchant-join-intro"><strong>Dados da empresa</strong><small>Preencha uma única vez. Você poderá corrigir os dados enquanto o cadastro estiver em análise.</small></div><div class="field-row"><div class="input-wrap"><label for="j-cnpj">CNPJ</label><input id="j-cnpj" name="cnpj" autocomplete="off" required aria-describedby="merchant-cnpj-hint" value="${esc(prefillCnpj)}" autocapitalize="characters" maxlength="18" class="input" placeholder="00.000.000/0000-00 ou alfanumérico"><small class="field-hint" id="merchant-cnpj-hint">Informe o CNPJ real da empresa, inclusive alfanumérico quando aplicável.</small></div><div class="input-wrap"><label for="j-name">Nome da empresa</label><input id="j-name" name="organization" autocomplete="organization" required value="${esc(prefillCompany)}" maxlength="90" class="input" placeholder="Nome da revenda"></div></div><div class="merchant-join-intro"><strong>Como falar com você</strong><small>O WhatsApp será usado para assuntos do cadastro e da operação.</small></div><div class="field-row"><div class="input-wrap"><label for="j-owner">Responsável</label><input id="j-owner" name="name" autocomplete="name" required value="${esc(ownApplication?.responsible_name||'')}" maxlength="90" class="input" placeholder="Nome do responsável"></div><div class="input-wrap"><label for="j-phone">WhatsApp</label><input id="j-phone" name="tel" type="tel" autocomplete="tel" required value="${esc(ownApplication?.phone||'')}" inputmode="tel" maxlength="20" class="input" placeholder="(55) 99999-9999"></div></div><div class="merchant-join-intro"><strong>Onde fica sua empresa</strong><small>Precisamos do endereço para conferir a região de atendimento.</small></div><div class="input-wrap"><label for="j-address">Endereço</label><input id="j-address" name="street-address" autocomplete="street-address" required value="${esc(ownApplication?.address_text||'')}" maxlength="160" class="input" placeholder="Endereço da empresa"></div><div class="input-wrap"><label for="j-referral-code">Código de quem apresentou o TAMÃO (opcional)</label><input id="j-referral-code" class="input" autocomplete="off" autocapitalize="characters" maxlength="40" value="${esc(typeof growthAttributionCode==='function'?growthAttributionCode():'')}" placeholder="Código do convite"><small class="field-hint">Quando você veio por um convite, o código pode aparecer automaticamente. Ele registra a origem do cadastro; benefícios dependem de validações e campanhas ativas.</small></div><button class="primary" type="submit" ${ownStatus==='approved'?'disabled title="Empresa já aprovada"':''}>${ownStatus==='rejected'?'Reenviar meus dados corrigidos':ownStatus==='pending'?'Salvar meus dados atualizados':'Enviar cadastro da minha empresa →'}</button><small class="merchant-join-footer">Cadastre sua empresa agora. A liberação comercial exige aprovação e as verificações próprias da categoria.</small></form></section>`)
}
function onlyDigits(v){return String(v||'').replace(/\D/g,'')}
function isValidPhoneShape(v){
const n=onlyDigits(v);
// Brazilian local numbers have DDD + 8/9 digits; contacts copied from
// WhatsApp often add the country prefix +55. The application backend
// accepts those 12/13-digit inputs, so the browser must not reject them.
if(n.length===10||n.length===11)return /^[1-9][0-9]/.test(n);
if((n.length===12||n.length===13)&&n.startsWith('55'))
return /^[1-9][0-9]/.test(n.slice(2));
return false;
}
function merchantJoinInvalid(id,message){
const input=document.getElementById(id);
if(input){input.setAttribute('aria-invalid','true');input.focus();}
return toast(message);
}
async function joinMerchant(){
  const cnpj=document.querySelector('#j-cnpj')?.value.trim()||'';
  const name=document.querySelector('#j-name')?.value.trim()||'';
  const owner=document.querySelector('#j-owner')?.value.trim()||'';
  const phone=document.querySelector('#j-phone')?.value.trim()||'';
  const address=document.querySelector('#j-address')?.value.trim()||'';
  const referralCode=String(document.querySelector('#j-referral-code')?.value||'')
    .trim().toUpperCase();
  if(!isValidCnpjShape(cnpj))return merchantJoinInvalid('j-cnpj','Informe um CNPJ válido no formato atual');
  if(name.length<2)return merchantJoinInvalid('j-name','Informe o nome da empresa');
  if(owner.length<2)return merchantJoinInvalid('j-owner','Informe o nome do responsável');
  if(!isValidPhoneShape(phone))return merchantJoinInvalid('j-phone','Informe um WhatsApp válido com DDD');
  if(address.length<5)return merchantJoinInvalid('j-address','Informe o endereço da empresa');
  if(referralCode&&!/^[A-Z0-9]{5,40}$/.test(referralCode))
    return merchantJoinInvalid('j-referral-code','Confira o código de indicação.');
  document.querySelectorAll('.merchant-join-form [aria-invalid="true"]').forEach(el=>el.removeAttribute('aria-invalid'));


  if(globalThis.merchantPortalRequested?.()){
    if(!globalThis.merchantRuntime?.session?.access_token)return toast('Entre com seu e-mail antes de enviar o cadastro');
    const submitBtn=document.querySelector('.merchant-join-form button[type="submit"]');
    if(submitBtn?.dataset.submitting==='true')return;
    const previousLabel=submitBtn?.textContent||'';
    if(submitBtn){submitBtn.dataset.submitting='true';submitBtn.disabled=true;submitBtn.textContent='Enviando cadastro…';}
    try{
      const prospectInviteToken=currentMerchantProspectInviteToken();
      const pilotInviteToken=prospectInviteToken?'':currentMerchantPilotInviteToken();
      const result=await merchantSubmitApplicationLive({
        cnpj,
        companyName:name.slice(0,90),
        responsibleName:owner.slice(0,90),
        phone,
        address:address.slice(0,160),
        ...(referralCode?{referralCode}:{}),
        ...(pilotInviteToken?{pilotInviteToken}:{}),
        ...(prospectInviteToken?{prospectInviteToken}:{})
      });
      toast(result?.growthReferral?.recorded===true
        ?'Cadastro recebido. A origem do convite foi registrada para análise.'
        :result?.prospectInvite?.linked?'Convite vinculado. Cadastro enviado para análise'
        :result?.pilotPartner?.pilotPartnerName?'Cadastro vinculado e enviado para análise'
        :'Cadastro enviado para análise');
      if(globalThis.merchantRuntime){
        globalThis.merchantRuntime.newApplicationMode=false;
        globalThis.merchantRuntime.selectedApplicationId=String(result?.applicationId||'')||null;
      }
      if(result?.pilotPartner)clearCurrentMerchantPilotInviteToken();
      if(result?.prospectInvite?.linked)clearCurrentMerchantProspectInviteToken();
      globalThis.merchantRuntime.notice=result?.pilotPartner?.pilotPartnerName
        ? 'Cadastro vinculado ao parceiro '+String(result.pilotPartner.pilotPartnerName)+'. Aguarde a aprovação e as validações operacionais.'
        : 'Cadastro '+String(result?.companyName||name)+' recebido. Aguarde a validação e o vínculo da operação.';
      go('merchant');
      render();
      return;
    }catch(e){
      toast(String(e?.message||e));
      return;
    }finally{
      if(submitBtn){submitBtn.dataset.submitting='false';submitBtn.disabled=false;submitBtn.textContent=previousLabel;}
    }
  }

  if(globalThis.__CHAMA_TEST__!==true){
    openMerchantPortal();
    return;
  }

  const normalized=normalizeCnpj(cnpj);
  if(state.onboarding.some(x=>normalizeCnpj(x.cnpj)===normalized))return toast('Este CNPJ já foi enviado para análise');
  state.onboarding.push({cnpj:normalized,name:name.slice(0,90),owner:owner.slice(0,90),phone:onlyDigits(phone),address:address.slice(0,160),status:'Em análise',createdAt:nowIso()});
  save();toast('Cadastro enviado para análise');go('merchants');
}
