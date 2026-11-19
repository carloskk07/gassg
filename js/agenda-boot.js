/* Minimal, CSP-safe shell for TAMÃO Agenda; no storefront bootstrap needed. */
const BRL=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function route(){return 'agenda';}
function shell(content){return '<main id="tamao-main">'+content+'</main>';}
function render(){
 const app=document.getElementById('app');
 if(!app||typeof agendaPage!=='function')return;
 app.innerHTML=agendaPage();
 agendaAfterRender();
}
// Cloudflare serves verified deep links through /agenda/?profissional=slug.
// Restore the professional's permanent short address in the current history
// entry without making a second request or changing booking ownership.
function agendaRestorePublishedVanity(){
 try{
  if(location.pathname!=='/agenda/')return false;
  const slug=String(new URLSearchParams(location.search).get('profissional')||'');
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||slug.length>60)return false;
  const url=new URL(location.href);
  url.pathname='/agenda/'+slug+'/';url.searchParams.delete('profissional');
  history.replaceState(history.state,'',url.pathname+url.search+url.hash);
  return true;
 }catch{return false}
}
agendaRestorePublishedVanity();
// The TAMÃO network stores first-touch hints in the same origin for 30 days.
// An Agenda appointment is not itself a paid referral event.
function agendaCaptureFirstTouchInvitation(){
 try{
  const code=String(new URLSearchParams(location.search).get('ref')||'').trim().toUpperCase();
  if(!/^[A-Z0-9]{5,40}$/.test(code))return false;
  const key='tamao-growth-first-ref-v1-226';
  const old=JSON.parse(localStorage.getItem(key)||'null');
  const active=String(old?.code||'').toUpperCase();
  if(/^[A-Z0-9]{5,40}$/.test(active)&&Number(old?.expiresAt)>Date.now())return false;
  localStorage.setItem(key,JSON.stringify({code,expiresAt:Date.now()+30*24*60*60*1000}));
  return true;
 }catch{return false}
}
agendaCaptureFirstTouchInvitation();
window.addEventListener('hashchange',render);
window.addEventListener('popstate',render);
// The standalone Agenda already owns this route; do not append #agenda to
// clean /agenda/estabelecimento URLs. Legacy #agenda links remain supported.
window.addEventListener('DOMContentLoaded',render);
