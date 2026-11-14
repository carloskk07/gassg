// Deferred buyer-only auth observer; merchant startup never loads this module.
let clubeCouponAuthClient=null;
function clubeCouponWatchAuth(){
 const rt=globalThis.liveRuntime,c=rt?.client;
 if(!c||clubeCouponAuthClient===c)return;
 clubeCouponAuthClient=c;
 c.auth.onAuthStateChange((_event,next)=>{
   const prev=rt.session;
   if(rt.status!=='ready'||!prev?.user?.id||
      prev.user.id!==next?.user?.id)return;
   rt.session=next;
   const eligible=u=>u.is_anonymous!==true&&!!u.email_confirmed_at;
   if(eligible(prev.user)!==eligible(next.user)&&route()==='club')
     Promise.resolve().then(()=>{if(rt.session===next)render()});
 });
}
clubeCouponWatchAuth();

// V1.949: read existing vouchers on the first verified visit to Clube or
// checkout. Never create a charge, grant a benefit or alter a balance.
const clubePaidCouponAutoRead={queuedFor:null};
function clubePaidCouponAutoLoad(userId){
 const user=globalThis.liveRuntime?.session?.user;
 if(!userId||user?.id!==userId||user.is_anonymous===true||
    !user.email_confirmed_at||typeof liveReady!=='function'||!liveReady())return;
 if(clubePaidCouponView.userId===userId&&clubePaidCouponView.status!=='idle')return;
 if(clubePaidCouponAutoRead.queuedFor===userId)return;
 clubePaidCouponAutoRead.queuedFor=userId;
 Promise.resolve().then(()=>{
   if(String(globalThis.liveRuntime?.session?.user?.id||'')!==userId||
      !liveReady()||!['club','order'].includes(route())){
     if(clubePaidCouponAutoRead.queuedFor===userId)
       clubePaidCouponAutoRead.queuedFor=null;
     return;
   }
   clubePaidCouponsRefresh();
 });
}

