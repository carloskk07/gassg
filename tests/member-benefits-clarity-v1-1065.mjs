import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const code=read('js/growth-benefits-statement.js');
const css=read('css/public-ux.css');
const audit=read('.github/workflows/audit.yml');
new vm.Script(code,{filename:'growth-benefits-statement.js'});
const htmlEscape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
const ctx=vm.createContext({
  liveRuntime:{session:{user:{id:'member-a'}}},
  liveReady:()=>true,route:()=> 'refer',render(){},
  BRL:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),
  esc:htmlEscape
});
vm.runInContext(code,ctx);
const money=ctx.tamaoBenefitsStatementMoney;
const amount={amountCents:1190,amountMicrocents:1190000000};
assert.match(money({...amount,money_type:'transfer',status:'pending'}),/^Saque solicitado:/);
assert.match(money({...amount,money_type:'transfer',status:'approved'}),/^Saque aprovado:/);
assert.match(money({...amount,money_type:'transfer',status:'paid'}),/^Saque pago:/);
assert.match(money({...amount,money_type:'transfer',status:'cancelled'}),/^Saque cancelado:/);
assert.doesNotMatch(money({...amount,money_type:'transfer',status:'review'}),/pago/i,
 'A review request is not a bank payment');
assert.match(money({...amount,money_type:'discount',status:'used'}),/^Desconto utilizado:/);
assert.match(money({...amount,money_type:'discount',status:'expired'}),/^Cupom vencido:/);
assert.match(money({...amount,money_type:'discount',status:'cancelled'}),/^Cupom cancelado:/);
assert.match(money({...amount,money_type:'discount',status:'available'}),/^Cupom de desconto:/);
assert.match(money({money_type:'network',status:'validated',amountCents:0,amountMicrocents:400000}),
 /menos de R\$ 0,01/,'Subcent share must never round up');

const entries=[
 {money_type:'transfer',title:'Saque solicitado',origin:'Rede TAMÃO',
  detail:'Solicitação não representa pagamento realizado.',status:'pending',...amount,occurredAt:'2026-11-17T12:00:00Z'},
 {money_type:'discount',title:'Cupom utilizado',origin:'Clube TAMÃO',
  detail:'Cupom válido apenas para pedido elegível.',status:'used',...amount,occurredAt:'2026-11-16T12:00:00Z'},
 {money_type:'wallet',title:'Ajuste',origin:'Loja <script>alert(1)</script>',
  detail:'Ajuste da compra, não um novo bônus.',status:'moved',amountCents:-100,amountMicrocents:-100000000,
  occurredAt:'2026-10-22T12:00:00Z'}
];
ctx.testRows=entries;
vm.runInContext(`tamaoBenefitStatement.userId='member-a';tamaoBenefitStatement.opened=true;
  tamaoBenefitStatement.items=testRows;tamaoBenefitStatement.busy=false;
  tamaoBenefitStatement.hasMore=true;`,ctx);
const html=ctx.tamaoBenefitsStatementPanel();
assert.equal((html.match(/class="tamao-statement-month"/g)||[]).length,2,
 'Month grouping must follow the complete paginated items, without duplicated month headings');
assert.match(html,/Novembro de 2026/);
assert.match(html,/Outubro de 2026/);
assert.match(html,/Movimento de saldo/);
assert.match(html,/Participação na Rede|Solicitação de saque/);
assert.match(html,/Saque solicitado:/);
assert.match(html,/Cupom de desconto/);
assert.match(html,/tamao-statement-waiting/);
assert.match(html,/tamao-statement-complete/);
assert.match(html,/aria-label="Filtrar extrato"/);
assert.match(html,/Ver mais lançamentos/);
assert.match(html,/aria-busy="false"/);
ctx.boundaryRow={...entries[0],occurredAt:'2026-12-01T01:30:00Z'};
vm.runInContext('tamaoBenefitStatement.items=[boundaryRow];',ctx);
const boundary=ctx.tamaoBenefitsStatementPanel();
assert.match(boundary,/Novembro de 2026/,'Statement month must follow the Brazilian operational timezone');
assert.doesNotMatch(boundary,/Dezembro de 2026/);
vm.runInContext('tamaoBenefitStatement.items=[];tamaoBenefitStatement.hasMore=false;',ctx);
assert.match(ctx.tamaoBenefitsStatementPanel(),/Nenhum lançamento nesta categoria/);
vm.runInContext('tamaoBenefitStatement.busy=true;',ctx);
const loading=ctx.tamaoBenefitsStatementPanel();
assert.match(loading,/aria-busy="true"/);
assert.doesNotMatch(loading,/Nenhum lançamento nesta categoria/);

assert.doesNotMatch(html,/<script>alert\(1\)<\/script>/,'Origins must stay escaped');
assert.match(html,/&lt;script&gt;/);
assert.ok(code.includes('tamaoBenefitsStatementStillCurrent')&&
 code.includes('statementOnly:true')&&code.includes('moneyMoved!==false'));
assert.doesNotMatch(code,/adminPerform\(|adminInvoke\(|create-order|payment-create/i);
for(const token of [
 '.tamao-statement-entry-top','.tamao-statement-entry-money',
 '.tamao-statement-waiting','.tamao-statement-inactive',
 '@media(max-width:580px)', '.tamao-statement-filters button:focus-visible'
])assert.ok(css.includes(token),'Statement responsive style missing: '+token);
assert.match(audit,/node tests\/member-benefits-clarity-v1-1065\.mjs/);
console.log('V1.1065 PASS — readable origins, grouped months, honest payout/coupon states, privacy and responsive UX.');
