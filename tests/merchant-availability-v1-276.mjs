import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const js=read('js/merchant.js'),css=read('css/components.css');
const backend=read('js/backend.js'),audit=read('.github/workflows/audit.yml');
new vm.Script(js,{filename:'js/merchant.js'});
const take=name=>{
  const i=js.indexOf('function '+name+'(');
  assert.ok(i>=0,'missing '+name);
  const j=js.indexOf('\n}',i);
  assert.ok(j>i,'unterminated '+name);
  return js.slice(i,j+2);
};
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
const formatted=x=>'R$ '+Number(x).toFixed(2);
const role={merchantId:'merchant-1',memberRole:'owner',online:false,deliveryFeeCents:899,
 acceptsCitywide:true};
const ctxState={merchant:role,actionPending:false,catalog:[
 {productCode:'P13',active:true,availableStock:12},
 {productCode:'A20',active:true,availableStock:3},
 {productCode:'I1',active:false,availableStock:50}]};
const actions=[],opened=[],messages=[];
const ctx=vm.createContext({esc,BRL:{format:formatted},globalThis:{merchantRuntime:ctxState},
 go:key=>actions.push(key),
 merchantRevealControl:selector=>{opened.push(selector);return true;},
 toast:value=>messages.push(String(value))});
vm.runInContext(take('merchantTimestampFresh')+'\n'+take('merchantQuickCatalogCandidates')+'\n'+take('merchantAvailabilityGo')+'\n'+take('merchantAvailabilityPanel')+
 ';this.draw=merchantAvailabilityPanel;this.open=merchantAvailabilityGo;',ctx);
const opts={canGoOnline:true,connectionHealthy:true,financialHold:false,
 freshness:{deliveryFresh:true},p13:ctxState.catalog[0],orderCount:4};
let html=ctx.draw(ctxState,opts);
assert.match(html,/Revenda online|Novas ofertas pausadas/);
assert.match(html,/Novas ofertas pausadas/);
assert.match(html,/Ficar online/);
assert.match(html,/Estoque P13/);
assert.match(html,/12<\/strong>/);
assert.match(html,/2 produtos com estoque/);
assert.match(html,/R\$ 8\.99/);
assert.match(html,/Pedidos na fila/);
assert.match(html,/4<\/strong>/);
assert.match(html,/Ajustar estoque e preços/);
assert.match(html,/Ajustar entregas/);
assert.equal((html.match(/id="merchant-online-toggle"/g)||[]).length,1);
assert.match(html,/merchantLiveToggleOnline\(true\)/);
assert.doesNotMatch(html,/<button[^>]*disabled[^>]*>Ficar online/);
assert.equal(ctx.open('stock'),true);
assert.deepEqual(actions,['catalog']);
assert.equal(ctx.open('delivery'),true);
assert.deepEqual(opened,['#live-delivery-fee']);
assert.equal(ctx.open('payment'),false);
assert.equal(actions.length,1);

const blocked=ctx.draw(ctxState,{...opts,canGoOnline:false});
assert.match(blocked,/merchant-online-toggle"[^>]*disabled/);
assert.match(blocked,/Antes de ficar online/);
const financial=ctx.draw(ctxState,{...opts,canGoOnline:false,financialHold:true});
assert.match(financial,/Regularize o fechamento financeiro vencido/);
assert.match(financial,/merchant-online-toggle"[^>]*disabled/);
ctxState.merchant.online=true;
html=ctx.draw(ctxState,{...opts,financialHold:true});
assert.match(html,/Novas vendas suspensas por pendência financeira/);
assert.match(html,/Pausar novos pedidos/);
assert.doesNotMatch(html,/id="merchant-online-toggle"[^>]*disabled/);
assert.match(html,/merchantLiveToggleOnline\(false\)/);
assert.doesNotMatch(html,/Recebendo novas ofertas/);
html=ctx.draw(ctxState,{...opts,connectionHealthy:false});
assert.match(html,/Conexão sem confirmação recente/);
assert.doesNotMatch(html,/Revenda online/);
ctxState.actionPending=true;
assert.match(ctx.draw(ctxState,opts),/merchant-online-toggle"[^>]*disabled/);
assert.match(ctx.draw(ctxState,opts),/Atualizando…/);
ctxState.actionPending=false;
ctxState.merchant.online=false;

ctxState.merchant.memberRole='operator';
html=ctx.draw(ctxState,opts);
assert.match(html,/Ficar online/);
assert.doesNotMatch(html,/Ajustar estoque e preços|Ajustar entregas/);
assert.equal(ctx.open('stock'),false);
assert.equal(ctx.open('delivery'),false);
ctxState.merchant.memberRole='driver';
assert.equal(ctx.draw(ctxState,opts),'');
ctxState.merchant.memberRole='guest';
assert.equal(ctx.draw(ctxState,opts),'');
ctxState.merchant.memberRole='manager';
assert.match(ctx.draw(ctxState,opts),/Ajustar entregas/);
ctxState.merchant.memberRole='owner';

ctxState.catalog=[{productCode:'I1',active:false,availableStock:50}];
html=ctx.draw(ctxState,{...opts,p13:null});
assert.match(html,/0 produtos com estoque/);
assert.match(html,/Estoque P13<\/span><strong>—/);
ctxState.merchant.deliveryFeeCents=NaN;
assert.match(ctx.draw(ctxState,{...opts,p13:null}),/Não informado/);
ctxState.merchant.deliveryFeeCents=899;
ctxState.merchant.acceptsCitywide=false;
assert.match(ctx.draw(ctxState,opts),/Atendimento na cidade desativado/);
ctxState.merchant.acceptsCitywide=true;
assert.match(ctx.draw(ctxState,{...opts,freshness:{deliveryFresh:false}}),/Taxa de entrega precisa de confirmação/);

// Exactly one online control in the live portal, above the order list; no role elevation or duplicate backend path.
assert.equal((js.match(/id="merchant-online-toggle"/g)||[]).length,1);
const liveStart=js.indexOf('function merchantLivePage(');
const live=js.slice(liveStart,js.indexOf('\nfunction merchantScheduledDispatchState(',liveStart));
assert.ok(live.indexOf('merchantAvailabilityPanel(rt,')<live.indexOf('merchantDailyOverview(rt,orders)'));
assert.ok(live.indexOf('merchantAvailabilityPanel(rt,')<live.indexOf('merchant-live-orders'));
assert.match(js,/function merchantAvailabilityGo\(key\)/);
assert.match(js,/merchantRevealControl\('#live-delivery-fee'\)/);
assert.match(backend,/async function merchantSetOnlineLive\(online\)/);
assert.match(backend,/action:'set-online',online:online===true/);
assert.match(backend,/action:'update-product'/);
assert.match(backend,/actionPending=true;render\(\)/);
assert.match(css,/\.merchant-availability-stats/);
assert.match(css,/@media\(max-width:600px\)/);
assert.match(css,/@media\(max-width:360px\)/);
assert.match(audit,/node tests\/merchant-availability-v1-276.mjs/);
console.log('V1.276 PASS — one availability control, protected shortcuts, roles, blocked-state truth and mobile layout.');
