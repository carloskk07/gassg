import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const core=read('js/core.js'),customer=read('js/customer.js'),
 merchant=read('js/merchant.js'),admin=read('js/admin.js'),
 publicCss=read('css/public-ux.css'),
 workspaceCss=read('css/workspace-experience.css'),
 landingCss=read('css/landing-editorial.css'),audit=read('.github/workflows/audit.yml');
for(const [name,source] of Object.entries({core,customer,merchant,admin}))
 assert.doesNotThrow(()=>new vm.Script(source,{filename:name+'.js'}));
const footer=core.slice(core.indexOf('function siteFooter('),core.indexOf('function tamaoOpenAvailability('));
assert.equal((footer.match(/class="tamao-footer-link-group"/g)||[]).length,3);
for(const path of ["go(\\'learn\\')","go(\\'merchants\\')","go(\\'professionals\\')","go(\\'contact\\')","go(\\'privacy\\')","go(\\'terms\\')"])
 assert.ok(footer.includes(path),'Public footer keeps destination '+path);
assert.doesNotMatch(footer,/\['stays','Hospedagens'\]/);
const liveTracking=customer.slice(customer.indexOf('function liveTracking(){'),customer.indexOf('\nfunction tracking(){'));
assert.ok(liveTracking.includes('Existe uma referência de pedido para consultar'));
assert.ok(liveTracking.includes('Atualizar acompanhamento'));
assert.match(liveTracking,/tamao-tracking-empty/);
assert.match(liveTracking,/tamaoOpenAvailability\(\)/);
assert.doesNotMatch(liveTracking,/quickProduct\('P13'\)/);
const demo=customer.slice(customer.indexOf('function tracking(){'),customer.indexOf('function tracking(){')+550);
assert.match(demo,/tamao-tracking-empty/);
assert.match(demo,/tamaoOpenAvailability\(\)/);
const overview=admin.slice(admin.indexOf('const overviewContent='),admin.indexOf('const ordersContent='));
assert.ok(overview.indexOf('adminExecutiveNextDecisionView(')<overview.indexOf('admin-quick-actions'));
assert.ok(overview.indexOf('adminAttentionCenter(')<overview.indexOf('admin-overview-pulse'));
assert.equal((overview.match(/adminExecutiveNextDecisionView\(/g)||[]).length,1);
assert.equal((overview.match(/adminAttentionCenter\(/g)||[]).length,1);
assert.match(overview,/admin-overview-quick-navigation/);
const start=merchant.indexOf('function merchantGrowthChoose(');
const end=merchant.indexOf('\n}',start);
assert.ok(start>=0&&end>start,'Growth choice helper exists');
const container={focused:false};
const panels=Array.from({length:3},()=>({
 open:false,scrollIntoView(){this.scrolled=true},
 querySelector(){return {focus(){container.focused=true}}}
}));
const root={open:false,querySelectorAll:()=>panels};
const ctx=vm.createContext({document:{getElementById:id=>id==='merchant-workspace-growth'?root:null}});
vm.runInContext(merchant.slice(start,end+2)+'\nthis.choose=merchantGrowthChoose;',ctx);
assert.equal(ctx.choose('not-allowed'),false);
assert.equal(ctx.choose('network'),true);
assert.equal(root.open,true);
assert.deepEqual(panels.map(x=>x.open),[false,true,false]);
assert.equal(container.focused,true);
assert.equal(panels[1].scrolled,true);
assert.equal(ctx.choose('campaigns'),true);
assert.deepEqual(panels.map(x=>x.open),[false,false,true]);
assert.equal((merchant.match(/onclick="merchantGrowthChoose\('/g)||[]).length,3);
assert.match(publicCss,/\.tamao-tracking-empty/);
assert.match(publicCss,/\.tamao-footer-link-group/);
assert.match(workspaceCss,/\.admin-overview-quick-navigation/);
assert.match(workspaceCss,/\.merchant-growth-choices/);
assert.match(landingCss,/V1\.983/);
assert.match(audit,/node tests\/modernizacao-ux-v1-983\.mjs/);
console.log('V1.983 PASS — task-first Admin, partner growth choice, grouped footer and neutral order empty states.');
