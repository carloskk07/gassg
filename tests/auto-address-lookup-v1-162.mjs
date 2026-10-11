import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const frontend=read('js/customer.js');
const backend=read('js/backend.js');
const source=backend.slice(
  backend.indexOf('let liveOfferTimer=null;'),
  backend.indexOf('\nfunction liveIdempotency(',backend.indexOf('let liveOfferTimer=null;'))
);
assert.ok(source.startsWith('let liveOfferTimer=null;')&&source.includes('async function liveRefreshOffers('),
  'Real backend scheduler and quote reader must be executable in the same fixture');

function harness(){
  const calls=[],renders=[],saves=[],remembers=[],timers=new Map();
  let nextTimerId=1;
  const runtime={
    offerRequestSeq:0,offers:[],postalValidated:false,lastCityCheck:null,lastSyncAt:null,
    loadingOffers:false,activeOfferFingerprint:null,lastOfferFingerprint:null,lastOfferCheckedAt:0
  };
  const state={
    postalCode:'97300000',addressNumber:'12',address:'',
    cart:{WATER20:1},checkout:{paymentMethod:'cash',deliveryMode:'now'}
  };
  let onRoute='order';
  const ctx=vm.createContext({
    state,liveRuntime:runtime,
    document:{activeElement:null,querySelector:()=>null,getElementById:()=>null},
    hasCartItems:()=>Object.values(state.cart).some(v=>v>0),
    liveCartItems:()=>Object.entries(state.cart).filter(([,v])=>v>0)
      .map(([productCode,quantity])=>({productCode,quantity})),
    liveOfferView:raw=>raw,
    liveReady:()=>true,route:()=>onRoute,
    setTimeout:(fn,delay)=>{const id=nextTimerId++;timers.set(id,{fn,delay});return id},
    clearTimeout:id=>timers.delete(id),
    liveInvoke:(operation,payload)=>{
      assert.equal(operation,'get-offers');
      return new Promise((resolve,reject)=>calls.push({payload,resolve,reject}));
    },
    rememberMarketRegion:(data,postal)=>remembers.push({data,postal}),
    save:()=>saves.push(1),render:()=>renders.push(1),
    globalThis:{ensureProductDefinition:()=>true}
  });
  vm.runInContext(source,ctx);
  function flushTimers(){
    const next=[...timers.values()];
    timers.clear();
    for(const item of next)item.fn();
    return next.map(x=>x.delay);
  }
  async function settle(){for(let n=0;n<10;n++)await Promise.resolve()}
  function response(code='97300000'){
    return {postalValidated:true,postalCode:code,addressNumber:state.addressNumber,
      canonicalAddress:'Rua Verificada, '+state.addressNumber,serviceCity:'São Gabriel',
      serviceState:'RS',regionAvailable:true,
      offers:[{quoteId:'quote-'+calls.length,expiresAt:new Date(Date.now()+90000).toISOString()}]
    };
  }
  return {ctx,state,runtime,calls,renders,saves,remembers,timers,flushTimers,settle,response,
    setRoute:v=>onRoute=v,eval:code=>vm.runInContext(code,ctx)};
}
const h=harness();
assert.equal(h.eval('liveAddressDraftReady()'),true);
h.eval('liveScheduleOfferRefresh(650)');
h.eval('liveScheduleOfferRefresh(650)');
h.eval('liveScheduleOfferRefresh(650)');
assert.equal(h.timers.size,1,'Typing burst needs one pending timer');
assert.deepEqual(h.flushTimers(),[650],'Expected a short, nonzero debounce');
assert.equal(h.calls.length,1,'One complete CEP and number make one backend call');
assert.equal(h.runtime.loadingOffers,true);
h.eval('liveScheduleOfferRefresh(650)');
h.flushTimers();
assert.equal(h.calls.length,1,'Retry while identical request in flight must be suppressed');
h.calls[0].resolve(h.response());
await h.settle();
assert.equal(h.runtime.loadingOffers,false);
assert.equal(h.runtime.postalValidated,true);
assert.equal(h.runtime.offers.length,1);
assert.equal(h.runtime.lastOfferFingerprint,h.eval('liveOfferRequestFingerprint()'));
assert.equal(h.remembers.length,1);
h.eval('liveScheduleOfferRefresh(650)');
h.flushTimers();
assert.equal(h.calls.length,1,'Identical recently completed request must be deduplicated');

h.eval('liveRefreshOffers({silent:true})');
assert.equal(h.calls.length,2,'Manual explicit refresh remains available, bypassing 20s auto cooldown');
h.state.addressNumber='13';
h.eval('liveInvalidateOfferAddressDraft()');
assert.equal(h.runtime.offers.length,0,'Editing a number immediately clears old quotes');
assert.equal(h.runtime.lastCityCheck,null,'Old city quote evidence must be cleared');
assert.equal(h.runtime.loadingOffers,false,'Pending stale request must not hold the UI');
h.calls[1].resolve(h.response());
await h.settle();
assert.equal(h.runtime.offers.length,0,'Late response from old address cannot restore stale offer');
assert.equal(h.runtime.postalValidated,false,'Late response cannot confirm modified address');
assert.equal(h.remembers.length,1,'Late response cannot change confirmed city');
h.eval('liveScheduleOfferRefresh(650)');
h.flushTimers();
assert.equal(h.calls.length,3,'Modified address needs a new quote');
assert.equal(h.calls[2].payload.addressNumber,'13');
h.calls[2].resolve(h.response());
await h.settle();
assert.equal(h.runtime.offers.length,1);

