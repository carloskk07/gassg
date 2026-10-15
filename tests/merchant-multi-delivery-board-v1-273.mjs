import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const src=read('js/merchant.js');
const css=read('css/components.css');
const audit=read('.github/workflows/audit.yml');
new vm.Script(src,{filename:'merchant.js'});
const extract=name=>{
 const a=src.indexOf('function '+name+'(');
 assert.ok(a>=0,'missing function '+name);
 const b=src.indexOf('\n}',a);
 assert.ok(b>a,'missing close '+name);
 return src.slice(a,b+2);
};
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
const ctx=vm.createContext({esc,Date,globalThis:{}});
vm.runInContext([
 'merchantOrderScheduleDate','merchantOrderAttention','merchantDeliveryShortcuts',
 'merchantDeliveryBoardModel','merchantDeliveryBoardView'
].map(extract).join('\n'),ctx);

const now=Date.now(),offset=m=>new Date(now+m*60000).toISOString();
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const mk=(n,status,extra={})=>({orderId:id(n),publicCode:'TAM-'+n,status,...extra});
const arriving=mk(1,'ARRIVING',{promisedBy:offset(45)});
const routeLate=mk(2,'OUT_FOR_DELIVERY',{promisedBy:offset(-15)});
const routeSoon=mk(3,'OUT_FOR_DELIVERY',{promisedBy:offset(10)});
const routeFuture=mk(4,'OUT_FOR_DELIVERY',{promisedBy:offset(60)});
const routeNoEta=mk(5,'OUT_FOR_DELIVERY');
const unoffered=mk(6,'OFFERED_TO_MERCHANT');
const prepared=mk(7,'PREPARING');

const all=[routeNoEta,routeFuture,prepared,routeSoon,arriving,routeLate,unoffered];
const sorted=ctx.merchantDeliveryBoardModel(all,now);
assert.equal(sorted.length,5);
assert.deepEqual(Array.from(sorted,x=>x.orderId),[
 arriving,routeLate,routeSoon,routeFuture,routeNoEta].map(x=>x.orderId));
assert.deepEqual(all[0],routeNoEta,'must not mutate server-owned input');
const rt={merchant:{memberRole:'owner'}};
assert.equal(ctx.merchantDeliveryBoardView(rt,[arriving]),'','single order uses existing focus');
assert.equal(ctx.merchantDeliveryBoardView(rt,[unoffered,prepared]),'');
const html=ctx.merchantDeliveryBoardView(rt,all);
assert.match(html,/5 entregas em andamento/);
assert.match(html,/1 aguardando conferência/);
assert.match(html,/Ver fila completa/);
assert.ok(html.indexOf('TAM-1')<html.indexOf('TAM-2'));
assert.ok(html.indexOf('TAM-2')<html.indexOf('TAM-3'));
assert.ok(!html.includes('TAM-6')&&!html.includes('TAM-7'));
assert.equal((html.match(/merchant-delivery-board-row/g)||[]).length,5);
assert.match(html,new RegExp("merchantFocusLiveOrder\\('"+arriving.orderId+"'\\)"));
assert.doesNotMatch(html,/merchantLiveAction|merchantLiveDeliver|merchantPerformAction|merchantCompleteDelivery/);
assert.doesNotMatch(html,/href="tel:|google\.com\/maps/,'unauthorized delivery data must not leak');
assert.equal(ctx.merchantDeliveryBoardView({merchant:{memberRole:'guest'}},all),'');
assert.match(ctx.merchantDeliveryBoardView({merchant:{memberRole:'driver'}},[routeLate,arriving]),/2 entregas em andamento/);
const authorized=mk(8,'OUT_FOR_DELIVERY',{
 address:'Rua central, 123 - São Gabriel, RS',addressVisible:true,deliveryDetailsVisible:true,
 customerPhone:'51999887766'
});
const withAuthorized=ctx.merchantDeliveryBoardView(rt,[authorized,arriving]);
assert.match(withAuthorized,/Google Maps|Abrir rota/);
assert.match(withAuthorized,/tel:\+5551999887766/);
const noDetails=ctx.merchantDeliveryBoardView(rt,[{...authorized,deliveryDetailsVisible:false},arriving]);
assert.doesNotMatch(noDetails,/google\.com\/maps|tel:\+55/);
const badId=mk(9,'OUT_FOR_DELIVERY',{orderId:"x');alert(1)//",publicCode:'<svg onload=alert(1)>'});
const safe=ctx.merchantDeliveryBoardView(rt,[arriving,badId]);
assert.match(safe,/&lt;svg onload=alert\(1\)&gt;/);
assert.doesNotMatch(safe,/<svg|alert\(1\)\/\//);
assert.equal((safe.match(/merchantFocusLiveOrder/g)||[]).length,1);
const expanded=ctx.merchantDeliveryBoardView(rt,Array.from({length:9},(_,i)=>mk(i+1,'OUT_FOR_DELIVERY')));
assert.equal((expanded.match(/merchant-delivery-board-row/g)||[]).length,6);
assert.match(expanded,/Mais 3 entrega\(s\) disponíveis na fila completa/);
const live=src.slice(src.indexOf('function merchantLivePage('),src.indexOf('\nfunction merchantScheduledDispatchState(',src.indexOf('function merchantLivePage(')));
assert.ok(live.indexOf('merchantDailyOverview(rt,orders)')<live.indexOf('merchantDeliveryBoardView(rt,orders)'),'V1.282 positions the daily focus ahead of the delivery board');
assert.ok(live.indexOf('merchantDeliveryBoardView(rt,orders)')<live.indexOf('merchant-live-orders'),'delivery board still precedes order cards');
assert.match(css,/\.merchant-delivery-board-row/);
assert.match(css,/@media\(max-width:700px\)/);
assert.match(audit,/node tests\/merchant-multi-delivery-board-v1-273.mjs/);
console.log('V1.273 PASS: multiple deliveries prioritized, role-scoped, privacy-safe and read-only with direct navigation.');
