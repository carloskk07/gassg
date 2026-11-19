import assert from 'node:assert/strict';

// Wrangler Pages DEV: real Cloudflare routes, no orders or database writes.
const origin='http://127.0.0.1:4187';
const tests=[
 {path:'/p/sem-cadastro-de-teste-1076/?ref=ABCDE1',marker:'ESPAÇO DO PARTICIPANTE',kind:'participant'},
 {path:'/p/revenda-da-rua-123456789abc/?ref=ABCDE1',marker:'ESPAÇO DO PARTICIPANTE',kind:'participant'},
 {path:'/agenda/profissional-inexistente-1076/?ref=ABCDE1',marker:'TAMÃO Agenda',kind:'agenda'},
 {path:'/agenda/barbearia-do-joao/',marker:'TAMÃO Agenda',kind:'agenda'}
];
for(const t of tests){
 const response=await fetch(origin+t.path,{
  redirect:'manual',headers:{Accept:'text/html','Cache-Control':'no-cache'},
  signal:AbortSignal.timeout(9000)
 });
 const body=(await response.text()).slice(0,120000);
 assert.equal(response.status,200,t.path+' must load without a 301/302 redirect');
 assert.ok((response.headers.get('content-type')||'').includes('text/html'),'Must return native HTML');
 assert.ok(body.includes(t.marker),'Wrong HTML shell for '+t.kind);
 assert.ok(!/Pediu\? Tá na mão|id="tamao-initial-splash"/i.test(body),
  'Native link cannot render root TAMÃO storefront: '+t.path);
 assert.match(response.headers.get('content-security-policy')||'',/frame-ancestors 'none'/,
  'Cloudflare Function security policy must survive HTML serving');
 assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 assert.equal(response.headers.get('x-frame-options'),'DENY');
 console.log('Native Pages Function OK '+t.path);
}
for(const t of [
 {path:'/p/',type:'text/html',marker:'id="page-title"'},
 {path:'/p/page.js',type:'javascript',marker:'participant_native_page_v1_1072'},
 {path:'/p/style.css',type:'text/css',marker:'.hero'},
 {path:'/agenda/exemplo/',type:'text/html',marker:'Barbearia'},
 {path:'/js/agenda.js',type:'javascript',marker:'agenda'},
 {path:'/',type:'text/html',marker:'TAMÃO'}
]){
 const response=await fetch(origin+t.path,{redirect:'manual',signal:AbortSignal.timeout(9000)});
 const body=(await response.text()).slice(0,300000);
 assert.equal(response.status,200,'Static asset or root changed: '+t.path);
 const contentType=response.headers.get('content-type')||'';
 assert.ok(contentType.includes(t.type),'Wrong static content type '+t.path+': '+contentType);
 assert.ok(body.includes(t.marker),'Wrong unchanged static asset at '+t.path);
 console.log('Static still works '+t.path);
}
console.log('V1.1076 Wrangler PASS — permanent participant and Agenda pages preserve path/ref without redirects; assets and root unaffected.');
