import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const home=read('js/home-showcase.js'),customer=read('js/customer.js'),css=read('css/marketing-premium.css');
new vm.Script(home);new vm.Script(customer);
const products={P13:{name:'Gás P13',icon:'🔥'},WATER20:{name:'Água 20 L',icon:'💧'},WOOD:{name:'Lenha',icon:'🪵'}};
const state={postalCode:'97300000',cart:{P13:0,WATER20:2,WOOD:0}};
const htmlCtx=vm.createContext({products,state,globalThis:{liveRuntime:{},liveReady:()=>false},
 BRL:{format:n=>'R$ '+Number(n).toFixed(2)},Date,
 customerProductName:(code,p)=>p?.name||code,
 esc:s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')});
vm.runInContext(home+';this.board=homeRegionalPriceBoard;this.basket=homeQuoteBasketMarkup;',htmlCtx);
let rendered=htmlCtx.board({city:'São Gabriel',state:'RS'});
assert.match(rendered,/Tamão São Gabriel\/RS/);
assert.match(rendered,/Clique no produto, coloque seu CEP e consulte as ofertas para o seu endereço/);
assert.match(rendered,/Como comprar/);
assert.match(rendered,/1<\/b> Escolha/);
assert.match(rendered,/2<\/b> Informe o CEP/);
assert.match(rendered,/3<\/b> Compare e compre/);
assert.equal((rendered.match(/name="tamao-city-quote"/g)||[]).length,3,
 'one native exclusive product accordion across reference products');
assert.match(rendered,/city-price-product-icon/);
assert.match(rendered,/homeQuoteSyncPostal\(this\)/);
assert.match(rendered,/homeQuoteAdjustQuantity\('P13',-1\)/);
assert.match(rendered,/homeQuoteAdjustQuantity\('P13',1\)/);
assert.match(rendered,/2 unidades selecionadas/);
assert.match(rendered,/2× Água 20 L/);
assert.match(rendered,/Ver cesta e consultar/);
assert.doesNotMatch(rendered,/subtotal.*R\$|economia garantida/i);
const empty=htmlCtx.basket({});
assert.match(empty,/button[^>]*disabled/);
assert.match(empty,/Escolha um produto para começar/);
const safe=htmlCtx.basket({P13:3,WATER20:1,OTHER:30});
assert.match(safe,/4 unidades selecionadas/);
assert.doesNotMatch(safe,/OTHER/);
assert.match(css,/\.city-price-basket/);
assert.match(css,/\.city-price-product-qty-control/);
assert.match(css,/\.city-price-shopping-steps/);
assert.ok(css.includes('@media(max-width:620px)'));
const pieceStart=customer.indexOf('function homeQuoteSyncPostal(');
const pieceEnd=customer.indexOf('// Consulta ofertas reais quando a sessão está pronta;',pieceStart);
assert.ok(pieceStart>=0&&pieceEnd>pieceStart);
let value='',sameValue='',plus='2',feedback='',basketHTML='',routes=[],toasts=[];
const input={value:'97300000'},otherInput={value:''},numberInput={value:'2'};
const panel={querySelector(sel){
 return sel==='.city-price-product-qty'?numberInput:
 sel==='.city-price-product-postal'?input:
 sel==='.city-price-product-feedback'?{set textContent(v){feedback=v}}:null;
}};
const doc={querySelector:sel=>sel.includes('data-city-quote-code')?panel:null,
 querySelectorAll:sel=>sel==='.city-price-product-postal'?[input,otherInput]:[],
 getElementById:id=>id==='city-price-basket'?{set innerHTML(markup){basketHTML=markup}}:null};
const ctx=vm.createContext({state,products,document:doc,
 homeQuoteBasketMarkup:cart=>htmlCtx.basket(cart),
 toast:msg=>toasts.push(msg),go:route=>routes.push(route),
 setCartProduct:(code,qty)=>{state.cart[code]=qty},globalThis:{liveRuntime:{offers:[]}}});
vm.runInContext(customer.slice(pieceStart,pieceEnd)+';this.sync=homeQuoteSyncPostal;this.qty=homeQuoteAdjustQuantity;this.checkout=homeQuoteGoToOrder;this.add=homeQuoteSelectProduct;',ctx);
input.value='97300000';assert.equal(ctx.sync(input),'97300-000');
assert.equal(otherInput.value,'97300-000','other product inherits ZIP');
numberInput.value='1';ctx.qty('WATER20',-1);assert.equal(numberInput.value,'1');
ctx.qty('WATER20',8);assert.equal(numberInput.value,'9');
ctx.qty('WATER20',99);assert.equal(numberInput.value,'20');
numberInput.value='1';
assert.equal(ctx.add('WATER20',false),true);
assert.equal(state.cart.WATER20,3,'existing basket quantity increments');
assert.match(basketHTML,/3 unidades selecionadas/);
assert.match(feedback,/adicionada à cesta/);
assert.equal(routes.length,0,'adding cannot launch checkout');
assert.equal(ctx.checkout(),true);
assert.deepEqual(routes,['order'],'persistent cart uses existing order route');
state.cart={P13:0,WATER20:0,WOOD:0};
assert.equal(ctx.checkout(),false);
assert.match(toasts.at(-1),/Adicione um produto/);
console.log('PASS — responsive accordion, shared ZIP, mobile steppers, reactive basket and safe checkout CTA.');
