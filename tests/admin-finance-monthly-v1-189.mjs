import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const source=read('js/admin.js');
new vm.Script(source,{filename:'js/admin.js'});
const cut=name=>{
  const start=source.indexOf('function '+name+'(');
  assert.ok(start>0,'Function missing: '+name);
  const end=source.indexOf('\n}',start);
  assert.ok(end>start,'Function closure missing: '+name);
  return source.slice(start,end+2);
};
const fmt=c=> 'R$ '+(c/100).toFixed(2).replace('.',',');
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
let role='finance';
const c=vm.createContext({
  Date,Intl,Number,Math,
  esc,adminMoney:fmt,
  adminRoleCanSection:section=>section==='finance'&&['finance','superadmin'].includes(role)
});
vm.runInContext(cut('adminFinanceMonthlyComparison')+'\n'+cut('adminFinanceMonthlyComparisonView')+
  '\nthis.compare=adminFinanceMonthlyComparison;this.view=adminFinanceMonthlyComparisonView;',c);
const row=(month,approvedCents=0,linkedRefundCents=0,approvedCount=0)=>({
  month,approvedCents,linkedRefundCents,approvedCount,
  netAfterLinkedRefundsCents:approvedCents-linkedRefundCents
});
const base={
  source:'database_complete',
  generatedAt:'2026-10-12T20:00:00Z',
  monthly:[row('2026-05',0),row('2026-06',2000,50,1),
    row('2026-07',3500,400,2),row('2026-08',10000,1000,2),
    row('2026-09',15000,3000,3),row('2026-10',100000,500,11)]
};
let m=c.compare(base);
assert.equal(m.ok,true);
assert.equal(m.latest.month,'2026-09');
assert.equal(m.previous.month,'2026-08');
assert.equal(m.partial.month,'2026-10');
assert.equal(m.approvedDelta,5000);
assert.equal(m.refundDelta,2000);
assert.equal(m.netDelta,3000);
assert.equal(m.countDelta,1);
assert.equal(m.percentage,50);
assert.equal(m.firstActivity,false);
let html=c.view(base);
for(const label of [
  'DESEMPENHO ENTRE MESES','2026-09 comparado com 2026-08',
  '50% ante o mês anterior','R$ 150,00','R$ 120,00',
  'R$ 30,00','R$ 50,00','2026-10','(parcial)',
  'sem projeção','não é receita por competência, lucro ou saldo no PSP'
])assert.ok(html.toLowerCase().includes(label.toLowerCase()),'Missing meaningful UI: '+label);
assert.equal((html.match(/admin-finance-month-row/g)||[]).length,6);
assert.ok(html.includes('aria-hidden'), 'bar graphic decorative; amounts remain readable');
assert.ok(!html.includes('onclick='), 'finance monthly KPIs must not move money');
const zeroPrevious={...base,monthly:base.monthly.map((x,i)=>i===3?row('2026-08'):x)};
m=c.compare(zeroPrevious);
assert.equal(m.ok,true);
assert.equal(m.percentage,null);
assert.equal(m.firstActivity,true);
assert.ok(c.view(zeroPrevious).includes('Início de atividade'));
assert.ok(!c.view(zeroPrevious).includes('Infinity'));
const bothZero={...base,monthly:base.monthly.map((x,i)=>
  i===3?row('2026-08'):i===4?row('2026-09'):x)};
m=c.compare(bothZero);
assert.equal(m.ok,true);
assert.equal(m.noActivity,true);
assert.ok(c.view(bothZero).includes('Sem movimentação nos meses comparados'));
const declining={...base,monthly:base.monthly.map((x,i)=>i===4?row('2026-09'):x)};
assert.equal(c.compare(declining).percentage,-100);
const refundsMoreThanApproved={...base,monthly:base.monthly.map((x,i)=>
  i===4?row('2026-09',500,800,1):x)};
assert.equal(c.compare(refundsMoreThanApproved).latest.netAfterLinkedRefundsCents,-300);
assert.ok(c.view(refundsMoreThanApproved).includes('Pode ser negativo'));
const invalid=[
  null,
  {...base,source:'recent_list'},
  {...base,monthly:base.monthly.slice(1)},
  {...base,generatedAt:'invalid'},
  {...base,monthly:base.monthly.map((x,i)=>i===4?{...x,month:'2026-08'}:x)},
  {...base,monthly:base.monthly.map((x,i)=>i===4?{...x,month:'2026-07'}:x)},
  {...base,monthly:base.monthly.map((x,i)=>i===4?{...x,month:'2026-13'}:x)},
  {...base,monthly:base.monthly.map((x,i)=>i===4?{...x,approvedCents:3.5}:x)},
  {...base,monthly:base.monthly.map((x,i)=>i===4?{...x,approvedCents:999,netAfterLinkedRefundsCents:999}:x)},
  {...base,monthly:base.monthly.map((x,i)=>i===4?{...x,linkedRefundCents:-1}:x)},
  {...base,monthly:base.monthly.map((x,i)=>i===4?{...x,approvedCents:Number.MAX_SAFE_INTEGER+1}:x)},
  {...base,monthly:base.monthly.map((x,i)=>i===5?{...x,month:'2026-11'}:x)}
];
for(const payload of invalid){
  assert.equal(c.compare(payload).ok,false,'Unsafe/corrupt chronology must not be compared');
  assert.ok(c.view(payload).includes('Comparação indisponível'));
}
const brasilMonth={source:'database_complete',generatedAt:'2027-01-01T01:30:00Z',
  monthly:['2026-07','2026-08','2026-09','2026-10','2026-11','2026-12']
    .map((value,i)=>row(value,i*1000,0,1))};
assert.equal(c.compare(brasilMonth).ok,true,'Brazil calendar day differs from UTC');
assert.equal(c.compare(brasilMonth).referenceMonth,'2026-12');
role='operations';
assert.equal(c.view(base),'','Operation roles have no finance access');
role='readonly';
assert.equal(c.view(base),'','Read-only roles have no finance access');
role='superadmin';
assert.ok(c.view(base).includes('DESEMPENHO ENTRE MESES'));
assert.ok(source.includes('adminFinanceMonthlyComparisonView(data)'),
  'Monthly view must be included within finance-only section');
const css=read('css/components.css');
assert.ok(css.includes('.admin-finance-month-row'));
assert.ok(css.includes('@media(max-width:340px)'));
assert.ok(read('.github/workflows/audit.yml').includes('node tests/admin-finance-monthly-v1-189.mjs'));
console.log('V1.189 monthly comparisons: complete calendar periods, zero denominator, negative refunds, errors, roles and mobile UI passed.');
