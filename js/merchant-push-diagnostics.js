/* TAMÃO merchant-only push diagnostics, loaded after a user requests device details. */
async function merchantPushDiagnoseImpl(){
  if(!merchantReady()||!merchantRuntime.merchant?.merchantId)
    throw new Error('Entre na revenda antes de verificar o aparelho.');
  const merchantId=String(merchantRuntime.merchant.merchantId);
  const supported=merchantPushStatus().supported;
  const permission=typeof Notification==='undefined'?'unsupported':Notification.permission;
  let workerReady=false,localSubscription=false,keyMatches=false;
  if(supported){
    const reg=await navigator.serviceWorker.getRegistration('./');
    workerReady=!!reg?.active;
    if(reg?.pushManager){
      const sub=await reg.pushManager.getSubscription();
      localSubscription=!!sub;
      if(sub&&merchantPushRuntime.publicKey){
        const current=sub.options?.applicationServerKey;
        const wanted=merchantPushKeyBytes(merchantPushRuntime.publicKey);
        const stored=current?new Uint8Array(current):new Uint8Array();
        keyMatches=stored.length===wanted.length&&stored.every((value,i)=>value===wanted[i]);
      }
    }
  }
  if(!merchantReady()||String(merchantRuntime.merchant?.merchantId||'')!==merchantId)return false;
  merchantPushRuntime.diagnostic={
    merchantId,supported,secure:typeof isSecureContext!=='undefined'&&isSecureContext===true,
    permission,workerReady,localSubscription,keyMatches,
    checkedAt:new Date().toISOString()
  };
  render();
  return true;
}

async function merchantPushDiagnoseServerImpl(){
  if(merchantPushRuntime.healthPending)return false;
  if(!merchantReady()||!merchantRuntime.merchant?.merchantId)
    throw new Error('Entre na revenda antes de verificar o aparelho.');
  const merchantId=String(merchantRuntime.merchant.merchantId);
  const userId=String(merchantRuntime.session?.user?.id||'');
  merchantPushRuntime.healthPending=true;
  merchantPushRuntime.deviceHealth=null;
  merchantPushRuntime.healthError=null;
  render();
  const current=()=>merchantReady()&&
    String(merchantRuntime.merchant?.merchantId||'')===merchantId&&
    String(merchantRuntime.session?.user?.id||'')===userId;
  try{
    await merchantPushDiagnoseLive();
    if(!current())return false;
    const device=merchantPushRuntime.diagnostic;
    if(device?.permission!=='granted'||!device.workerReady||
      !device.localSubscription||!device.keyMatches)return true;
    const reg=await navigator.serviceWorker.getRegistration('./');
    const subscription=await reg?.pushManager?.getSubscription();
    if(!subscription?.endpoint)return true;
    try{
      const result=await merchantInvoke('merchant-push-self-test',{
        action:'diagnose-tests',merchantId,endpoint:subscription.endpoint
      });
      if(!current())return false;
      if(result?.diagnosis?.registered===true){
        const raw=result.diagnosis;
        const count=k=>Number.isInteger(raw[k])&&raw[k]>=0?Math.min(raw[k],100000):0;
        const states=['provider_accepted','gateway_rejected','reserved','expired','failed'];
        const codes=['SUBSCRIPTION_GONE','GATEWAY_UNAVAILABLE','GATEWAY_REJECTED',
          'NETWORK_ERROR','PUSH_TEST_FAILED','SENDER_UNAVAILABLE'];
        merchantPushRuntime.deviceHealth={
          merchantId,userId,registered:true,tests:count('tests'),
          providerAccepted:count('providerAccepted'),
          providerFailed:count('providerFailed'),reportedSeen:count('reportedSeen'),
          reportedNotSeen:count('reportedNotSeen'),reportedWarning:count('reportedWarning'),
          latestState:states.includes(raw.latestState)?raw.latestState:null,
          latestFailureCode:codes.includes(raw.latestFailureCode)?raw.latestFailureCode:null,
          latestReport:['seen','not_seen','spam_warning'].includes(raw.latestReport)?raw.latestReport:null,
          checkedAt:new Date().toISOString()
        };
      }
    }catch(error){
      if(!current())return false;
      merchantPushRuntime.healthError={merchantId,userId,
        code:String(error?.data?.code||error?.code||'RESULT_UNAVAILABLE').slice(0,60)};
    }
    render();
    return true;
  }finally{merchantPushRuntime.healthPending=false;render();}
}

async function merchantPushCorrectChromeWarningImpl(){
  if(merchantPushRuntime.testPending||merchantPushRuntime.reportPending)
    throw new Error('Aguarde a operação de teste em andamento.');
  const merchantId=String(merchantRuntime.merchant?.merchantId||'');
  const userId=String(merchantRuntime.session?.user?.id||'');
  const last=merchantPushStatus().testResult;
  if(!merchantReady()||!merchantPushRuntime.subscribed||!last?.runId||
    last.providerAccepted!==true||!['seen','not_seen'].includes(last.deviceReport))
    throw new Error('Consulte o último teste registrado antes de corrigir o relato.');
  merchantPushRuntime.reportPending=true;render();
  try{
    const reg=await navigator.serviceWorker.getRegistration('./');
    const subscription=await reg?.pushManager?.getSubscription();
    if(!subscription?.endpoint)throw new Error('Inscrição não encontrada neste navegador.');
    const result=await merchantInvoke('merchant-push-self-test',{
      action:'correct-spam-warning',merchantId,endpoint:subscription.endpoint,
      runId:last.runId
    });
    if(!merchantReady()||String(merchantRuntime.merchant?.merchantId||'')!==merchantId||
       String(merchantRuntime.session?.user?.id||'')!==userId)return false;
    if(result?.correctionRecorded!==true||result?.receiptKind!=='manual_user_report'||
       result?.deviceReport!=='spam_warning')
      throw new Error('Não foi possível registrar a correção do relato.');
    if(merchantPushRuntime.testResult?.runId===last.runId){
      merchantPushRuntime.testResult.previousReport=last.deviceReport;
      merchantPushRuntime.testResult.deviceReport='spam_warning';
    }
    merchantPushRuntime.deviceHealth=null;render();return true;
  }finally{merchantPushRuntime.reportPending=false;render();}
}

globalThis.merchantPushDiagnoseImpl=merchantPushDiagnoseImpl;
globalThis.merchantPushDiagnoseServerImpl=merchantPushDiagnoseServerImpl;
globalThis.merchantPushCorrectChromeWarningImpl=merchantPushCorrectChromeWarningImpl;
