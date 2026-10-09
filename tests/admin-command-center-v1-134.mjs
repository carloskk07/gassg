import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(path)=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const admin=read('js/admin.js');
const css=read('css/components.css');

const count=(hay,needle)=>hay.split(needle).length-1;

assert.equal(count(admin,'function adminPage()'),1,'adminPage precisa existir uma única vez');
assert.equal(count(admin,'function adminAttentionCenter(d)'),1,'attention center precisa existir uma única vez');
assert.equal(count(admin,'function adminFinanceOverview(d)'),1,'finance overview precisa existir uma única vez');

assert.ok(admin.includes('function adminSectionMeta(')
  &&admin.includes("overview:{kicker:'CENTRAL DE COMANDO'")
  &&admin.includes("finance:{kicker:'CONTROLADORIA'"),
  'cada aba precisa possuir título e descrição operacional próprios');

assert.ok(admin.includes('function adminOperationalStrip(d)')
  &&admin.includes('OPERAÇÃO')
  &&admin.includes('Prontidão')
  &&admin.includes('Última atualização'),
  'cabeçalho precisa expor modo, prontidão e frescor antes de detalhes');

assert.ok(admin.includes('function adminRelativeTime(')
  &&admin.includes('adminRelativeTime(adminRuntime.lastSyncAt)'),
  'painel precisa mostrar frescor relativo dos dados');

assert.ok(admin.includes('function adminNavIcon(id)')
  &&admin.includes('<svg viewBox="0 0 24 24"')
  &&admin.includes('adminNavIcon(id)'),
  'navegação precisa usar iconografia SVG consistente');

assert.ok(admin.includes("document.addEventListener('keydown'")
  &&admin.includes('event.ctrlKey||event.metaKey')
  &&admin.includes("String(event.key).toLowerCase()==='k'")
  &&admin.includes('adminFocusSearch()'),
  'Ctrl/Cmd+K precisa focar a busca global');

assert.ok(admin.includes('<kbd class="admin-search-shortcut">Ctrl K</kbd>')
  &&admin.includes('Buscar pedido, telefone, CNPJ, revenda ou cliente'),
  'busca precisa se comportar visualmente como command palette');

assert.ok(admin.includes('admin-exec-grid')
  &&admin.includes('Receita TAMÃO 30d')
  &&admin.includes('Pedidos ativos')
  &&admin.includes('Revendas ativas')
  &&admin.includes("label:'Financeiro'")
  &&admin.includes("label:'Incidentes'"),
  'visão geral precisa privilegiar KPIs executivos e risco atual');

const adminPage=admin.slice(admin.indexOf('function adminPage()'),admin.indexOf('function adminFilterRegistry'));
const execIndex=adminPage.indexOf('admin-exec-grid');
const attentionIndex=adminPage.indexOf('adminAttentionCenter(d)');
assert.ok(execIndex>=0&&attentionIndex>execIndex,
  'KPIs executivos devem aparecer antes da fila de decisões');

assert.ok(admin.includes('Decisões prioritárias')
  &&admin.includes('admin-severity-summary')
  &&admin.includes('admin-attention-rank'),
  'Atenção Agora precisa ser uma fila de decisão com severidade e prioridade');

assert.ok(adminPage.includes('adminFinanceOverview(d)')
  &&admin.includes('POSIÇÃO FINANCEIRA')
  &&admin.includes('D+1 em aberto')
  &&admin.includes('Crédito pré-pago')
  &&admin.includes('Refunds em revisão'),
  'Financeiro precisa abrir com visão executiva antes da implementação detalhada');

assert.ok(admin.includes('admin-psp-status-grid')
  &&admin.includes('Pagamento E2E')
  &&admin.includes('API Mercado Pago'),
  'PSP deve mostrar estados operacionais em um grid legível');

assert.ok(admin.includes('<details class="admin-tech-details">')
  &&admin.includes('Detalhes técnicos da integração')
  &&admin.includes('Webhook Mercado Pago único (Order):')
  &&admin.includes('Pix de cobrança TAMÃO → revenda:'),
  'contratos e endpoints precisam permanecer disponíveis, porém recolhidos');

assert.ok(admin.includes('<div class="admin-nav-group">Operação</div>')
  &&admin.includes('<div class="admin-nav-group">Governança</div>')
  &&admin.includes('admin-sidebar-foot'),
  'menu deve separar operação de governança e mostrar contexto da sessão');

assert.ok(css.includes('/* TAMÃO V1.134 — Admin Command Center */')
  &&css.includes('body:has(.admin-page) .shell')
  &&css.includes('.admin-ops-strip')
  &&css.includes('.admin-exec-grid')
  &&css.includes('.admin-command-card'),
  'CSS V1.134 precisa conter a linguagem visual do command center');

assert.ok(css.includes('.admin-nav-icon svg')
  &&css.includes('.admin-sidebar-brand')
  &&css.includes('.admin-sidebar-mode'),
  'sidebar premium precisa preservar ícones, marca e modo operacional');

assert.ok(css.includes('.admin-search-shortcut')
  &&css.includes('.admin-search-results')
  &&css.includes('position:absolute'),
  'resultados da busca precisam funcionar como camada compacta');

assert.ok(css.includes('.admin-psp-status-grid')
  &&css.includes('.admin-tech-details')
  &&css.includes('.admin-state-dot.ok'),
  'PSP precisa diferenciar estado e disclosure técnico visualmente');

assert.ok(css.includes('@media(max-width:820px)')
  &&css.includes('@media(max-width:560px)')
  &&css.includes('.admin-exec-grid.finance'),
  'command center precisa continuar responsivo');

console.log('Admin Command Center V1.134 passou: hierarquia, navegação, KPIs, busca, PSP e responsividade protegidos.');
