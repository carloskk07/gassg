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
console.log('TAMÃO — checkpoint, stable tasks, recovery steps and acceptance scope PASS');
