import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const merchant=read('js/merchant.js'),growth=read('js/growth.js');
const css=read('css/components.css');
for(const [name,src] of Object.entries({merchant,growth}))new vm.Script(src,{filename:name+'.js'});
function functionBody(source,name){
 const start=source.indexOf('function '+name+'(');
 const end=source.indexOf('\n}',start);
 assert.ok(start>=0&&end>start,'function unavailable: '+name);
 return source.slice(start,end+2);
}
const orientSource=functionBody(merchant,'merchantWorkspaceOrientation');
const ctx=vm.createContext({});
vm.runInContext(orientSource+'\nthis.model=merchantWorkspaceOrientation',ctx);
const model=(role='owner',options={})=>ctx.model({merchant:{memberRole:role,online:true}},options);
const order={orderId:'00000000-0000-4000-8000-000000000001',status:'PREPARING'};
assert.equal(model('owner',{canGoOnline:true,connectionHealthy:true,orders:[order]}).action,'orders');
assert.match(model('owner',{canGoOnline:true,connectionHealthy:true,orders:[order]}).detail,/1 pedido/);
assert.equal(model('owner',{financialHold:true,orders:[order]}).action,'orders',
 'previously accepted orders retain priority even while new sales are suspended');
assert.equal(model('owner',{financialHold:true}).action,'finance');
assert.equal(model('operator',{financialHold:true}).action,'start','operator does not get financial shortcut');
assert.equal(model('owner',{canGoOnline:false}).action,'setup');
assert.equal(model('operator',{canGoOnline:false}).action,'start');
assert.equal(model('owner',{canGoOnline:true,connectionHealthy:false}).title,'Confira sua conexão');
assert.equal(ctx.model({merchant:{memberRole:'owner',online:false}},
 {canGoOnline:true,connectionHealthy:true}).title,'Novos pedidos pausados');
assert.equal(model('owner',{canGoOnline:true,connectionHealthy:true}).tone,'ready');
assert.ok(!orientSource.includes('merchantLiveToggleOnline')&&!orientSource.includes('merchantLiveAction')
 &&!orientSource.includes('merchantLiveDeliver')&&!orientSource.includes('adminSetMerchantStatus'),
 'orientation may navigate only, never mutate merchant/admin state');
for(const state of [
 model('owner',{canGoOnline:true,connectionHealthy:true}),
 model('owner',{orders:[order],financialHold:true}),
 model('operator',{financialHold:true}),
 model('operator',{canGoOnline:false})
]){
 assert.ok(['orders','start','setup','finance'].includes(state.action));
 assert.ok(state.label.length>5&&state.detail.length>10);
}
const page=merchant.slice(merchant.indexOf('function merchantLivePage(){'),
 merchant.indexOf('\nfunction merchantScheduledDispatchState('));
assert.ok(page.includes('merchantWorkspaceOrientation(rt,'));
assert.ok(page.includes('orientationMarkup'));
assert.ok(page.includes('merchant-workspace-readonly'));
assert.ok(page.includes('merchant-shortcut-growth'));
assert.ok(page.includes("${manage?'<button type=\"button\" class=\"merchant-workspace-shortcut merchant-shortcut-growth\""));
assert.ok(page.includes("merchantWorkspaceJump(\\'finance\\')"));
assert.ok(page.includes('h2 tabindex="-1">Pedidos que exigem ação'));
assert.ok(page.indexOf('merchantAvailabilityPanel(rt,')<page.indexOf('merchantDailyOverview(rt,orders)'));
assert.ok(page.indexOf('merchantDailyOverview(rt,orders)')<page.indexOf('merchantOrderQueueView(orders)'));
let scrolled=false,focused=false;
const heading={focus(opts){focused=opts?.preventScroll===true}};
const orderSection={tagName:'SECTION',
 querySelector:key=>key==='h2'?heading:null,
 scrollIntoView:()=>{scrolled=true}};
const focusContext=vm.createContext({document:{getElementById:id=>id==='merchant-live-orders'?orderSection:null},
 matchMedia:()=>({matches:true})});
vm.runInContext(functionBody(merchant,'merchantWorkspaceJump')+'\nthis.jump=merchantWorkspaceJump;',focusContext);
assert.equal(focusContext.jump('orders'),true);
assert.equal(scrolled,true);assert.equal(focused,true);
assert.equal(focusContext.jump('unknown'),false);
const earn=growth.slice(growth.indexOf('function earn(){'),growth.indexOf('\nfunction ',growth.indexOf('function earn(){')+15));
assert.match(earn,/tamao-network-hero/);
assert.match(earn,/tamao-network-illustration/);
assert.match(earn,/Atribuições e recompensas dependem das condições/);
assert.match(earn,/go\('refer'\)/);
assert.match(earn,/go\('club'\)/);
assert.match(earn,/go\('merchants'\)/);
assert.doesNotMatch(earn,/renda garantida|clientes garantidos/i);
for(const selector of ['.merchant-workspace-orientation','.merchant-workspace-identity',
 '.merchant-shortcut-growth','.tamao-network-hero','.tamao-network-illustration',
 '@media(max-width:540px)','prefers-reduced-motion'])
 assert.ok(css.includes(selector),'missing accessible responsive style: '+selector);
console.log('TAMÃO V1.348 PASS — role-aware merchant next step, safe navigation and network hero.');