// The signed-in buyer sees only packages explicitly released by the server.
// A failed commercial preflight never manufactures a public offer.
const clubeCouponShopState={
  userId:null,status:'idle',packages:[],seller:null,error:null,busy:false,
  attempts:{},purchase:null,autoQueuedFor:null,regionPostal:''
};
const clubeCouponRefundState={userId:null,inFlight:new Set(),attempts:{}};
// V1.950: verify only an EXISTING buyer-owned pending Pix, never create one.
let clubeCouponPixAutoWatch=null;
function clubeCouponPixAutoStop(expected=null){
 const w=clubeCouponPixAutoWatch;
 if(expected&&w!==expected)return;
 if(w?.timer!=null&&typeof clearTimeout==='function')clearTimeout(w.timer);
 clubeCouponPixAutoWatch=null;
}
function clubeCouponPixAutoStart(invoiceId){
 const uid=String(globalThis.liveRuntime?.session?.user?.id||'');
 const id=String(invoiceId||'');
 if(!uid||!globalThis.liveReady?.()||route()!=='club'||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)||
    typeof setTimeout!=='function')return;
 const local=clubeCouponShopState.userId===uid&&
    clubeCouponShopState.purchase?.invoiceId===id&&
    clubeCouponShopState.purchase?.status==='awaiting_payment';
 const prior=typeof clubePaidCouponView!=='undefined'&&clubePaidCouponView.userId===uid&&
    clubePaidCouponView.purchases.some(p=>p.invoiceId===id&&p.status==='awaiting_payment');
 if(!local&&!prior)return;
 if(clubeCouponPixAutoWatch?.invoiceId===id&&clubeCouponPixAutoWatch.userId===uid)return;
 clubeCouponPixAutoStop();
 const w={invoiceId:id,userId:uid,timer:null,attempts:0,run:null};
 clubeCouponPixAutoWatch=w;
 const active=()=>clubeCouponPixAutoWatch===w&&route()==='club'&&
   String(globalThis.liveRuntime?.session?.user?.id||'')===uid&&
   globalThis.liveReady?.()===true;
 const poll=async()=>{
   w.timer=null;
   if(!active()){clubeCouponPixAutoStop(w);return}
   if((typeof document!=='undefined'&&document.hidden===true)||clubeCouponShopState.busy){
     w.timer=setTimeout(poll,70000);return;
   }
   if(w.attempts>=6){clubeCouponPixAutoStop(w);return}
   w.attempts++;
   try{
     const result=await liveInvoke('coupon-credit-pix',{action:'invoice-status',invoiceId:id});
     if(!active()){clubeCouponPixAutoStop(w);return}
     if(result?.ok!==true||result.invoiceId!==id)throw Error('COUPON_STATUS_UNVERIFIED');
     if(['paid','review_required','refunded','cancelled','expired'].includes(result.status)){
       if(clubeCouponShopState.userId===uid){
         const postal=clubeCouponShopState.purchase?.invoiceId===id
           ?clubeCouponShopState.purchase.servicePostalCode:null;
         clubeCouponShopState.purchase={...result,...(postal?{servicePostalCode:postal}:{})};
       }
       clubeCouponPixAutoStop(w);
       await clubePaidCouponsRefresh();
       return;
     }
   }catch{
     // A temporary network/PSP lookup failure must not permanently silence
     // the original Pix. Retry only this invoice, at most six times, without
     // creating a new payment or exposing stale QR data.
     if(!active()||w.attempts>=6){clubeCouponPixAutoStop(w);return}
     w.timer=setTimeout(poll,70000);
     return;
   }
   if(active())w.timer=setTimeout(poll,70000);
 };
 w.run=poll;
 w.timer=setTimeout(poll,60000);
}
// A QR, external payment link, and copyable BR Code can outlive merchant
// eligibility in an open tab. Keep them on-screen only briefly; a new
// authenticated invoice-status check is required to reveal them again.
const clubeCouponPixLease={timer:null,expiresAt:0};
const CLUBE_COUPON_PIX_VISIBLE_MS=45000;
function clubeCouponClearPixTimer(){
 if(clubeCouponPixLease.timer!==null&&typeof clearTimeout==='function')
   clearTimeout(clubeCouponPixLease.timer);
 clubeCouponPixLease.timer=null;
}
function clubeCouponHideDisplayedPix(expected=null){
 const state=clubeCouponShopState;
 const old=state.purchase;
 if(!old||(expected&&old!==expected))return;
 clubeCouponClearPixTimer();
 clubeCouponPixLease.expiresAt=0;
 if(old.pixPayable!==true&&!old.pixCode&&!old.paymentUrl&&!old.qrImageDataUri)return;
 // A display lease is NOT a provider cancellation. Preserve the invoice ID
 // so the buyer can explicitly refresh the same charge without minting one.
 state.purchase={...old,pixPayable:false,pixCode:null,paymentUrl:null,
   qrImageDataUri:null};
 if(route()==='club')render();
}
function clubeCouponArmPixLease(){
 const old=clubeCouponShopState.purchase;
 clubeCouponClearPixTimer();
 clubeCouponPixLease.expiresAt=0;
 if(!old||old.pixPayable!==true)return;
 if(typeof document!=='undefined'&&document.hidden===true){
   clubeCouponHideDisplayedPix(old);return;
 }
 const deadline=Date.parse(String(old.expiresAt||''));
 if(!Number.isFinite(deadline)||deadline<=Date.now())return;
 clubeCouponPixLease.expiresAt=deadline;
 if(typeof setTimeout==='function')
   clubeCouponPixLease.timer=setTimeout(()=>{
     clubeCouponHideDisplayedPix(old);
   },Math.max(0,deadline-Date.now()));
}
if(typeof document!=='undefined'&&typeof document.addEventListener==='function')
 document.addEventListener('visibilitychange',()=>{
   if(document.hidden===true)clubeCouponHideDisplayedPix();
   else if(clubeCouponPixAutoWatch?.run&&route()==='club'){
     const w=clubeCouponPixAutoWatch;
     if(w.timer!=null)clearTimeout(w.timer);
     w.timer=setTimeout(w.run,1200);
   }
 });
