import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const js=read('js/admin.js');
const names=['adminPurgeSensitiveReads','adminSensitiveReadCurrent','adminRunSearch',
 'adminClearSearch','adminOpenEntity','adminCloseDetail','adminLoadSystemHealth','adminAuditFilterValue','adminAuditSearch'];
const take=name=>{
 const i=js.search(new RegExp('(?:async )?function '+name+'\\('));
 assert.ok(i>=0,'missing '+name);
 const j=js.indexOf('\n}',i);
 assert.ok(j>i,'unfinished '+name);
 return js.slice(i,j+2);
};
const source=names.map(take).join('\n');
new vm.Script(source);
const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const detail=id=>({type:'order',id,order:{id,customer_phone_digits:'PRIVATE-PHONE-'+id}});
const wait=()=>{let resolve,reject;return {promise:new Promise((a,b)=>{resolve=a;reject=b}),get resolve(){return resolve},get reject(){return reject}};};
function fixture(){
 const calls=[],renders=[],gates=new Map();
 const rt={requested:true,status:'ready',session:{user:{id:'admin-A'}},
  data:{currentAdmin:{admin_role:'superadmin'}},section:'orders',
  searchQuery:'',searchResults:[],searchPending:false,
  detail:null,detailPending:false,auditResults:null,auditPending:false,
  health:null,healthPending:false,error:null};
 const ctx=vm.createContext({
  adminRuntime:rt,Date,String,Array,Error,
  adminReady:()=>rt.requested&&rt.status==='ready',
  adminCurrentRole:()=>rt.data?.currentAdmin?.admin_role||'superadmin',
  adminRoleCanSection:k=>rt.data?.currentAdmin?.admin_role==='superadmin'&&['audit','system'].includes(k),
  document:{getElementById:id=>({value:id==='admin-audit-action'?'merchant_activated':'q'})},
  render:()=>renders.push(rt.status),
  adminInvoke:async args=>{
   calls.push(args);
   if(gates.has(args.action))return gates.get(args.action).promise;
   if(args.action==='search')return {results:[{secret:'PRIVATE-SEARCH'}]};
   if(args.action==='audit-search')return {results:[{secret:'PRIVATE-AUDIT'}]};
   if(args.action==='entity-detail')return detail(args.entityId);
   if(args.action==='system-health')return {secret:'PRIVATE-PSP'};
   throw Error('Unexpected action '+args.action);
  }
 });
 vm.runInContext(source+'\nthis.actions={search:adminRunSearch,clear:adminClearSearch,open:adminOpenEntity,close:adminCloseDetail,health:adminLoadSystemHealth,audit:adminAuditSearch,purge:adminPurgeSensitiveReads};',ctx);
 return {rt,ctx,calls,renders,
  gate:name=>{const d=wait();gates.set(name,d);return d;},
  logout:()=>{
   rt.session=null;rt.status='unauthenticated';rt.data=null;
   ctx.actions.purge();
  },
  switchUser:()=>{
   ctx.actions.purge();rt.session={user:{id:'admin-B'}};
   rt.status='ready';rt.data={currentAdmin:{admin_role:'superadmin'}};
  },
  demote:()=>{
   rt.data={currentAdmin:{admin_role:'readonly'}};ctx.actions.purge();
  }
 };
}
{
 const x=fixture();
 await x.ctx.actions.search('needle');
 assert.equal(x.rt.searchResults[0].secret,'PRIVATE-SEARCH');
 await x.ctx.actions.open('order',A);
 assert.equal(x.rt.detail.order.customer_phone_digits,'PRIVATE-PHONE-'+A);
 await x.ctx.actions.audit();
 assert.equal(x.rt.auditResults[0].secret,'PRIVATE-AUDIT');
 const auditRequest=x.calls.find(c=>c.action==='audit-search');
 assert.ok(auditRequest,'audit operation must reach the correct server endpoint');
 assert.equal(auditRequest.auditAction,'merchant_activated',
  'audit action filter cannot override the endpoint action');
 await x.ctx.actions.health();
 assert.equal(x.rt.health.secret,'PRIVATE-PSP');
}
const operations=[
 ['search',x=>x.ctx.actions.search('needle'),{results:[{secret:'OLD'}]},'searchResults'],
 ['audit-search',x=>x.ctx.actions.audit(),{results:[{secret:'OLD'}]},'auditResults'],
 ['entity-detail',x=>x.ctx.actions.open('order',A),detail(A),'detail'],
 ['system-health',x=>x.ctx.actions.health(),{secret:'OLD'},'health']
];
for(const [action,call,data,field] of operations){
 const x=fixture(),d=x.gate(action),p=call(x);
 assert.equal(x.calls.length,1);
 x.logout();
 const n=x.renders.length;d.resolve(data);await p;
 assert.ok(x.rt[field]===null||Array.isArray(x.rt[field])&&x.rt[field].length===0,
  'late '+action+' result cannot restore private data');
 assert.equal(x.renders.length,n);
}
for(const [action,call] of operations){
 const x=fixture(),d=x.gate(action),p=call(x);
 x.switchUser();d.reject(Error('PRIVATE OLD ERROR'));await p;
 assert.equal(x.rt.error,null);
 assert.equal(x.rt.detail,null);
 assert.equal(x.rt.auditResults,null);
 assert.equal(x.rt.health,null);
 assert.equal(x.rt.searchResults.length,0);
}
{
 const x=fixture(),d=x.gate('entity-detail');
 const p=x.ctx.actions.open('order',A);
 x.ctx.actions.close();
 assert.equal(x.rt.detailPending,false);
 d.resolve(detail(A));await p;
 assert.equal(x.rt.detail,null,'closed modal cannot reopen');
}
{
 const x=fixture(),old=x.gate('entity-detail');
 const p1=x.ctx.actions.open('order',A);
 x.ctx.actions.close();
 const recent=x.gate('entity-detail');
 const p2=x.ctx.actions.open('order',B);
 old.resolve(detail(A));await p1;
 assert.equal(x.rt.detail.id,B);
 assert.equal(x.rt.detailPending,true,'old finally must not unlock a newer read');
 recent.resolve(detail(B));await p2;
 assert.equal(x.rt.detail.id,B);
 assert.equal(x.rt.detailPending,false);
}
{
 const x=fixture();
 const d=x.gate('entity-detail');
 const p=x.ctx.actions.open('order',A);
 d.resolve(detail(B));await p;
 assert.equal(x.rt.detail.id,A);
 assert.match(x.rt.detail.error,/outro registro/);
 assert.equal(x.rt.detail.order,undefined);
}
{
 const x=fixture(),old=x.gate('search');
 const p1=x.ctx.actions.search('old');
 x.ctx.actions.clear();
 const recent=x.gate('search');
 const p2=x.ctx.actions.search('new');
 old.resolve({results:[{secret:'OLD'}]});await p1;
 assert.equal(x.rt.searchPending,true);
 recent.resolve({results:[{secret:'NEW'}]});await p2;
 assert.equal(x.rt.searchResults[0].secret,'NEW');
}
{
 const x=fixture();
 await x.ctx.actions.search('needle');
 await x.ctx.actions.open('order',A);
 await x.ctx.actions.audit();
 await x.ctx.actions.health();
 x.demote();
 assert.equal(x.rt.detail,null);
 assert.equal(x.rt.auditResults,null);
 assert.equal(x.rt.health,null);
 assert.equal(x.rt.searchResults.length,0);
 await x.ctx.actions.audit();
 await x.ctx.actions.health();
 assert.equal(x.calls.filter(c=>['audit-search','system-health'].includes(c.action)).length,2);
}
{
 const x=fixture(),d=x.gate('entity-detail');
 const p=x.ctx.actions.open('order',A);
 x.demote();d.resolve(detail(A));await p;
 assert.equal(x.rt.detail,null);
}
assert.match(js,/if\(previousRole&&previousRole!==data\?\.currentAdmin\?\.admin_role\)/);
assert.ok(read('.github/workflows/audit.yml').includes('node tests/admin-sensitive-read-isolation-v1-493.mjs'));
const edge=read('supabase/functions/admin-ops/index.ts');
assert.ok(edge.includes('function scopeEntityDetail('));
assert.ok(edge.includes('if(body.auditAction)query=query.eq("action",'),
 'backend must filter using auditAction rather than endpoint action');
assert.ok(!edge.includes('if(body.action)query=query.eq("action",'));
assert.match(js,/action:'audit-search',query,auditAction:auditAction\|\|null/);
console.log('PASS #493: Admin private search, detail 360, audit and system health do not leak after account switch, RBAC demotion, close or concurrent reads.');
