import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const growth=read('js/growth.js');
const merchant=read('js/merchant.js');
const core=read('js/core.js');
new vm.Script(growth,{filename:'js/growth.js'});
new vm.Script(merchant,{filename:'js/merchant.js'});

const growthStart=growth.indexOf('const TAMAO_NETWORK_INVITE_TARGETS=');
const growthEnd=growth.indexOf('function referralUrl(){',growthStart);
assert.ok(growthStart>0&&growthEnd>growthStart,'Referral targets must reuse the original first-touch client entry');
const toasts=[],shared=[];
const ctx=vm.createContext({
 state:{user:{referralCode:'FRIEND88'}},
 document:{getElementById:()=>({value:'professional'})},
 navigator:{clipboard:{writeText:async value=>{shared.push(value)}}},
 toast:message=>toasts.push(message)
});
vm.runInContext(growth.slice(growthStart,growthEnd)+
 '\nthis.makeInvite=tamaoGrowthInviteUrl;this.shareInvite=shareTamaoGrowthInvite;this.renderPicker=tamaoNetworkInvitePicker;',ctx);

const routes={customer:'home',merchant:'merchants',mobility:'mobility',
 professional:'advertise',rides:'rides',club:'club',sponsor:'sponsors'};
for(const [kind,route] of Object.entries(routes)){
 assert.equal(ctx.makeInvite(kind),'https://tamao.com.br/?ref=FRIEND88#'+route,'Route must preserve first-touch query for '+kind);
 assert.equal(await ctx.shareInvite(kind),true,'Shareable referral '+kind);
 assert.ok(shared.at(-1).endsWith('?ref=FRIEND88#'+route),'Clipboard has correct deep-link '+kind);
}
assert.equal(ctx.makeInvite('stays'),'https://tamao.com.br/?ref=FRIEND88#home','Suspended stays are never promoted by an invite');
assert.equal(ctx.makeInvite('https://evil.example'),'https://tamao.com.br/?ref=FRIEND88#home','Untrusted destinations fail closed');
assert.match(ctx.renderPicker(),/id="tamao-network-invite-target"/,'One simple destination selector');
assert.match(ctx.renderPicker(),/Hospedagens seguem suspensas/,'Suspended vertical disclosure');
assert.doesNotMatch(ctx.renderPicker(),/value="stays"/,'No invite to unavailable accommodations');
ctx.state.user.referralCode='';
assert.equal(await ctx.shareInvite('merchant'),false,'No financial attribution without a real verified invite code');
assert.match(toasts.at(-1),/Entre na sua conta/);
assert.doesNotMatch(ctx.renderPicker(),/onclick="tamaoShareSelectedNetworkInvite\(\)"(?:(?!disabled).)*>/,'Anonymous invite button must not be presented as enabled');

const merchantStart=merchant.indexOf('async function merchantGrowthShareFromUi(');
const merchantEnd=merchant.indexOf('function merchantRealPortalRequired()',merchantStart);
assert.ok(merchantStart>0&&merchantEnd>merchantStart,'Merchant referral must use independent merchant invite code');
const merchantShared=[],merchantToasts=[];
const store=vm.createContext({
 merchantRuntime:{merchant:{merchantId:'merchant-1'},growthNetwork:{merchantId:'merchant-1',inviteCode:'TMR'+'A'.repeat(24)}},
 navigator:{clipboard:{writeText:async value=>{merchantShared.push(value)}}},
 toast:message=>merchantToasts.push(message),
 document:{getElementById:()=>({value:'rides'})}
});
vm.runInContext(merchant.slice(merchantStart,merchantEnd)+'\nthis.shareMerchant=merchantGrowthShareFromUi;',store);
for(const [kind,route] of Object.entries(routes)){
 await store.shareMerchant(kind);
 assert.match(merchantShared.at(-1),new RegExp('\\?ref=TMRA{24}#'+route+'$'),'Merchant link must keep code and route '+kind);
}
assert.match(merchant,/merchantGrowthShareFromUi\(document\.getElementById\('merchant-network-target'\)\.value\)/,'Simple merchant dropdown reuses verified invite action');
assert.match(merchant,/id="merchant-network-target"/,'Merchant portal offers other verticals');
store.merchantRuntime.growthNetwork.inviteCode='INVALID';
await store.shareMerchant('customer');
assert.match(merchantToasts.at(-1),/Carregue primeiro/,'Merchant cannot share invalid code');

assert.match(core,/new URLSearchParams\(location\.search\)\.get\('ref'\)/,'Landing must read query before hash');
assert.match(core,/const GROWTH_REF_TTL_MS=30\*24\*60\*60\*1000/,'Preserve existing 30-day first-touch TTL');
assert.match(growth,/\$\{tamaoNetworkInvitePicker\(\)\}/,'Referral account view must render picker');
assert.doesNotMatch(growth.slice(growthStart,growthEnd),/network_fee_package_tick|wallet_entries|award_cents|accrual_enabled\s*=\s*true/,'Invites cannot accidentally credit bonuses');
console.log('V1.1040 PASS — cross-module invitation URLs, 30-day first-touch, financial isolation, account and merchant safely shared; stays paused.');
