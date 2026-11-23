// TAMÃO V1.1162 — loaded only when a real payable Pix is visible.
// Informational identity, never a bank-verification or financial API.
(()=>{
 'use strict';
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function recipientHtml({scope='platform',merchantName='',sellerName=''}={}){
  if(!['platform','merchant','seller'].includes(scope))return '';
  const name=scope==='platform'?'Carlos Alberto dos Santos Freitas':
   String(scope==='merchant'?merchantName:sellerName).trim();
  const heading=scope==='platform'?'RESPONSÁVEL TÉCNICO TAMÃO':
   scope==='merchant'?'RECEBIMENTO DIRETO À REVENDA':'VENDEDOR DO PACOTE';
  const description=scope==='platform'?
   'Responsável indicado pelo TAMÃO para a operação de recebimento':
   scope==='merchant'?'Esta compra é recebida pela revenda, não pelo TAMÃO.':
   'Vendedor identificado no registro da compra; confira o recebedor bancário.';
  // Never infer digits from an unverified profile, BR Code or DOM.
  return '<aside class="tamao-pix-trust" aria-label="Identificação do pagamento Pix"'+
   ' style="margin:14px 0;padding:18px 20px;border:1px solid #b8d8ce;border-radius:16px;background:#eaf5f0;color:#173f32">'+
   '<span style="display:block;color:#176d50;letter-spacing:.07em;font-size:11px;font-weight:850">'+heading+'</span>'+
   (name?'<strong style="display:block;margin:7px 0 3px;font-size:18px;line-height:1.3;overflow-wrap:anywhere">'+escape(name)+'</strong>':'')+
   '<p style="font-size:13px;margin:5px 0">'+description+'</p>'+
   '<p style="padding-top:9px;margin:10px 0 5px;border-top:1px solid #cadfd7;font-weight:750;font-size:13px">Cobrança gerada pelo sistema oficial do TAMÃO.</p>'+
   '<p style="font-size:13px;margin:5px 0;line-height:1.5">Antes de pagar, confira no aplicativo do banco o nome e a identificação do recebedor. Em caso de divergência, não conclua o pagamento e contate o suporte do TAMÃO.</p>'+
   (scope==='platform'?
    '<small style="display:block;color:#44665b;line-height:1.45">CPF: os dígitos finais não são divulgados sem conferência da titularidade bancária. O nome acima é a identificação administrativa informada pelo TAMÃO.</small>':'')+
   '</aside>';
 }
 globalThis.tamaoPixRecipientHtml=recipientHtml;
})();
