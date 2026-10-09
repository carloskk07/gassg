import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(path)=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');

const admin=read('js/admin.js');
const adminOps=read('supabase/functions/admin-ops/index.ts');
const css=read('css/components.css');
const migration=read('supabase/migrations/20261009150000_admin_billing_plan_governance_v1_133.sql');

const poll=admin.slice(
  admin.indexOf('async function adminPoll()'),
  admin.indexOf('function openAdminPortal')
);
assert.ok(poll.includes("await adminRefresh({silent:true})"),
  'polling deve continuar atualizando o summary');
assert.ok(!poll.includes('d.merchantBilling'),
  'adminPoll não pode usar d fora de escopo');
assert.ok(!poll.includes("push(linked?'critical'"),
  'adminPoll não pode construir a fila de atenção');

const attention=admin.slice(
  admin.indexOf('function adminAttentionItems'),
  admin.indexOf('function adminAttentionCenter')
);
assert.ok(attention.includes("refund.status==='review_required'"),
  'refunds em revisão precisam subir para Atenção Agora');
assert.ok(attention.includes("statement.status==='overdue'"),
  'fechamentos vencidos precisam subir para Atenção Agora');
assert.ok(attention.includes("event.status==='review_required'"),
  'eventos PSP em revisão precisam subir para Atenção Agora');
assert.ok(attention.includes('account.sales_hold'),
  'hold financeiro precisa subir para Atenção Agora');

assert.ok(admin.includes("function adminBillingProviderName"),
  'nome do PSP deve ser dinâmico');
assert.ok(admin.includes("Access Token"),
  'Mercado Pago deve usar nomenclatura Access Token');
assert.ok(admin.includes("PSP E2E"),
  'saúde do sistema deve separar API de prova E2E');
assert.ok(admin.includes("API do PSP validada; E2E financeiro ainda pendente."),
  'API válida não pode ser promovida silenciosamente a E2E');
assert.ok(admin.includes("Pix de cobrança TAMÃO → revenda"),
  'Pix de cobrança da plataforma precisa ter semântica inequívoca');
assert.ok(!admin.includes('<span class="label">Woovi</span>'),
  'System Health não pode manter PSP Woovi hardcoded');

assert.ok(admin.includes("Taxa global de fallback"),
  'política global deve declarar natureza fallback');
assert.ok(admin.includes("taxa efetiva TAMÃO vem do plano de cobrança"),
  'UI deve explicar autoridade econômica dos planos');
assert.ok(admin.includes("async function adminSaveBillingPlan"),
  'planos de cobrança devem possuir ação administrativa auditada');
assert.ok(adminOps.includes('"merchant-billing-plan"'),
  'admin API precisa expor ação governada de plano');
assert.ok(adminOps.includes('admin_merchant_billing_plan_action'),
  'admin API deve usar RPC transacional de plano');
assert.ok(adminOps.includes('policy_version,updated_by,last_change_reason'),
  'summary deve transportar versão e proveniência dos planos');

assert.match(migration,/add column if not exists policy_version integer not null default 1/i,
  'plano precisa ser versionado');
assert.match(migration,/create table if not exists public\.merchant_billing_plan_history/i,
  'histórico imutável de plano precisa existir');
assert.match(migration,/create or replace function public\.admin_merchant_billing_plan_action/i,
  'RPC administrativa de plano precisa existir');
assert.match(migration,/FLEX_BILLING_PLAN_MUST_REMAIN_ACTIVE/,
  'Flex Diário precisa permanecer fallback obrigatório');
assert.match(migration,/BILLING_PLAN_VERSION_CONFLICT/,
  'edição concorrente de plano precisa falhar fechado');
assert.match(migration,/action_requests/,
  'mutação de plano precisa ser idempotente');
assert.match(migration,/platform_admin_audit/,
  'mutação de plano precisa registrar auditoria');
assert.match(migration,/future-orders-only/,
  'alteração de plano precisa preservar snapshots históricos');
assert.match(migration,/revoke all on table public\.merchant_billing_plan_history\s+from public,anon,authenticated/i,
  'histórico financeiro não pode ficar exposto ao browser');

assert.ok(admin.includes("active:false,sortOrder,reason"),
  'produto novo deve nascer pausado para revisão explícita');
assert.ok(admin.includes('function adminFilterRegistry'),
  'catálogo amplo precisa de busca/filtro operacional');
assert.ok(css.includes('.admin-registry-product[hidden]'),
  'filtro de catálogo precisa esconder apenas visualmente os itens');
assert.ok(admin.includes('admin-audit-metadata'),
  'auditoria precisa expor metadata forense');
assert.ok(css.includes('.admin-audit-metadata'),
  'metadata forense precisa permanecer legível');

assert.ok(admin.includes("CNPJ_EVIDENCE_REQUIRED")===false,
  'códigos internos de API não devem vazar para a UI');
assert.ok(admin.includes("Registre a fonte/evidência usada para verificar o CNPJ"),
  'UI deve exigir evidência CNPJ');
assert.ok(adminOps.includes('CNPJ_EVIDENCE_REQUIRED'),
  'API deve impedir bypass da evidência CNPJ');
assert.ok(adminOps.includes('ANP_REFERENCE_REQUIRED'),
  'API deve impedir verificação ANP sem referência');

assert.ok(admin.includes('MTTA mediano')&&admin.includes('MTTR mediano'),
  'incidentes precisam expor métricas operacionais');
assert.ok(admin.includes("adminRequireTypedConfirmation('ATIVAR LIVE'"),
  'LIVE precisa de confirmação reforçada');
assert.ok(admin.includes("adminRequireTypedConfirmation('ESTORNAR '+orderId"),
  'reversão financeira precisa de confirmação reforçada');
assert.ok(admin.includes("adminRequireTypedConfirmation('SUPERADMIN'"),
  'elevação a Superadmin precisa de confirmação reforçada');

const page=admin.slice(admin.indexOf('function adminPage()'),admin.indexOf('function adminFilterRegistry'));
assert.ok(page.includes("const badge=(n)=>Number(n)>0"),
  'badges devem desaparecer quando não há ação');
assert.ok(page.includes("paymentEvents||[]).filter(x=>x.status==='review_required')"),
  'badge Financeiro precisa contabilizar eventos em revisão');
assert.ok(page.includes("refunds||[]).filter(x=>x.status==='review_required')"),
  'badge Financeiro precisa contabilizar refunds em revisão');
assert.ok(page.includes("statements||[]).filter(x=>x.status==='overdue')"),
  'badge Financeiro precisa contabilizar D+1 vencido');

console.log('Admin control plane V1.133 passou: polling, PSP, financeiro, catálogo, compliance, incidentes e auditoria governados.');
