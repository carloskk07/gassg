import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const admin=read('js/admin-acquisition.js');
const css=read('css/components.css');
const audit=read('.github/workflows/audit.yml');
new vm.Script(admin,{filename:'admin-acquisition.js'});
const start=admin.indexOf('function adminAcquisitionAggregateVerified(');
const end=admin.indexOf('\nfunction adminGrowthNetworkOverviewView(',start);
assert.ok(start>=0&&end>start,'real read-only evidence helpers required');
const source=admin.slice(start,end);
const escaped=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const ctx=vm.createContext({
  Date,Number,String,Array,
  adminMetricPercent:n=>Number(n).toFixed(1)+'%',
  esc:escaped
});
vm.runInContext(source+'\nthis.valid=adminAcquisitionAggregateVerified;this.view=adminAcquisitionEvidenceView;this.campaign=adminAcquisitionCampaigns;',ctx);
const base={
 generatedAt:'2026-10-17T02:00:00Z',
 landingViews:100,formViews:120,total:9,customers:5,merchants:4,
 contacted:6,qualified:3,converted:2,last7d:4,staleNew24h:1,
 campaigns:[
  {audience:'customer',source:'meta',medium:'paid',campaign:'gas_01',
   content:'criativo_01',landingViews:40,formViews:50,total:5,qualified:2,converted:1},
  {audience:'merchant',source:'whatsapp',medium:'outreach',campaign:'partnership',
   content:'partner_01',landingViews:60,formViews:70,total:4,qualified:1,converted:1}
 ]
};
assert.equal(ctx.valid(base),true);
const html=ctx.view(base);
assert.match(html,/ETAPA 1 • INTERESSE ANÔNIMO/);
assert.match(html,/ETAPA 2 • CADASTROS NO CRM/);
assert.match(html,/ETAPA 3 • EVOLUÇÃO DO CRM/);
assert.match(html,/Clientes \/ revendas/);
assert.match(html,/5 \/ 4/,'composite metric must not display NaN');
assert.match(html,/Convertidos no CRM/);
assert.match(html,/não pedido pago|não comprova pedido/);
assert.match(html,/Ainda não há indicador agregado de propostas aceitas/);
assert.doesNotMatch(html,/100\.0%/,'cross-population observations may not be inflated into a conversion rate');
assert.doesNotMatch(html,/funnel-stage/,'the old fake six-stage path must be removed');

const camp=ctx.campaign(base);
assert.match(camp,/Fontes comerciais, sem taxas artificiais/);
assert.match(camp,/eventos/);
assert.match(camp,/cadastros/);
assert.match(camp,/Convertidos/);
assert.doesNotMatch(camp,/Entrada → form\.|Entrada → lead|100\.0%/,
 'aggregate event counts are not a CTR or visitor-to-lead conversion');
const malicious=structuredClone(base);
malicious.campaigns[0].content='<script>alert(1)</script>';
assert.ok(!ctx.campaign(malicious).includes('<script>'),'campaign labels must be escaped');

for(const [reason,value] of [
 ['absent protected aggregate',null],
 ['missing timestamp',{...base,generatedAt:null}],
 ['invalid timestamp',{...base,generatedAt:'garbage'}],
 ['incomplete breakdown',{...base,customers:8,merchants:4}],
 ['negative events',{...base,landingViews:-1}],
 ['too many leads qualified',{...base,qualified:11}],
 ['unbounded campaign rows',{...base,campaigns:Array(31).fill(base.campaigns[0])}],
 ['fake event count',{...base,formViews:'120'}]
]){
 assert.equal(ctx.valid(value),false,reason);
 assert.match(ctx.view(value),/Funil agregado não confirmado/,reason);
 assert.equal(ctx.campaign(value),'',reason);
}
// Partial operator queue must never masquerade as the full server-side funnel.
const sectionStart=admin.indexOf('function adminPrelaunchLeadsSection(');
const sectionEnd=admin.indexOf('\nfunction adminPublicRequestKindLabel(',sectionStart);
assert.ok(sectionStart>0&&sectionEnd>sectionStart);
const section=admin.slice(sectionStart,sectionEnd);
assert.match(section,/adminAcquisitionEvidenceView\(metrics\)/);
assert.match(section,/adminAcquisitionCampaigns\(metrics\)/);
assert.doesNotMatch(section,/funnel-stage|VIRARAM LEAD|VIRAM FORMULÁRIO/);
assert.match(section,/Agregados pendentes/);
for(const selector of [
 '.admin-evidence-funnel','.admin-evidence-lanes','.admin-evidence-caveat',
 '.admin-evidence-sponsor','@media(max-width:520px)'])
 assert.ok(css.includes(selector),'responsive evidence presentation missing '+selector);
assert.ok(audit.includes('node tests/admin-acquisition-evidence-v1-368.mjs'),
 'regression must be run on every PR');
console.log('V1.368 PASS — read-only source evidence, partial-data fail closed, campaign counts and mobile admin UI.');
