import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const ui=read('js/admin.js');
const css=read('css/components.css');
new vm.Script(ui);
const portion=ui.slice(ui.indexOf('function adminFinanceHomologationView(d){'),
 ui.indexOf('function adminFinanceHomologationToggleLab(){'));
assert.match(portion,/7 módulos conferidos/);
assert.match(portion,/Nenhum homologado automaticamente/);
assert.match(portion,/function adminFinanceHomologationView\(d\)/);
assert.match(portion,/adminLatestBillingWebhookProbe\(d,'mercadopago'\)/);
assert.match(portion,/adminFinanceLabLiveReadinessFromUi\(\)/);
assert.match(portion,/adminGenerateBillingWebhookProbe\(\)/);
assert.match(portion,/Data ID/);
assert.match(portion,/A simples criação do ID não valida o webhook/);
assert.match(portion,/adminFinanceHomologationToggleLab\(\)/);
assert.match(portion,/adminIndependentAdsHomologationControlsForFinance\(\)/);
assert.match(portion,/chosen\.key==='advertising'/);
assert.match(portion,/adminFinanceHomologationRefresh\(\)/);
assert.doesNotMatch(portion,/adminFinanceLabLiveCreateFromUi\(\)/,
 'No real Pix is triggered merely by loading Finance');
assert.match(ui,/const compact=adminRuntime\.section==='finance'&&adminRuntime\.financeWorkspace==='homologation'/);
assert.match(ui,/admin-finance-lab-extra/);
assert.match(ui,/admin-finance-lab-diagnostics/);
assert.match(css,/\.admin-finance-lab-guided/);
console.log('V1.922 PASS: guided finance, real webhook proof, advanced tools collapsed, no automatic billing.');
