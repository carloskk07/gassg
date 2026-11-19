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
      const {error}=await liveRuntime.client.auth.updateUser({data:profile});
      if(error)throw error;
      state.user.cashEarningEligible=true;
      state.user.identityType='permanent';
      save();
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
