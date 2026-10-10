import assert from 'node:assert/strict';
import fs from 'node:fs';

const admin=fs.readFileSync(new URL('../js/admin.js',import.meta.url),'utf8');

assert.ok(
  admin.includes("const e2eValidated=preflight")
  &&admin.includes("const activationKind=e2eValidated?'reactivation':'pilot'"),
  'ação administrativa precisa decidir entre piloto e reativação pela prova E2E persistida'
);

assert.ok(
  admin.includes("const typed=activationKind==='pilot'?'ATIVAR PILOTO':'REATIVAR'")
  &&admin.includes('Preflight aprovado.')
  &&admin.includes('não concede status HOMOLOGADO'),
  'piloto precisa exigir confirmação explícita diferente de homologação'
);

assert.ok(
  admin.includes('Referência do primeiro piloto real de ')
  &&admin.includes('Referência da reativação de ')
  &&!admin.includes('Referência da homologação E2E de '),
  'prompt não pode continuar chamando ativação inicial de homologação'
);

assert.ok(
  admin.includes('Primeiro piloto real ativado em ')
  &&admin.includes('aguardando prova E2E')
  &&admin.includes('prova E2E já validada'),
  'feedback precisa distinguir piloto pendente de reativação com prova existente'
);

assert.ok(
  admin.includes("provider:providerKey")
  &&admin.includes("enabled:enabled===true")
  &&admin.includes("reference:reference.trim()"),
  'mudança semântica não pode alterar o contrato da mutation'
);

console.log('V1.143 passou: UX administrativa separa PILOTO, REATIVAR e HOMOLOGADO sem ambiguidade.');
