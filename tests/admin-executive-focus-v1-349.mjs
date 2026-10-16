import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const admin=read('js/admin.js'),css=read('css/components.css');
const audit=read('.github/workflows/audit.yml');
new vm.Script(admin,{filename:'js/admin.js'});
const cut=name=>{
  const i=admin.indexOf('function '+name+'(');
  const end=admin.indexOf('\n}',i);
  assert.ok(i>=0&&end>i,'function not found: '+name);
  return admin.slice(i,end+2);
};
const grants={
 superadmin:['overview','orders','partners','finance','incidents','system','alerts','enablement'],
 operations:['overview','orders','partners','incidents','system','alerts','enablement'],
 finance:['overview','orders','finance','incidents','alerts'],
 support:['overview','orders','incidents','alerts'],
 compliance:['overview','partners','incidents','alerts','enablement'],
 readonly:['overview','incidents','system','alerts','enablement']
};
const can=(section,role)=>grants[role]?.includes(section)===true;
const ctx=vm.createContext({
 adminRoleCanSection:can,
 adminOrderIsLate:()=>false,
 adminLaunchWorklistModel:()=>({serverVerified:true,next:{title:'Confirmar recebimento',section:'enablement'}}),
 adminRelativeTime:()=> 'há 2 min',
 esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
 Date,Number,Array,String
});
vm.runInContext(cut('adminExecutiveNextDecision')+'\n'+cut('adminExecutiveNextDecisionView')+
 '\nthis.next=adminExecutiveNextDecision;this.view=adminExecutiveNextDecisionView;',ctx);
const date=Date.UTC(2026,9,16,12,0,0);
const fresh=new Date(date-2*60*1000).toISOString();
const data={
 launchReadiness:{commerceEnabled:true,securityBlockers:[]},
 incidents:[],controlOrders:[],supportCases:[],applications:[],
 merchantBilling:{},rewardFailures:[],accountingFailures:[]
};
const choose=(patch,role='superadmin',sync=fresh)=>
 ctx.next({...data,...patch},role,date,sync);
assert.equal(choose({},'superadmin',null).tone,'stale','no sync cannot assert clean state');
assert.equal(choose({},'superadmin',new Date(date-16*60*1000).toISOString()).kind,'refresh');
assert.equal(choose({},'superadmin',new Date(date+2*60*1000).toISOString()).kind,'refresh');
assert.equal(choose({launchReadiness:{commerceEnabled:false,securityBlockers:['blocked']}}).section,'system');
assert.equal(choose({launchReadiness:{commerceEnabled:false,securityBlockers:['blocked']}},'finance').section,'alerts',
 'role without system access must not receive a system control link');
const incident={incidents:[{status:'open'}]};
assert.equal(choose(incident).section,'incidents');
assert.equal(choose({incidents:[{status:'resolved'}]}).tone,'calm');
const risky={controlOrders:[{status:'AT_RISK'}]};
assert.equal(choose(risky).section,'orders');
assert.equal(choose(risky,'compliance').section,'alerts');
const financial={merchantBilling:{paymentEvents:[{status:'review_required'}]}};
assert.equal(choose(financial,'finance').section,'finance');
assert.equal(choose(financial,'support').section,'alerts');
assert.equal(choose({supportCases:[{status:'in_review'}]},'support').section,'orders');
assert.equal(choose({applications:[{status:'pending'}]},'compliance').section,'partners');
const launch={launchReadiness:{commerceEnabled:false,securityBlockers:[],operationMode:'PRELAUNCH'}};
assert.equal(choose(launch,'operations').section,'enablement');
assert.equal(choose(launch,'support').section,'alerts');
const mixed={...financial,incidents:[{status:'open'}],controlOrders:[{status:'AT_RISK'}]};
assert.equal(choose(mixed,'superadmin').section,'incidents');
assert.equal(choose({...financial,controlOrders:[{status:'AT_RISK'}]},'finance').section,'orders');
const html=ctx.view({...data,applications:[{status:'pending'}]},'compliance',date,fresh);
assert.match(html,/admin-executive-focus/);
assert.match(html,/adminSetSection\('partners'\)/);
assert.doesNotMatch(html,/adminRefresh\(\)/);
assert.match(html,/Dados: há 2 min/);
const stale=ctx.view(data,'readonly',date,null);
assert.match(stale,/adminRefresh\(\)/);
assert.doesNotMatch(stale,/adminSetSection/);
assert.equal(ctx.view(data,'blocked-role',date,fresh),'');
const critical=ctx.view({...data,incidents:[{status:'open'}]},'superadmin',date,fresh);
assert.match(critical,/admin-executive-focus--critical/);
assert.doesNotMatch(critical,/adminPerform|adminSetOperationMode|adminGovernanceChangeCityCommerce/);
const panel=admin.slice(admin.indexOf('function adminPage(){'),
 admin.indexOf('\nfunction adminFilterRegistry(',admin.indexOf('function adminPage(){')));
assert.ok(panel.indexOf('adminExecutiveNextDecisionView(d,currentRole')<panel.indexOf('adminAttentionCenter(d)'));
assert.ok(panel.indexOf('adminAttentionCenter(d)')<panel.indexOf('adminReleaseHub(d)'));
assert.ok(panel.includes('tabindex="-1" id="admin-current-section-title"'));
const center=cut('adminAttentionCenter');
assert.match(center,/adminRoleCanSection\(target\)/);
const itemsCtx=vm.createContext({
 adminAttentionItems:()=>[
  {section:'finance',severity:'critical',title:'Finance',detail:'Private'},
  {section:'partners',severity:'medium',title:'Partners',detail:'Review'},
  {type:'order',id:'id',severity:'medium',title:'Order',detail:'Review'}
 ],
 adminRoleCanSection:section=>can(section,'compliance'),
 esc:x=>String(x),
 adminSeverityLabel:s=>s
});
vm.runInContext(center+'\nthis.center=adminAttentionCenter;',itemsCtx);
const filtered=itemsCtx.center({});
assert.match(filtered,/Partners/);
assert.doesNotMatch(filtered,/Finance|Order|Private/);
assert.match(filtered,/Nenhuma prioridade identificada|admin-attention-item/);
const adminNav=cut('adminSetSection');
assert.match(adminNav,/getElementById\('admin-current-section-title'\)\?\.focus/);
for(const token of ['.admin-executive-focus','.admin-executive-focus--stale',
 '.admin-executive-focus-action:focus-visible','@media(max-width:720px)'])
 assert.ok(css.includes(token),'missing mobile accessible decision style: '+token);
assert.ok(audit.includes('node tests/admin-executive-focus-v1-349.mjs'),
 'CI must execute executive priority regression');
console.log('TAMÃO V1.349 PASS — priority, stale evidence, role isolation, keyboard and navigation.');
