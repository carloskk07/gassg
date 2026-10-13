import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261013223000_growth_cnpj_application_attribution_v1_229.sql');
const edge=read('supabase/functions/submit-merchant-application/index.ts');
const adminEdge=read('supabase/functions/admin-ops/index.ts');
const backend=read('js/backend.js');
const growth=read('js/growth.js');
const acquisition=read('js/admin-acquisition.js');
const audit=read('.github/workflows/audit.yml');
for(const x of ['claim_growth_application_referral_v1_229','admin_growth_application_funnel_v1_229',
 'reward_eligible boolean not null default false check(reward_eligible=false)',
 'cnpj text not null unique','on conflict do nothing returning application_id',
 "m.cnpj<>v_app.cnpj","m.user_id=p_actor_user_id",
 "l.lead_type='merchant'","l.phone=v_app.phone",
 "'contact_match_unverified'","'attributionNeverFinancialProof',true",
 "'noPayout',true","revoke all on function public.claim_growth_application_referral_v1_229",
 "grant execute on function public.admin_growth_application_funnel_v1_229"])
 assert.ok(sql.includes(x),'Missing restricted evidence: '+x);
assert.ok(!/insert into public\.(merchant_fee_credit_ledger|merchant_billing_accounts|platform_receivables)/i.test(sql));
assert.ok(edge.includes('attachGrowthApplicationReferral('));
assert.ok(edge.includes('body.referralCode'));
assert.equal((edge.match(/const growthReferral=await attachGrowthApplicationReferral\(/g)||[]).length,1);
assert.ok(edge.includes('verified:false,rewardEligible:false'));
assert.ok(backend.includes("destination.searchParams.set('ref',ref)"));
assert.ok(backend.includes("destination.hash='merchant-join'"));
assert.ok(growth.includes('id="j-referral-code"'));
assert.ok(growth.includes('...(referralCode?{referralCode}:{})'));
assert.ok(adminEdge.includes('admin_growth_application_funnel_v1_229'));
assert.ok(adminEdge.includes('growthApplicationFunnel:{available:false,valid:false}'));
assert.ok(acquisition.includes('adminGrowthApplicationFunnelView(data?.growthApplicationFunnel)'));
assert.ok(audit.includes('node tests/growth-cnpj-attribution-v1-229.mjs'));
for(const [p,s] of [['backend',backend],['growth',growth],['acquisition',acquisition]])
 new vm.Script(s,{filename:p+'.js'});
const extract=(src,name)=>{
 const from=src.indexOf('function '+name+'('),to=src.indexOf('\n}',from);
 assert.ok(from>=0&&to>from);
 return src.slice(from,to+2);
};
const loc={href:'https://tamao.com.br/#merchants'};
const ctx=vm.createContext({URL,location:loc,
 globalThis:{CHAMA_MERCHANT_ORIGIN:'https://parceiro.tamao.com.br'},
 buildPortalHref:()=> 'https://parceiro.tamao.com.br/?merchant=1#merchant',
 growthAttributionCode:()=> 'TMR'+'A'.repeat(24),toast:()=>{}});
vm.runInContext(extract(backend,'openMerchantPortal')+
 '\nthis.transfer=openMerchantPortal;',ctx);
ctx.transfer();
let target=new URL(loc.href);
assert.equal(target.hostname,'parceiro.tamao.com.br');
assert.equal(target.searchParams.get('ref'),'TMR'+'A'.repeat(24));
assert.equal(target.hash,'#merchant-join');
ctx.growthAttributionCode=()=>'';ctx.transfer();
target=new URL(loc.href);
assert.equal(target.searchParams.has('ref'),false);
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const ui=vm.createContext({esc,String,Number,Object,Array});
vm.runInContext(extract(acquisition,'adminGrowthApplicationFunnelView')+
 '\nthis.view=adminGrowthApplicationFunnelView;',ui);
const v={available:true,valid:true,source:'growth_cnpj_application_funnel_v1_229',
 readOnly:true,noPayout:true,noPersonalContactData:true,
 attributionNeverFinancialProof:true,firstLevelOnly:true,
 applicationsAttributed:1,contactCandidatesUnverified:1,applicationsApproved:0,
 approvedCnpjOwnerMatches:0,activeMatchedMerchants:0,
 invitedByMerchants:1,invitedByCustomers:0,
 rows:[{companyName:'Teste <x>',cnpjSuffix:'0011',inviterKind:'merchant',
 applicationStatus:'pending',merchantLinked:false,activeMerchant:false,
 leadCandidate:true,verified:false,rewardEligible:false}]};
assert.ok(ui.view(v).includes('&lt;x&gt;'));
assert.ok(ui.view(v).includes('Nenhuma comissão de revenda'));
for(const changed of [{...v,noPayout:false},{...v,applicationsAttributed:3},
 {...v,activeMatchedMerchants:1}])
 assert.ok(ui.view(changed).includes('não puderam ser comprovados'));
console.log('V1.229 PASS — private CNPJ attribution and safe cross-domain onboarding.');
