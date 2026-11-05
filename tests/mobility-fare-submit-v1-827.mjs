import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../js/mobility.js',import.meta.url),'utf8');
const calls=[];
class FakeFormData{
 constructor(form){this.form=form}
 get(key){return this.form[key]??null}
}
const ctx={console,Date,Intl,URL,URLSearchParams,FormData:FakeFormData,
 BRL:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),
 document:{querySelector:()=>null,createElement:()=>({}),head:{appendChild(){}},addEventListener(){}},
 route:()=> 'mobility',render(){},esc:value=>String(value??'').replace(/</g,'&lt;'),
 CHAMA_BACKEND:{url:'https://ci.example',publishableKey:'test'}};
ctx.globalThis=ctx;
vm.runInNewContext(source+';this.rt=mobilityRuntime;',ctx);
const rt=ctx.rt;
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const user='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
rt.id=id;rt.user={id:user};rt.sessionEpoch=5;
rt.detail={id,role:'driver',status:'accepted',fare_cents:null};
rt.client={rpc:async(name,args)=>{calls.push({name,args});return {data:{fareCents:args.p_fare_cents},error:null}}};
ctx.mobilityRefresh=async()=>{rt.detail={...rt.detail,fare_cents:calls.at(-1).args.p_fare_cents};return true};
const send=async fare=>ctx.mobilityFarePropose({preventDefault(){},target:{fare}});
for(const fare of ['0','0.99','19.999','hello','1e4','-50']){
 rt.busy=false;rt.error='';await send(fare);
 assert.equal(calls.length,0,'preço inválido não pode chamar RPC: '+fare);
 assert.match(rt.error,/valor/i);
}
for(const [fare,cents] of [['1',100],['19.90',1990],['100000',10000000]]){
 rt.busy=false;rt.error='';
 await send(fare);
 assert.equal(calls.at(-1).name,'mobility_fare_propose_v1_826');
 assert.equal(calls.at(-1).args.p_fare_cents,cents);
 assert.equal(rt.detail.fare_cents,cents);
 assert.equal(rt.error,'','Preço válido deve ser confirmado pelo servidor: '+fare);
 assert.match(rt.notice,/confirmado pelo servidor/);
}
assert.equal(calls.length,3);
console.log('TAMÃO #827: preço real do motorista aceito, erro e valores incorretos barrados.');
