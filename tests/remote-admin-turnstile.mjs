import assert from 'node:assert/strict';
import {spawn,execSync} from 'node:child_process';

const ADMIN_URL='https://admin.tamao.com.br/?admin=1#admin';
const DEBUG_PORT=9337;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function chromeBinary(){
  const cmd='command -v google-chrome || command -v chromium || command -v chromium-browser';
  return execSync(cmd,{encoding:'utf8',shell:'/bin/bash'}).trim();
}

async function waitDebugger(){
  for(let i=0;i<40;i++){
    try{
      const r=await fetch('http://127.0.0.1:'+DEBUG_PORT+'/json/version');
      if(r.ok)return await r.json();
    }catch{}
    await sleep(250);
  }
  throw new Error('Chrome DevTools não iniciou');
}

const chrome=spawn(chromeBinary(),[
  '--headless=new','--no-sandbox','--disable-gpu',
  '--remote-debugging-port='+DEBUG_PORT,
  '--user-data-dir=/tmp/tamao-turnstile-probe',
  'about:blank'
],{stdio:'ignore'});

try{
  await waitDebugger();
  const tabs=await (await fetch('http://127.0.0.1:'+DEBUG_PORT+'/json/list')).json();
  assert.ok(tabs[0]?.webSocketDebuggerUrl,'CDP sem aba disponível');
  const ws=new WebSocket(tabs[0].webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{
    ws.addEventListener('open',resolve,{once:true});
    ws.addEventListener('error',reject,{once:true});
  });

  let seq=0;
  const pending=new Map();
  ws.addEventListener('message',event=>{
    const msg=JSON.parse(String(event.data));
    if(msg.id&&pending.has(msg.id)){
      const {resolve,reject}=pending.get(msg.id);
      pending.delete(msg.id);
      msg.error?reject(new Error(JSON.stringify(msg.error))):resolve(msg.result);
    }
  });
  const call=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++seq;
    pending.set(id,{resolve,reject});
    ws.send(JSON.stringify({id,method,params}));
  });

  await call('Page.enable');
  await call('Runtime.enable');
  await call('Page.navigate',{url:ADMIN_URL});
  await sleep(5000);

  const setup=await call('Runtime.evaluate',{
    expression:`(async()=>{
      const out={status:'starting',code:null,message:null,key:String(globalThis.CHAMA_TURNSTILE_SITE_KEY||''),host:location.hostname};
      globalThis.__tamaoTurnstileProbe=out;
      if(!globalThis.chamaTurnstile?.preload){out.status='helper-missing';return out}
      try{await globalThis.chamaTurnstile.preload()}catch(e){out.status='load-error';out.message=String(e?.message||e);return out}
      if(!globalThis.turnstile?.render){out.status='api-missing';return out}
      const host=document.createElement('div');
      host.id='tamao-turnstile-probe';
      document.body.appendChild(host);
      try{
        globalThis.turnstile.render(host,{
          sitekey:out.key,
          action:'admin_login',
          size:'flexible',
          callback:()=>{out.status='token'},
          'error-callback':code=>{out.status='error';out.code=String(code||'');return true},
          'unsupported-callback':()=>{out.status='unsupported'},
          'timeout-callback':()=>{out.status='interactive-timeout'}
        });
        if(out.status==='starting')out.status='rendered';
      }catch(e){
        out.status='render-throw';
        out.message=String(e?.message||e);
      }
      return out;
    })()`,
    awaitPromise:true,
    returnByValue:true
  });
  const initial=setup.result?.value||{};
  assert.equal(initial.host,'admin.tamao.com.br','sonda abriu hostname inesperado');
  assert.ok(initial.key.length>=6,'portal admin sem sitekey Turnstile');
  assert.ok(!['helper-missing','load-error','api-missing','render-throw'].includes(initial.status),'Turnstile não inicializou: '+JSON.stringify(initial));

  await sleep(9000);
  const stateResult=await call('Runtime.evaluate',{
    expression:'globalThis.__tamaoTurnstileProbe',
    returnByValue:true
  });
  const state=stateResult.result?.value||initial;
  const code=String(state.code||'');
  const hardConfigError=
    ['110100','110110','110200','110600','200100','200500','400020','400021','400070'].includes(code);
  assert.equal(hardConfigError,false,'Turnstile live falhou com erro de configuração/rede '+code+': '+JSON.stringify(state));
  assert.notEqual(state.status,'unsupported','Turnstile declarou navegador incompatível');

  if(state.status==='error'&&(/^(300|600)/.test(code))){
    console.warn('Turnstile respondeu com challenge anti-automação '+code+'; hostname/API carregaram corretamente.');
  }else{
    console.log('Turnstile live admin smoke:',JSON.stringify(state));
  }

  ws.close();
}finally{
  chrome.kill('SIGTERM');
}
