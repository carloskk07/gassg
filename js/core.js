const BRL = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const STORAGE='chama-sg-state-v1';
const now=()=>new Date();
const hhmm=(d=new Date())=>d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
const uid=()=>Math.random().toString(36).slice(2,7).toUpperCase();

const seed={
  mode:'customer',
  user:{name:'Carlos',cashback:7.50,purchases:4,referralCode:'CARLOS27',commissionAvailable:0,commissionPending:0},
  address:'',
  cart:{P13:1,WATER20:0,CHARCOAL4:0,WOOD:0,ICE5:0},
  merchants:[
    {id:'A',name:'Revenda Parceira A',priceP13:116.90,deliveryFee:0,eta:34,distance:3.8,online:true,stock:24,trust:94,accepted:0,delivered:0,products:{WATER20:15.90,CHARCOAL4:19.90,WOOD:24.90,ICE5:12.00}},
    {id:'B',name:'Revenda Parceira B',priceP13:119.90,deliveryFee:0,eta:19,distance:1.9,online:true,stock:31,trust:97,accepted:0,delivered:0,products:{WATER20:14.90,CHARCOAL4:21.90,WOOD:null,ICE5:11.50}},
    {id:'C',name:'Revenda Parceira C',priceP13:122.90,deliveryFee:0,eta:13,distance:1.1,online:true,stock:18,trust:98,accepted:0,delivered:0,products:{WATER20:null,CHARCOAL4:18.90,WOOD:22.90,ICE5:13.00}}
  ],
  orders:[],
  selectedMerchant:'A',
  onboarding:[]
};

let state=load();
function load(){try{return {...structuredClone(seed),...JSON.parse(localStorage.getItem(STORAGE)||'{}')}}catch{return structuredClone(seed)}}
function save(){localStorage.setItem(STORAGE,JSON.stringify(state))}
function reset(){state=structuredClone(seed);save();location.hash='#home';render();toast('Demonstração reiniciada')}
function route(){return (location.hash.replace('#','')||'home').split('?')[0]}
function go(r){location.hash='#'+r}
function toast(msg){const t=document.querySelector('#toast');if(!t)return;t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2300)}

const products={
  P13:{name:'Gás P13',icon:'🔥'}, WATER20:{name:'Água 20 L',icon:'💧'}, CHARCOAL4:{name:'Carvão 4 kg',icon:'⚫'}, WOOD:{name:'Lenha',icon:'🪵'}, ICE5:{name:'Gelo 5 kg',icon:'🧊'}
};

function minPrice(){return Math.min(...state.merchants.filter(m=>m.online&&m.stock>0).map(m=>m.priceP13+m.deliveryFee))}
function cartAvailable(m){return Object.entries(state.cart).every(([k,q])=>q<=0 || (k==='P13'?m.stock>=q:m.products[k]!=null))}
function cartTotal(m){let total=(state.cart.P13||0)*m.priceP13 + m.deliveryFee;for(const [k,q] of Object.entries(state.cart)){if(k!=='P13'&&q>0)total+=q*(m.products[k]||0)}return Number(total.toFixed(2))}
function offers(){const eligible=state.merchants.filter(m=>m.online&&m.stock>0&&cartAvailable(m)).map(m=>({...m,total:cartTotal(m),score:(m.eta*.45)+(m.distance*1.4)+((100-m.trust)*1.6)+(cartTotal(m)*.05)}));if(!eligible.length)return[];const cheapest=[...eligible].sort((a,b)=>a.total-b.total||a.eta-b.eta)[0];const fastest=[...eligible].sort((a,b)=>a.eta-b.eta||a.total-b.total)[0];const recommended=[...eligible].sort((a,b)=>a.score-b.score)[0];const uniq=[];[['Mais barato',cheapest],['Recomendado',recommended],['Mais rápido',fastest]].forEach(([label,m])=>{if(m&&!uniq.some(x=>x.id===m.id))uniq.push({...m,label})});return uniq}
function activeOrder(){return state.orders.slice().reverse().find(o=>!['DELIVERED','SETTLED','CANCELLED'].includes(o.status))||state.orders.at(-1)}
function timelineIndex(status){return ['CREATED','QUOTE_LOCKED','OFFERED_TO_MERCHANT','MERCHANT_ACCEPTED','PREPARING','OUT_FOR_DELIVERY','ARRIVING','DELIVERED','SETTLED'].indexOf(status)}

function shell(content){
  const r=route();
  return `<div class="app">
  <div class="demo-strip">Demonstração local • preços e revendas são ilustrativos até o cadastro dos 3 parceiros reais</div>
  <header class="topbar"><div class="shell topbar-inner">
    <div class="brand" onclick="go('home')"><div class="brandmark"><span>🔥</span></div><div>Chama<small>São Gabriel</small></div></div>
    <div class="desktop-only desktop-nav"><button onclick="go('home')">Início</button><button onclick="go('club')">Clube</button><button onclick="go('refer')">Indique e ganhe</button><button onclick="go('merchants')">Para revendas</button></div>
    <div class="mode-pill"><button class="${state.mode==='customer'?'active':''}" onclick="setMode('customer')">Cliente</button><button class="${state.mode==='merchant'?'active':''}" onclick="setMode('merchant')">Revenda</button></div>
  </div></header>
  <main class="shell">${content}</main>
  ${bottomNav(r)}
  </div>`;
}
function bottomNav(r){const items=state.mode==='merchant'?[['merchant','🏪','Operação'],['merchant-orders','📦','Pedidos'],['catalog','🧺','Catálogo'],['merchant-metrics','📊','Desempenho'],['merchants','➕','Parceiros']]:[['home','⌂','Início'],['order','🔥','Pedir'],['tracking','📍','Pedido'],['club','★','Clube'],['refer','🤝','Indique']];return `<nav class="bottom-nav">${items.map(([id,ic,l])=>`<button class="nav-btn ${r===id?'active':''}" onclick="go('${id}')"><span>${ic}</span><span>${l}</span></button>`).join('')}</nav>`}
function setMode(m){state.mode=m;save();go(m==='merchant'?'merchant':'home');render()}