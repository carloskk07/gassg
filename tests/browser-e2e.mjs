import assert from 'node:assert/strict';

const BASE=process.env.CHAMA_BASE_URL||'http://127.0.0.1:4173/';
const DEBUG=process.env.CHROME_DEBUG||'http://127.0.0.1:9222';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function getTarget(){
  for(let i=0;i<30;i++){
    try{
      const list=await fetch(DEBUG+'/json/list').then(r=>r.json());
      const page=list.find(x=>x.type==='page');
      if(page)return page;
    }catch{}
    await sleep(200);
  }
  throw new Error('Chrome DevTools não respondeu');
}

const target=await getTarget();
const ws=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{
  const t=setTimeout(()=>reject(new Error('timeout websocket')),5000);
  ws.addEventListener('open',()=>{clearTimeout(t);resolve()},{once:true});
  ws.addEventListener('error',reject,{once:true});
});
let seq=0;
const pending=new Map();
const pageErrors=[];
ws.addEventListener('message',ev=>{
  const msg=JSON.parse(String(ev.data));
  if(msg.method==='Runtime.exceptionThrown'){
    pageErrors.push(msg.params?.exceptionDetails?.exception?.description||msg.params?.exceptionDetails?.text||'Runtime exception');
  }
  if(msg.method==='Log.entryAdded'&&['error','warning'].includes(msg.params?.entry?.level)){
    pageErrors.push(msg.params.entry.text||'Browser log error');
  }
  if(msg.id&&pending.has(msg.id)){
    const {resolve,reject,t}=pending.get(msg.id);clearTimeout(t);pending.delete(msg.id);
    if(msg.error)reject(new Error(JSON.stringify(msg.error)));else resolve(msg.result);
  }
});
function send(method,params={}){
  const id=++seq;
  return new Promise((resolve,reject)=>{
    const t=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout '+method))},7000);
    pending.set(id,{resolve,reject,t});
    ws.send(JSON.stringify({id,method,params}));
  });
}
async function evaluate(expression){
  const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});
  if(r.exceptionDetails)throw new Error(r.exceptionDetails.text||'Runtime exception');
  return r.result?.value;
}
async function waitFor(expression,label,timeout=7000){
  const end=Date.now()+timeout;
  let lastEvalError='';
  while(Date.now()<end){
    try{if(await evaluate(expression))return}catch(e){lastEvalError=String(e?.message||e)}
    await sleep(100);
  }
  let debug={};
  try{
    debug=JSON.parse(await evaluate(`JSON.stringify({hash:location.hash,href:location.href,text:document.body.innerText.slice(0,1600),renderError:window.__lastRenderError||null})`));
  }catch{}
  throw new Error('Timeout: '+label+' | '+JSON.stringify({debug,lastEvalError,pageErrors}));
}
async function navigate(url){
  await send('Page.navigate',{url});
  await waitFor("document.readyState==='complete'","page load");
  await waitFor("document.querySelector('#app') && document.querySelector('#app').innerText.length>20","app render");
}
const text=()=>evaluate("document.body.innerText");
async function auditDom(label){
  const raw=await evaluate(`JSON.stringify((()=>{const ids=[...document.querySelectorAll('[id]')].map(e=>e.id).filter(Boolean);const dup=ids.filter((id,i)=>ids.indexOf(id)!==i);const controls=[...document.querySelectorAll('input,select,textarea')].filter(e=>e.type!=='hidden');const labels=[...document.querySelectorAll('label')];const unlabeled=controls.filter(e=>!(e.getAttribute('aria-label')||e.getAttribute('aria-labelledby')||e.closest('label')||(e.id&&labels.some(l=>l.htmlFor===e.id)))).map(e=>e.id||e.outerHTML.slice(0,80));const buttons=[...document.querySelectorAll('button')].filter(b=>!(b.textContent.trim()||b.getAttribute('aria-label')||b.title)).length;return {overflow:document.documentElement.scrollWidth-window.innerWidth,dup:[...new Set(dup)],unlabeled,buttons};})())`);
  const a=JSON.parse(raw);
  assert.ok(a.overflow<=1,label+' tem overflow horizontal de '+a.overflow+'px');
  assert.deepEqual(a.dup,[],label+' tem IDs duplicados');
  assert.deepEqual(a.unlabeled,[],label+' tem controles sem label');
  assert.equal(a.buttons,0,label+' tem botões sem nome acessível');
}

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Page.addScriptToEvaluateOnNewDocument',{source:'globalThis.__CHAMA_TEST__=true;'});
await navigate(BASE+'#home');
await evaluate("localStorage.clear(); location.reload()");
await waitFor("document.body.innerText.includes('Seu gás, com preço e prazo')","home after reset");

