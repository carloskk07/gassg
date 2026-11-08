import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const admin=read('js/admin.js');
const acquisition=read('js/admin-acquisition.js');
const independent=read('js/admin-ads-independent.js');

for(const [file,text] of [['admin.js',admin],['admin-acquisition.js',acquisition],['admin-ads-independent.js',independent]])
  assert.doesNotThrow(()=>new vm.Script(text,{filename:file}));
const access=admin.slice(admin.indexOf('const ADMIN_SECTION_ROLES='),admin.indexOf('function adminRelativeTime('));
assert.match(access,/ads:new Set\(\['superadmin','operations','compliance','finance'\]\)/);
const ctx=vm.createContext({adminCurrentRole:()=> 'superadmin',adminRuntime:{section:'ads'}});
vm.runInContext(access+'\nthis.can=adminRoleCanSection;this.meta=adminSectionMeta;',ctx);
for(const role of ['superadmin','operations','compliance','finance'])
  assert.equal(ctx.can('ads',role),true,'Ads read/navigation permitted to '+role);
for(const role of ['readonly','support','anonymous',''])
  assert.equal(ctx.can('ads',role),false,'Ads navigation denied to '+role);
assert.equal(ctx.meta('ads').title,'Publicidade');
assert.match(ctx.meta('ads').description,/Não exige revendas/);

const selection=admin.slice(admin.indexOf('function adminSetSection('),admin.indexOf('function adminMenuButton(',admin.indexOf('function adminSetSection(')));
assert.match(selection,/['"]ads['"]/);
assert.match(selection,/if\(next==='ads'&&typeof adminIndependentAdsRefresh==='function'\)/);
assert.match(admin,/['"]catalog['"],['"]finance['"],['"]ads['"],['"]alerts['"]/);
assert.match(admin,/adminMenuButton\('ads','Publicidade'/);
assert.match(admin,/adminMenuButton\('discovery','Moderação de anúncios'/);
assert.match(admin,/adminPanel\('ads',adsContent\)/);

const start=admin.indexOf('function adminPage(){');
const end=admin.indexOf('function adminFilterRegistry()',start);
const page=admin.slice(start,end);
assert.match(page,/const adsContent=\(sectionActive\('ads'\)\)\?/);
assert.match(page,/typeof adminAdsIndependentSection==='function'/);
assert.match(page,/adminAdsIndependentLoad\(\)/);
assert.ok(page.indexOf('const adsContent=')<page.indexOf('const menu='),'Standalone Ads must be gated before nav');
assert.match(acquisition,/function adminAdsIndependentLoad\(\)/);
assert.match(independent,/function adminAdsIndependentSection\(\)/);
assert.match(independent,/Conferir conta e webhook do TAMÃO Ads/);
assert.match(independent,/adminIndependentAdsCheckProvider/);
assert.match(independent,/HOMOLOGAR/);
assert.match(independent,/\['superadmin','operations','compliance','finance'\]/);

// The paid Ads interface stays separate from Discovery moderation and merchant activity.
assert.doesNotMatch(ctx.meta('ads').description,/profissionais|caronas|hospedagens/i);
assert.equal(ctx.meta('discovery').title,'Anúncios e revisões');
console.log('V1.894 PASS: dedicated advertiser Ads navigation, strict role gate, lazy module, provider-check access and separate moderation.');
