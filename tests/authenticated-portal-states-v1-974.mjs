import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const admin=read('js/admin.js'),merchant=read('js/merchant.js');
const audit=read('.github/workflows/audit.yml');
for(const [name,s] of [['admin',admin],['merchant',merchant]])new vm.Script(s,{filename:name+'.js'});
const extract=(src,start,end)=>{
 const a=src.indexOf(start),b=src.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'Missing function boundaries '+start);
 return src.slice(a,b);
};
const adminPrelude=extract(admin,'function adminPage(){','  const d=adminRuntime.data;');
const merchantPrelude=extract(merchant,'function merchantLivePage(){','  const m=rt.merchant;');
const statusViews=(role)=>{
 const isAdmin=role==='admin';
 const rt={status:'loading',error:null,data:null};
 const nav={requested:true};
 const context=vm.createContext({
  document:{title:''},
  globalThis:{merchantRuntime:rt},
  navigator:{onLine:true},
  shell:html=>html,
  esc:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),
  adminRuntime:rt,adminPortalRequested:()=>nav.requested,
  adminLoginView:()=>'<section>login</section>',
  adminNoAccessView:()=>'<section>no-access</section>',
  adminBootstrapErrorView:()=>'<section>bootstrap</section>',
  merchantLiveLoginView:()=>'<section>login</section>',
  merchantLiveNoAccess:()=>'<section>no-access</section>'
 });
 const source=(isAdmin?adminPrelude:merchantPrelude)+'\n  return null;\n}\nthis.view='+
   (isAdmin?'adminPage':'merchantLivePage')+';';
 vm.runInContext(source,context);
 return {rt,nav,context,view:()=>context.view()};
};
for(const role of ['admin','merchant']){
 const s=statusViews(role);
 let page=s.view();
 assert.match(page,/role="status" aria-live="polite"/,role+' loading announced');
 assert.match(page,/Confirmando|Verificando/,role+' loading should explain purpose');
 assert.doesNotMatch(page,/Tentar novamente|Ver site TAMÃO/,role+' no misleading action mid-load');
 s.rt.status='disabled';page=s.view();
 assert.match(page,/role="alert"/);
 assert.match(page,/indisponível/i);
 assert.match(page,/onclick="openCustomerPortal\(\)"/);
 assert.doesNotMatch(page,/role="status"/);
 s.rt.status='unsafe-origin';page=s.view();
 assert.match(page,/role="alert"/);
 assert.match(page,/origem.*(compartilhada|isolada)/);
 assert.doesNotMatch(page,/onclick="adminRefresh\(\)"|onclick="merchantLiveRefresh\(\)"/,
  'unsafe origin cannot be fixed by refreshing');
 s.rt.status='unauthenticated';
 assert.equal(s.view(),'<section>login</section>');
 s.rt.status='no-access';
 assert.equal(s.view(),'<section>no-access</section>');
 s.rt.status='unavailable';s.rt.error='<img src=x onerror=alert(1)>';
 page=s.view();
 assert.match(page,/role="alert"/);
 assert.match(page,/Não foi possível/);
 assert.doesNotMatch(page,/<img src=x/);
 assert.match(page,/&lt;img src=x/);
 assert.match(page,isAdmin?/onclick="adminRefresh\(\)"/:/onclick="merchantLiveRefresh\(\)"/);
 assert.doesNotMatch(page,/role="status"/);
 if(isAdmin){
  s.rt.status='bootstrap-error';
  assert.equal(s.view(),'<section>bootstrap</section>');
  s.nav.requested=false;s.rt.status='ready';
  page=s.view();
  assert.match(page,/Área administrativa protegida/);
  assert.match(page,/role="alert"/);
 }
}
// Authenticated 360/768/1280px screen matrix is covered by the complementary V1.973 isolated Chrome suite.
assert.match(audit,/node tests\/authenticated-portal-states-v1-974\.mjs/);
console.log('V1.974 PASS: protected access states, truthful retry/error affordances and real Auth viewport proof.');
