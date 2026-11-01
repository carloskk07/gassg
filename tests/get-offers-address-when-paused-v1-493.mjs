import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');

const edge=read('supabase/functions/get-offers/index.ts');
const customer=read('js/backend.js');
const checkout=read('js/customer.js');
const start=edge.indexOf('    // A paused commercial checkout must still validate');
const end=edge.indexOf('    // Never allow another municipality',start);
assert.ok(start>=0&&end>start,'expected address/launch gate source section');
const gate=edge.slice(start,end);
assert.ok(gate.indexOf('validateServicePostalCode(')<gate.indexOf('commerce_launch_status'),
  'postal validation must precede the commerce gate');
assert.match(gate,/commerceLaunchBlocked:true[\s\S]*\.\.\.addressMeta/,
  'closed commerce must return the validated address without creating a quote');

async function exercise({enabled=false,invalidPostal=false}={}){
  const calls=[];
  const ctx={
    admin:{rpc:async name=>{
      calls.push('rpc:'+name);
      if(name!=='commerce_launch_status')throw Error('unexpected RPC '+name);
      return {data:{commerceEnabled:enabled,operationMode:enabled?'LIVE':'PRELAUNCH'},error:null};
    }},
    body:{postalCode:'97300-000'},addressNumber:'123',origin:'https://tamao.com.br',
    validateServicePostalCode:async (_client,code)=>{
      calls.push('postal');
      if(invalidPostal)throw Error('INVALID_POSTAL');
      assert.equal(code,'97300-000');
      return {postalCode:'97300000',street:'Rua de Teste',city:'São Gabriel',state:'RS',neighborhood:'Centro'};
    },
    canonicalAddress:(postal,number)=>postal.street+', '+number+', '+postal.city+'/'+postal.state,
    json:(data,status)=>({data,status})
  };
  let result,error;
  try{result=await vm.runInNewContext('(async()=>{\n'+gate+'\nreturn null;\n})()',ctx)}
  catch(e){error=e}
  return {result,error,calls};
}
const disabled=await exercise();
assert.equal(disabled.error,undefined);
assert.equal(disabled.result.status,200);
assert.equal(disabled.result.data.commerceLaunchBlocked,true);
assert.equal(disabled.result.data.launchMode,'prelaunch');
assert.equal(disabled.result.data.postalValidated,true);
assert.equal(disabled.result.data.postalCode,'97300000');
assert.equal(disabled.result.data.addressNumber,'123');
assert.match(disabled.result.data.canonicalAddress,/Rua de Teste, 123/);
assert.equal(disabled.result.data.serviceCity,'São Gabriel');
assert.equal(disabled.result.data.serviceState,'RS');
assert.equal(disabled.result.data.offers.length,0);
assert.deepEqual(disabled.calls,['postal','rpc:commerce_launch_status']);

const enabled=await exercise({enabled:true});
assert.equal(enabled.error,undefined);
assert.equal(enabled.result,null);
assert.deepEqual(enabled.calls,['postal','rpc:commerce_launch_status']);

const invalid=await exercise({invalidPostal:true});
assert.match(String(invalid.error),/INVALID_POSTAL/);
assert.deepEqual(invalid.calls,['postal'],'do not query launch after invalid postal');

assert.ok(customer.includes('if(liveRuntime.postalValidated&&data?.canonicalAddress)'),
  'customer backend must store valid canonical address');
assert.ok(checkout.includes('commerceLaunchBlocked'),'no-offer checkout must keep its commercial gate');
assert.ok(checkout.includes('onclick="requestUnavailableDelivery()"'),
  'no-offer checkout must keep its request action');
assert.ok(!gate.includes('create-order')&&!gate.includes('merchant_billing'),
  'paused-market path must not create orders or charges');
console.log('PASS #493: disabled commerce returns verified address and available contact action; no offer created.');
