import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {compactReleasedGrowthComments} from '../scripts/build-live-portals.mjs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const src=read('js/growth.js');
const start=src.indexOf('function club(){'),end=src.indexOf('\nfunction tamaoGrowthInviteUrl(',start);
assert.ok(start>0&&end>start);
const ctx={
 globalThis:{liveReady:()=>false,liveRuntime:{session:null}},
 state:{user:{cashback:0,purchases:0,cashbackDebt:0}},
 shell:x=>x,BRL:{format:n=>'R$ '+Number(n).toFixed(2)},esc:x=>String(x),
 clubePaidCouponPanel:()=>'<section id="member-vouchers"></section>'
};
vm.runInNewContext(src.slice(start,end)+';this.club=club;',ctx);
const guest=ctx.club();
assert.match(guest,/Cupons na sua conta/);
assert.match(guest,/Cashback elegível/);
assert.match(guest,/Compare pelo CEP/);
assert.match(guest,/onclick="go\('home'\)"/);
assert.match(guest,/onclick="go\('earn'\)"/);
assert.doesNotMatch(guest,/SEU CASHBACK DISPONÍVEL|R\$ 0\.00|member-vouchers/);
ctx.globalThis.liveReady=()=>true;
ctx.globalThis.liveRuntime.session={user:{id:'member-1'}};
ctx.state.user={cashback:7.25,purchases:2,cashbackDebt:0};
const member=ctx.club();
assert.match(member,/SEU CASHBACK DISPONÍVEL/);
assert.match(member,/R\$ 7\.25/);
assert.match(member,/member-vouchers/);
assert.doesNotMatch(member,/tamao-club-visitor-hero/);
assert.equal((member.match(/Cashback disponível/g)||[]).length,0,'No duplicate visible available-balance card');
const emitted=compactReleasedGrowthComments(src);
assert.ok(src.length-emitted.length>1100);
new vm.Script(emitted);
assert.match(read('css/marketing-premium.css'),/@media\(max-width:600px\)/);
console.log('PASS guest Clube editorial and real private benefits, source-preserving startup budget');
