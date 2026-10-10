import assert from 'node:assert/strict';
import fs from 'node:fs';

const admin=fs.readFileSync(new URL('../js/admin.js',import.meta.url),'utf8');

assert.ok(
  admin.includes("const e2eValidated=preflight")
  &&admin.includes("const activationKind=e2eValidated?'reactivation':'pilot'"),
  'ação administrativa precisa decidir entre piloto e reativação pela prova E2E persistida'
);

assert.ok(
  admin.includes("const typed=activationKind==='pilot'?'ATIVAR PAGAMENTOS':'REATIVAR'")
  &&admin.includes('Verificação aprovada.')
  &&admin.includes('mantém a primeira transação sob controle reforçado'),
  'ativação precisa exigir confirmação explícita sem fabricar validação transacional'
);

assert.ok(
  admin.includes('Referência da ativação de ')
  &&admin.includes('Referência da reativação de ')
  &&!admin.includes('Referência da homologação E2E de '),
  'prompt deve tratar a mudança como ativação e não homologação'
);

assert.ok(
  admin.includes('Confirmação automática ativada em ')
  &&admin.includes('aguardando validação transacional')
  &&admin.includes('integração já verificada'),
  'feedback precisa distinguir ativação pendente de reativação já verificada'
);

assert.ok(
  admin.includes("provider:providerKey")
  &&admin.includes("enabled:enabled===true")
  &&admin.includes("reference:reference.trim()"),
  'mudança semântica não pode alterar o contrato da mutation'
);

console.log('V1.143 passou: UX administrativa separa PILOTO, REATIVAR e HOMOLOGADO sem ambiguidade.');
