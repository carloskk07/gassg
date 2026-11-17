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
window.addEventListener('hashchange',render);
// The standalone Agenda already owns this route; do not append #agenda to
// clean /agenda/estabelecimento URLs. Legacy #agenda links remain supported.
window.addEventListener('DOMContentLoaded',render);
