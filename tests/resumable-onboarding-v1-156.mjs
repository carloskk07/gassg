import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const submit=read('supabase/functions/submit-merchant-application/index.ts');
const backend=read('js/backend.js');
const growth=read('js/growth.js');
const bootstrap=read('js/bootstrap.js');
const admin=read('supabase/functions/admin-ops/index.ts');
const adminUI=read('js/admin-acquisition.js');
const merchant=read('js/merchant.js');

// Account-owned read only, not CNPJ lookup open to any authenticated user.
assert.ok(submit.includes('if(body.action==="my-applications")'));
assert.ok(submit.includes('const user=await authenticatedUser(req)'));
assert.ok(submit.includes('actionName:"merchant-my-applications",limit:20,windowSeconds:3600'));
assert.ok(submit.includes('.eq("applicant_user_id",user.id)'), 'read always constrained to authenticated owner');
assert.ok(submit.includes('.order("updated_at",{ascending:false}).limit(20)'), 'bounded read');
assert.ok(!submit.includes('select("*")'),'no over-sharing');
assert.ok(submit.includes('if(body.action!=null&&body.action!=="submit")'),'unknown mutations blocked');
assert.ok(backend.includes("merchantInvoke('submit-merchant-application',{action:'my-applications'})"));
assert.ok(backend.includes("if(merchantRuntime.status==='no-access')"),'only query when signup relevant');
assert.ok(backend.includes('try{await merchantLoadOwnApplications()}catch(error)'), 'auxiliary read cannot block login');
assert.ok(backend.includes('ownApplications:[]'));
assert.ok(backend.includes('merchantRuntime.ownApplications=[]'), 'signout clears PII');
assert.ok(backend.includes('ownApplicationsLoaded:true')===false);
assert.ok(backend.includes('merchantOwnApplicationForInvite'));
assert.ok(backend.includes("if(cnpj)return all.find(x=>String(x.cnpj||'')"), 'only same CNPJ when invited');
assert.ok(bootstrap.includes("globalThis.merchantProspectInviteToken?.()"),'magic-link callback redirect');
assert.ok(growth.includes("globalThis.merchantOwnApplicationForInvite?.()"));
assert.ok(growth.includes("prefillCnpj=String(prospectDetails?.cnpj||ownApplication?.cnpj||'')"));
assert.ok(growth.includes("esc(ownApplication?.phone||'')"),'existing phone escaped');
assert.ok(growth.includes("esc(ownApplication?.address_text||'')"),'existing address escaped');
assert.ok(growth.includes('Cadastro já recebido.'));
assert.ok(growth.includes('Reenviar cadastro corrigido'));
assert.ok(growth.includes("ownStatus==='approved'"),'approved app cannot resubmit from UI');
assert.ok(merchant.includes('Cadastro em análise'));
assert.ok(merchant.includes('Cadastro precisa de correção'));

assert.ok(admin.includes('.select("id,cnpj,status,online")'));
assert.ok(admin.includes('.in("cnpj",prospectCnpjs)'));
assert.ok(admin.includes('.select("merchant_id,city,state")'));
assert.ok(admin.includes('marketCityKey(location.city)!==cityKey'),'merchant city must match prospect city');
assert.ok(admin.includes('const eligibleIds=new Set(Array.isArray(merchantScope)'));
assert.ok(admin.includes('ready=Boolean(p.merchant?.id&&eligibleIds.has(String(p.merchant.id)))'));
assert.ok(admin.includes('reminderRecommended:dormantInvite'));
assert.ok(admin.includes('prospects:commercialProspects'));
assert.ok(adminUI.includes('adminProspectOnboardingProgress(x)'));
assert.ok(adminUI.includes('A autoridade de ofertas confirma elegibilidade em tempo real.'));
assert.ok(adminUI.includes('Convite sem cadastro há mais de 3 dias'));
assert.ok(!adminUI.includes('Enviar lembrete automaticamente'));

function excerpt(source,signature){
 const begin=source.indexOf(signature);
 assert.ok(begin>=0,signature+' not found');
 const end=source.indexOf('\n}',begin);
 assert.ok(end>begin,signature+' missing end');
 return source.slice(begin,end+2);
}
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const p=vm.runInNewContext(excerpt(adminUI,'function adminProspectOnboardingProgress(')+';adminProspectOnboardingProgress',{esc});
const fake=p({onboarding:{step:'merchant',nextStep:'<img src=x onerror=alert(1)>',reminderRecommended:true}});
assert.ok(fake.includes('&lt;img src=x onerror=alert(1)&gt;'),'admin recommendation escaped');
assert.ok(!fake.includes('<img'),'no raw XSS');
assert.ok(fake.includes('Revenda registrada não significa'));
const invite=p({onboarding:{step:'invited',nextStep:'Aguardar cadastro'}});
assert.ok(invite.includes('Aguardar cadastro'));
assert.ok(!invite.includes('Convite sem cadastro há mais de 3 dias'),'no false reminder');
console.log('V1.156: auth-scoped application resume, magic-link callback, admin local onboarding proof and XSS passed.');
