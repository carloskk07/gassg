import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const migration=read('supabase/migrations/20261013210000_growth_network_foundation_v1_226.sql');
const leadEdge=read('supabase/functions/capture-prelaunch-lead/index.ts');
const merchantEdge=read('supabase/functions/merchant-ops/index.ts');
const core=read('js/core.js');
const backend=read('js/backend.js');
const growth=read('js/growth.js');
const customer=read('js/customer.js');
const merchant=read('js/merchant.js');
const bootstrap=read('js/bootstrap.js');
const audit=read('.github/workflows/audit.yml');
for(const x of [
  'growth_merchant_invites_v1_226','growth_lead_attributions_v1_226',
  'record_growth_lead_attribution_v1_226',
  'merchant_growth_network_v1_226','on conflict (lead_id) do nothing',
  "reward_eligible boolean not null default false check(reward_eligible=false)",
  "v_lead.created_at<clock_timestamp()-interval '10 minutes'",
  "m.member_role in ('owner','manager')",
  'extensions.gen_random_bytes(12)',"on conflict (merchant_id) do nothing",
  "inviter_kind in ('customer','merchant')",
  'revoke all on public.growth_merchant_invites_v1_226',
  'alter table public.growth_lead_attributions_v1_226 enable row level security',
  'grant execute on function public.record_growth_lead_attribution_v1_226(uuid,text)',
  'grant execute on function public.merchant_growth_network_v1_226(uuid,uuid)'
])assert.ok(migration.includes(x),'Missing protected network contract: '+x);
assert.ok(!/insert into public\.(commission|merchant_fee_credit|order_reward_grants)/i.test(migration));
assert.ok(!/security definer/i.test(migration));
assert.ok(leadEdge.includes('record_growth_lead_attribution_v1_226'));
assert.ok(leadEdge.includes('result?.reused!==true&&result?.replayed!==true'));
assert.ok(leadEdge.includes('referralCaptured=attribution?.recorded===true'));
assert.ok(leadEdge.includes('referralCaptured,'));
assert.ok(merchantEdge.includes('if(action==="growth-network")'));
assert.ok(merchantEdge.includes('if(!canManage(role))'));
assert.ok(merchantEdge.includes('merchant_growth_network_v1_226'));
assert.ok(merchantEdge.includes('data?.rewardEnabled!==false'));
assert.ok(backend.includes("referralCode:typeof growthAttributionCode"));
assert.ok(backend.includes("return /^TMR[A-F0-9]{24}$/.test(code)?null:code||null;"));
assert.ok(growth.includes("function tamaoGrowthInviteUrl("));
assert.ok(growth.includes("function growthNetworkIntro("));
assert.ok(growth.includes("shareTamaoGrowthInvite('merchant')"));
assert.ok(customer.includes('Indique o TAMÃO'));
assert.ok(core.includes("['earn','🤝','Indicar','go']"));
assert.ok(merchant.includes('merchantGrowthNetworkSection(m)'));
assert.ok(merchant.includes('merchantGrowthShareFromUi'));
assert.ok(bootstrap.includes('shareTamaoGrowthInvite'));
assert.ok(bootstrap.includes('merchantGrowthLoadFromUi'));
assert.ok(audit.includes('node tests/growth-network-v1-226.mjs'));
for(const [name,js] of [['core.js',core],['backend.js',backend],
  ['growth.js',growth],['merchant.js',merchant],['customer.js',customer],
  ['bootstrap.js',bootstrap]])new vm.Script(js,{filename:name});

// First-touch attribution is a short-lived browser hint, never payment authority.
const start=core.indexOf("const GROWTH_REF_STORAGE=");
const end=core.indexOf('function isPriceFresh',start);
assert.ok(start>0&&end>start);
const store=new Map();
const localStorage={
 getItem:k=>store.has(k)?store.get(k):null,
 setItem:(k,v)=>store.set(k,String(v)),
 removeItem:k=>store.delete(k)
};
const now=Date.now();
const state={user:{referralCode:'OWNCODE',referredBy:null}};
const location={search:'?ref=FRIEND55'};
const ctx=vm.createContext({localStorage,state,location,Date,JSON,URLSearchParams});
vm.runInContext(core.slice(start,end)+
  '\nthis.parse=parseReferral;this.get=growthAttributionCode;',ctx);
