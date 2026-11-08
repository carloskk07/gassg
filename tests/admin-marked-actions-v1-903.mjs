import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const admin=read('js/admin.js'),acq=read('js/admin-acquisition.js'),activations=read('js/admin-activations.js');
for(const [name,src] of [['admin',admin],['acquisition',acq],['activations',activations]])
  new vm.Script(src,{filename:name+'.js'});
const span=(src,a,b)=>{
 const start=src.indexOf(a),end=src.indexOf(b,start+1);
 assert.ok(start>=0&&end>start,'source missing '+a);return src.slice(start,end);
};
const fn=(src,name)=>{
 const start=src.search(new RegExp('(?:async )?function '+name+'\\('));
 assert.ok(start>=0,'missing function '+name);
 const end=src.indexOf('\n}',start);
 assert.ok(end>start,'incomplete '+name);
 return src.slice(start,end+2);
};
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const inputs=new Map(),writes=[],messages=[];
const document={getElementById:id=>inputs.get(id)||null};
const set=(id,value,extra={})=>inputs.set(id,{value,...extra});
const ctx=vm.createContext({document,esc,Date,Number,String,Object,Array,Math,Intl,Set,
 adminRuntime:{status:'ready',data:{pilotPartners:[]},session:{user:{id:'admin-1'}},
 governance:{data:{controls:{cityPause:true},cities:[]}},cityNotifications:[],
 prospectCity:'São Gabriel',prospectState:'RS'},adminReady:()=>true,
 adminCurrentRole:()=> 'superadmin',adminRoleCanSection:()=>true,
 adminPerform:async(action,payload)=>{writes.push({action,payload});return {ok:true}},
 adminLoadGovernanceGates:async()=>{},adminLoadCityNotifications:async()=>{},adminLoadProspects:async()=>{},
 adminActivationDesk:{loading:false,actor:'admin-1',role:'superadmin',checkedAt:new Date().toISOString(),
 data:{intake:{controls:[{moduleKey:'ads_proposals',enabled:true,version:1}]}}},
 adminActivationLoad:async()=>null,
 render:()=>{},toast:note=>messages.push(String(note)),confirm:()=>true,
 crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'}
});
vm.runInContext([
 span(admin,'const ADMIN_CITY_REASON_CHOICES=','async function adminGovernanceChangeCityPause(index){'),
 fn(admin,'adminGovernanceChangeCityPause'),
 span(admin,'const ADMIN_APPLICATION_REJECTION_REASONS=','async function adminReviewMerchantRepresentation('),
 span(admin,'const ADMIN_SUPPORT_RESOLUTION_REASONS=','function adminGeneratePilotInviteToken(){'),
 fn(acq,'adminMarkCityNotification'),
 fn(acq,'adminPauseMarketCity'),
 span(activations,'const ADMIN_ACTIVATION_REASONS=','async function adminMarketingIntakeSet(moduleKey){'),
 fn(activations,'adminMarketingIntakeSet')
].join('\n')+'\nthis.test={city:adminCityGovernanceReason,reject:adminRejectApplication,'+
 'support:adminSetSupportStatus,notice:adminMarkCityNotification,pause:adminPauseMarketCity,'+
 'activation:adminActivationSelectedReason,intake:adminMarketingIntakeSet};',ctx);
const t=ctx.test;
assert.ok(admin.includes('id="governance-reason-')&&admin.includes('id="application-reject-'));
assert.ok(admin.includes('id="support-reason-')&&admin.includes('id="support-confirm-'));
assert.ok(admin.includes('id="pilot-invite-days-')&&admin.includes('type="checkbox"'));
assert.ok(acq.includes('id="prospect-invite-days-')&&acq.includes('city-notification-sent-'));
assert.ok(activations.includes("adminActivationReasonSelect('offer-share'"));
assert.ok(activations.includes("adminActivationReasonSelect('receivable-'+action"));
assert.ok(activations.includes("adminActivationReasonSelect('assistance-'+action"));
assert.equal(t.city(0),null);
set('governance-reason-0','__proto__');assert.equal(t.city(0),null);
set('governance-reason-0','availability');assert.match(t.city(0),/disponibilidade/);
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
await t.reject(id);assert.equal(writes.length,0,'reject requires selection');
set('application-reject-'+id,'duplicate');
await t.reject(id);assert.equal(writes.pop().payload.applicationId,id);
const support='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
set('support-reason-'+support,'corrected');set('support-confirm-'+support,'');
await t.support(support,'resolved');assert.equal(writes.length,0,'no false resolution');
inputs.set('support-confirm-'+support,{checked:true});
await t.support(support,'resolved');
assert.equal(writes.pop().payload.status,'resolved');
set('support-reason-'+support,'custom');set('support-reason-extra-'+support,'');
await t.support(support,'closed');assert.equal(writes.length,0,'custom closure cannot be blank');
set('support-reason-extra-'+support,'Caso realmente encerrado após verificação');
await t.support(support,'closed');assert.match(writes.pop().payload.resolutionNote,/realmente encerrado/);
const notice='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
await t.notice(notice,'sent');assert.equal(writes.length,0,'cannot assert unsent WhatsApp');
inputs.set('city-notification-sent-'+notice,{checked:true});
await t.notice(notice,'sent');assert.equal(writes.pop().payload.status,'sent');
await t.notice(notice,'skipped');assert.equal(writes.length,0,'skipped requires selected reason');
set('city-notification-skip-'+notice,'invalid');await t.notice(notice,'skipped');
assert.match(writes.pop().payload.note,/inválido/);
await t.pause(true);assert.equal(writes.length,0,'no unselected city reason');
set('prospect-city-pause-reason','maintenance');await t.pause(true);
assert.equal(writes.pop().action,'market-city-pause');
assert.equal(t.activation('offer-share',id),null);
set('activation-reason-offer-share-'+id,'reviewed');
assert.match(t.activation('offer-share',id),/Plano e material/);
set('activation-reason-offer-share-'+id,'__proto__');
assert.equal(t.activation('offer-share',id),null,'prototype pollution rejected');
await t.intake('ads_proposals');assert.equal(writes.length,0,'intake demands selection');
set('activation-reason-intake-disable-ads_proposals','review');
await t.intake('ads_proposals');assert.equal(writes.pop().action,'commercial-intake-set');
assert.doesNotMatch(fn(admin,'adminRejectApplication'),/prompt\(/);
assert.doesNotMatch(fn(admin,'adminSetSupportStatus'),/prompt\(/);
assert.doesNotMatch(fn(acq,'adminMarkCityNotification'),/prompt\(/);
assert.doesNotMatch(fn(acq,'adminIssueAnpProspectInvite'),/prompt\('Validade do convite/);
assert.doesNotMatch(fn(activations,'adminAdsOfferAction'),/prompt\(/);
console.log('V1.903 PASS: support, registration, city, WhatsApp, invite and commercial choices; no false writes.');
