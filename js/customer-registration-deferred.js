async function tamaoRegisterIdentifiedAccount(email,{fullName='',phone=''}={}){
  if(!liveRuntime?.client?.auth||!customerOriginSafe())
    throw new Error('Cadastro indisponível no endereço atual.');
  const value=String(email||'').trim().toLowerCase();
  const name=String(fullName||'').trim().replace(/\s+/g,' ');
  const digits=String(phone||'').replace(/\D/g,'');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))throw new Error('Informe e-mail válido.');
  if(name.length<5||name.length>100||name.split(' ').length<2||
     !/^[\p{L}][\p{L} .'-]{3,99}$/u.test(name))
     throw new Error('Informe nome e sobrenome.');
  if(!/^[0-9]{10,11}$/.test(digits))
    throw new Error('Informe telefone com DDD.');
  const profile={full_name:name,phone:digits};
  const {data:{session},error:sessionError}=await liveRuntime.client.auth.getSession();
  if(sessionError)throw sessionError;
  if(session?.user){
    if(session.user.email_confirmed_at){
      if(session.user.email?.toLowerCase()!==value)throw Error('Entre na conta deste e-mail.');
      const {data,error}=await liveRuntime.client.auth.updateUser({data:profile});
      if(error)throw error;
      // An existing verified customer who completes the missing contact
      // fields must see the unlocked checkout immediately, without logging
      // out or retaining an outdated in-memory account snapshot.
      if(data?.user?.id===session.user.id){
        liveRuntime.session={...session,user:data.user};
      }
      state.user.cashEarningEligible=true;
      state.user.identityType='permanent';
      save();
      if(typeof render==='function')render();
      return {alreadyPermanent:true,profileUpdated:true};
    }
    const {data,error}=await liveRuntime.client.auth.updateUser({email:value,data:profile});
    if(error)throw error;
    liveRuntime.identityUpgradePending=value;
    return {pending:true,email:value,user:data?.user||null};
  }
  if(!globalThis.chamaTurnstile?.challenge)throw Error('Proteção anti-bot indisponível.');
  const captchaToken=await globalThis.chamaTurnstile.challenge('customer_login');
  if(!captchaToken)throw Error('Verificação de segurança indisponível.');
  const redirect=new URL('/',location.origin);
  redirect.searchParams.set('entrada','clube');
  const {error}=await liveRuntime.client.auth.signInWithOtp({
    email:value,options:{emailRedirectTo:redirect.toString(),shouldCreateUser:true,
      captchaToken,data:profile}
  });
  if(error)throw error;
  return {pending:true,email:value};
}

globalThis.tamaoRegisterIdentifiedAccount=tamaoRegisterIdentifiedAccount;

async function tamaoRegisterForm(event){
  event.preventDefault();
  const form=event.currentTarget;
  const clubEntry=form?.dataset?.tamaoAccountContext==='club';
  const checkoutEntry=Boolean(form?.closest?.('#tamao-checkout-identity'));
  const field=form?.querySelector('input[type=email]');
  const status=form?.querySelector('[data-welcome-signup-status]');
  const button=form?.querySelector('button[type=submit]');
  const buttons=clubEntry?Array.from(form.querySelectorAll('button[type=submit]')):[button].filter(Boolean);
  const email=String(field?.value||'').trim().toLowerCase();
  const login=clubEntry&&event.submitter?.value!=='register';
  const fullName=String(form?.querySelector('input[name="full_name"]')?.value||'').trim().replace(/\s+/g,' ');
  const phone=String(form?.querySelector('input[name="phone"]')?.value||'').replace(/\D/g,'');
  if(!login&&(fullName.length<5||fullName.split(' ').length<2||fullName.length>100)){
    if(status)status.textContent='Informe nome e sobrenome.';
    form?.querySelector('input[name="full_name"]')?.focus();return false;
  }
  if(!login&&!/^[0-9]{10,11}$/.test(phone)){
    if(status)status.textContent='Informe telefone com DDD.';
    form?.querySelector('input[name="phone"]')?.focus();return false;
  }
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    if(status)status.textContent='Informe um e-mail válido.';
    return false;
  }
  if(buttons.some(item=>item.disabled))return false;
  buttons.forEach(item=>item.disabled=true);
  if(status)status.textContent='Preparando confirmação…';
  try{
    if(!login&&typeof liveUpgradeAccount!=='function')throw Error('ACCOUNT_SERVICE_UNAVAILABLE');
    const result=login?await tamaoClubSendAccess(email):await liveUpgradeAccount(email,{fullName,phone});
    if(status)status.textContent=result?.alreadyPermanent
      ?'Sua conta já está cadastrada. Consulte seu saldo e benefícios no Clube.'
      :result?.accessRequested?'Solicitamos seu link de acesso. Confira o e-mail e abra a mensagem neste navegador.':
       clubEntry?'Enviamos a confirmação para seu e-mail. Abra a mensagem para confirmar sua conta.':
       checkoutEntry?'Enviamos a confirmação para seu e-mail. Confira sua caixa de entrada para finalizar o cadastro e voltar ao seu pedido.':
       'Enviamos a confirmação para seu e-mail. Conclua a confirmação para participar, sujeito às vagas e às regras da campanha.';
    if(field&&result?.alreadyPermanent!==true)field.value='';
  }catch{
    if(status)status.textContent=clubEntry
      ?'Não foi possível enviar o acesso. Confira o e-mail e a conexão. Se for seu primeiro acesso, escolha “Criar minha conta”.'
      :'Não foi possível enviar a confirmação. Confira a conexão e tente novamente.';
  }finally{
    buttons.forEach(item=>item.disabled=false);
  }
  return false;
}
globalThis.tamaoRegisterForm=tamaoRegisterForm;
