import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {isValidOperatorCnpj,normalizeOperatorCnpj} from '../supabase/functions/_shared/operator-cnpj-v1-1159.mjs';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261123040000_platform_operator_cnpj_transition_v1_1159.sql');
const edge=read('supabase/functions/operator-transition-ops/index.ts');
const admin=read('js/admin-network-payout.js');
const adminUI=read('js/admin-operator-transition.js');
const legal=read('js/legal.js');
const publicModule=read('js/operator-public-identity.js');
const portals=read('scripts/build-live-portals.mjs');
const audit=read('.github/workflows/audit.yml');
const ci=read('.github/workflows/isolated-supabase-integration.yml');
const documentation=read('docs/operations/pf-to-pj-cutover-v1-1159.md');
assert.equal(normalizeOperatorCnpj('11.222.333/0001-81'),'11222333000181');
assert.ok(isValidOperatorCnpj('11.222.333/0001-81'));
assert.ok(isValidOperatorCnpj('AB12CD34EF5602'),'CNPJ alfanumérico deve ser aceito');
for(const c of ['11222333000180','AB12CD34EF5603','11111111111111',
  '00000000000000','AB12CD34EF560','AB12CD34EF56ZZ','c%']) {
  assert.equal(isValidOperatorCnpj(c),false,c);
}
for(const x of ['platform_cnpj_valid_v1_1159','platform_operator_transition_v1_1159',
 'platform_operator_transition_gates_v1_1159','platform_operator_transition_audit_v1_1159',
 'platform_operator_transition_read_v1_1159',
 'platform_operator_transition_stage_v1_1159','platform_operator_transition_gate_v1_1159',
 'platform_operator_transition_activate_v1_1159','platform_operator_public_identity_v1_1159']) {
 assert.ok(sql.includes(x),x);
}
assert.ok(sql.includes("default 'not_started'"));
assert.ok(sql.includes("default 'individual'"));
assert.ok(sql.includes("stage='active' and p.entity_kind='company'"),
  'Dados do candidato nunca devem vazar ao público');
assert.match(sql,/when s%11<2 then 0 else 11-s%11/);
assert.ok(sql.includes("n_all<>12 or n_ok<>n_all"),'Não ativar com gates parciais');
assert.ok(sql.includes("where state in ('requested','approved','review')"),
  'Saques manuais em aberto não podem desaparecer na virada');
assert.ok(sql.includes("set verified_at=null,verified_by=null,evidence_reference=null"),
  'A alteração do cadastro invalida todas as comprovações anteriores');
assert.ok(sql.includes('revision=p_expected_revision'),'Controle concorrente obrigatório');
assert.ok(sql.includes('enable row level security'),'Proteção RLS');
assert.ok(sql.includes('revoke all on public.platform_operator_transition_v1_1159'));
assert.ok(sql.includes('grant execute on function public.platform_operator_public_identity_v1_1159() to anon,authenticated,service_role'));
assert.doesNotMatch(sql,/update\s+public\.(?:network_.*(?:policy|awards)|platform_payment_reconciliation_config|merchants)\b/i);
for(const action of ['read','stage','gate','activate']){
 assert.ok(edge.includes('if(action==="'+action+'")'));
}
assert.ok(edge.includes('data.user.email_confirmed_at'));
assert.ok(edge.includes('permission?.admin_role!=="superadmin"'));
assert.ok(edge.includes('enforceApiQuota'));
assert.ok(edge.includes('isValidOperatorCnpj'));
assert.ok(edge.includes('CONFIRMO ATIVACAO PJ'));
assert.ok(!edge.includes('MERCADOPAGO_ACCESS_TOKEN'),'Não tocar credenciais PSP');
assert.ok(admin.includes('adminOperatorMigrationLoad()'));
assert.ok(admin.includes('adminOperatorTransitionSection()'));
new vm.Script(admin,{filename:'js/admin-network-payout.js'});
new vm.Script(adminUI,{filename:'js/admin-operator-transition.js'});
new vm.Script(legal,{filename:'js/legal.js'});
assert.ok(adminUI.includes('12 verificações')||adminUI.includes('12 verificação'));
assert.ok(adminUI.includes('adminOperatorGate(false)'),'Deve reabrir provas');
assert.ok(adminUI.includes('CONFIRMO ATIVACAO PJ'));
assert.ok(legal.includes('platform_operator_public_identity_v1_1159'));
assert.ok(legal.includes('tamaoOperatorPublicProfileSchedule'), 'Consulta somente sob demanda');
assert.ok(publicModule.includes('textContent'),'Não renderizar razão social por innerHTML');
new vm.Script(publicModule,{filename:'js/operator-public-identity.js'});
assert.ok(portals.includes("fs.rmSync(path.join(target,'js','admin-operator-transition.js'),{force:true})"),'Não distribuir interface Admin em Cliente/Parceiro');
assert.ok(audit.includes('operator-cnpj-transition-v1-1159.mjs'));
assert.ok(ci.includes('operator-cnpj-transition-v1-1159.sql'));
assert.ok(documentation.includes('CNPJ alfanumérico')&&documentation.includes('12 comprovações'));
console.log('V1.1159 OK: CNPJ numérico/alfanumérico, Admin isolado, 12 gates, sem Pix/titularidade fictícia');
