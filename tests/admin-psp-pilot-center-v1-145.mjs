import assert from 'node:assert/strict';
import fs from 'node:fs';

const admin=fs.readFileSync(new URL('../js/admin.js',import.meta.url),'utf8');
const adminOps=fs.readFileSync(new URL('../supabase/functions/admin-ops/index.ts',import.meta.url),'utf8');
const v144=fs.readFileSync(new URL('../supabase/migrations/20261010011500_single_unproven_psp_pilot_v1_144.sql',import.meta.url),'utf8');

assert.ok(
  adminOps.includes('merchantSaleAttemptsPromise=["superadmin","finance","readonly"].includes(actorRole)')
  &&adminOps.includes('admin.from("merchant_sale_payment_attempts")')
  &&adminOps.includes('pilot_guard,created_at,updated_at')
  &&adminOps.includes('attempts:merchantSaleAttempts.data??[]'),
  'snapshot financeiro precisa expor tentativas PSP com pilot_guard sem abrir para perfis operacionais'
);

assert.ok(
  (adminOps.match(/providerCatalog:\[\],routes:\[\],verifications:\[\],attempts:\[\]/g)||[]).length>=2,
  'escopos sem autoridade financeira precisam receber attempts vazio'
);

assert.ok(
  admin.includes('function adminMerchantPspPilotCenter(d)')
  &&admin.includes('Central de validação transacional')
  &&admin.includes('VALIDAÇÃO EM CURSO')
  &&admin.includes('AGUARDA LIQUIDAÇÃO')
  &&admin.includes('AGUARDA 1ª VENDA')
  &&admin.includes('INTEGRAÇÃO VERIFICADA')
  &&admin.includes("stage='REVISÃO'"),
  'Admin precisa materializar o ciclo operacional completo da primeira validação automática'
);

assert.ok(
  admin.includes("const attempts=(d.merchantPayments?.attempts||[]).filter(x=>x?.pilot_guard===true)")
  &&admin.includes('verificationByAttempt')
  &&admin.includes("x?.status==='verified'")
  &&admin.includes("caps.e2eValidated===true||Boolean(verification)"),
  'central precisa cruzar pilot_guard com evidência transacional real em vez de inferir só pela interface'
);

assert.ok(
  admin.includes('Validação automática bloqueada por segurança.')
  &&admin.includes('O TAMÃO não deve criar uma segunda cobrança automática até existir prova do resultado.')
  &&admin.includes('Não libere nova tentativa. Suspenda a automação e confira o PSP'),
  'review_required precisa permanecer fail-closed e orientar investigação'
);

assert.ok(
  admin.includes("adminSetMerchantPaymentCapability(\\'")
  &&admin.includes("false)\">Suspender automação</button>")
  &&admin.includes('não existe atalho para forçar validação')
  &&admin.includes('não transforma manualmente uma integração em verificada'),
  'central só pode suspender autoridade; não pode forçar evidência/validação'
);

assert.ok(
  !admin.includes("adminPerform('merchant-payment-pilot-resolve'")
  &&!admin.includes("adminPerform('merchant-payment-e2e-override'"),
  'V1.145 não pode introduzir mutation administrativa para limpar revisão ou fabricar evidência'
);

assert.ok(
  admin.includes("if(status==='review_required')")
  &&admin.includes("'critical','Pagamento automático exige revisão'")
  &&admin.includes("age>2*60*60*1000")
  &&admin.includes("'high','Validação de pagamento aberta há +2h'"),
  'central de atenção precisa elevar revisão e validação excessivamente antiga'
);

assert.ok(
  v144.includes('merchant_sale_payment_attempts_one_unproven_pilot')
  &&v144.includes('MERCHANT_PAYMENT_PILOT_IN_FLIGHT')
  &&v144.includes("set status='review_required'"),
  'observabilidade V1.145 não pode enfraquecer a contenção transacional V1.144'
);

// Modelo pequeno da precedência visual: revisão > integração verificada > aprovado > live > espera > encerrado.
function stage({status,e2e,hasAttempt,direct=true,canValidate=true}){
  if(status==='review_required')return 'REVISÃO';
  if(e2e)return 'INTEGRAÇÃO VERIFICADA';
  if(status==='approved')return 'AGUARDA LIQUIDAÇÃO';
  if(['preparing','checkout_ready','pending'].includes(status))return 'VALIDAÇÃO EM CURSO';
  if(!hasAttempt&&direct&&canValidate)return 'AGUARDA 1ª VENDA';
  return 'VALIDAÇÃO ENCERRADA';
}
assert.equal(stage({status:'review_required',e2e:false,hasAttempt:true}),'REVISÃO');
assert.equal(stage({status:'approved',e2e:false,hasAttempt:true}),'AGUARDA LIQUIDAÇÃO');
assert.equal(stage({status:'pending',e2e:false,hasAttempt:true}),'VALIDAÇÃO EM CURSO');
assert.equal(stage({status:'',e2e:false,hasAttempt:false}),'AGUARDA 1ª VENDA');
assert.equal(stage({status:'approved',e2e:true,hasAttempt:true}),'INTEGRAÇÃO VERIFICADA');
assert.equal(stage({status:'rejected',e2e:false,hasAttempt:true}),'VALIDAÇÃO ENCERRADA');

console.log('V1.145 passou: Admin enxerga validações PSP sem autoridade para fabricar evidência ou integração verificada.');
