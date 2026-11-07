import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../js/backend.js',import.meta.url),'utf8');
const marker="    client.auth.onAuthStateChange((_event,next)=>{";
const start=source.indexOf(marker);
const closing='\n    });';
const end=source.indexOf(closing,start)+closing.length;
assert.ok(start>0&&end>start,'Auth listener must exist');
const listener=source.slice(start,end);
const upgradeStart=source.indexOf('async function liveUpgradeAccount(');
const upgradeEnd=source.indexOf('\n}',upgradeStart)+2;
assert.ok(upgradeStart>0&&upgradeEnd>upgradeStart);
assert.ok(source.slice(upgradeStart,upgradeEnd).includes('!session.user.email_confirmed_at'),
 'Pending unverified account must not be marked permanent');

let callback;
const registered={id:'test-account',is_anonymous:false,email:'buyer@example.com',email_confirmed_at:'2026-11-07T20:00:00Z'};
const anonymous={id:registered.id,is_anonymous:true,email:null,email_confirmed_at:null};
const pending={...registered,email_confirmed_at:null};
const runtime={status:'ready',session:{user:anonymous,access_token:'old'}};
let draws=0,forget=0,current='club';
const ctx=vm.createContext({
 client:{auth:{onAuthStateChange:fn=>{callback=fn}}},
 liveRuntime:runtime,liveForgetAccount:()=>{forget++;runtime.session=null;runtime.status='loading'},
 route:()=>current,render:()=>draws++,Promise,Boolean
});
vm.runInContext(listener,ctx);
assert.equal(typeof callback,'function');
const change=(event,user,token='new')=>callback(event,user?{user,access_token:token}:null);
change('USER_UPDATED',pending);
assert.equal(draws,0,'No redraw until email is confirmed');
assert.equal(runtime.session.user.email_confirmed_at,null);
change('SIGNED_IN',registered);
assert.equal(runtime.session.user.email_confirmed_at,registered.email_confirmed_at);
await Promise.resolve();
assert.equal(draws,1,'Confirmed customer gains Club checkout without a reload');
change('TOKEN_REFRESHED',registered,'fresh-token');
await Promise.resolve();
assert.equal(draws,1,'Token refresh does not redraw the page');
assert.equal(runtime.session.access_token,'fresh-token');
change('SIGNED_OUT',null);
assert.equal(forget,1,'Sign out still clears scoped data');
assert.equal(runtime.session,null);
runtime.status='ready';runtime.session={user:anonymous,access_token:'x'};
current='home';change('SIGNED_IN',registered);
await Promise.resolve();
assert.equal(draws,1,'No unrelated navigation render');
runtime.session={user:registered,access_token:'x'};
change('SIGNED_IN',{id:'another-user',email_confirmed_at:'yes',is_anonymous:false});
assert.equal(forget,2,'Account switches still isolate privacy');
console.log('TAMÃO V1.881 — confirmed registration opens Club without losing isolation.');
