import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const acquisition=read('js/acquisition.js');
const edge=read('supabase/functions/capture-prelaunch-lead/index.ts');
const merchant=read('js/merchant.js');
new vm.Script(acquisition,{filename:'js/acquisition.js'});
const begin=acquisition.indexOf('function prelaunchMerchantLeadSection(){');
const finish=acquisition.indexOf('function openPrelaunchMerchantLead(){',begin);
assert.ok(begin>=0&&finish>begin);
const view=vm.createContext({prelaunchLeadSent:()=>false});
vm.runInContext(acquisition.slice(begin,finish)+';this.form=prelaunchMerchantLeadSection;',view);
const html=view.form();
assert.match(html,/ANUNCIE NO TAMÃO/);
assert.match(html,/Quero anunciar no TAMÃO/);
assert.match(html,/Nome da empresa/);
assert.match(html,/WhatsApp/);
assert.match(html,/Autorizo o TAMÃO a entrar em contato/);
assert.doesNotMatch(html,/\bCNPJ\b|\bANP\b|\bRG\b|\bCPF\b|foto de documento/i);
assert.ok(html.indexOf('id="partner-business"')<html.indexOf('<details'));
assert.ok(html.indexOf('id="partner-phone"')<html.indexOf('<details'));
assert.ok(html.indexOf('id="partner-name"')>html.indexOf('<details'),
  'optional personal name must stay in progressive disclosure');
assert.ok(html.indexOf('id="partner-interest-categories"')>html.indexOf('<details'));
assert.equal((html.match(/<details\b/g)||[]).length,(html.match(/<\/details>/g)||[]).length,
  'optional panels correctly closed');
assert.match(edge,/if\(leadType==="customer"&&!interests.length\)/,
 'do not weaken buyer interest checks');
assert.doesNotMatch(edge,/CONTACT_REQUIRED/);
assert.match(edge,/if\(leadType==="merchant"\)\{/);
assert.match(edge,/if\(!businessName\|\|businessName.length<2\)/);
assert.match(edge,/if\(body.consent!==true\)/);
assert.match(edge,/capture_prelaunch_lead_idempotent/);
assert.match(edge,/RATE_LIMITED/);
assert.match(edge,/IDEMPOTENCY_CONFLICT/);
assert.doesNotMatch(edge,/status:'active'|commerce_enabled\s*=\s*true|grant execute.*anon/i,
 'contact capture must not activate sales');
const start=acquisition.indexOf('async function submitPrelaunchMerchantLead(){');
assert.ok(start>=0);
const fields={
 'partner-submit':{disabled:false,textContent:'Quero anunciar no TAMÃO'},
 'partner-result':{textContent:'',className:''},
 'partner-business':{value:'Comércio Local'},
 'partner-name':{value:''},
 'partner-phone':{value:'(55) 99999-1234'},
 'partner-postal':{value:''},
 'partner-note':{value:''},
 'partner-consent':{checked:true},
 'partner-website':{value:''}
};
let submitted=null,marked=0,errors=[];
const ctx=vm.createContext({
 globalThis:{prelaunchLeadSubmit:async payload=>{
  submitted=payload;return {ok:true,message:'Recebido'};
 }},
 document:{querySelector:sel=>fields[sel.slice(1)]||null},
 leadCheckedValues:()=>[],
 leadPhoneDigits:v=>String(v??'').replace(/\D/g,''),
 leadPostalDigits:v=>String(v??'').replace(/\D/g,''),
 prelaunchMerchantFieldError:(id,message)=>errors.push([id,message]),
 markPrelaunchLeadSent:()=>{marked++},
 toast:message=>errors.push(['toast',message]),String,Array,Object
});
vm.runInContext(acquisition.slice(start)+';this.submit=submitPrelaunchMerchantLead;',ctx);
await ctx.submit();
assert.equal(errors.length,0,'empty optional fields should not block the lead');
assert.equal(submitted?.leadType,'merchant');
assert.equal(submitted?.businessName,'Comércio Local');
assert.equal(submitted?.phone,'55999991234');
assert.equal(submitted?.contactName,'');
assert.equal(submitted?.interests.length,0);
assert.equal(submitted?.consent,true);
assert.equal(marked,1);
fields['partner-submit'].disabled=false;
fields['partner-consent'].checked=false;
submitted=null;
await ctx.submit();
assert.equal(submitted,null,'no contact without consent');
assert.equal(errors.at(-1)[0],'partner-consent');
fields['partner-consent'].checked=true;
fields['partner-business'].value='A';
await ctx.submit();
assert.equal(errors.at(-1)[0],'partner-business','business identity still mandatory');
assert.match(merchant,/merchant_cnpj|cnpj/i,'full commercial path remains distinct');
console.log('PASS: two-field advertiser lead, optional data, required consent, anti-spam & purchase gates intact.');
