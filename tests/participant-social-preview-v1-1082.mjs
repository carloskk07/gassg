import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const src=read('functions/_shared/native-route.js');
const page=read('p/page.js'),owner=read('js/participant-native-owner.js');
const mark=read('p/index.html'),slug='barbearia-premium-0123456789ab';
const key='11111111-2222-4333-8444-555555555555/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.webp';
const record={source:'participant_native_page_v1_1072',slug,kind:'agenda',name:'Barbearia do João',
 tagline:'Corte & estilo <sem complicações>.',photos:[key]};
const html='<!doctype html><html><head><meta name="robots" content="noindex,follow">'+
 '<meta name="description" content="Genérico"><meta property="og:title" content="Página de participante">'+
 '<meta property="og:description" content="Genérico"><title>Página genérica</title></head><body>OK</body></html>';
assert.match(mark,/id="whatsapp-share"/);
assert.match(page,/const canonicalLink="https:\/\/tamao.com.br\/p\/"\+slug\+"\/"/);
assert.match(page,/whats\.href="https:\/\/wa.me\/\?text="\+encodeURIComponent/);
assert.match(page,/url:canonicalLink/);
assert.match(owner,/tamao-native-page-whatsapp/);
assert.match(owner,/encodeURIComponent\('Conheça minha página no TAMÃO: '\+url\)/);
assert.doesNotMatch(src,/SUPABASE_SERVICE_ROLE_KEY|\.(?:from|rpc)\(/);
let payload={...record},calls=[];
const env={ASSETS:{fetch:async()=>new Response(html,{status:200,headers:{
 'Content-Type':'text/html; charset=utf-8','ETag':'"old"',
 'Content-Length':String(Buffer.byteLength(html))}})}};
const compiled=src.replace('export async function nativePageRoute','async function nativePageRoute')+
 '\nthis.route=nativePageRoute;';
const ctx=vm.createContext({URL,Headers,Response,AbortController,setTimeout,clearTimeout,
 fetch:async(url,options)=>{calls.push({url:String(url),options});return new Response(JSON.stringify(payload),
  {status:200,headers:{'Content-Type':'application/json'}});}});
vm.runInContext(compiled,ctx);
const send=async(method='GET',domain='p')=>ctx.route({
 request:{method,url:'https://tamao.com.br/'+domain+'/'+slug+'/?private=keep-out'},env,
 next:()=>new Response('NEXT',{status:299})
},domain);
let response=await send(),body=await response.text();
assert.equal(response.status,200);
assert.equal(response.headers.get('x-robots-tag'),'index, follow');
assert.equal(response.headers.get('etag'),null);
assert.match(body,/Barbearia do João • TAMÃO/);
assert.match(body,/Corte &amp; estilo &lt;sem complicações&gt;/);
assert.match(body,/rel="canonical"/);
assert.match(body,/property="og:image"/);
assert.match(body,/tamao-discovery-photos/);
assert.match(body,new RegExp('https://tamao.com.br/p/'+slug+'/'));
assert.doesNotMatch(body,/private=keep-out/);
assert.equal(calls.length,1);
assert.equal(calls[0].url,'https://lgugwujpunhslavewffd.supabase.co/functions/v1/participant-pages');
assert.equal(calls[0].options.method,'POST');
assert.equal(JSON.parse(calls[0].options.body).action,'view');
assert.equal(calls[0].options.headers.Authorization,undefined);
const head=await send('HEAD');
assert.equal(head.status,200);assert.equal(await head.text(),'');
assert.equal(calls.length,1);
payload={...record,slug:'another-identity'};
response=await send();
assert.match(response.headers.get('x-robots-tag'),/noindex/);
assert.equal(await response.text(),html);
payload={...record,name:'<img src=x onerror=alert(1)>',
 tagline:'"><script>alert(1)</script>',photos:['https://evil.example/path']};
response=await send();body=await response.text();
assert.match(body,/&lt;img src=x onerror=alert\(1\)&gt;/);
assert.match(body,/&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
assert.doesNotMatch(body,/<script>alert\(1\)<\/script>/);
assert.doesNotMatch(body,/property="og:image"/);
assert.match(body,/name="twitter:card" content="summary"/);
response=await send('GET','agenda');
assert.match(response.headers.get('x-robots-tag'),/noindex/);
const denied=vm.createContext({URL,Headers,Response,AbortController,setTimeout,clearTimeout,
 fetch:async()=>new Response('NOT_FOUND',{status:404})});
vm.runInContext(compiled,denied);
const missing=await denied.route({request:{method:'GET',url:'https://tamao.com.br/p/'+slug+'/'},
 env,next:()=>new Response('NEXT',{status:299})},'p');
assert.match(missing.headers.get('x-robots-tag'),/noindex/);
console.log('V1.1082 PASS: approved-only social metadata, no XSS, no private referral URL, HEAD and Agenda preserved, WhatsApp CTA.');
