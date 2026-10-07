// Cloudflare Turnstile helper for anonymous customer creation.
// Loaded only when a new anonymous Supabase identity is required.
(function(){
  let scriptPromise=null;

  function siteKey(){
    return String(globalThis.CHAMA_TURNSTILE_SITE_KEY||'').trim();
  }

  function loadApi(){
    if(globalThis.turnstile?.render)return Promise.resolve(globalThis.turnstile);
    if(scriptPromise)return scriptPromise;

    scriptPromise=new Promise((resolve,reject)=>{
      document.querySelectorAll('script[data-chama-turnstile-api]').forEach(node=>node.remove());
      const script=document.createElement('script');
      let settled=false;
      const timer=setTimeout(()=>finish(false,new Error('Tempo limite ao carregar a verificação anti-bot')),12000);

      function finish(ok,value){
        if(settled)return;
        settled=true;
        clearTimeout(timer);
        script.onload=null;
        script.onerror=null;
        if(!ok){
          script.remove();
          scriptPromise=null;
          reject(value);
          return;
        }
        resolve(value);
      }

      script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async=true;
      script.defer=true;
      script.dataset.chamaTurnstileApi='1';
      script.onload=()=>{
        if(globalThis.turnstile?.render)finish(true,globalThis.turnstile);
        else finish(false,new Error('Turnstile não inicializou'));
      };
      script.onerror=()=>finish(false,new Error('Falha ao carregar a verificação anti-bot'));
      document.head.appendChild(script);
    });
    return scriptPromise;
  }

  function turnstileErrorMessage(code){
    const value=String(code??'').trim();
    if(value==='110100'||value==='110110'||value==='400020'){
      return 'A chave da verificação anti-bot está inválida ou não foi encontrada. Código Turnstile: '+value;
    }
    if(value==='110200'||value==='400021'){
      return 'Este domínio não está autorizado no Turnstile. Adicione admin.tamao.com.br em Hostname Management. Código Turnstile: '+value;
    }
    if(value==='200500'){
      return 'O Turnstile não conseguiu carregar o iframe. Verifique bloqueadores de anúncios/rastreadores e permita challenges.cloudflare.com. Código Turnstile: '+value;
    }
    if(value==='110600'||value==='110620'){
      return 'A verificação de segurança expirou. Tente novamente. Código Turnstile: '+value;
    }
    if(/^300/.test(value)||/^600/.test(value)){
      return 'A verificação de segurança falhou. Atualize a página e tente novamente. Código Turnstile: '+value;
    }
    return value
      ? 'A verificação de segurança falhou. Código Turnstile: '+value
      : 'A verificação de segurança falhou';
  }

  function preload(){
    return loadApi();
  }

  async function challenge(action='auth'){
    const key=siteKey();
    const safeAction=/^[A-Za-z0-9_-]{1,32}$/.test(String(action))?String(action):'auth';
    if(!key)throw new Error('Proteção anti-bot do piloto não configurada');
    const api=await loadApi();

    return new Promise((resolve,reject)=>{
      const wrap=document.createElement('div');
      wrap.dataset.chamaTurnstile='1';
      wrap.setAttribute('role','dialog');
      wrap.setAttribute('aria-modal','true');
      wrap.innerHTML='<div class="turnstile-card"><strong>Verificação de segurança</strong><p>Conclua esta etapa para entrar no piloto.</p><div data-turnstile-host></div><button type="button" data-turnstile-cancel>Cancelar</button></div>';
      document.body.appendChild(wrap);

      const host=wrap.querySelector('[data-turnstile-host]');
      const cancel=wrap.querySelector('[data-turnstile-cancel]');
      let widgetId=null;
      let settled=false;
      const timer=setTimeout(()=>finish(false,new Error('A verificação de segurança expirou')),120000);

      function cleanup(){
        clearTimeout(timer);
        if(widgetId!==null){
          try{api.remove(widgetId)}catch{}
        }
        wrap.remove();
      }
      function finish(ok,value){
        if(settled)return;
        settled=true;
        cleanup();
        ok?resolve(value):reject(value);
      }

      cancel?.addEventListener('click',()=>finish(false,new Error('Verificação cancelada')),{once:true});

      try{
        widgetId=api.render(host,{
          sitekey:key,
          theme:'auto',
          size:'flexible',
          action:safeAction,
          callback:(token)=>finish(true,String(token||'')),
          retry:'auto',
          'retry-interval':8000,
          'error-callback':(code)=>{
            finish(false,new Error(turnstileErrorMessage(code)));
            return true;
          },
          'timeout-callback':()=>finish(false,new Error('A interação com a verificação de segurança expirou. Tente novamente.')),
          'unsupported-callback':()=>finish(false,new Error('Este navegador não é compatível com a verificação de segurança. Atualize o navegador ou tente outro navegador.')),
          'expired-callback':()=>{ try{api.reset(widgetId)}catch{} }
        });
      }catch(error){
        finish(false,error instanceof Error?error:new Error('Falha ao iniciar Turnstile'));
      }
    });
  }

  globalThis.chamaTurnstile={siteKey,preload,challenge};
})();