let body=await text();
assert.match(body,/Seu gás, com preço e prazo/);
assert.match(body,/Quero pedir agora/);
assert.match(body,/Quero entender melhor/);
assert.match(body,/Botijão de cozinha 13 kg/);
assert.match(body,/PROTEÇÃO CHAMA/);
assert.match(body,/Quero ganhar ou vender/);
assert.match(body,/Ambiente isolado de teste automatizado/);
await auditDom('home');

assert.equal(
  await evaluate("buildPortalHref('https://revenda.example.com','merchant',{origin:'https://app.example.com',hostname:'app.example.com',pathname:'/gassg/'})"),
  'https://revenda.example.com/?merchant=1#merchant'
);
assert.equal(
  await evaluate("buildPortalHref('https://admin.example.com','admin',{origin:'https://app.example.com',hostname:'app.example.com',pathname:'/gassg/'})"),
  'https://admin.example.com/?admin=1#admin'
);
assert.equal(
  await evaluate("buildPortalHref('https://app.example.com','customer',{origin:'https://revenda.example.com',hostname:'revenda.example.com',pathname:'/gassg/'})"),
  'https://app.example.com/#home'
);
assert.equal(
  await evaluate("buildPortalHref('https://revenda.example.com','merchant',{origin:'http://127.0.0.1:4173',hostname:'127.0.0.1',pathname:'/'})"),
  'http://127.0.0.1:4173/?merchant=1#merchant'
);

assert.equal(
  await evaluate(`(async()=>{const original=window.fetch;window.fetch=()=>new Promise(()=>{});try{await chamaFetch('/timeout-probe',{},25);return 'NO_TIMEOUT'}catch(error){return error?.code||error?.name||String(error)}finally{window.fetch=original}})()`),
  'NETWORK_TIMEOUT'
);

await evaluate("go('learn')");
await waitFor("document.body.innerText.includes('Antes de pedir, veja quanto custa')","learn route");
body=await text();
assert.match(body,/DÚVIDAS FREQUENTES/);
assert.match(body,/Parceiro precisa confirmar/);
await auditDom('learn');

await evaluate("go('earn')");
await waitFor("document.body.innerText.includes('Comissão por indicação para pessoas')","earn route");
body=await text();
assert.match(body,/Indique quem realmente pode comprar/);
assert.match(body,/Venda mais sem perder o controle/);
assert.match(body,/2%/);
assert.match(body,/Taxa Chama: 7,5% por pedido concluído/);
await auditDom('earn');

await evaluate("go('merchants')");
await waitFor("document.body.innerText.includes('SIMULADOR COMERCIAL')","merchant commercial route");
body=await text();
assert.match(body,/7,5%/);
await evaluate("document.querySelector('#merchant-sim-orders').value='20'; document.querySelector('#merchant-sim-ticket').value='150'; updateMerchantSimulator()");
assert.match(await evaluate("document.querySelector('#merchant-sim-fee').textContent"),/225,00/);
assert.match(await evaluate("document.querySelector('#merchant-sim-net').textContent"),/2\.775,00/);
await auditDom('merchant acquisition');

await evaluate("go('home')");
await waitFor("document.body.innerText.includes('Seu gás, com preço e prazo')","return home");
await evaluate("quickProduct('WATER20')");
await waitFor("location.hash==='#order'","order route");
await evaluate("document.querySelector('#address').value='Rua <img src=x onerror=window.__xss=1> Teste, 123'; setAddress()");
await waitFor("document.querySelector('.offer-stack')","offers rendered");
await auditDom('order');

