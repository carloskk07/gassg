import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const admin=read('js/admin.js'),acq=read('js/admin-acquisition.js');
new vm.Script(admin,{filename:'admin.js'});
new vm.Script(acq,{filename:'admin-acquisition.js'});
const span=(src,a,b)=>{
 const start=src.indexOf(a),end=src.indexOf(b,start+a.length);
 assert.ok(start>=0&&end>start,'source range missing '+a);
 return src.slice(start,end);
};
const fn=(src,name)=>{
 const p=src.search(new RegExp('(?:async )?function '+name+'\\('));
 assert.ok(p>=0,'missing function '+name);
 const e=src.indexOf('\n}',p);
 assert.ok(e>p,'incomplete '+name);
 return src.slice(p,e+2);
};
const escaped=value=>String(value??'').replaceAll('&','&amp;')
 .replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')
 .replaceAll("'","&#39;");
const fields=new Map(),calls=[],messages=[];
const set=(id,value,extra={})=>fields.set(id,{value,...extra});
let allowConfirm=true,typedConfirm=true;
const ctx=vm.createContext({
 document:{getElementById:id=>fields.get(id)||null},
 esc:escaped,Date,Object,String,Number,Array,Intl,
 toast:message=>messages.push(String(message)),
 confirm:()=>allowConfirm,
 adminRequireTypedConfirmation:()=>typedConfirm,
 adminOperationModeLabel:mode=>String(mode),
 adminPerform:async(action,payload)=>{calls.push({action,payload});return {ok:true}}
});
vm.runInContext([
 span(admin,'const ADMIN_LAUNCH_EXCEPTION_REASONS=','async function adminConfirmLaunchRequirement('),
 fn(admin,'adminConfirmLaunchRequirement'),
 fn(admin,'adminSetOperationMode'),
 span(admin,'function adminOwnerFundingPreset(','const ADMIN_LAUNCH_EXCEPTION_REASONS=')
].join('\n')+'\nthis.api={exceptionUI:adminLaunchRequirementDecisionUI,'+
 'modeUI:adminOperationModePicker,exception:adminConfirmLaunchRequirement,'+
 'mode:adminSetOperationMode,funding:adminOwnerFundingPreset,club:adminClubeTermsNotePreset};',ctx);
const x=ctx.api;
const key='real_supply_required';
assert.match(x.exceptionUI(key),/Risco revisado/);
assert.match(x.exceptionUI(key),/launch-exception-confirm-/);
assert.match(x.exceptionUI(key),/168/);
assert.equal(x.exceptionUI('<script>'),'');
assert.match(x.modeUI('PRELAUNCH'),/LIVE:readiness/);
assert.match(x.modeUI('PAUSED'),/PRELAUNCH:review/);
assert.equal(x.modeUI('UNKNOWN'),'');
assert.match(admin,/adminLaunchRequirementDecisionUI\(item.key\)/);
assert.match(admin,/adminOperationModePicker\(mode\)/);
assert.doesNotMatch(fn(admin,'adminConfirmLaunchRequirement'),/prompt\(/);
assert.doesNotMatch(fn(admin,'adminSetOperationMode'),/prompt\(/);
await x.exception(key);
assert.equal(calls.length,0,'A warning cannot be accepted with no reason selected');
set('launch-exception-reason-'+key,'__proto__');
set('launch-exception-hours-'+key,'24');
fields.set('launch-exception-confirm-'+key,{checked:true});
await x.exception(key);assert.equal(calls.length,0,'prototype key is not allowed');
set('launch-exception-reason-'+key,'follow_up');
set('launch-exception-hours-'+key,'999');
await x.exception(key);assert.equal(calls.length,0,'bad expiry cannot persist');
set('launch-exception-hours-'+key,'72');
allowConfirm=false;await x.exception(key);assert.equal(calls.length,0);
allowConfirm=true;await x.exception(key);
assert.equal(calls.length,1);
let written=calls.pop();
assert.equal(written.action,'confirm-launch-requirement');
assert.equal(written.payload.requirementKey,key);
assert.equal(written.payload.source,'admin-panel');
assert.match(written.payload.reason,/Acompanhamento administrativo temporário/);
const expiryHours=(new Date(written.payload.expiresAt).getTime()-Date.now())/3600000;
assert.ok(expiryHours>71.98&&expiryHours<=72);
assert.equal(written.payload.evidence,'');
await x.mode('LIVE');assert.equal(calls.length,0);
set('admin-operation-reason','PAUSED:risk');
fields.set('admin-operation-confirm',{checked:true});
await x.mode('LIVE');assert.equal(calls.length,0,'cannot use pause reason for live');
set('admin-operation-reason','LIVE:readiness');
typedConfirm=false;await x.mode('LIVE');assert.equal(calls.length,0,'LIVE reinforced confirmation still required');
typedConfirm=true;await x.mode('LIVE');
written=calls.pop();
assert.equal(written.action,'set-operation-mode');
assert.equal(written.payload.mode,'LIVE');
assert.match(written.payload.reason,/Prontidão operacional consultada/);
set('admin-operation-reason','__proto__');
await x.mode('PAUSED');assert.equal(calls.length,0);
const budget='customer_referral';
const amount={value:'200.00'},wrap={hidden:true};
fields.set('owner-funding-budget-'+budget,amount);
fields.set('owner-funding-manual-budget-'+budget,wrap);
set('owner-funding-quick-budget-'+budget,'50');
x.funding(budget,'budget');assert.equal(amount.value,'50');assert.equal(wrap.hidden,true);
set('owner-funding-quick-budget-'+budget,'custom');
x.funding(budget,'budget');assert.equal(wrap.hidden,false);
const manual={open:false},note={value:'Condição original'};
fields.set('clube-terms-note-'+budget,note);
fields.set('clube-terms-note-manual-'+budget,manual);
set('clube-terms-note-template-'+budget,'discussion');
x.club(budget);
assert.match(note.value,/Não há contrato firmado/);
assert.equal(manual.open,false);
set('clube-terms-note-template-'+budget,'custom');
x.club(budget);assert.equal(manual.open,true);
assert.match(acq,/owner-funding-quick-/);
assert.match(admin,/function adminOwnerFundingPreset/);
assert.match(acq,/clube-terms-note-template-/);
assert.match(admin,/adminRequireTypedConfirmation\('CONFIRMAR OPERAÇÃO'/);
assert.match(fn(admin,'adminFinancial'),/comprovante externo conferido/);
console.log('V1.905 PASS: launch and mode choices, no unconfirmed admin decisions, finance proofs retained, internal budget presets and Club notes.');
