import fs from 'node:fs';
import http from 'node:http';

// Shared synthetic fixture for desktop Chromium and Android-emulator Chrome.
// Only the REAL offline-delivery JS and service worker are read from the PR.
// No Supabase credentials, external network or commercial data.
export const USER='11111111-1111-4111-8111-111111111111';
const OTHER='99999999-9999-4999-8999-999999999999';
const MERCHANT='22222222-2222-4222-8222-222222222222';
export const ORDER='33333333-3333-4333-8333-333333333333';
const moduleSource=fs.readFileSync(new URL('../js/merchant-offline-delivery.js',import.meta.url));
const realServiceWorker=fs.readFileSync(new URL('../sw.js',import.meta.url));
const fixture=[
'<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width">',
'<h1>Teste isolado do entregador</h1><div id="merchant-offline-receipts"></div>',
'<article class="merchant-driver-local-card">',
'<input id="live-pin-',ORDER,'" value="6789"><input id="live-paid-',ORDER,'" type="checkbox" checked>',
'<div id="live-delivery-guide-',ORDER,'">A entrega continuará pendente no servidor.</div>',
'<button id="live-deliver-submit-',ORDER,'">Guardar comprovante (pendente)</button>',
'</article><button id="stage">Guardar comprovante</button><script>',
'const U1=',JSON.stringify(USER),',U2=',JSON.stringify(OTHER),',M=',JSON.stringify(MERCHANT),',O=',JSON.stringify(ORDER),';',
'globalThis.events=[];globalThis.toast=m=>events.push({type:"toast",text:String(m)});globalThis.confirm=()=>true;',
'globalThis.esc=x=>String(x||"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");',
'const cold=sessionStorage.getItem("tamao-synthetic-cold")==="1"||!new URLSearchParams(location.search).has("seed");',
'const savedAuth=sessionStorage.getItem("tamao-synthetic-auth");',
'const auth=cold?JSON.parse(savedAuth||"null"):{access_token:"SYNTHETIC-ONLY",expires_at:Math.floor(Date.now()/1000)+3600,user:{id:U1}};',
'globalThis.merchantRuntime={status:cold?"unavailable":"ready",session:auth,',
'selectedMerchantId:M,merchant:cold?null:{merchantId:M,memberRole:"driver"},lastSyncAt:cold?null:new Date().toISOString(),',
'orders:cold?[]:[{orderId:O,publicCode:"SIM-01",status:"OUT_FOR_DELIVERY",version:3,assignedDeliveryUserId:U1,addressVisible:true,address:"Rua Fictícia, 123"}],recentClosedDeliveries:[]};',
'globalThis.merchantDeliveryConfirmationState=id=>{const pin=document.getElementById("live-pin-"+id).value;',
'const paid=document.getElementById("live-paid-"+id).checked;return {pin,paid,pinReady:/^[0-9]{4}$/.test(pin),ready:paid&&/^[0-9]{4}$/.test(pin)}};',
'globalThis.failServer=false;globalThis.merchantRefresh=async()=>{events.push({type:"refresh"});',
'merchantRuntime.status="ready";merchantRuntime.lastSyncAt=new Date().toISOString();',
'merchantRuntime.recentClosedDeliveries=merchantRuntime.orders.filter(o=>["DELIVERED","SETTLED"].includes(o.status)).map(o=>({orderId:o.orderId,status:o.status,version:o.version,assignedDeliveryUserId:o.assignedDeliveryUserId}));',
'return {merchant:merchantRuntime.merchant,orders:merchantRuntime.orders,recentClosedDeliveries:merchantRuntime.recentClosedDeliveries}};',
'globalThis.merchantPerformAction=async(id,action)=>{events.push({type:"arrive",id,action});',
'if(action!=="arriving")throw Error("INVALID_ACTION");merchantRuntime.orders[0].status="ARRIVING";merchantRuntime.orders[0].version++;return {ok:true,status:"ARRIVING"}};',
'globalThis.merchantCompleteDeliveryLive=async(id,pin,paid,key)=>{events.push({type:"send",id,pinMatched:pin==="6789",paid,key});',
'if(failServer)throw Error("Synthetic API 503");if(pin!=="6789"||paid!==true)throw Error("PIN_INCORRECT");',
'merchantRuntime.orders[0].status="DELIVERED";merchantRuntime.orders[0].version++;await merchantRefresh();return {ok:true,status:"DELIVERED"}};',
'</script><script src="/js/merchant-offline-delivery.js"></script></html>'
].join('');
export function createOfflineFixtureServer(){return http.createServer((req,res)=>{
 if(req.url==='/js/merchant-offline-delivery.js'){res.writeHead(200,{'Content-Type':'application/javascript'});res.end(moduleSource)}
 else if(req.url==='/sw.js'){res.writeHead(200,{'Content-Type':'application/javascript','Service-Worker-Allowed':'/'});res.end(realServiceWorker)}
 else if(req.url==='/'||req.url==='/index.html'||req.url==='/?seed=1'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(fixture)}
 else{res.writeHead(200,{'Content-Type':'application/octet-stream'});res.end('/* synthetic asset for the actual service-worker precache */')}
});}