const basket=await evaluate("JSON.stringify([...document.querySelectorAll('.cart-item')].map(row=>({name:row.querySelector('.product-left strong').textContent,qty:Number(row.querySelector('.qty strong').textContent)})))");
const parsed=JSON.parse(basket);
assert.equal(parsed.find(x=>x.name==='Botijão de cozinha 13 kg').qty,0);
assert.equal(parsed.find(x=>x.name==='Água 20 L').qty,1);

assert.equal(await evaluate("window.__xss===undefined"),true);
await evaluate("checkout('A')");
await waitFor("location.hash==='#tracking' && document.body.innerText.includes('Aguardando parceiro')","tracking pending");
assert.equal(await evaluate("window.__xss===undefined"),true);
await auditDom('tracking pending');

await evaluate("setMode('merchant')");
await waitFor("location.hash==='#merchant' && document.querySelector('.order-card.new')","merchant pending card");
await evaluate("document.querySelector('.order-card.new .primary').click()");
await waitFor("document.body.innerText.includes('Confirmar saída')","merchant preparing");
await auditDom('merchant preparing');

await evaluate("setMode('customer'); go('tracking')");
await waitFor("document.body.innerText.includes('Em preparação')","customer preparing");
body=await text();
assert.match(body,/Revenda Parceira A/);
await auditDom('customer preparing');

await evaluate("setMode('merchant')");
await waitFor("document.body.innerText.includes('Confirmar saída')","merchant dispatch action");
await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Confirmar saída')).click()");
await evaluate("setMode('customer'); go('tracking')");
await waitFor("document.body.innerText.includes('A caminho')","customer out for delivery");

await evaluate("setMode('merchant')");
await waitFor("document.body.innerText.includes('Estou chegando')","merchant arriving action");
await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Estou chegando')).click()");
await evaluate("setMode('customer'); go('tracking')");
await waitFor("document.body.innerText.includes('Código de recebimento')","customer PIN");
body=await text();
const pin=(body.match(/Código de recebimento:\s*(\d{4})/)||[])[1];
assert.ok(pin,'Código de recebimento não encontrado');

await evaluate("setMode('merchant')");
await waitFor("document.querySelector('.pin-input') && document.querySelector('input[id^=paid-]')","merchant PIN and payment confirmation");
await evaluate("document.querySelector('input[id^=paid-]').checked=true; document.querySelector('.pin-input').value='0000'; [...document.querySelectorAll('button')].find(b=>b.textContent.includes('Confirmar entrega')).click()");
await waitFor("document.querySelector('.pin-input')","wrong PIN keeps order open");
await evaluate("document.querySelector('input[id^=paid-]').checked=true; document.querySelector('.pin-input').value="+JSON.stringify(pin)+"; [...document.querySelectorAll('button')].find(b=>b.textContent.includes('Confirmar entrega')).click()");
await waitFor("document.body.innerText.includes('Nenhum pedido ativo')","merchant order closes");

await evaluate("setMode('customer'); go('tracking')");
await waitFor("document.body.innerText.includes('Concluído')","customer settled");
body=await text();
assert.match(body,/cashback/i);

await evaluate("go('club')");
await waitFor("document.body.innerText.includes('Clube Chama')","club route");
body=await text();
assert.match(body,/R\$\s*7,65/);
await auditDom('club');

await evaluate("go('refer')");
await waitFor("document.body.innerText.includes('Indique um novo comprador')","referral route");
body=await text();
assert.match(body,/Saldo disponível e saque são coisas diferentes/);
assert.match(body,/R\$\s*24,00/);
assert.match(body,/primeira compra qualificada/i);
assert.match(body,/Compras repetidas do mesmo cliente não geram novas comissões/i);
assert.equal(await evaluate("[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Saque Pix ainda não disponível')&&b.disabled)"),true);
await evaluate("document.querySelector('#ref-sim-clients').value='25'; document.querySelector('#ref-sim-ticket').value='150'; updateReferralSimulator()");
assert.match(await evaluate("document.querySelector('#ref-sim-total').textContent"),/75,00/);
await auditDom('refer');

assert.deepEqual(pageErrors,[],`Chrome registrou erros: ${pageErrors.join(' | ')}`);

console.log('E2E Chrome passou: água sem botijão → aceite → saída → chegada → pagamento + código → cashback.');
ws.close();