function clubeCouponShopPanel(){
  const uid=String(globalThis.liveRuntime?.session?.user?.id||'');
  if(!uid||!globalThis.liveReady?.())return '';
  const s=clubeCouponShopState.userId===uid?clubeCouponShopState:null;
  const pendingLocal=s?.purchase?.status==='awaiting_payment'?s.purchase:null;
  const pendingHistory=typeof clubePaidCouponView!=='undefined'&&clubePaidCouponView.userId===uid&&
    clubePaidCouponView.status==='ready'
    ?clubePaidCouponView.purchases.find(p=>p.status==='awaiting_payment'):null;
  const pendingId=pendingLocal?.invoiceId||pendingHistory?.invoiceId;
  if(pendingId)clubeCouponPixAutoStart(pendingId);
  // Fetch once on opening the Clube, with no extra user click. Never request
  // an invoice/Pix here; the buyer must explicitly choose and accept terms.
  if((!s||s.status==='idle')&&!clubeCouponShopState.busy&&
     clubeCouponShopState.autoQueuedFor!==uid){
    clubeCouponShopState.autoQueuedFor=uid;
    Promise.resolve().then(()=>clubeCouponShopRefresh());
  }
  const money=n=>BRL.format((Number(n)||0)/100);
  const offers=(s?.status==='ready'?s.packages:[]).map(p=>{
    const key=String(p.packageKey||'');
    if(!/^[a-z][a-z0-9_]{2,39}$/.test(key))return '';
    const partner=p.fundingModel==='partner_funded';
    const specificTerms=partner&&p.termsVersion==='clube_partner_coupon_terms_v1_846'
      &&typeof p.termsText==='string'&&p.termsText.length>600;
    const termsNotice=partner
      ?'<span>Li e aceito as condições específicas desta modalidade: cupons apenas nas revendas participantes, pagamento direto à revenda, validade e possibilidade de solicitar cancelamento e reembolso.</span>'
      :'<span>Li e aceito as condições, inclusive que pode não haver revendas na minha região, que a validade começa na emissão e que posso solicitar reembolso de um pacote não utilizado.</span>';
    const specificDocument=partner
      ?'<details><summary>Condições completas da compra</summary><p>'+esc(String(p.termsText||''))+'</p></details>'
      :'<button type="button" class="text-link" onclick="go(\'terms\')">Ler condições completas</button>';
    const partnerSeller=partner&&p.seller?
      '<p class="tiny muted">Vendedor do pacote: '+esc(String(p.seller.name||''))+
      ' · Documento: '+esc(String(p.seller.taxDocument||''))+
      ' · Contato: '+esc(String(p.seller.supportEmail||''))+
      ' · Endereço: '+esc(String(p.seller.address||''))+'</p>':'';
    if(partner&&!specificTerms)return '';
    return '<article class="card flat form-stack"><h3>'+esc(p.title)+'</h3>'+
     '<p><strong>'+esc(money(p.priceCents))+'</strong> por '+
     Number(p.couponCount)+' cupons de '+esc(money(p.faceCents))+'</p>'+
     '<p class="tiny muted">Válidos por '+Number(p.validDays)+' dias após a emissão. '+
     (partner?'Somente em revendas participantes que atendam seu CEP. ':'Valem para qualquer produto do catálogo. ')+
     (Number(p.minOrderCents)>0?'Pedido mínimo: '+esc(money(p.minOrderCents))+'.':'')+'</p>'+
     '<label class="check-row"><input type="checkbox" id="clube-coupon-terms-'+key+'">'+
     termsNotice+'</label>'+
     specificDocument+partnerSeller+ 
     '<button type="button" class="primary small" onclick="clubeCouponBuy(\''+
     key+'\')" '+(s.busy?'disabled':'')+'>Comprar com Pix</button></article>';
  }).join('');
  const currentPostal=String(s?.regionPostal||'');
  const postalVerifier='<div class="card flat form-stack">'+
    '<label>Consultar cupons de revendas participantes pelo CEP'+
    '<input id="clube-partner-coupon-cep" class="input" inputmode="numeric" maxlength="9"'+
    ' placeholder="00000-000" autocomplete="postal-code" value="'+esc(currentPostal)+'"></label>'+
    '<button type="button" class="secondary small" onclick="clubeCouponVerifyPostal()" '+
    (s?.busy?'disabled':'')+'>Verificar CEP para cupons de revendas</button>'+
    (currentPostal?'<p class="tiny muted">Consulta: CEP '+esc(currentPostal)+
     '. A oferta depende de revenda participante, estoque e disponibilidade atual.</p>':'')+
    '</div>';
  const seller=s?.seller;
  const sellerInfo=seller?'<aside class="card flat form-stack" aria-label="Fornecedor dos cupons">'+
    '<strong>Quem vende os cupons</strong>'+
    '<p>'+esc(String(seller.name||''))+' · Documento: '+esc(String(seller.taxDocument||''))+'</p>'+
    '<p>Endereço: '+esc(String(seller.address||''))+'</p>'+
    '<p>Atendimento e cancelamentos: '+esc(String(seller.supportEmail||''))+'</p></aside>':'';
  const purchase=s?.purchase;
  const pixDisplayFresh=Boolean(purchase&&purchase.pixPayable===true&&
    clubeCouponPixLease.expiresAt>Date.now());
  const purchasePostal=String(purchase?.servicePostalCode||'');
  // A partner-funded Pix is only rendered with its original, authenticated
  // invoice CEP. Searching a different area cannot relabel an old charge.
  const partnerPixProven=purchase?.fundingModel!=='partner_funded'||
    /^[0-9]{8}$/.test(purchasePostal);
  const pix=String(purchase?.pixCode||'');
  const validCode=pix.length>=30&&pix.length<=3000;
  let paymentLink='';
  try{
    const u=new URL(String(purchase?.paymentUrl||''));
    if(u.protocol==='https:'&&
       ['mercadopago.com.br','www.mercadopago.com.br'].includes(u.hostname))
      paymentLink='<a href="'+esc(u.href)+'" target="_blank" rel="noopener noreferrer">Abrir pagamento seguro no Mercado Pago</a>';
  }catch{}
  const qr=String(purchase?.qrImageDataUri||'');
  const qrImage=validCode&&typeof globalThis.tamaoPixMarkup==='function'
    ?globalThis.tamaoPixMarkup(pix,{amountCents:Number(purchase.amountCents),label:'QR Code Pix do pacote',imageDataUri:qr})
    :/^data:image\/png;base64,[A-Za-z0-9+/=]{16,300000}$/.test(qr)
     ?'<img alt="QR Code Pix do pedido de cupom" src="'+esc(qr)+'" style="max-width:240px;width:100%;height:auto">':'';
  const payment=purchase?'<article class="card flat form-stack">'+
    '<strong>Pagamento do seu pacote</strong>'+
    (purchase.fundingModel==='partner_funded'?'<p class="tiny">CEP vinculado a este Pix: '+
      esc(purchasePostal||'não confirmado')+'</p>':'')+
    '<p>Valor: '+esc(money(purchase.amountCents))+' • Situação: '+
     esc(purchase.status==='paid'&&purchase.fundingPending===true?
       'Pagamento identificado; cupons aguardam conciliação financeira':
       purchase.status||'Em conferência')+'</p>'+
    (pixDisplayFresh&&partnerPixProven?(qrImage+
      (validCode?'<label>Código Pix copia e cola<textarea readonly rows="3" class="input">'+
        esc(pix)+'</textarea></label><button type="button" class="secondary small" onclick="clubeCouponCopyPix()" '+(s?.busy?'disabled':'')+'>Copiar código Pix</button>':'')+
      paymentLink):'')+
    '<button type="button" class="secondary small" onclick="clubeCouponCheckInvoice(\''+
       esc(String(purchase.invoiceId||''))+'\')" '+(s?.busy?'disabled':'')+
       '>Conferir pagamento e cupons</button></article>':'';
  const empty=s?.status==='ready'&&s.packages.length===0
    ?'<p class="muted">Não há pacotes liberados para compra neste momento. Você ainda pode consultar cupons já emitidos na sua conta.</p>':'';
  const error=s?.status==='failed'?'<p class="notice danger">Não foi possível consultar os pacotes. Tente novamente.</p>':'';
  const loading=(!s||s.status==='idle'||s.status==='loading'||s.busy)&&!purchase
    ?'<p class="tiny muted" role="status">Conferindo pacotes disponíveis…</p>':'';
  return '<section class="section" aria-label="Comprar cupons TAMÃO">'+
   '<div class="section-head"><div><h2>Pacotes de cupons</h2>'+
   '<p>Escolha um pacote disponível e pague com Pix. Os cupons são vinculados à sua conta.</p>'+
   '<p class="tiny muted">A compra de cupons não reserva produtos ou entrega. O desconto só pode ser usado quando houver revenda atendendo seu CEP. Sem atendimento disponível, você poderá solicitar cancelamento e reembolso no histórico do Clube.</p></div>'+
   '<button type="button" class="secondary small" onclick="clubeCouponShopRefresh()" '+
   (s?.busy?'disabled':'')+'>Consultar pacotes</button></div>'+
   (offers?'<div class="grid cards-2">'+offers+'</div>':'')+
   postalVerifier+loading+error+sellerInfo+empty+payment+'</section>';
}
async function clubeCouponVerifyPostal(){
 const uid=String(globalThis.liveRuntime?.session?.user?.id||'');
 if(!uid||!globalThis.liveReady?.()||clubeCouponShopState.busy)return;
 const raw=String(document.getElementById('clube-partner-coupon-cep')?.value||'');
 const postal=raw.replace(/\D/g,'');
 if(!/^[0-9]{8}$/.test(postal))
   return toast('Informe um CEP com 8 números.');
 if(clubeCouponShopState.userId!==uid)return;
 if(clubeCouponShopState.regionPostal!==postal&&
    clubeCouponShopState.purchase?.fundingModel==='partner_funded')
   clubeCouponShopState.purchase=null;
 clubeCouponShopState.regionPostal=postal;
 await clubeCouponShopRefresh();
}
async function clubeCouponShopRefresh(){
  const uid=String(globalThis.liveRuntime?.session?.user?.id||'');
  if(!uid||!globalThis.liveReady?.())return;
  if(clubeCouponShopState.busy)return;
  if(clubeCouponShopState.userId!==uid)Object.assign(clubeCouponShopState,{
    userId:uid,status:'idle',packages:[],seller:null,attempts:{},purchase:null,regionPostal:''
  });
  clubeCouponShopState.busy=true;
  try{
    const result=await liveInvoke('coupon-credit-pix',{action:'catalog'});
    if(result?.source!=='clube_paid_catalog_v1_807'||result.ok!==true||
       !Array.isArray(result.packages))throw Error('COUPON_CATALOG_NOT_VERIFIED');
    if(String(globalThis.liveRuntime?.session?.user?.id||'')!==uid)return;
    const valid=result.packages.filter(p=>
      /^[a-z][a-z0-9_]{2,39}$/.test(String(p.packageKey||''))&&
      Number.isSafeInteger(p.priceCents)&&p.priceCents>=100&&
      Number.isSafeInteger(p.faceCents)&&p.faceCents>=100&&
      Number.isSafeInteger(p.couponCount)&&p.couponCount>=1&&p.couponCount<=15&&
      Number.isSafeInteger(p.validDays)&&p.validDays>=1&&p.validDays<=365&&
      p.termsVersion==='clube_coupon_terms_v1_813'
    );
    // Independent future buyer contract. An unavailable/older Edge must not
    // block historical owner-sponsored packages or invent a new sale.
    let participating=[];
    try{
      const region=String(clubeCouponShopState.regionPostal||'');
      const partner=/^[0-9]{8}$/.test(region)
        ?await liveInvoke('coupon-credit-pix',{action:'partner-catalog',postalCode:region})
        :{ok:true,source:'clube_partner_coupon_catalog_v1_849',packages:[]};
      if(partner?.ok===true&&partner?.source==='clube_partner_coupon_catalog_v1_849'
         &&Array.isArray(partner.packages)){
        participating=partner.packages.filter(p=>
          p.fundingModel==='partner_funded'&&
          p.termsVersion==='clube_partner_coupon_terms_v1_846'&&
          String(p.packageKey)==='partner_general_3x5_849'&&
          Number.isSafeInteger(p.priceCents)&&p.priceCents===890&&
          p.faceCents===500&&p.couponCount===3&&p.validDays===180&&
          p.minOrderCents===1000&&p.eligibleProducts==='participating_merchants_only'&&
          p.eligiblePostalCode===region&&
          typeof p.termsText==='string'&&p.termsText.length>600&&
          typeof p.seller?.name==='string'&&typeof p.seller?.taxDocument==='string'&&
          typeof p.seller?.address==='string'&&typeof p.seller?.supportEmail==='string'
        );
      }
    }catch{participating=[]}
    if(String(globalThis.liveRuntime?.session?.user?.id||'')!==uid)return;
    clubeCouponShopState.packages=[...valid,...participating];
    clubeCouponShopState.seller=valid.length&&
      result.seller&&typeof result.seller.name==='string'&&
      typeof result.seller.taxDocument==='string'&&
      typeof result.seller.address==='string'&&
      typeof result.seller.supportEmail==='string'
      ?result.seller:null;
    if(valid.length&&!clubeCouponShopState.seller)
      throw Error('COUPON_SELLER_NOT_DISCLOSED');
    clubeCouponShopState.status='ready';
  }catch(err){
    if(String(globalThis.liveRuntime?.session?.user?.id||'')!==uid)return;
    clubeCouponShopState.status='failed';
    clubeCouponShopState.error=String(err?.message||err);
  }finally{
    clubeCouponShopState.busy=false;
    if(route()==='club')render();
  }
}
async function clubeCouponBuy(packageKey){
  const uid=String(globalThis.liveRuntime?.session?.user?.id||'');
  if(!uid||!globalThis.liveReady?.()||clubeCouponShopState.busy||
     clubeCouponShopState.userId!==uid)return;
  const p=clubeCouponShopState.status==='ready'?
    clubeCouponShopState.packages.find(x=>x.packageKey===packageKey):null;
  if(!p)return toast('Atualize os pacotes antes de comprar.');
  if(!document.getElementById('clube-coupon-terms-'+packageKey)?.checked)
    return toast('Leia e aceite as condições do pacote antes de comprar.');
  const partnerPurchase=p.fundingModel==='partner_funded';
  if(partnerPurchase&&(!/^[0-9]{8}$/.test(String(clubeCouponShopState.regionPostal||''))||
    p.eligiblePostalCode!==clubeCouponShopState.regionPostal))
    return toast('Verifique seu CEP novamente antes de comprar este pacote.');
  if(p.termsVersion!==(partnerPurchase?'clube_partner_coupon_terms_v1_846':'clube_coupon_terms_v1_813'))
    return toast('Não foi possível confirmar a versão das condições. Atualize a página.');
  clubeCouponShopState.busy=true;
  if(route()==='club')render();
  try{
    // Old pending invoice must be resumed, never replaced with a second Pix.
    if(clubePaidCouponView.userId!==uid||clubePaidCouponView.status!=='ready'){
      await clubePaidCouponsRefresh();
      if(clubePaidCouponView.userId!==uid||clubePaidCouponView.status!=='ready')
        throw Error('COUPON_HISTORY_NOT_READY');
    }
    const previous=clubePaidCouponView.purchases.find(x=>
      x.packageKey===packageKey&&
      ['prepared','awaiting_payment'].includes(String(x.status)));
    // A pending partner Pix is tied to its original, immutable CEP. Never
    // present that Pix as payment for a new CEP, or replay its request UUID
    // against a different region; the buyer must resolve the prior invoice.
    if(partnerPurchase&&previous&&
       (!/^[0-9]{8}$/.test(String(previous.servicePostalCode||''))||
        previous.servicePostalCode!==p.eligiblePostalCode)){
      toast('Há um Pix pendente deste pacote para outro CEP. Consulte ou cancele a compra anterior no histórico antes de prosseguir.');
      return;
    }
    if(previous?.invoiceId&&previous.status!=='prepared'){
      await clubeCouponCheckInvoice(previous.invoiceId,true);
      return;
    }
    // An interrupted prepared invoice is retried with its OWN immutable UUID,
    // never a second invoice, even after a page reload.
    if(previous?.status==='prepared'&&
       !/^[0-9a-f-]{36}$/i.test(String(previous.requestId||'')))
      throw Error('COUPON_PREPARED_REPLAY_KEY_MISSING');
    if(!clubeCouponShopState.attempts[packageKey])
      clubeCouponShopState.attempts[packageKey]=previous?.requestId||crypto.randomUUID();
    const requestId=clubeCouponShopState.attempts[packageKey];
    const result=await liveInvoke('coupon-credit-pix',{
      action:partnerPurchase?'partner-purchase':'purchase',packageKey,requestId,
      termsAccepted:true,termsVersion:p.termsVersion,
      ...(partnerPurchase?{postalCode:clubeCouponShopState.regionPostal}:{})
    });
    if(result?.ok!==true||(partnerPurchase&&result.fundingModel!=='partner_funded')||
       !/^[0-9a-f-]{36}$/i.test(String(result.invoiceId||'')))
      throw Error('COUPON_PIX_NOT_CONFIRMED');
    if(String(globalThis.liveRuntime?.session?.user?.id||'')!==uid)return;
    clubeCouponShopState.purchase=partnerPurchase?
      {...result,servicePostalCode:p.eligiblePostalCode}:result;
    clubeCouponArmPixLease();
    // Retain same request UUID during ambiguous retries / pending payments.
    await clubePaidCouponsRefresh();
  }catch(err){
    if(String(globalThis.liveRuntime?.session?.user?.id||'')===uid){
      if(err?.code==='PARTNER_COUPON_PENDING_SUPPLY_UNAVAILABLE'){
        clubeCouponShopState.purchase=null;
        toast('O Pix anterior não pode ser reutilizado: a oferta da revenda mudou. Não pague o código antigo; consulte o histórico para cancelar ou solicitar reembolso.');
      }else toast('Não foi possível confirmar o Pix. Consulte o pedido antes de tentar novamente.');
    }
  }finally{
    clubeCouponShopState.busy=false;
    if(route()==='club')render();
  }
}
async function clubeCouponCheckInvoice(invoiceId,nested=false){
  const uid=String(globalThis.liveRuntime?.session?.user?.id||'');
  if(!uid||!globalThis.liveReady?.()||(!nested&&clubeCouponShopState.busy)||
     !/^[0-9a-f-]{36}$/i.test(String(invoiceId||'')))return;
  if(!nested)clubeCouponShopState.busy=true;
  try{
    const result=await liveInvoke('coupon-credit-pix',{action:'invoice-status',invoiceId});
    if(String(globalThis.liveRuntime?.session?.user?.id||'')!==uid)return;
    if(result?.ok!==true||result.invoiceId!==invoiceId)
      throw Error('COUPON_INVOICE_NOT_CONFIRMED');
    // A paid invoice without separately verified net funds is NOT an available coupon.
    const history=clubePaidCouponView.userId===uid&&
      clubePaidCouponView.status==='ready'?
      clubePaidCouponView.purchases.find(x=>x.invoiceId===invoiceId):null;
    if(result.fundingModel==='partner_funded'){
      const originalPostal=String(history?.servicePostalCode||'');
      clubeCouponShopState.purchase={...result,servicePostalCode:originalPostal,
        ...(/^[0-9]{8}$/.test(originalPostal)?{}:
          {pixPayable:false,pixCode:null,paymentUrl:null,qrImageDataUri:null})};
    }else clubeCouponShopState.purchase=result;
    clubeCouponArmPixLease();
    await clubePaidCouponsRefresh();
  }catch(err){
    if(String(globalThis.liveRuntime?.session?.user?.id||'')===uid){
      if(err?.code==='PARTNER_COUPON_PENDING_SUPPLY_UNAVAILABLE'){
        if(clubeCouponShopState.purchase?.invoiceId===invoiceId)
          clubeCouponShopState.purchase=null;
        toast('Este Pix deixou de estar disponível porque não há oferta válida da revenda no CEP original. Não pague o código anterior; solicite cancelamento ou reembolso no histórico.');
      }else toast('Pagamento não confirmado. Consulte novamente o status ou solicite atendimento pelo histórico.');
    }
  }finally{
    if(!nested)clubeCouponShopState.busy=false;
    if(route()==='club')render();
  }
}
async function clubeCouponCopyPix(){
  const uid=String(globalThis.liveRuntime?.session?.user?.id||'');
  const state=clubeCouponShopState;
  if(!uid||!globalThis.liveReady?.()||state.userId!==uid||state.busy)return;
  const purchase=state.purchase;
  const invoiceId=String(purchase?.invoiceId||'');
  const code=String(purchase?.pixCode||'');
  const originalPostal=String(purchase?.servicePostalCode||'');
  // A hidden or withdrawn Pix must not be copied by an old button while
  // the previous BR code is still held in memory.
  if(purchase?.status!=='awaiting_payment'||purchase?.pixPayable!==true||
     clubeCouponPixLease.expiresAt<=Date.now()||
     !/^[0-9a-f-]{36}$/i.test(invoiceId)||code.length<30||code.length>3000||
     (purchase?.fundingModel==='partner_funded'&&
      !/^[0-9]{8}$/.test(originalPostal)))
    return toast('Este código Pix não está confirmado. Confira a compra no histórico.');
  state.busy=true;
  if(route()==='club')render();
  try{
    // The server must recheck BOTH provider order and merchant eligibility
    // at copy time. Existing tabs and their QR displays may be stale.
    const fresh=await liveInvoke('coupon-credit-pix',{
      action:'invoice-status',invoiceId
    });
    if(String(globalThis.liveRuntime?.session?.user?.id||'')!==uid||
       state.userId!==uid||state.purchase!==purchase)return;
    if(fresh?.ok!==true||fresh.invoiceId!==invoiceId||
       fresh.status!=='awaiting_payment'||fresh.pixPayable!==true||
       String(fresh.pixCode||'')!==code||
       fresh.fundingModel!==purchase.fundingModel||
       (purchase.fundingModel==='partner_funded'&&
        purchase.servicePostalCode!==originalPostal))
      throw Error('COUPON_PIX_STALE_AT_COPY');
    try{
      await navigator.clipboard.writeText(code);
      if(String(globalThis.liveRuntime?.session?.user?.id||'')===uid&&
         state.purchase===purchase)toast('Código Pix confirmado e copiado.');
    }catch{
      if(String(globalThis.liveRuntime?.session?.user?.id||'')===uid)
        toast('Selecione e copie o código Pix exibido.');
    }
  }catch{
    if(String(globalThis.liveRuntime?.session?.user?.id||'')===uid&&
       state.userId===uid){
      if(state.purchase===purchase)state.purchase=null;
      toast('O Pix antigo não foi confirmado. Não pague o código anterior; confira a compra no histórico.');
    }
  }finally{
    if(state.userId===uid)state.busy=false;
    if(route()==='club')render();
  }
}