ctx.parse();
assert.equal(ctx.get(),'FRIEND55');
assert.equal(state.user.referredBy,'FRIEND55');
location.search='?ref=CHANGED77';
state.user.referredBy=null;
ctx.parse();
assert.equal(ctx.get(),'FRIEND55','later source must not overwrite first touch');
const entry=JSON.parse(store.get('tamao-growth-first-ref-v1-226'));
assert.ok(entry.expiresAt>now&&entry.expiresAt<=now+31*86400000);
store.set('tamao-growth-first-ref-v1-226',
 JSON.stringify({code:'FRIEND55',expiresAt:Date.now()-1}));
state.user.referredBy=null;
location.search='?ref=OWNCODE';
ctx.parse();
assert.equal(ctx.get(),'','own invitation must be ignored');
location.search='?ref=TMR'+'A'.repeat(24);
ctx.parse();
assert.equal(ctx.get(),'TMR'+'A'.repeat(24),'merchant attribution recognized');
assert.ok(!/create-order.*merchant|sendMoney|withdraw/i.test(migration));

// Merchant dashboard is private to a selected merchant; counts never include PII.
const mStart=merchant.indexOf('function merchantGrowthNetworkSection(');
const mEnd=merchant.indexOf('function merchantRealPortalRequired',mStart);
assert.ok(mStart>=0&&mEnd>mStart);
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
const mCtx=vm.createContext({globalThis:{merchantRuntime:{growthNetwork:null}},
 esc,Number,String,encodeURIComponent,toast:()=>{},navigator:{},render:()=>{}});
vm.runInContext(merchant.slice(mStart,mEnd)+
  '\nthis.view=merchantGrowthNetworkSection;',mCtx);
assert.equal(mCtx.view({merchantId:'m1',memberRole:'operator'}),'');
let html=mCtx.view({merchantId:'m1',memberRole:'owner'});
assert.ok(html.includes('Gerar meu link'));
mCtx.globalThis.merchantRuntime.growthNetwork={
 merchantId:'m1',source:'merchant_network_v1_226',
 inviteCode:'TMR'+'A'.repeat(24),rewardEnabled:false,
 customerInterests:2,merchantInterests:3
};
html=mCtx.view({merchantId:'m1',memberRole:'manager'});
assert.ok(html.includes('Indicar outra revenda'));
assert.ok(html.includes('Convidar clientes'));
assert.ok(html.includes('Revendas interessadas'));
assert.ok(html.includes('?ref=TMR'+'A'.repeat(24)+'#merchants'));
assert.ok(!html.includes('Ganhos disponíveis'));
assert.ok(mCtx.view({merchantId:'m2',memberRole:'owner'}).includes('Gerar meu link'),
 'Never show another merchant code');

// Sharing without a confirmed authenticated code must not invent attribution.
const gStart=growth.indexOf('function tamaoGrowthInviteUrl(');
const gEnd=growth.indexOf('function referralUrl()',gStart);
assert.ok(gStart>0&&gEnd>gStart);
const gCtx=vm.createContext({
 state:{user:{referralCode:''}},navigator:{},
 encodeURIComponent,toast:()=>{},location:{}
});
vm.runInContext(growth.slice(gStart,gEnd)+'\nthis.url=tamaoGrowthInviteUrl;',gCtx);
assert.equal(gCtx.url('merchant'),'https://tamao.com.br/#merchants');
gCtx.state.user.referralCode='FRIEND55';
assert.equal(gCtx.url('merchant'),'https://tamao.com.br/?ref=FRIEND55#merchants');

console.log('V1.226 PASS — first-touch referral, private merchant network, no payout, origin-scoped acquisition and visible sharing.');
