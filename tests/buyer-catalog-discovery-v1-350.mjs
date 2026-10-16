import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const customer=read('js/customer.js'),bootstrap=read('js/bootstrap.js');
const css=read('css/components.css'),audit=read('.github/workflows/audit.yml');
new vm.Script(customer,{filename:'customer.js'});
new vm.Script(bootstrap,{filename:'bootstrap.js'});
const cut=name=>{
  const start=customer.indexOf('function '+name+'(');
  const end=customer.indexOf('\n}',start);
  assert.ok(start>=0&&end>start,'missing '+name);
  return customer.slice(start,end+2);
};
const rows=Array.from({length:12},(_,index)=>({
  dataset:{
    buyerCartKind:index%3===0?'gas':index%3===1?'water':'other',
    buyerCartSelected:index===10?'true':'false'
  },
  hidden:index>=8&&index!==10
}));
const tabs=['all','gas','water','other'].map(kind=>({
  dataset:{buyerCartFilter:kind},
  setAttribute(name,value){if(name==='aria-pressed')this.pressed=value}
}));
const status={textContent:''};
const catalog={querySelectorAll:query=>query==='[data-buyer-cart-kind]'?rows:[]};
const document={
  getElementById:id=>id==='buyer-cart-catalog'?catalog:id==='buyer-cart-feedback'?status:null,
  querySelectorAll:query=>query==='[data-buyer-cart-filter]'?tabs:[]
};
const context=vm.createContext({document});
vm.runInContext(cut('buyerCartFilter')+'\nthis.filter=buyerCartFilter;',context);
assert.equal(context.filter('all'),true);
assert.equal(rows.filter(row=>!row.hidden).length,9,
  'show eight products plus any selected items even beyond featured limit');
assert.equal(rows[10].hidden,false);
assert.equal(context.filter('gas'),true);
assert.equal(rows.filter(row=>!row.hidden).length,5,
  'selected item must remain visible outside the filtered category');
assert.equal(tabs.find(x=>x.dataset.buyerCartFilter==='gas').pressed,'true');
assert.match(status.textContent,/cesta continuam à vista/);
assert.equal(context.filter('water'),true);
assert.equal(rows[10].hidden,false);
assert.equal(context.filter('other'),true);
assert.equal(context.filter('invalid'),true,'unknown categories fail to the safe featured set');
assert.equal(rows.filter(row=>!row.hidden).length,9);
const focusedContext=vm.createContext({document:{getElementById:()=>null,querySelectorAll:()=>[]}});
vm.runInContext(cut('buyerCartFilter')+'\nthis.filter=buyerCartFilter;',focusedContext);
assert.equal(focusedContext.filter('gas'),false);
const goCalls=[],added=[];
let input='';
const state={
  postalCode:'',address:'old address',addressNumber:'17',
  cart:{},checkout:{glpContainerMode:'exchange'}
};
const liveRuntime={offers:[{id:'stale'}],postalValidated:true,lastCityCheck:{},
  lastSyncAt:100,error:'old'};
const inputField={get value(){return input},focus(){this.focused=true}};
const runtime=vm.createContext({
  state,products:{P13:{hidden:false,name:'Gás 13 kg'},WATER20:{hidden:false,name:'Água 20 litros'}},
  document:{querySelector:query=>query==='#home-address'?inputField:
    query==='#home-featured-code'?{value:'P13'}:null},
  globalThis:{__CHAMA_TEST__:false,liveRuntime,setTimeout:()=>{}},
  liveRuntime,normalizeCart:()=>({}),setCartProduct:(code,qty)=>{added.push([code,qty]);state.cart[code]=qty},
  save:()=>{},go:route=>goCalls.push(route),toast:s=>{throw Error(String(s))},
  route:()=> 'order',String,Number,Object
});
vm.runInContext(cut('startHomeOrder')+'\n'+cut('startHomeBrowse')+
 '\nthis.browse=startHomeBrowse;this.begin=startHomeOrder;',runtime);
await runtime.browse();
assert.equal(goCalls.at(-1),'order');
assert.equal(added.length,0,'browsing from an empty basket must never add P13');
assert.equal(Object.keys(state.cart).length,0);
state.cart={WATER20:2};
await runtime.browse();
assert.equal(state.cart.WATER20,2,'browsing must preserve a real selected basket');
assert.equal(added.length,0);
state.cart={};
input='97300000';
await runtime.browse();
assert.equal(state.postalCode,'97300000','valid CEP is carried to the checkout');
assert.equal(state.address,'','changing delivery CEP must invalidate previous address');
assert.equal(state.addressNumber,'');
assert.equal(liveRuntime.offers.length,0);
assert.equal(liveRuntime.postalValidated,false);
assert.equal(added.length,0);
state.cart={};input='';
await runtime.begin();
assert.equal(added.length,1,'explicit legacy product entry keeps its known behavior');
assert.equal(added[0][0],'P13');
assert.ok(bootstrap.includes('quickProduct,startHomeBrowse,homeFilterProducts'));
assert.ok(bootstrap.includes('homeDiscoverFocus,buyerCartFilter,customerCheckoutFocusStep'));
assert.ok(customer.includes('onclick="startHomeBrowse()">Continuar para a cesta'));
assert.ok(customer.includes('onclick="startHomeBrowse()">Escolher produtos →'));
assert.ok(customer.includes('data-buyer-cart-selected'));
assert.ok(customer.includes('aria-label="Filtrar produtos para adicionar"'));
assert.ok(customer.includes('id="buyer-cart-catalog"'));
assert.ok(customer.includes('tabindex="-1">Sua cesta'));
assert.ok(css.includes('.buyer-cart-item[hidden]')&&css.includes('.buyer-cart-filter button:focus-visible'));
assert.ok(css.includes('@media(max-width:550px)'));
assert.ok(audit.includes('node tests/buyer-catalog-discovery-v1-350.mjs'));
console.log('TAMÃO V1.350 PASS — no invented gas, preserved cart and CEP, category navigation, mobile and accessibility.');
