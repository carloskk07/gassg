import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=x=>fs.readFileSync(new URL('../'+x,import.meta.url),'utf8');
const script=read('js/discovery.js');
new vm.Script(script);
// Synthetic browser now = Nov 1, 2026, 22:30 São Paulo time, but the
// UTC calendar has already advanced to Nov 2. No browser/PSP calls.
class BrazilNightDate extends Date {
 constructor(...args){super(...(args.length?args:['2026-11-02T01:30:00Z']))}
 static now(){return Date.parse('2026-11-02T01:30:00Z')}
 getFullYear(){return 2026}
 getMonth(){return 10}
 getDate(){return 1}
}
const uuid='99999999-9999-4999-8999-999999999999';
let kind='professionals';
const ctx={
 Date:BrazilNightDate,URL,URLSearchParams,console,
 route:()=>kind,esc:x=>String(x).replace(/</g,'&lt;'),
 shell:x=>x,render(){},
 BRL:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),
 location:{origin:'https://tamao.com.br',search:'',hash:'#professionals'},
 CHAMA_BACKEND:{url:'https://example.supabase.co',publishableKey:'test-public'}
};ctx.globalThis=ctx;
vm.runInNewContext(script,ctx);
assert.equal(ctx.discoveryTodayLocal(),'2026-11-01');
for(const [value,valid] of [
 ['2026-11-01',true],['2026-11-02',true],['2026-10-31',true],
 ['2026-02-30',false],['2026-11-31',false],['today',false]
])assert.equal(ctx.discoveryValidCalendarDate(value),valid,value);
const moto='Mototáxi',car='Motorista de carro / táxi';
assert.equal(ctx.discoveryProfessionalTransportKind(moto),'moto');
assert.equal(ctx.discoveryProfessionalTransportKind('Moto Táxi'),'moto');
assert.equal(ctx.discoveryProfessionalTransportKind('moto-taxi'),'moto');
assert.equal(ctx.discoveryProfessionalTransportKind(car),'carro');
assert.equal(ctx.discoveryProfessionalTransportKind('Taxista'),'carro');
assert.equal(ctx.discoveryProfessionalTransportKind('Eletricista'),'');
const base={id:uuid,vertical:'professionals',title:'Profissional de testes',
 description:'Atendimento mediante confirmação',city_name:'São Gabriel',
 state_code:'RS',whatsapp_e164:'+555599998888'};
for(const [requested,occupation,expected] of [
 ['carro',moto,false],['moto',car,false],['moto',moto,true],['carro',car,true]
]){
 ctx.discoveryState('professionals').service=requested;
 const item={...base,occupation};
 const page=ctx.discoveryCard(item,'professionals');
 assert.equal(page.includes('Solicitar e acompanhar no mapa'),expected,
  requested+'/'+occupation+' must not misroute tracking');
 const inquiry=ctx.discoveryInquiryForm(item,'professionals');
 assert.equal(inquiry.includes('Consultar trajeto e corrida'),expected,
  'quote intent must use this listing mode, not the global filter');
 if(!expected)assert.match(inquiry,/Pedir orçamento com detalhes/);
}
ctx.discoveryState('professionals').service='';
function inquiry(values,mode='stays',departure=''){
 const feedback={textContent:''};
 const box={dataset:{phone:'+555599998888',kind:mode,service:'moto',
  departure,title:'Anúncio de teste',max:'3'},
  querySelector(selector){
   if(selector==='.discovery-inquiry-feedback')return feedback;
   const field=selector.match(/\[name="([^"]+)"\]/)?.[1];
   return field&&Object.hasOwn(values,field)?{value:values[field]}:null;
  }};
 const link={href:'#',closest:()=>box};
 const ok=ctx.discoveryPrepareInquiry(link);
 return {ok,feedback:feedback.textContent,href:link.href};
}
let test=inquiry({checkin:'2026-11-01',checkout:'2026-11-02',guests:'2'});
assert.equal(test.ok,true,'same-day lodging in São Paulo evening must be accepted');
assert.match(decodeURIComponent(test.href),/2026-11-01 a 2026-11-02/);
test=inquiry({checkin:'2026-10-31',checkout:'2026-11-03',guests:'2'});
assert.equal(test.ok,false,'yesterday stays remain rejected');
test=inquiry({checkin:'2026-11-02',checkout:'2026-11-02',guests:'2'});
assert.equal(test.ok,false,'checkout must be after check-in');
test=inquiry({origin:'Centro',destination:'Vila Nova',
 preferred_day:'2026-11-01',service:''},'professionals');
assert.equal(test.ok,true,'same-day motorbike inquiry works in late local evening');
test=inquiry({origin:'Centro',destination:'Vila Nova',
 preferred_day:'2026-10-31',service:''},'professionals');
assert.equal(test.ok,false,'past service inquiry date remains invalid');
const ride={id:uuid,vertical:'rides',title:'Carona',
 description:'Viagem eventual',departure_city:'São Gabriel',destination_city:'Bagé',
 whatsapp_e164:'+555599998888',seats_available:3,
 departure_at:'2026-11-02T02:00:00Z'};
assert.equal(ctx.discoveryRideAvailable(ride),true);
kind='rides';
assert.match(ctx.discoveryCard(ride,'rides'),/Consultar vagas pelo WhatsApp/);
assert.match(ctx.discoveryInquiryForm(ride,'rides'),/Quantas vagas deseja consultar/);
test=inquiry({seats:'2'},'rides',ride.departure_at);
assert.equal(test.ok,true,'future departure can be consulted');
test=inquiry({seats:'2'},'rides','2026-11-02T01:00:00Z');
assert.equal(test.ok,false,'a cached carpool departure must not be contacted after departure');
assert.match(test.feedback,/já passou/);
for(const unavailable of [
 {...ride,departure_at:'2026-11-02T01:00:00Z'},
 {...ride,seats_available:0}
]){
 assert.equal(ctx.discoveryWhatsApp(unavailable),'','past/full rides do not expose direct inquiry');
 assert.equal(ctx.discoveryInquiryForm(unavailable,'rides'),'');
 assert.doesNotMatch(ctx.discoveryCard(unavailable,'rides'),/Consultar vagas pelo WhatsApp|Preparar consulta no WhatsApp/);
 assert.match(ctx.discoveryCard(unavailable,'rides'),/Saída encerrada ou sem vagas/);
}
assert.match(read('.github/workflows/audit.yml'),/node tests\/discovery-transport-calendar-safety-v1-493\.mjs/);
console.log('PASS: moto/car modal purity, stale carpool contacts denied, São Paulo date-only stays and professional quotes');
