import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=read('js/learn-premium.js'),css=read('css/learn-premium.css');
new vm.Script(source,{filename:'js/learn-premium.js'});
const context=vm.createContext({shell:markup=>markup});
vm.runInContext(source+'\nthis.page=learnPremiumPage;',context);
const markup=context.page();
vm.runInContext("learnPremiumFaqState.topic='entrega';learnPremiumFaqState.query='velho';learnPremiumPage();",context);
assert.equal(vm.runInContext("learnPremiumFaqState.topic",context),'todos','route revisit resets filter');
assert.equal(vm.runInContext("learnPremiumFaqState.query",context),'','route revisit resets query');

for(const anchor of [
 'id="learn-faq-search"','oninput="learnPremiumSearchFaq(this.value)"',
 'data-learn-faq-count','data-learn-faq-empty','id="learn-faq-results"',
 'aria-controls="learn-faq-results"','aria-live="polite"','role="status"'
])assert(markup.includes(anchor),'Missing accessible concierge FAQ element '+anchor);

for(const [category,count] of Object.entries({compra:2,entrega:3,beneficios:1,cadastro:2}))
 assert.equal((markup.match(new RegExp('data-learn-faq-category="'+category+'"','g'))||[]).length,count);

assert.equal((markup.match(/data-learn-faq-topic="/g)||[]).length,5);
assert.match(markup,/Simples para pedir/);
assert.match(markup,/Claro para acompanhar/);
assert.match(markup,/data-learn-scene="4"/);
assert.match(markup,/onclick="go\('contact'\)"/);
assert.doesNotMatch(markup,/mais de \d+ pedidos|entrega garantida em \d+ minutos|5 estrelas/i);
assert.doesNotMatch(source,/fetch\(|localStorage|sessionStorage|XMLHttpRequest|sendBeacon/);

const titles=[
 ['cadastro','Posso consultar produtos sem criar uma conta?','Para concluir uma compra, nome e e-mail confirmado.'],
 ['compra','Preciso comprar gás para pedir água?','Também temos produtos disponíveis para comprar sem gás.'],
 ['compra','O preço pode mudar?','Alternativas mais caras dependem da sua autorização.'],
 ['entrega','Como sei que a revenda assumiu o pedido?','A revenda precisa aceitar.'],
 ['entrega','E se ninguém aceitar meu pedido?','Pedido não confirmado.'],
 ['entrega','Como a entrega é concluída?','Código de recebimento.'],
 ['beneficios','Como funcionam cashback e indicações?','Comissões de campanhas elegíveis.'],
 ['cadastro','Tenho uma revenda. Posso participar?','Cadastro de revendas.']
];
const cards=titles.map(([topic,q,a])=>({
  hidden:false,open:false,textContent:q+' '+a,
  getAttribute:name=>name==='data-learn-faq-category'?topic:null
}));
const buttons=['todos','compra','entrega','beneficios','cadastro'].map(topic=>({
  topic,attributes:{'aria-pressed':topic==='todos'?'true':'false'},
  getAttribute:name=>name==='data-learn-faq-topic'?topic:null,
  setAttribute(name,value){this.attributes[name]=value},
  classList:{toggle(){}}
}));
const count={textContent:''},empty={hidden:true},input={value:''};
const faqRoot={
 querySelectorAll:q=>q==='.learn-faq-items details[data-learn-faq-category]'?cards:
 q==='[data-learn-faq-topic]'?buttons:[],
 querySelector:q=>q==='[data-learn-faq-count]'?count:
 q==='[data-learn-faq-empty]'?empty:null
};
const document={
 querySelector:q=>q==='.learn-premium .learn-faq'?faqRoot:
 q==='.learn-premium #learn-faq-search'?input:null
};
const context2=vm.createContext({document});
vm.runInContext(source.slice(source.indexOf('/** Find help locally;'))+
 '\nthis.filter=learnPremiumSetFaqTopic;this.search=learnPremiumSearchFaq;this.clear=learnPremiumClearFaq;',context2);
assert.equal(context2.filter('entrega'),3);
assert.equal(cards.filter(x=>!x.hidden).length,3);
assert.equal(count.textContent,'3 perguntas encontradas');
assert.equal(buttons.find(x=>x.topic==='entrega').attributes['aria-pressed'],'true');
assert.equal(context2.search('código'),1);
assert.equal(cards.filter(x=>!x.hidden).length,1);
assert.equal(cards[5].open,true,'search should expose matching answer');
assert.equal(context2.filter('compra'),0);
assert.equal(empty.hidden,false);
assert.equal(context2.search('PRECO'),1,'Portuguese accented words should match without accent');
assert.equal(empty.hidden,true);
assert.equal(context2.search('<script>'),0,'typed text must only filter, never execute or interpolate HTML');
assert.equal(empty.hidden,false);
assert.equal(context2.filter('fake-topic'),false);
input.value='please clear';
assert.equal(context2.clear(),8);
assert.equal(input.value,'');
assert.equal(cards.filter(x=>x.hidden).length,0);
assert.equal(count.textContent,'8 perguntas encontradas');
assert.equal(buttons.find(x=>x.topic==='todos').attributes['aria-pressed'],'true');
for(const rule of ['.learn-faq-search-frame:focus-within','.learn-faq-empty[hidden]',
 '.learn-faq-items details[hidden]','.learn-faq-topics button.is-active',
 '@media(max-width:700px)','prefers-reduced-motion:reduce'])
 assert(css.includes(rule),'Missing accessibility or mobile style '+rule);
console.log('TAMÃO V1.1127 PASS: 8 FAQ entries, local search, accent folding, topic filters, no-results and clear reset.');
