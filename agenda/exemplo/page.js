/* TAMÃO Agenda Black Gold: illustrative front-end, with ZERO financial or booking operations. */
(function(){
 'use strict';
 const menu=document.getElementById('menu-toggle');
 const nav=document.getElementById('main-navigation');
 if(menu&&nav){
  const close=()=>{nav.classList.remove('is-open');menu.setAttribute('aria-expanded','false');menu.setAttribute('aria-label','Abrir menu');};
  menu.addEventListener('click',()=>{
   const open=menu.getAttribute('aria-expanded')!=='true';
   nav.classList.toggle('is-open',open);
   menu.setAttribute('aria-expanded',String(open));
   menu.setAttribute('aria-label',open?'Fechar menu':'Abrir menu');
  });
  nav.querySelectorAll('a').forEach(link=>link.addEventListener('click',close));
  document.addEventListener('keydown',event=>{if(event.key==='Escape')close();});
  document.addEventListener('click',event=>{if(!nav.contains(event.target)&&!menu.contains(event.target))close();});
 }
 const prices={
  corte:{price:4500,label:'Corte masculino'},
  barba:{price:3500,label:'Barba'},
  combo:{price:7000,label:'Corte + barba'},
  acabamento:{price:2000,label:'Acabamento'}
 };
 const money=cents=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
 const service=document.getElementById('booking-service');
 const person=document.getElementById('booking-person');
 const date=document.getElementById('booking-date');
 const form=document.getElementById('demo-booking');
 const feedback=document.getElementById('booking-feedback');
 const price=document.getElementById('booking-price');
 const slots=Array.from(document.querySelectorAll('#time-grid [data-slot]'));
 let selectedTime='';
 const iso=(dateValue)=>dateValue.getFullYear()+'-'+String(dateValue.getMonth()+1).padStart(2,'0')+'-'+String(dateValue.getDate()).padStart(2,'0');
 if(date){
  const today=new Date();
  const next=new Date(today.getFullYear(),today.getMonth(),today.getDate()+1);
  const end=new Date(today.getFullYear(),today.getMonth(),today.getDate()+30);
  date.min=iso(today);
  date.max=iso(end);
  date.value=iso(next);
 }
 const setFeedback=(message,state='')=>{
  if(!feedback)return;
  feedback.textContent=message;
  feedback.dataset.state=state;
 };
 const chooseTime=button=>{
  selectedTime=button.dataset.slot;
  slots.forEach(slot=>slot.setAttribute('aria-pressed',String(slot===button)));
  setFeedback('Horário ilustrativo selecionado: '+selectedTime+'. Escolha os demais dados e visualize a prévia.');
 };
 slots.forEach(button=>button.addEventListener('click',()=>chooseTime(button)));
 const setService=id=>{
  if(!prices[id]||!service||!price)return;
  service.value=id;
  price.textContent=money(prices[id].price);
  setFeedback('Serviço ilustrativo selecionado: '+prices[id].label+'.');
 };
 service?.addEventListener('change',()=>setService(service.value));
 document.querySelectorAll('[data-service]').forEach(button=>button.addEventListener('click',()=>{
  setService(button.dataset.service);
  document.getElementById('agendamento')?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
  service?.focus({preventScroll:true});
 }));
 if(form){
  form.addEventListener('submit',event=>{
   event.preventDefault();
   if(!service||!person||!date||!prices[service.value]||!date.value||date.value<date.min||date.value>date.max){
    setFeedback('Escolha um serviço, um profissional e uma data válida para visualizar a prévia.','error');
    return;
   }
   if(!selectedTime){
    setFeedback('Selecione um dos horários ilustrativos acima.','error');
    slots[0]?.focus();
    return;
   }
   const dateLabel=new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(date.value+'T12:00:00Z'));
   const label=prices[service.value].label;
   setFeedback('Prévia: '+label+' em '+dateLabel+', às '+selectedTime+', por '+money(prices[service.value].price)+'. Esta página é um exemplo: nenhuma reserva ou pagamento foi realizado. Crie sua Agenda para trabalhar com horários reais.','success');
  });
 }
 const dialog=document.getElementById('gallery-dialog');
 const photo=document.getElementById('gallery-large');
 const caption=document.getElementById('gallery-caption');
 const close=document.getElementById('dialog-close');
 let returnFocus=null;
 if(dialog&&photo&&caption){
  document.querySelectorAll('[data-gallery]').forEach(button=>button.addEventListener('click',()=>{
   const img=button.querySelector('img');
   if(!img)return;
   photo.src=img.currentSrc||img.src;
   photo.alt=img.alt;
   caption.textContent=button.dataset.caption||img.alt;
   returnFocus=button;
   if(typeof dialog.showModal==='function')dialog.showModal();
  }));
  close?.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
  dialog.addEventListener('close',()=>{photo.removeAttribute('src');returnFocus?.focus({preventScroll:true});});
 }
})();
