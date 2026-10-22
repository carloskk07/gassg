import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const diary=read('docs/TAMAO_EXECUCAO.md');
const scope=read('docs/TAMAO_ESCOPO.md');
const architecture=read('docs/TAMAO-EXPANSAO-INTEGRADA.md');
const required=[
 'CONT-001','AUD-001','CORE-001','PRO-001','RIDE-001','STAY-001',
 'UI-001','SEO-001','ADS-001','FIN-001','REP-001','ADMIN-001',
 'QA-001','REL-001'
];
assert.match(diary,/carloskk07\/gassg/);
assert.match(diary,/feat\/unified-discovery-tamao/);
assert.match(diary,/pull\/492/);
assert.match(diary,/Commit-base de `main`/);
assert.match(diary,/SHA.*auditad|SHA.*auditoria|SHA.*Auditoria/i);
for(const id of required){
  const diaryCount=(diary.match(new RegExp('\\| '+id+' \\|','g'))||[]).length;
  assert.equal(diaryCount,1,id+' must have exactly one status row in execution diary');
  assert.ok(scope.includes(id),id+' needs acceptance criteria in scope');
}
for(const checkpoint of [
 'ÚLTIMA ETAPA CONCLUÍDA','ETAPA ATUAL','PRÓXIMA AÇÃO EXATA',
 'ARQUIVOS QUE DEVEM SER INSPECIONADOS','TESTES QUE DEVEM SER EXECUTADOS',
 'BLOQUEIOS CONHECIDOS','CONDIÇÃO DE CONCLUSÃO']){
  assert.ok(diary.includes('**'+checkpoint+':**'),checkpoint+' missing');
}
assert.match(diary,/PRELAUNCH/);
assert.match(diary,/não aplicada|não aplicado/i);
assert.match(diary,/portais/);
assert.match(diary,/recupera|retomar/i);
assert.match(scope,/critério|aceitação/i);
assert.match(architecture,/não.*cobrança|sem.*cobrança/i);
assert.doesNotMatch(diary,/sb_secret_[A-Za-z0-9_-]+|password\s*[:=]\s*["']/i);
assert.doesNotMatch(scope,/sb_secret_[A-Za-z0-9_-]+|password\s*[:=]\s*["']/i);

// Critical operational acceptance rule: an implemented UI, a passing CI, or
// a deployed SHA alone MUST NOT certify an end-to-end business journey.
const operationalRule='## Regra obrigatória de conclusão operacional — 22/10/2026';
assert.ok(scope.includes(operationalRule),'operational completion rule missing from canonical scope');
for(const phrase of [
 'Ciclo e contrato','Automação','Integração real','Implantação',
 'Financeiro (quando aplicável)','Evidência auditável','Revisão'
])assert.ok(scope.includes(phrase),'mandatory operational gate missing: '+phrase);
assert.ok(scope.includes('PILOTO CONTROLADO'),'pilot cannot automatically mean completed');
assert.ok(scope.includes('não autentica o provedor'),'documentation gate cannot claim banking validation');

const startMarker='<!-- INICIO_GATES_OPERACIONAIS -->';
const endMarker='<!-- FIM_GATES_OPERACIONAIS -->';
assert.equal(diary.split(startMarker).length,2,'exactly one operational table start');
assert.equal(diary.split(endMarker).length,2,'exactly one operational table end');
const section=diary.split(startMarker)[1].split(endMarker)[0];
const rows=section.split('\n').filter(line=>/^\|\s*OP-[A-Z-]+\s*\|/.test(line));
const ids=[
 'OP-ORDER','OP-MERCHANT','OP-PIX','OP-REFERRAL',
 'OP-COUPON','OP-DISCOVERY','OP-MOBILITY','OP-ADS'
];
const allowedStates=new Set([
 'EM IMPLEMENTAÇÃO','IMPLEMENTADA','EM VALIDAÇÃO',
 'PILOTO CONTROLADO','CONCLUÍDA','BLOQUEADA'
]);
const financingRequired=new Set([
 'OP-ORDER','OP-MERCHANT','OP-PIX','OP-REFERRAL','OP-COUPON','OP-ADS'
]);
const parseRow=line=>line.split('|').slice(1,-1).map(x=>x.trim());
const missingProof=s=>!s||s.length<18||
 /^(?:PENDENTE|A VERIFICAR|NÃO COMPROVADO|SEM EVIDÊNCIA|N\/A|—|-)\b/i.test(s)||
 /^NÃO SE APLICA/i.test(s);
function assertOperationalEvidence(parts){
 const [id,,state,,automatic,realIntegration,financial,finalProof,publishedSha,recovery,pending]=parts;
 assert.ok(allowedStates.has(state),'invalid state for '+id+': '+state);
 if(state!=='CONCLUÍDA')return;
 // These MUST reference the exact tested/published artifacts and final result;
 // this structural check cannot authenticate an external provider or bank.
 for(const [kind,value] of Object.entries({
  automatic,realIntegration,finalProof,publishedSha,recovery
 })){
  assert.ok(!missingProof(value),id+' cannot close without '+kind);
 }
 assert.ok(/(?:https:\/\/|ADMIN-REF:|TRACE-REF:)/i.test(automatic),
  id+' needs automated test evidence reference');
 assert.ok(/(?:https:\/\/|ADMIN-REF:|TRACE-REF:)/i.test(realIntegration),
  id+' needs actual E2E integration evidence reference');
 assert.ok(/(?:https:\/\/|ADMIN-REF:|TRACE-REF:)/i.test(finalProof),
  id+' needs observed final outcome evidence reference');
 assert.ok(/[0-9a-f]{7,40}/i.test(publishedSha),
  id+' must provide published source SHA');
 assert.ok(!missingProof(financial),id+' must explain financial verification or justified exemption');
 if(financingRequired.has(id)){
  assert.ok(!/^NÃO SE APLICA/i.test(financial),
   id+' handles money and cannot waive PSP/settlement evidence');
  assert.ok(/(?:https:\/\/|ADMIN-REF:|TRACE-REF:)/i.test(financial),
   id+' needs provider/financial evidence reference');
 }else {
  assert.ok(
   /(?:https:\/\/|ADMIN-REF:|TRACE-REF:)/i.test(financial)||
   /^NÃO SE APLICA: .{20,}/i.test(financial),
   id+' needs documented no-money rationale or financial evidence'
  );
 }
 assert.ok(/^(?:NENHUMA|SEM PENDÊNCIAS)$/i.test(pending),
  id+' cannot close with pending blockers');
}
const observed=[];
for(const line of rows){
 const parts=parseRow(line);
 assert.equal(parts.length,11,'operational gate must have exactly 11 cells');
 assertOperationalEvidence(parts);
 observed.push(parts[0]);
}
assert.deepEqual([...observed].sort(),[...ids].sort(),
 'operational completion inventory must contain exactly the required journeys');
const badRow=parseRow(rows.find(r=>r.includes('OP-REFERRAL')));
badRow[2]='CONCLUÍDA';
assert.throws(()=>assertOperationalEvidence(badRow),
 'test must reject a false positive completion lacking real-world evidence');

console.log('TAMÃO — checkpoint and operational E2E evidence gates PASS (records only; not PSP homologation)');
