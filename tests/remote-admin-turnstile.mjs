import assert from 'node:assert/strict';
import {spawn,execSync} from 'node:child_process';
import {rmSync} from 'node:fs';

const ADMIN_URL='https://admin.tamao.com.br/?admin=1#admin';
const DEBUG_PORT_BASE=9337;
const CHROME_START_ATTEMPTS=3;
const CHROME_START_POLLS=80;
const CHROME_START_POLL_MS=250;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function chromeBinary(){
  const cmd='command -v google-chrome || command -v chromium || command -v chromium-browser';
  return execSync(cmd,{encoding:'utf8',shell:'/bin/bash'}).trim();
}

function compactDiagnostics(value){
  return String(value||'')
    .replace(/\u001b\[[0-9;]*m/g,'')
    .trim()
    .slice(-12000);
}

async function stopChrome(chrome){
  if(!chrome||chrome.exitCode!==null)return;
  chrome.kill('SIGTERM');
  for(let i=0;i<20&&chrome.exitCode===null;i++)await sleep(100);
  if(chrome.exitCode===null)chrome.kill('SIGKILL');
}

async function waitDebugger({port,chrome,diagnostics}){
  for(let i=0;i<CHROME_START_POLLS;i++){
    if(chrome.exitCode!==null){
      throw new Error(
        'Chrome encerrou antes do DevTools (exit='+chrome.exitCode+'): '+
        compactDiagnostics(diagnostics.stderr)
      );
    }
    if(diagnostics.spawnError){
      throw new Error('Chrome falhou ao iniciar: '+diagnostics.spawnError);
    }
    try{
      const r=await fetch('http://127.0.0.1:'+port+'/json/version');
      if(r.ok)return await r.json();
    }catch{}
    await sleep(CHROME_START_POLL_MS);
  }
  throw new Error(
    'Chrome DevTools não iniciou em '+
    (CHROME_START_POLLS*CHROME_START_POLL_MS)+'ms: '+
    compactDiagnostics(diagnostics.stderr)
  );
}

async function launchChrome(){
  const binary=chromeBinary();
  const failures=[];
  for(let attempt=1;attempt<=CHROME_START_ATTEMPTS;attempt++){
    const port=DEBUG_PORT_BASE+attempt-1;
    const profile='/tmp/tamao-turnstile-probe-'+process.pid+'-'+attempt;
    rmSync(profile,{recursive:true,force:true});
    const diagnostics={stderr:'',spawnError:''};
    const chrome=spawn(binary,[
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port='+port,
      '--user-data-dir='+profile,
      'about:blank'
    ],{stdio:['ignore','ignore','pipe']});

    chrome.stderr?.on('data',chunk=>{
      diagnostics.stderr=(diagnostics.stderr+String(chunk)).slice(-12000);
    });
    chrome.on('error',error=>{
      diagnostics.spawnError=String(error?.message||error);
    });

    try{
      await waitDebugger({port,chrome,diagnostics});
      return {chrome,port,profile,attempt};
    }catch(error){
      failures.push('tentativa '+attempt+': '+String(error?.message||error));
      await stopChrome(chrome);
      rmSync(profile,{recursive:true,force:true});
      if(attempt<CHROME_START_ATTEMPTS)await sleep(500);
    }
  }
  throw new Error(
    'Chrome DevTools não iniciou após '+CHROME_START_ATTEMPTS+
    ' tentativas independentes. '+failures.join(' | ')
  );
}

const launched=await launchChrome();
const {chrome,port,profile}=launched;

try{
  if(launched.attempt>1){
    console.warn('Chrome DevTools iniciou após retry '+launched.attempt+'.');
  }

  const targetResponse=await fetch(
    'http://127.0.0.1:'+port+'/json/new?'+encodeURIComponent(ADMIN_URL),
    {method:'PUT'}
  );
  assert.ok(targetResponse.ok,'CDP recusou criação da aba do portal admin');
  const target=await targetResponse.json();
  assert.ok(target?.webSocketDebuggerUrl,'CDP não criou a aba do portal admin');

  const ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(
      ()=>reject(new Error('Timeout abrindo WebSocket CDP')),
      10000
    );
    ws.addEventListener('open',()=>{
      clearTimeout(timer);
      resolve();
    },{once:true});
    ws.addEventListener('error',event=>{
      clearTimeout(timer);
      reject(new Error('Falha abrindo WebSocket CDP: '+String(event?.message||'')));
    },{once:true});
  });

  let seq=0;
  const pending=new Map();
  ws.addEventListener('message',event=>{
    const msg=JSON.parse(String(event.data));
    if(msg.id&&pending.has(msg.id)){
      const {resolve,reject,timer}=pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(timer);
      msg.error?reject(new Error(JSON.stringify(msg.error))):resolve(msg.result);
    }
  });
  const call=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++seq;
    const timer=setTimeout(()=>{
      pending.delete(id);
      reject(new Error('Timeout CDP em '+method));
    },15000);
    pending.set(id,{resolve,reject,timer});
    ws.send(JSON.stringify({id,method,params}));
  });

  await call('Page.enable');
  await call('Runtime.enable');

  let liveHost='';
  for(let attempt=0;attempt<40;attempt++){
    const loc=await call('Runtime.evaluate',{
      expression:'location.hostname',
      returnByValue:true
    });
    liveHost=String(loc.result?.value||'');
    if(liveHost==='admin.tamao.com.br')break;
    await sleep(500);
  }
  assert.equal(liveHost,'admin.tamao.com.br','Chromium não abriu o portal admin real');
  await sleep(2500);

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
  assert.ok(
    !['helper-missing','load-error','api-missing','render-throw'].includes(initial.status),
    'Turnstile não inicializou: '+JSON.stringify(initial)
  );

  await sleep(9000);
  const stateResult=await call('Runtime.evaluate',{
    expression:'globalThis.__tamaoTurnstileProbe',
    returnByValue:true
  });
  const state=stateResult.result?.value||initial;
  const code=String(state.code||'');
  const hardConfigError=
    ['110100','110110','110200','110600','200100','200500','400020','400021','400070'].includes(code);
  assert.equal(
    hardConfigError,
    false,
    'Turnstile live falhou com erro de configuração/rede '+code+': '+JSON.stringify(state)
  );
  assert.notEqual(state.status,'unsupported','Turnstile declarou navegador incompatível');

  if(state.status==='error'&&(/^(300|600)/.test(code))){
    console.warn(
      'Turnstile respondeu com challenge anti-automação '+code+
      '; hostname/API carregaram corretamente.'
    );
  }else{
    console.log('Turnstile live admin smoke:',JSON.stringify(state));
  }

  ws.close();
}finally{
  await stopChrome(chrome);
  rmSync(profile,{recursive:true,force:true});
}