h.state.postalCode='97300';
h.eval('liveInvalidateOfferAddressDraft()');
h.eval('liveScheduleOfferRefresh(650)');
assert.equal(h.timers.size,0,'Incomplete CEP must not schedule a network lookup');
h.state.postalCode='97300000';
h.state.addressNumber='14';
h.eval('liveScheduleOfferRefresh(650)');
h.setRoute('home');
h.flushTimers();
assert.equal(h.calls.length,3,'Leaving checkout cancels the delayed query');
h.setRoute('order');
h.eval('liveScheduleOfferRefresh(650)');
h.flushTimers();
assert.equal(h.calls.length,4);
h.calls[3].reject(new Error('temporarily unavailable'));
await h.settle();
assert.equal(h.runtime.loadingOffers,false);
assert.equal(h.runtime.lastOfferFingerprint,null,'Errors must not cache a negative result forever');
h.eval('liveScheduleOfferRefresh(650)');
h.flushTimers();
assert.equal(h.calls.length,5,'Retry after transient failure must remain possible');
h.calls[4].resolve(h.response());
await h.settle();

const draftFn=frontend.slice(
  frontend.indexOf('function deliveryAddressDraftChanged(){'),
  frontend.indexOf('\nasync function setAddress()',frontend.indexOf('function deliveryAddressDraftChanged(){'))
);
assert.ok(draftFn.includes('globalThis.liveInvalidateOfferAddressDraft?.()'));
assert.ok(draftFn.includes('globalThis.liveScheduleOfferRefresh?.(650)'));
const typed={postal:'97300-000',number:'42'};
const events=[],draftState={
  postalCode:'97300000',addressNumber:'12',address:'Rua Antiga',cart:{P13:1}
};
const elements={'#postal-code':{get value(){return typed.postal}},
  '#address-number':{get value(){return typed.number}},
  '#address-auto-status span:last-child':{textContent:''}
};
const draftContext=vm.createContext({
  state:draftState,document:{querySelector:selector=>elements[selector]||null},
  liveRuntime:{offers:[{id:'old'}]},products:{P13:{name:'Gás'}},
  globalThis:{
    __CHAMA_TEST__:false,liveRuntime:null,
    liveInvalidateOfferAddressDraft:()=>events.push('invalidate'),
    liveReady:()=>true,liveScheduleOfferRefresh:delay=>events.push(['schedule',delay])
  },
  save:()=>events.push('save'),hasCartItems:()=>true
});
vm.runInContext(draftFn,draftContext);
vm.runInContext('deliveryAddressDraftChanged()',draftContext);
assert.equal(draftState.addressNumber,'42');
assert.equal(draftState.address,'');
assert.deepEqual(events,['invalidate','save',['schedule',650]]);
vm.runInContext('deliveryAddressDraftChanged()',draftContext);
assert.equal(events.length,3,'Blur after input must not schedule duplicate lookup');
typed.postal='9730';
vm.runInContext('deliveryAddressDraftChanged()',draftContext);
assert.equal(events.filter(x=>Array.isArray(x)).length,1,'Incomplete CEP suppresses automatic lookup');

// The postal field uses a JS template interpolation with an arrow (=>) in
// its value. Do not use a naive HTML regex that stops on the arrow's '>'.
const postalAt=frontend.lastIndexOf('id="postal-code"');
const numberAt=frontend.indexOf('id="address-number"');
assert.ok(postalAt>=0&&numberAt>=0,'Both real delivery address fields must exist');
const realInputs=[frontend.slice(postalAt,postalAt+680),frontend.slice(numberAt,numberAt+440)];
assert.ok(realInputs.every(t=>t.includes('onchange="deliveryAddressDraftChanged()"')),
  'Both address fields retain blur fallback');
assert.ok(realInputs.every(t=>t.includes('oninput="deliveryAddressDraftChanged()"')),
  'Typing rather than blur must trigger debounce');
assert.ok(frontend.includes('Consultaremos as ofertas automaticamente.'));
assert.ok(frontend.includes('Não foi possível concluir a consulta.'));
assert.ok(frontend.includes('Tentar novamente'));
assert.ok(!frontend.includes('O servidor confirma rua, bairro e atendimento em São Gabriel/RS.'));
assert.ok(backend.includes('liveRefreshOffers({silent:true})')
 &&backend.includes("replacement.focus({preventScroll:true})")
 &&backend.includes("replacement.setSelectionRange(caret,caret)")
 &&backend.includes("liveOfferRequestFingerprint()!==fingerprint"),
 'Automatic updates must not steal keyboard focus or render an old address');
assert.ok(backend.includes('if(seq!==liveRuntime.offerRequestSeq)return liveRuntime.offers;'),
  'Older response must be rejected by monotonic request sequence');

console.log('V1.162 passed: automatic address lookup, 650ms debounce, in-flight and recent deduplication, stale-response rejection, invalid CEP, navigation and error retry.');