// History is lazy-loaded with the coupon shop and never costs the merchant startup JS.
function clubeCouponPurchasesPanel(){
 const money=value=>BRL.format(Math.max(0,Number(value)||0)/100);
return (clubePaidCouponView.status==='ready' && clubePaidCouponView.userId===String(globalThis.liveRuntime?.session?.user?.id||''))?
 clubePaidCouponView.purchases.slice(0,20).map(inv=>{
  const id=String(inv.invoiceId||'');
  if(!/^[0-9a-f-]{36}$/i.test(id))return '';
  const request=String(inv.refundStatus||'');
  const refundPending=clubeCouponRefundState.userId===String(globalThis.liveRuntime?.session?.user?.id||'')&&
    clubeCouponRefundState.inFlight.has(id);
  const allowed=['paid','awaiting_payment','prepared','review_required'].includes(String(inv.status));
  const seller=inv.seller;
  return '<article class="card flat"><strong>Compra de cupons</strong>'+
   '<p>'+esc(money(inv.amountCents))+' · '+esc(inv.status)+'</p>'+
   (inv.status==='review_required'&&[
      'PARTNER_COUPON_SUPPLY_LOST_AT_SETTLEMENT',
      'COUPON_REFUND_REQUEST_PRECEDES_SETTLEMENT'
    ].includes(String(inv.settlementReviewReason||''))?
      '<p class="notice">Pagamento Pix identificado. Os cupons não foram liberados porque a oferta da revenda ficou indisponível ou já havia solicitação de cancelamento. O reembolso depende de verificação do Mercado Pago; acompanhe ou solicite no histórico.</p>':'')+
   (inv.fundingModel==='partner_funded'
    ?'<p class="tiny">Cupom pago financiado pela revenda participante. CEP da compra: '+
     esc(String(inv.servicePostalCode||'não informado'))+'. O desconto depende de adesão da revenda e pedido elegível; o TAMÃO não o converte em cashback comum.</p>'
    :'')+
   (seller?'<p class="tiny muted">Vendedor: '+esc(String(seller.name||''))+
      ' · '+esc(String(seller.taxDocument||''))+'</p>':'')+
   (inv.status==='awaiting_payment'?
      '<button class="secondary small" type="button" onclick="clubeCouponCheckInvoice(\''+id+
      '\')">Conferir Pix desta compra</button>':'')+
   (request==='refunded'&&inv.status==='refunded'?
     '<p class="tiny">Reembolso confirmado pelo provedor.</p>':
    request?'<p class="tiny muted">Pedido de reembolso registrado. O Pix ainda não está confirmado como devolvido.</p>'+
      '<button class="secondary small" type="button" onclick="clubeCouponRefundAsk(\''+id+'\')" '+
      (refundPending?'disabled':'')+'>Conferir reembolso</button>':
    allowed?'<label class="tiny">Motivo do cancelamento<select id="clube-refund-reason-'+id+'" class="input">'+
       '<option value="arrependimento">Desistência / arrependimento</option>'+
       '<option value="sem_atendimento">Não há revenda para utilizar</option>'+
       '<option value="outro">Outro motivo</option></select></label>'+
      '<button class="secondary small" type="button" onclick="clubeCouponRefundAsk(\''+id+
       '\')" '+
       (refundPending?'disabled':'')+'>Solicitar cancelamento / reembolso</button>':'')+'</article>';
 }).join(''):'';
}

