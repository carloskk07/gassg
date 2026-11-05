import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src=fs.readFileSync(new URL('../js/mobility.js',import.meta.url),'utf8');
const valid={
 eligibleDriver:true,optedIn:false,version:2,normalFeeBps:900,
 memberFeeBps:800,maxDiscountCents:100,
 termsText:'Contrato informado ao usuário: desconto do próprio motorista sem ressarcimento TAMÃO. '
   .repeat(3)
};
let checked=false,rpcCalls=[],serverJoined=false;
const ctx={console,Date,Intl,URL,URLSearchParams,FormData,
 BRL:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),
 document:{querySelector:()=>null,getElementById:(id)=>id==='mobility-program-accept'?{checked}:null,
  createElement:()=>({}),head:{appendChild(){}},addEventListener(){}},
 route:()=> 'mobility',render(){},esc:value=>String(value??'').replace(/</g,'&lt;'),
 CHAMA_BACKEND:{url:'https://ci.example',publishableKey:'test'}};
ctx.globalThis=ctx;
vm.runInNewContext(src+';this.runtime=mobilityRuntime;',ctx);
const s=ctx.runtime;
s.user={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};
s.client={rpc:async(name,args)=>{
 rpcCalls.push({name,args});
 if(name==='mobility_billing_catalog_v1_826')
  return {data:{plans:[{key:'flex',feeBps:900}],benefits:{...valid,optedIn:serverJoined}},error:null};
 if(name==='mobility_benefits_participate_v1_826'){
  serverJoined=args.p_opt_in;
  return {data:{optedIn:serverJoined,termsVersion:2},error:null};
 }
 throw Error('Unexpected RPC '+name);
}};
assert.equal(await ctx.mobilityLoadProgram(),true);
assert.match(ctx.mobilityProgramPanel(),/Taxa Flex: 9% normalmente, 8% ao participar/);
assert.match(ctx.mobilityProgramPanel(),/sem ressarcimento pelo TAMÃO/);
assert.match(ctx.mobilityProgramPanel(),/Condições completas/);
assert.match(ctx.mobilityProgramPanel(),/Li e aceito/);
assert.equal(await ctx.mobilitySetProgram(true),false,'cannot join without informed consent');
assert.equal(rpcCalls.filter(x=>x.name==='mobility_benefits_participate_v1_826').length,0);
checked=true;
await ctx.mobilitySetProgram(true);
assert.equal(serverJoined,true);
assert.equal(s.program.benefits.optedIn,true,'server readback must confirm actual enrollment');
assert.match(ctx.mobilityProgramPanel(),/Sair do programa/);
assert.equal(s.error,'');
await ctx.mobilitySetProgram(false);
assert.equal(serverJoined,false);
assert.match(ctx.mobilityProgramPanel(),/Participar e reduzir a taxa Flex/);
assert.equal(s.error,'');
s.user={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'};s.program=null;s.programSeq++;
assert.equal(ctx.mobilityProgramPanel(),'','cannot show another account terms');
console.log('TAMÃO #832: aceite explícito, taxa e readback de adesão/saída confirmados.');
