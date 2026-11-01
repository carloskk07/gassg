import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const rider='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const one='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const two='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const notifications=[];
const doc={visibilityState:'visible',querySelector:()=>null,
 createElement:()=>({}),head:{appendChild(){}},
 addEventListener:()=>{},getElementById:()=>null};
function MobileNotification(){throw new TypeError('Notification constructor unavailable on Android')}
MobileNotification.permission='granted';
MobileNotification.requestPermission=async()=> 'granted';
const registration={active:{state:'activated'},async showNotification(title,options){
 notifications.push({title,options});
}};
const worker={controller:{},getRegistration:async()=>registration};
const ctx={console,URL,URLSearchParams,Date,document:doc,
 navigator:{serviceWorker:worker},Notification:MobileNotification,
 location:{search:'',hash:'#mobility',origin:'https://tamao.com.br',pathname:'/'},
 route:()=> 'mobility',shell:x=>x,esc:x=>String(x),
 render:()=>{},clearInterval:()=>{},setInterval:()=>1,
 CHAMA_BACKEND:{url:'https://example.supabase.co',publishableKey:'test'},
 addEventListener:()=>{}};
ctx.globalThis=ctx;
vm.runInNewContext(read('js/mobility.js')+';this.runtime=mobilityRuntime;',ctx);
const s=ctx.runtime;s.user={id:rider};s.noticeOptIn=true;s.pendingDriverIds=[];
const pending=id=>({id,role:'driver',status:'requested',
 expires_at:new Date(Date.now()+60_000).toISOString()});
const flush=()=>new Promise(resolve=>setImmediate(resolve));

// Android: showNotification on the active worker, NOT the unsupported constructor.
ctx.mobilityNotifyNewPending([pending(one)]);
await flush();
assert.equal(notifications.length,1,'visible Android driver receives one local alert');
assert.match(notifications[0].title,/Novo pedido/);
assert.equal(notifications[0].options.data.url,'./?mobility=1#mobility');
assert.equal(notifications[0].options.tag,'tamao-mobility-pending');
assert.doesNotMatch(JSON.stringify(notifications),new RegExp(one+'|origem|destino|latitude|longitude'));
ctx.mobilityNotifyNewPending([pending(one)]);
await flush();
assert.equal(notifications.length,1,'same pending request cannot notify twice');

// An asynchronous getRegistration must not fire after logout/account change.
let release;
worker.getRegistration=()=>new Promise(resolve=>{release=resolve});
s.pendingDriverIds=[];
ctx.mobilityNotifyNewPending([pending(two)]);
s.sessionEpoch++;s.user={id:other};s.pendingDriverIds=null;
release(registration);await flush();
assert.equal(notifications.length,1,'stale account cannot show a private request alert');
s.user={id:rider};s.noticeOptIn=true;s.pendingDriverIds=[];
worker.getRegistration=async()=>registration;
doc.visibilityState='hidden';
ctx.mobilityNotifyNewPending([pending(two)]);
await flush();
assert.equal(notifications.length,1,'hidden tab does not synthesize a push');
doc.visibilityState='visible';
MobileNotification.permission='denied';s.pendingDriverIds=[];
ctx.mobilityNotifyNewPending([pending(two)]);
await flush();
assert.equal(notifications.length,1,'denied permission does not notify');
MobileNotification.permission='granted';

// Desktop fallback remains possible when no active service worker exists.
const desktop=[];
function DesktopNotification(title,options){desktop.push({title,options})}
DesktopNotification.permission='granted';
ctx.Notification=DesktopNotification;
ctx.navigator.serviceWorker=null;s.pendingDriverIds=[];
ctx.mobilityNotifyNewPending([pending(two)]);
await flush();
assert.equal(desktop.length,1,'desktop fallback remains available');
assert.equal(desktop[0].options.data.url,'./?mobility=1#mobility');

// Exercise the actual deployed worker notificationclick handler with safe routes.
const handlers={},opened=[],navigations=[];
const sw={registration:{scope:'https://tamao.com.br/'},
 clients:{matchAll:async()=>[],openWindow:async url=>{opened.push(url)}},
 addEventListener:(name,fn)=>{handlers[name]=fn},
 skipWaiting:()=>{}};
vm.runInNewContext(read('sw.js'),{self:sw,URL,console,Request,AbortController,
 caches:{},fetch:async()=>{},setTimeout,clearTimeout});
async function click(url,existing=[]){
 opened.length=0;navigations.length=0;
 sw.clients.matchAll=async()=>existing;
 let complete=null;
 handlers.notificationclick({notification:{data:{url},close(){}},
  waitUntil(p){complete=p}});
 assert.ok(complete,'notificationclick must wait for completion');
 await complete;
 return opened[0]||navigations[0]||'';
}
assert.equal(await click('./?mobility=1#mobility'),
 'https://tamao.com.br/?mobility=1#mobility');
assert.equal(await click('./?merchant=1#merchant'),
 'https://tamao.com.br/?merchant=1#merchant');
assert.equal(await click('https://evil.example/redirect'),
 'https://tamao.com.br/?merchant=1#merchant',
 'never navigate to untrusted push-supplied URLs');
let focused=0;
const existing=[{url:'https://tamao.com.br/#mobility',
 async focus(){focused++},async navigate(url){navigations.push(url)}}];
assert.equal(await click('./?mobility=1#mobility',existing),
 'https://tamao.com.br/?mobility=1#mobility');
assert.equal(focused,1,'existing mobility tab reused');
const audit=read('.github/workflows/audit.yml');
assert.match(audit,/node tests\/mobility-android-foreground-alert-v1-493\.mjs/);
console.log('PASS: Android SW foreground alerts, no duplicate/stale-account/hidden alert, desktop fallback, safe mobility click');