// A cancellation is a protocol/request, NOT an immediate Pix reversal.
// Per-user, per-invoice lock avoids duplicate requests and repeated PSP checks.
// The UUID remains stable across ambiguous network retries.
async function clubeCouponRefundAsk(invoiceId){
 const uid=String(globalThis.liveRuntime?.session?.user?.id||'');
 if(!uid||!globalThis.liveReady?.()||
    !/^[0-9a-f-]{36}$/i.test(String(invoiceId||'')))return;
 if(clubeCouponRefundState.userId!==uid)Object.assign(clubeCouponRefundState,{
   userId:uid,inFlight:new Set(),attempts:{}
 });
 if(clubeCouponRefundState.inFlight.has(invoiceId))return;
 const invoice=clubePaidCouponView.userId===uid&&clubePaidCouponView.status==='ready'?
  clubePaidCouponView.purchases.find(x=>x.invoiceId===invoiceId):null;
 if(!invoice||invoice.refundStatus==='refunded')return;
 const existing=Boolean(invoice.refundStatus);
 const choice=existing?'outro':String(document.getElementById('clube-refund-reason-'+invoiceId)?.value||'');
 if(!['arrependimento','sem_atendimento','outro'].includes(choice))
   return toast('Escolha o motivo do cancelamento.');
 if(!existing&&!window.confirm('Confirma o cancelamento do pacote? A devolução do Pix só aparece como concluída após confirmação do Mercado Pago.'))return;
 const requestId=clubeCouponRefundState.attempts[invoiceId]||crypto.randomUUID();
 clubeCouponRefundState.attempts[invoiceId]=requestId;
 clubeCouponRefundState.inFlight.add(invoiceId);
 if(route()==='club')render();
 try{
  const result=await liveInvoke('coupon-credit-pix',{action:'request-refund',
    invoiceId,requestId,reason:choice});
  if(result?.ok!==true||result?.source!=='clube_coupon_refund_request_v1_814'||
     result?.invoiceId!==invoiceId)throw Error('COUPON_REFUND_REQUEST_UNVERIFIED');
  if(String(globalThis.liveRuntime?.session?.user?.id||'')!==uid)return;
  if(result.status==='refunded'&&result.refundConfirmed===true)
    toast('Reembolso confirmado. Protocolo: '+String(result.requestId).slice(0,8)+'.');
  else
    toast('Pedido recebido. Protocolo: '+String(result.requestId).slice(0,8)+'. Aguardando análise do reembolso.');
  await clubePaidCouponsRefresh();
 }catch{
  if(String(globalThis.liveRuntime?.session?.user?.id||'')===uid)
   toast('Não foi possível confirmar o protocolo. Consulte seu histórico antes de tentar novamente.');
 }finally{
  if(clubeCouponRefundState.userId===uid)
    clubeCouponRefundState.inFlight.delete(invoiceId);
  if(route()==='club')render();
 }
}

// ESM lazy load: onclick handlers must be available on the customer window.
Object.assign(globalThis,{clubeCouponWatchAuth,clubeCouponShopPanel,clubeCouponShopRefresh,
  clubeCouponBuy,clubeCouponCheckInvoice,clubeCouponCopyPix,clubeCouponRefundAsk,clubeCouponVerifyPostal,
  clubeCouponPurchasesPanel,ca:clubePaidCouponAutoLoad});
