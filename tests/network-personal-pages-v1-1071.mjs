import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const growth=read('js/growth.js'),merchant=read('js/merchant.js');
const page=read('convite/page.js'),html=read('convite/index.html'),css=read('convite/style.css');
const editor=read('js/network-pages-editor.js');new vm.Script(editor,{filename:'js/network-pages-editor.js'});
const editorCss=read('css/network-pages.css'),index=read('index.html');
const live=read('scripts/build-live-portals.mjs'),publicBuild=read('scripts/build-public-site.mjs');
const core=read('js/core.js');
new vm.Script(growth,{filename:'js/growth.js'});
new vm.Script(page,{filename:'convite/page.js'});
new vm.Script(merchant,{filename:'js/merchant.js'});
assert.doesNotMatch(index,/href="\.\/css\/network-pages\.css"/,'Editor CSS must not slow down the public homepage');
assert.match(growth,/new URL\('\/css\/network-pages\.css'/);
assert.match(growth,/new URL\('\/js\/network-pages-editor\.js'/);
assert.match(live,/copyDir\(path\.join\(ROOT,'convite'\),path\.join\(target,'convite'\)\)/);
assert.match(live,/\/convite\/\* \/convite\/index\.html 200/);
assert.match(publicBuild,/fs\.cpSync\(path\.join\(root,'convite'\)/);
assert.match(core,/new URLSearchParams\(location\.search\)\.get\('ref'\)/);
assert.match(html,/<meta name="robots" content="noindex,follow/);
assert.match(html,/<script defer src="\/convite\/page\.js"/);
assert.match(html,/<link rel="stylesheet" href="\/convite\/style\.css"/);
assert.match(html,/Conteúdo|Convite|convite/i);
assert.match(css,/@media\(max-width:790px\)/);
assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
assert.match(editorCss,/tamao-network-page-preview\.theme-gold/);
assert.match(editorCss,/tamao-network-page-preview\.theme-rose/);
assert.doesNotMatch(page,/fetch\(|supabase|\.rpc\(|localStorage|sessionStorage|payment|Pix|cashbackCents|accrual_enabled|payout/i);
const escape=x=>String(x??'').replace(/[&<>"']/g,c=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const start=growth.indexOf('const TAMAO_NETWORK_INVITE_TARGETS=');
const end=growth.indexOf('function referralUrl(){',start);
assert.ok(start>=0&&end>start);
const owner='FRIEND88',merchantCode='TMR'+'A'.repeat(24);
const storage=new Map();
const runtime={merchant:{merchantId:'store-1'},growthNetwork:{
 merchantId:'store-1',source:'merchant_network_v1_226',rewardEnabled:false,inviteCode:merchantCode
}};
const elements=new Map();
const ctx=vm.createContext({
 state:{user:{referralCode:owner}},
 merchantRuntime:runtime,
 localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
 document:{getElementById:id=>elements.get(id)||null},URL,URLSearchParams,console,
 navigator:{clipboard:{writeText:async()=>{}}},toast:()=>{},esc:escape
});
vm.runInContext(growth.slice(start,end),ctx);
vm.runInContext(editor+'\nthis.build=tamaoNetworkPageBuilder;this.code=tamaoNetworkPageVerifiedCode;this.url=tamaoNetworkPageLink;this.form=tamaoNetworkPageFormOptions;this.changed=tamaoNetworkPageChanged;',ctx);
assert.equal(ctx.code('customer'),owner);
assert.equal(ctx.code('merchant'),merchantCode);
for(const [a,hash] of Object.entries({customer:'home',merchant:'merchants',
 mobility:'mobility',professional:'advertise',rides:'rides',club:'club',sponsor:'sponsors'})){
 const url=new URL(ctx.url(owner,{audience:a,theme:'gold'}));
 assert.equal(url.origin,'https://tamao.com.br');
 assert.equal(url.pathname,'/convite/');
 assert.equal(url.searchParams.get('ref'),owner);
 assert.equal(url.searchParams.get('a'),a);
 assert.equal(url.searchParams.get('t'),'gold');
 assert.ok(page.includes(hash));
}
assert.equal(ctx.url('BAD-REF',{audience:'merchant'}),'','No untrusted referral code');
assert.equal(ctx.url(owner,{audience:'../../evil'}).includes('a=customer'),true);
assert.equal(ctx.url(owner,{audience:'merchant',name:'<img src=x onerror=1>'}).includes('n='),false);
assert.equal(ctx.url(owner,{message:'<script>alert(1)</script>'}).includes('m='),false);
let name='Ana & Cia';
let pretty=new URL(ctx.url(owner,{audience:'professional',theme:'rose',
 name,message:'Conheça as novidades da nossa região'}));
assert.equal(pretty.searchParams.get('n'),name);
assert.equal(pretty.searchParams.get('m'),'Conheça as novidades da nossa região');
const ownerEditor=ctx.build('customer');
for(const expected of ['Minha página de indicação','Compartilhar página','Ver minha página',
 'Visual da página','Black Gold','Elegance','Clean','Personalizar nome e mensagem',
 'O que deseja divulgar?']){
 assert.ok(ownerEditor.includes(expected),'Missing owner setup '+expected);
}
assert.ok(ownerEditor.includes('value="customer" selected'));
assert.ok(ctx.build('merchant').includes('value="merchant" selected'));
assert.ok(ownerEditor.includes('/convite/?ref=FRIEND88'));
assert.doesNotMatch(ownerEditor,/reserva fictícia|ganho garantido|100% de comissão/);
storage.set('tamao-network-look:'+owner,JSON.stringify({
 audience:'club',theme:'gold',name:'Carlos & Cia',message:'Convite pessoal'
}));
const restored=ctx.build('customer');
assert.ok(restored.includes('Carlos &amp; Cia'),'Stored custom presentation must be escaped');
assert.ok(restored.includes('Convite pessoal'));
assert.ok(restored.includes('value="club" selected'));
assert.ok(restored.includes('value="gold" checked'));
runtime.growthNetwork.inviteCode='BAD';
assert.equal(ctx.code('merchant'),'');
assert.equal(ctx.build('merchant'),'','Invalid merchant tokens have no invitation builder');
runtime.growthNetwork.inviteCode=merchantCode;
runtime.growthNetwork.rewardEnabled=true;
assert.equal(ctx.code('merchant'),'','Merchant financial-reward mode cannot be presented as approved');
runtime.growthNetwork.rewardEnabled=false;
runtime.growthNetwork.merchantId='store-2';
assert.equal(ctx.code('merchant'),'','Mismatched merchant cannot reuse another merchant invite');
runtime.growthNetwork.merchantId='store-1';

function makeNode(id){
 const el={id,textContent:'',href:'',hidden:true,attrs:{},children:[],firstChild:{textContent:'Conhecer o TAMÃO '},
  setAttribute(k,v){this.attrs[k]=v;},appendChild(x){this.children.push(x)},
  replaceChildren(...xs){this.children=xs}};
 return el;
}
function landing(search){
 const ids=Object.fromEntries(['title','message','primary','inviter','areas'].map(id=>[id,makeNode(id)]));
 const body={classList:{active:'theme-clean',replace(old,next){if(this.active===old)this.active=next}}};
 const doc={body,getElementById:id=>ids[id],createElement:tag=>makeNode(tag)};
 vm.runInNewContext(page,{location:{search},URLSearchParams,document:doc,console});
 return {ids,body};
}
let actual=landing('?ref='+owner+'&a=merchant&t=gold&n=Ana&m='+encodeURIComponent('Conheça nossa plataforma'));
assert.equal(actual.body.classList.active,'theme-gold');
assert.match(actual.ids.title.textContent,/empresa/);
assert.equal(actual.ids.message.textContent,'Conheça nossa plataforma');
assert.equal(actual.ids.inviter.textContent,'Convite compartilhado por Ana');
assert.equal(actual.ids.inviter.hidden,false);
let primary=new URL(actual.ids.primary.href);
assert.equal(primary.searchParams.get('ref'),owner);
assert.equal(primary.hash,'#merchants');
assert.equal(actual.ids.areas.children.length,7);
for(const node of actual.ids.areas.children){
 const route=new URL(node.href);
 assert.equal(route.origin,'https://tamao.com.br','Never open external redirect');
 assert.equal(route.searchParams.get('ref'),owner,'Preserve original referral for all areas');
}
actual=landing('?ref=FRIEND88&a=../../evil&t=javascript&n='+encodeURIComponent('<img src=x>'));
assert.equal(actual.body.classList.active,'theme-clean');
assert.equal(actual.ids.inviter.hidden,true);
assert.equal(new URL(actual.ids.primary.href).hash,'#home');
actual=landing('?ref=BAD-CODE&a=rides');
assert.equal(new URL(actual.ids.primary.href).searchParams.has('ref'),false,
 'Invalid code cannot be attributed to any party');
actual=landing('?ref='+merchantCode+'&a=professional&t=rose&m='+encodeURIComponent('<script>alert(1)</script>'));
assert.equal(new URL(actual.ids.primary.href).searchParams.get('ref'),merchantCode);
assert.equal(actual.ids.message.textContent.includes('<script>'),false);
assert.equal(actual.ids.body,undefined);
console.log('V1.1071 PASS — seven premium landing paths, generated branded links, personal names escaped, verified account and merchant codes, safe fallback, no API writes, first-touch ref retained.');
