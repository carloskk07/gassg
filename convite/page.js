/* TAMÃO V1.1071 — public, static and non-transactional invitation landing.
 * Personalization is part of the shared URL. No account/profile lookup is claimed.
 * All actions route to the official TAMÃO site with the original verified-at-source ref. */
(function(){
 'use strict';
 const targets=Object.freeze({
  customer:{hash:'home',heading:'Produtos e economia para o seu dia.',subtitle:'Conheça gás, água e itens essenciais. Consulte ofertas e entregas disponíveis para o seu CEP.',label:'Conhecer os produtos'},
  merchant:{hash:'merchants',heading:'Sua empresa pode chegar mais longe.',subtitle:'Apresente sua revenda e descubra como organizar produtos, pedidos e novas oportunidades no TAMÃO.',label:'Conhecer o TAMÃO para revendas'},
  mobility:{hash:'mobility',heading:'Mais caminhos para conectar pessoas.',subtitle:'Conheça as opções de moto e carro e descubra como participar da plataforma.',label:'Conhecer Moto e Carro'},
  professional:{hash:'advertise',heading:'Seu trabalho merece ser encontrado.',subtitle:'Divulgue seus serviços, mostre seu talento e conheça oportunidades para profissionais.',label:'Conhecer os serviços profissionais'},
  rides:{hash:'rides',heading:'Caronas e destinos se encontram aqui.',subtitle:'Conheça a área de caronas e confira os anúncios disponíveis.',label:'Conhecer as caronas'},
  club:{hash:'club',heading:'Mais benefícios para fazer parte.',subtitle:'Descubra o Clube TAMÃO, cupons e condições disponíveis conforme as campanhas.',label:'Conhecer o Clube TAMÃO'},
  sponsor:{hash:'sponsors',heading:'Sua marca mais próxima da região.',subtitle:'Conheça as opções de divulgação e as oportunidades para anunciantes.',label:'Conhecer oportunidades para marcas'}
 });
 const themes=Object.freeze({clean:'clean',gold:'gold',rose:'rose'});
 const params=new URLSearchParams(location.search);
 const rawCode=String(params.get('ref')||'').trim().toUpperCase();
 const valid=/^(?:[A-Z0-9]{5,40})$/.test(rawCode);
 const code=valid?rawCode:'';
 const area=Object.hasOwn(targets,params.get('a'))?params.get('a'):'customer';
 const theme=Object.hasOwn(themes,params.get('t'))?params.get('t'):'clean';
 const sender=String(params.get('n')||'').trim().slice(0,48);
 const personalized=String(params.get('m')||'').trim().slice(0,140);
 const name=/^[\p{L}\p{M}0-9 .'\-]{1,48}$/u.test(sender)?sender:'';
 const message=personalized&&!/[\u0000-\u001f<>]/.test(personalized)?personalized:'';
 const data=targets[area];
 const withRef=hash=>'https://tamao.com.br/'+(code?'?ref='+encodeURIComponent(code):'')+'#'+hash;
 document.body.classList.replace('theme-clean','theme-'+theme);
 document.getElementById('title').textContent=data.heading;
 document.getElementById('message').textContent=message||data.subtitle;
 document.getElementById('primary').href=withRef(data.hash);
 document.getElementById('primary').firstChild.textContent=data.label+' ';
 if(name){
  const el=document.getElementById('inviter');
  el.textContent='Convite compartilhado por '+name;
  el.hidden=false;
 }
 const areas=document.getElementById('areas');
 const list=[
  ['customer','Produtos e clientes'],['merchant','Revendas'],['mobility','Moto e carro'],
  ['professional','Profissionais'],['rides','Caronas'],['club','Clube TAMÃO'],
  ['sponsor','Anunciantes']
 ];
 areas.replaceChildren(...list.map(([key,label])=>{
  const a=document.createElement('a');
  a.href=withRef(targets[key].hash);a.textContent=label;
  if(key===area)a.setAttribute('aria-current','true');
  return a;
 }));
 // This page is not an enrollment or reward confirmation. No click analytics
 // represent a conversion; every CTA proceeds to the official platform.
})();
