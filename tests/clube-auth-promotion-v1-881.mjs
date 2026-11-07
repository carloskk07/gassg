import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const backend=read('js/backend.js'),growth=read('js/growth.js'),module=read('js/clube-coupon-shop.js');
assert.ok(backend.includes("if(session.user.email_confirmed_at){"),
 'Upgrade cannot mark an email-pending account permanent');
assert.ok(backend.includes('if(liveRuntime.status===\'ready\'&&liveRuntime.session?.user?.id&&'),
 'Original account-switch isolation is preserved');
assert.ok(growth.includes('globalThis.clubeCouponWatchAuth?.()'),
 'Club retries attaching the listener after customer Auth boot');

const start=module.indexOf('let clubeCouponAuthClient=null;');
const end=module.indexOf('\nclubeCouponWatchAuth();',start);
assert.ok(start>=0&&end>start,'Deferred account watcher exists');
let callback=null,registers=0,draws=0,forget=0;
let currentRoute='club';
const verified={id:'buyer-id',email:'cliente@example.com',is_anonymous:false,email_confirmed_at:'2026-11-07T20:00:00Z'};
const anon={id:'buyer-id',is_anonymous:true,email:null,email_confirmed_at:null};
const pending={...verified,email_confirmed_at:null};
const rt={status:'ready',session:{user:anon,access_token:'anon-token'},
  client:{auth:{onAuthStateChange:fn=>{registers++;callback=fn;}}}};
const ctx=vm.createContext({globalThis:{liveRuntime:rt},route:()=>currentRoute,render:()=>draws++,Promise});
vm.runInContext(module.slice(start,end)+'\nthis.watch=clubeCouponWatchAuth;',ctx);
ctx.watch();
ctx.watch();
assert.equal(registers,1,'Only one listener per Supabase client');
callback('USER_UPDATED',{user:pending,access_token:'pending-token'});
assert.equal(draws,0);
assert.equal(rt.session.user.email_confirmed_at,null);
callback('SIGNED_IN',{user:verified,access_token:'verified-token'});
await Promise.resolve();
assert.equal(draws,1,'Verified customer automatically sees coupon checkout');
assert.equal(rt.session.access_token,'verified-token');
callback('TOKEN_REFRESHED',{user:verified,access_token:'fresh-token'});
await Promise.resolve();
assert.equal(draws,1,'Ordinary refresh cannot rerender Club repeatedly');
assert.equal(rt.session.access_token,'fresh-token');
currentRoute='home';
rt.session={user:anon,access_token:'new-anon'};
callback('SIGNED_IN',{user:verified,access_token:'verified-token'});
await Promise.resolve();
assert.equal(draws,1,'Do not redraw unrelated routes');
rt.session={user:verified,access_token:'verified-token'};
callback('SIGNED_OUT',null);
assert.equal(rt.session.user.id,'buyer-id','Primary account isolation handler owns sign-out');
rt.session={user:verified,access_token:'verified-token'};
callback('SIGNED_IN',{user:{...verified,id:'other-user'},access_token:'bad'});
assert.equal(rt.session.user.id,'buyer-id','No cross-account promotion in coupon observer');

const clStart=growth.indexOf('function club(){'),clEnd=growth.indexOf('\n  if(!member)',clStart);
assert.ok(clStart>=0&&clEnd>clStart);
const scope={globalThis:{__CHAMA_TEST__:false,liveReady:()=>true,document:null,liveRuntime:rt,
  clubeCouponWatchAuth:()=>{}},shell:html=>html,render:()=>{},console};
vm.runInNewContext(growth.slice(clStart,clEnd)+'\n  return member;\n}',scope);
vm.runInNewContext('this.getClub=club;',scope);
rt.session={user:pending,access_token:'pending'};
assert.equal(scope.getClub(),false,'Unverified account is not a buyer');
rt.session={user:anon,access_token:'anon'};
assert.equal(scope.getClub(),false,'Anonymous session is not a buyer');
rt.session={user:verified,access_token:'confirmed'};
assert.ok(scope.getClub(),'Verified buyer sees the private Club');
console.log('TAMÃO V1.881: pending -> confirmed signup and account isolation audited.');
