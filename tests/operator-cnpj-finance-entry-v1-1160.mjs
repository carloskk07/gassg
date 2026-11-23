import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const admin=read('js/admin.js');
const operator=read('js/admin-operator-transition.js');
const payout=read('js/admin-network-payout.js');
const builder=read('scripts/build-live-portals.mjs');

for(const phrase of [
 "id:'operator',label:'Empresa / CNPJ'",
 "adminFinanceWorkspaceCurrent()!=='operator'",
 "adminCurrentRole()!=='superadmin'",
 "adminOperatorFinanceLoadOnDemand()",
 "operator:sectionActive('finance')&&financeSelection==='operator'",
 "adminOperatorFinanceView()",
 "new URL('admin-operator-transition.js',source)",
 "moduleUrl.search=source.search",
 "admin-finance-primary ${superadmin?'has-operator':''}",
 "['lab','homologation','operator'].includes(key)",
 "['lab','homologation','operator'].includes(selected)",
 "['lab','homologation','operator'].includes(item.id)",
 "['summary','homologation','billing','reconciliation','operator']"
]){
 assert.ok(admin.includes(phrase),'Nova área de CNPJ não está isolada: '+phrase);
}
assert.ok(builder.includes("fs.rmSync(path.join(target,'js','admin-operator-transition.js'),{force:true})"),
 'A preparação PJ não pode chegar aos bundles Cliente/Parceiro');
assert.ok(payout.includes('adminOperatorTransitionSection()'),
 'O acesso anterior pela Rede deve permanecer compatível');

new vm.Script(admin,{filename:'js/admin.js'});
new vm.Script(operator,{filename:'js/admin-operator-transition.js'});

const user={id:'00000000-0000-4000-8000-000000000001'};
const inputs={
 'operator-pj-cnpj':'',
 'operator-pj-legal-name':'',
 'operator-pj-trade-name':'',
 'operator-pj-public-address':'',
 'operator-pj-email':''
};
let role='superadmin';
const ctx=vm.createContext({
 adminReady:()=>true,adminCurrentRole:()=>role,
 adminRuntime:{session:{user}},
 document:{getElementById:id=>id in inputs?{value:inputs[id]}:null},
 esc:x=>String(x),render:()=>{},toast:()=>{},
 CHAMA_BACKEND:{url:'https://isolated.example.invalid',publishableKey:'public-key'},
 adminAccessToken:async()=>'private-test-token',
 chamaFetch:async()=>{throw Error('Nenhuma chamada externa autorizada no teste.')}
});
vm.runInContext(operator,ctx);
assert.equal(vm.runInContext('adminOperatorSession()',ctx),user.id);
vm.runInContext("adminOperatorState.data={stage:'not_started',currentEntityKind:'individual',revision:7,verifiedGates:0,totalGates:12,gates:Array.from({length:12},(_,i)=>({key:'k'+i,title:'Conferência '+i,verified:false}))};",ctx);
inputs['operator-pj-cnpj']='11.222.333/0001-81';
inputs['operator-pj-legal-name']='Razão social digitada';
inputs['operator-pj-trade-name']='TAMÃO';
inputs['operator-pj-public-address']='Rua da empresa, São Gabriel';
inputs['operator-pj-email']='contato@empresa.invalid';
vm.runInContext('adminOperatorDraftCapture()',ctx);
assert.equal(vm.runInContext('adminOperatorState.draft.revision',ctx),7);
assert.equal(vm.runInContext('adminOperatorState.draft.values.legalName',ctx),'Razão social digitada');
const html=vm.runInContext('adminOperatorPanel()',ctx);
assert.ok(html.includes('Razão social digitada'),'Formulário não pode perder alterações locais');
assert.ok(html.includes('oninput="adminOperatorDraftCapture()"'));
assert.ok(html.includes('0/12'),'Nenhuma verificação pode ser simulada');
role='finance';
assert.equal(vm.runInContext('adminOperatorSession()',ctx),null,'Outro papel não pode editar empresa');
assert.equal(vm.runInContext('adminOperatorState.draft',ctx),null,'Rascunho não pode vazar após perder acesso');
role='superadmin'; user.id='00000000-0000-4000-8000-000000000002';
assert.equal(vm.runInContext('adminOperatorSession()',ctx),user.id);
assert.equal(vm.runInContext('adminOperatorState.data',ctx),null,'Outra conta não herda dados da anterior');
assert.equal(vm.runInContext('adminOperatorPanel()',ctx).includes('Razão social digitada'),false);

console.log('V1.1160 PASS: entrada própria no Financeiro, superadmin, módulo diferido, rascunho isolado e Rede preservada.');