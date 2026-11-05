import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const admin=read('js/admin.js');
const boot=read('js/bootstrap.js');
const begin=admin.indexOf('const ADMIN_COUPON_EDITOR_FIELD_IDS=');
const end=admin.indexOf('function adminCouponCommercialReleaseView(){',begin);
assert.ok(begin>0&&end>begin,'Seller edit preservation code must exist');
const adminCode=admin.slice(begin,end);
const renderStart=boot.indexOf('let renderLock=false;');
const renderEnd=boot.indexOf("window.addEventListener('hashchange'",renderStart);
assert.ok(renderStart>0&&renderEnd>renderStart,'Admin render path must exist');
const renderCode=boot.slice(renderStart,renderEnd);
assert.match(renderCode,/adminCouponCommercialBeforeRender/);
assert.match(renderCode,/adminCouponCommercialAfterRender/);

let owner='owner-1';
let role='superadmin';
let showForm=true;
let fromProvider=false;
const document={activeElement:null};
const createField=(id,type='text',value='',checked=false)=>{
  const f={id,type,value,checked,selectionStart:type==='text'||type==='email'?0:null,
    selectionEnd:type==='text'||type==='email'?0:null,focus(options){
      assert.equal(options.preventScroll,true);
      document.activeElement=this;
    },setSelectionRange(start,end){
      this.selectionStart=start;
      this.selectionEnd=end;
    }};
  return f;
};
let nodes={};
function rebuild(){
  nodes=showForm?{
    'clube-commercial-release-button':{id:'clube-commercial-release-button',type:'button',dataset:{couponOwner:owner}},
    'clube-seller-name':createField('clube-seller-name',fromProvider?'hidden':'text',fromProvider?'Provider Verified':''),
    'clube-seller-tax':createField('clube-seller-tax',fromProvider?'hidden':'text',fromProvider?'52998224725':''),
    'clube-seller-address':createField('clube-seller-address'),
    'clube-seller-support':createField('clube-seller-support','email'),
    'clube-accept-all':createField('clube-accept-all','checkbox','',false)
  }:{};
}
rebuild();
const app={
  set innerHTML(html){ assert.equal(typeof html,'string');rebuild();document.activeElement=null; },
  get innerHTML(){return '<main>test</main>';}
};
document.getElementById=id=>nodes[id]||null;
document.querySelector=selector=>selector==='#app'?app:null;
const ctx=vm.createContext({document,adminRuntime:{session:{user:{id:owner}}},
  adminCurrentRole:()=>role,adminPage:()=>'<section>Admin</section>',
  CHAMA_PORTAL_ROLE:'admin'});
vm.runInContext(adminCode+'\n'+renderCode,ctx);
function render(){ctx.adminRuntime.session.user.id=owner;ctx.render();}
nodes['clube-seller-name'].value='Seller Typed';
nodes['clube-seller-tax'].value='12345678901';
nodes['clube-seller-address'].value='Rua das Acácias, 123, São Gabriel, RS';
nodes['clube-seller-support'].value='cliente@provedor.com';
nodes['clube-accept-all'].checked=true;
document.activeElement=nodes['clube-seller-support'];
document.activeElement.selectionStart=8;
document.activeElement.selectionEnd=8;
render();
assert.equal(nodes['clube-seller-name'].value,'Seller Typed');
assert.equal(nodes['clube-seller-tax'].value,'12345678901');
assert.equal(nodes['clube-seller-address'].value,'Rua das Acácias, 123, São Gabriel, RS');
assert.equal(nodes['clube-seller-support'].value,'cliente@provedor.com');
assert.equal(nodes['clube-accept-all'].checked,true);
assert.equal(document.activeElement.id,'clube-seller-support');
assert.equal(document.activeElement.selectionStart,8);
nodes['clube-seller-support'].value+='br';
nodes['clube-seller-support'].selectionStart=23;
nodes['clube-seller-support'].selectionEnd=23;
render();
assert.equal(nodes['clube-seller-support'].value,'cliente@provedor.combr',
 'Repeated dashboard updates must not clear a partially typed address/email');
assert.equal(document.activeElement.selectionStart,23);

// Newly verified MP identity must win over stale manually entered values.
fromProvider=true;
render();
assert.equal(nodes['clube-seller-name'].value,'Provider Verified');
assert.equal(nodes['clube-seller-tax'].value,'52998224725');
assert.equal(nodes['clube-seller-address'].value,'Rua das Acácias, 123, São Gabriel, RS');
assert.equal(nodes['clube-accept-all'].checked,true);

// Switching authenticated users must not leak draft values into the new account.
owner='owner-2';
render();
assert.equal(nodes['clube-seller-address'].value,'');
assert.equal(nodes['clube-seller-support'].value,'');
assert.equal(nodes['clube-accept-all'].checked,false);

// Switching out of the coupon form should never inject stale content.
owner='owner-1';
showForm=false;
render();
assert.equal(Object.keys(nodes).length,0);
role='finance';
showForm=true;
render();
assert.equal(nodes['clube-seller-address'].value,'');
assert.equal(nodes['clube-accept-all'].checked,false);
console.log('PASS coupon admin: drafts, focus/caret, verified MP identity, account isolation, navigation');
