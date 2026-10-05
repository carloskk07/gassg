import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8');
const handlers=new Map();
const store=new Map();

function keyOf(key){
  if(typeof key==='string')return key;
  return String(key?.url||key);
}
const cache={
  async put(key,response){store.set(keyOf(key),response.clone())},
  async match(key){const value=store.get(keyOf(key)); return value?value.clone():undefined},
  async addAll(){},
};
const cachesMock={
  async open(){return cache},
  async keys(){return ['tamao-sg-v1.57','tamao-sg-v1.70.3']},
  async delete(name){return name!=='tamao-sg-v1.70.3'}
};
let fetchImpl=async()=>{throw new Error('fetch not configured')};

const context={
  self:{
    location:{origin:'https://tamao.com.br'},
    registration:{scope:'https://tamao.com.br/'},
    clients:{claim:async()=>{},matchAll:async()=>[],openWindow:async()=>{}},
    skipWaiting:async()=>{},
    addEventListener(type,fn){handlers.set(type,fn)}
  },
  caches:cachesMock,
  fetch:(...args)=>fetchImpl(...args),
  URL,Response,Promise,console
};
vm.runInNewContext(source,context,{filename:'sw.js'});

async function dispatchFetch(req){
  let responsePromise=null;
  handlers.get('fetch')({
    request:req,
    respondWith(value){responsePromise=Promise.resolve(value)}
  });
  assert.ok(responsePromise,'fetch handler precisa responder');
  return await responsePromise;
}

// 1) A navegação direta para um JSON não pode envenenar ./index.html.
store.set('./index.html',new Response('<html>shell-antigo</html>',{status:200,headers:{'content-type':'text/html'}}));
fetchImpl=async req=>{
  assert.equal(req.url,'https://tamao.com.br/portal-build.json');
  return new Response('{"schemaVersion":1}',{status:200,headers:{'content-type':'application/json'}});
};
const jsonReq={method:'GET',url:'https://tamao.com.br/portal-build.json',mode:'navigate'};
const jsonRes=await dispatchFetch(jsonReq);
assert.equal(await jsonRes.text(),'{"schemaVersion":1}');
assert.equal(await (await cache.match('./index.html')).text(),'<html>shell-antigo</html>','JSON não pode substituir o app shell');
assert.equal(await (await cache.match(jsonReq)).text(),'{"schemaVersion":1}','recurso não-HTML pode ser cacheado na própria chave');

// 2) Uma navegação HTML válida deve renovar o app shell.
fetchImpl=async()=>new Response('<html>shell-novo</html>',{status:200,headers:{'content-type':'text/html; charset=utf-8'}});
const homeReq={method:'GET',url:'https://tamao.com.br/alguma-rota',mode:'navigate'};
const homeRes=await dispatchFetch(homeReq);
assert.equal(await homeRes.text(),'<html>shell-novo</html>');
assert.equal(await (await cache.match('./index.html')).text(),'<html>shell-novo</html>');

// 3) Offline em rota não cacheada deve cair no shell HTML, nunca em JSON.
fetchImpl=async()=>{throw new Error('offline')};
const offlineReq={method:'GET',url:'https://tamao.com.br/outra-rota',mode:'navigate'};
const offlineRes=await dispatchFetch(offlineReq);
assert.match(await offlineRes.text(),/shell-novo/);

// 4) A rede do SW deve ignorar HTTP cache para reduzir bundle obsoleto pós-deploy.
assert.match(source,/fetch\(req,\{cache:'no-store'\}\)/);
assert.match(source,/contentType\.includes\('text\/html'\)/);
assert.ok(!source.includes("req.mode==='navigate'?'./index.html':req"),'padrão antigo de cache poisoning não pode voltar');

console.log('Service worker cache integrity passou.');
