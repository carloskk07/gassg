import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=read('js/admin-acquisition.js');
new vm.Script(source,{filename:'admin-acquisition.js'});
const fn=name=>{
  const a=source.indexOf('function '+name+'('),b=source.indexOf('\n}',a);
  assert.ok(a>=0&&b>a,'Missing '+name);return source.slice(a,b+2);
};
let role='operations',fresh=true,valid=true,copied='',calls=0,notifications=[];
const base={key:'RS:sao-gabriel',label:'São Gabriel/RS',hasRadar:true,hasMerchants:true,
  paused:false,interests:14,anp:6,overdue:3,openProspects:2,onboarding:1,
  registered:2,needingReview:1,available:0,next:'Conferir três retornos no CRM'};
const runtime={status:'ready',session:{user:{id:'admin-A'}},data:{}};
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const context=vm.createContext({adminRuntime:runtime,esc,Number,String,Array,Object,Date,
  navigator:{clipboard:{writeText:async value=>{calls++;copied=value}}},
  adminCityPipelineSnapshot:()=>({valid,fresh,items:[base]}),
  adminRoleCanSection:area=>area==='prospects'
    ?['superadmin','operations','compliance','readonly'].includes(role)
    :area==='partners'&&['superadmin','operations','compliance'].includes(role),
  toast:value=>notifications.push(value)});
const names=['adminCityPlanSteps','adminCityPlanView','adminCityPlanCopy'];
vm.runInContext(names.map(fn).join('\n')+
 '\nthis.steps=adminCityPlanSteps;this.view=adminCityPlanView;this.copy=adminCityPlanCopy;',context);
let steps=context.steps(base);
assert.equal(steps.length,5);
assert.equal(steps[0].state,'observed');
assert.ok(steps[0].detail.includes('não representam pedidos'));
assert.ok(steps[1].detail.includes('ainda não são parceiros'));
assert.equal(steps[2].state,'attention');
assert.ok(steps[2].detail.includes('3 retorno(s) vencido(s)'));
assert.ok(steps[3].detail.includes('Cadastro não significa habilitação'));
assert.equal(steps[4].state,'attention');
assert.ok(steps[4].detail.includes('Nenhuma oferta confirmada'));
let html=context.view(base);
assert.ok(html.includes('Roteiro de expansão • 5 verificações'));
assert.ok(html.includes('Copiar resumo'));
assert.ok(html.includes('Conferir prospectos'));
assert.ok(html.includes('Conferir revendas'));
assert.equal((html.match(/class='admin-city-plan-step'/g)||[]).length,5);
assert.ok(!html.includes('adminPerform('));
assert.ok(!html.includes('adminIssueAnpProspectInvite('));
assert.ok(!html.includes('wa.me'));
const paused=context.steps({...base,paused:true,available:3});
assert.equal(paused[4].state,'blocked');
assert.ok(paused[4].detail.includes('Cidade pausada'));
const missing=context.steps({...base,interests:null,anp:null,overdue:null,
  openProspects:null,onboarding:null,available:null,registered:null,needingReview:null});
assert.equal(missing[0].state,'unknown');
assert.equal(missing[1].state,'unknown');
assert.equal(missing[2].state,'unknown');
assert.equal(missing[3].state,'unknown');
assert.equal(missing[4].state,'unknown');
assert.ok(!missing[0].detail.includes('Nenhum interesse'));
assert.ok(!missing[1].detail.includes('Nenhum registro ANP'));
assert.ok(!missing[4].detail.includes('Nenhuma oferta confirmada'));
const xss=context.view({...base,anp:'<img src=x onerror=alert(1)>',interests:'<script>',
  registered:'<svg/onload=alert(1)>',key:"RS:sao' onmouseover='alert(1)"});
assert.ok(!xss.includes('<script>'));
assert.ok(!xss.includes('<img'));
assert.ok(!xss.includes('<svg'));
assert.ok(!xss.includes("data-city-key='RS:sao' onmouseover='"));
role='readonly';html=context.view(base);
assert.ok(html.includes('disabled title="Sem cadastro consultável ou permissão"'));
assert.ok(!html.includes('disabled title="Sem fonte ANP consultável nesta cidade"'));
role='operations';
await context.copy(base.key);
assert.equal(calls,1);
assert.ok(copied.includes('São Gabriel/RS'));
assert.ok(copied.includes('3 retorno(s) vencido(s)'));
assert.ok(copied.includes('ainda não são parceiros'));
assert.ok(!copied.includes('Confirmação de abertura'));
assert.equal(notifications.at(-1),'Resumo da cidade copiado');
const count=calls;
await context.copy('RS:inexistente');
assert.equal(calls,count);
fresh=false;await context.copy(base.key);
assert.equal(calls,count,'Stale data must never be copied');
fresh=true;valid=false;await context.copy(base.key);
assert.equal(calls,count,'Invalid source must never be copied');
valid=true;role='finance';await context.copy(base.key);
assert.equal(calls,count,'Unauthorized role must never copy');
role='operations';runtime.status='unauthenticated';await context.copy(base.key);
assert.equal(calls,count,'No authenticated session must block copy');
runtime.status='ready';
context.navigator.clipboard.writeText=async()=>{throw new Error('denied')};
await context.copy(base.key);
assert.ok(notifications.at(-1).includes('Não foi possível copiar'));
assert.ok(source.includes('adminCityPlanView(row)'));
assert.ok(read('css/components.css').includes('.admin-city-plan-step'));
assert.ok(read('css/components.css').includes('@media(max-width:340px)'));
assert.ok(read('.github/workflows/audit.yml').includes('node tests/admin-city-expansion-playbook-v1-203.mjs'));
console.log('V1.203 OK: five evidence-based city steps, pause, unknown sources, auth, copy guard, XSS, and no writes.');
