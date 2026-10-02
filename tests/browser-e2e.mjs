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
  await evaluate(`(async()=>{const original=window.fetch;window.fetch=(_input,init={})=>new Promise((_resolve,reject)=>{const signal=init.signal;if(signal?.aborted)return reject(signal.reason||new DOMException('Aborted','AbortError'));signal?.addEventListener('abort',()=>reject(signal.reason||new DOMException('Aborted','AbortError')),{once:true})});try{await chamaFetch('/timeout-probe',{},25);return 'NO_TIMEOUT'}catch(error){return error?.code||error?.name||String(error)}finally{window.fetch=original}})()`),
  'NETWORK_TIMEOUT'
);

const retryProbe=JSON.parse(await evaluate(`(async()=>{let attempts=0;const result=await retryAmbiguousOnce(async()=>{attempts++;if(attempts===1){const error=new Error('ACK perdido');error.code='NETWORK_TIMEOUT';throw error}return 'OK'});return JSON.stringify({attempts,result})})()`));
assert.deepEqual(retryProbe,{attempts:2,result:'OK'});

const noRetryProbe=JSON.parse(await evaluate(`(async()=>{let attempts=0;try{await retryAmbiguousOnce(async()=>{attempts++;const error=new Error('regra');error.code='INVALID_ACTION';error.status=400;throw error})}catch(error){return JSON.stringify({attempts,code:error.code})}})()`));
assert.deepEqual(noRetryProbe,{attempts:1,code:'INVALID_ACTION'});

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
assert.match(body,/Transforme pedidos adicionais em faturamento incremental/);
assert.match(body,/2%/);
assert.match(body,/Taxa Chama: 7,5% por pedido concluído/);
await auditDom('earn');

await evaluate("go('merchants')");
await waitFor("document.body.innerText.includes('SIMULADOR DE MARGEM INCREMENTAL')","merchant commercial route");
body=await text();
assert.match(body,/7,5%/);
assert.match(body,/Sem exclusividade/);
assert.match(body,/Você não precisa ser sempre o mais barato/);
assert.match(body,/PARCEIRO FUNDADOR/);
await evaluate("document.querySelector('#merchant-sim-orders').value='20'; document.querySelector('#merchant-sim-ticket').value='150'; document.querySelector('#merchant-sim-product-cost').value='100'; document.querySelector('#merchant-sim-delivery-cost').value='5'; document.querySelector('#merchant-sim-payment-cost').value='2'; document.querySelector('#merchant-sim-tax-rate').value='0'; updateMerchantSimulator()");
assert.match(await evaluate("document.querySelector('#merchant-sim-gross').textContent"),/3\.000,00/);
assert.match(await evaluate("document.querySelector('#merchant-sim-fee').textContent"),/225,00/);
assert.match(await evaluate("document.querySelector('#merchant-sim-costs').textContent"),/2\.140,00/);
assert.match(await evaluate("document.querySelector('#merchant-sim-contribution').textContent"),/635,00/);
assert.match(await evaluate("document.querySelector('#merchant-sim-unit').textContent"),/31,75/);
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

// Internal pilot on GitHub Pages reuses the proven simulation engine with a
// single JR supplier. Exercise the complete customer ↔ merchant path separately.
await evaluate("globalThis.CHAMA_INTERNAL_PILOT=true; reset(); render()");
await waitFor("document.body.innerText.includes('PILOTO INTERNO') && document.body.innerText.includes('Gas e Lenheira do JR')","internal pilot home");
body=await text();
assert.match(body,/115,90/);
assert.match(body,/SEM PEDIDOS REAIS/);
assert.equal(await evaluate("state.merchants.length"),1);
assert.equal(await evaluate("state.merchants[0].id"),'JR-PILOT');
assert.equal(await evaluate("state.merchants[0].priceP13"),115.9);

await evaluate("go('merchants')");
await waitFor("document.body.innerText.includes('Experimentar painel da revenda') && document.body.innerText.includes('PARCEIRO FUNDADOR')","pilot merchant conversion landing");
body=await text();
assert.match(body,/Sem exclusividade/);
assert.match(body,/SIMULADOR DE MARGEM INCREMENTAL/);
await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Experimentar painel da revenda')).click()");
await waitFor("location.hash==='#merchant' && document.body.innerText.includes('PAINEL DA REVENDA — PILOTO INTERNO')","pilot merchant CTA");
await evaluate("setMode('customer'); go('home')");

await evaluate("quickProduct('P13')");
await waitFor("location.hash==='#order'","pilot order route");
await evaluate("document.querySelector('#address').value='Rua Piloto Interno, 100'; setAddress()");
await waitFor("document.body.innerText.includes('OPÇÃO DISPONÍVEL AGORA')","pilot single supplier offer");
body=await text();
assert.match(body,/Simulação operacional/);
assert.match(body,/115,90/);
assert.doesNotMatch(body,/Parceiro local verificado/);
assert.equal(await evaluate("offers().length"),1);
assert.deepEqual(JSON.parse(await evaluate("JSON.stringify(offers()[0].roles)")),['Disponível agora']);

await evaluate("checkout('JR-PILOT')");
await waitFor("location.hash==='#tracking' && document.body.innerText.includes('Aguardando parceiro')","pilot tracking pending");
await evaluate("setMode('merchant')");
await waitFor("document.body.innerText.includes('PAINEL DA REVENDA — PILOTO INTERNO') && document.querySelector('.order-card.new')","pilot merchant pending");
body=await text();
assert.match(body,/Nenhuma ação é real/);
await evaluate("document.querySelector('.order-card.new .primary').click()");
await waitFor("document.body.innerText.includes('Confirmar saída')","pilot merchant accepted");
await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Confirmar saída')).click()");
await waitFor("document.body.innerText.includes('Estou chegando')","pilot dispatched");
await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Estou chegando')).click()");

await evaluate("setMode('customer'); go('tracking')");
await waitFor("document.body.innerText.includes('Código de recebimento')","pilot customer PIN");
body=await text();
const pilotPin=(body.match(/Código de recebimento:\s*(\d{4})/)||[])[1];
assert.ok(pilotPin,'Código de recebimento do piloto não encontrado');
assert.match(body,/Gas e Lenheira do JR/);

await evaluate("setMode('merchant')");
await waitFor("document.querySelector('.pin-input') && document.querySelector('input[id^=paid-]')","pilot merchant delivery");
await evaluate("document.querySelector('input[id^=paid-]').checked=true; document.querySelector('.pin-input').value="+JSON.stringify(pilotPin)+"; [...document.querySelectorAll('button')].find(b=>b.textContent.includes('Confirmar entrega')).click()");
await waitFor("document.body.innerText.includes('Nenhum pedido ativo')","pilot merchant settled");

await evaluate("setMode('customer'); go('tracking')");
await waitFor("document.body.innerText.includes('Concluído')","pilot customer settled");
body=await text();
assert.match(body,/R\$\s*1,15/);

assert.deepEqual(pageErrors,[],`Chrome registrou erros: ${pageErrors.join(' | ')}`);

console.log('E2E Chrome passou: fluxo padrão + piloto interno JR P13 R$ 115,90 até settlement e cashback.');
ws.close();
