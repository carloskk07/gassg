import assert from 'node:assert/strict';
import fs from 'node:fs';

const merchant=fs.readFileSync(new URL('../js/merchant.js',import.meta.url),'utf8');
const merchantTeam=fs.readFileSync(new URL('../supabase/functions/merchant-team/index.ts',import.meta.url),'utf8');

// A API aceita uma sintaxe deliberadamente ampla para e-mail; portanto o frontend
// não pode assumir que o valor é seguro para um contexto JavaScript inline.
const hostileEmail="x');globalThis.__tamao_xss=1;//@evil.com";
assert.match(hostileEmail,/^[^@\s]+@[^@\s]+\.[^@\s]+$/,'payload de regressão precisa passar pela forma aceita pela API');

assert.ok(
  !merchant.includes("copyMerchantTeamInstructions('${esc(invite.email)}')"),
  'e-mail persistido não pode ser interpolado dentro de string JavaScript inline'
);
assert.ok(
  merchant.includes('data-invite-id="${esc(invite.inviteId)}"') &&
  merchant.includes('copyMerchantTeamInstructionsByInvite(this.dataset.inviteId)'),
  'handler deve transportar somente o UUID do convite via data-*'
);
assert.ok(
  merchant.includes("const invite=(globalThis.merchantRuntime?.team?.pendingInvites||[]).find"),
  'e-mail deve ser resolvido como dado somente depois do clique'
);
assert.ok(
  merchantTeam.includes('/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/'),
  'teste deve continuar acompanhando a validação real do endpoint'
);

// Guard rail adicional: nenhum e-mail de equipe pode reaparecer interpolado
// diretamente em onclick/onchange/oninput.
for(const line of merchant.split('\n')){
  if(/on(?:click|change|input)=/.test(line) && /invite\.email|member\.email/.test(line)){
    throw new Error('dado de e-mail voltou a um handler inline: '+line.trim());
  }
}

console.log('Inline handler stored-XSS regression passou.');
