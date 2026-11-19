import assert from 'node:assert/strict';
// HTTP from GitHub runner: bypasses user PWA, service worker and browser cache.
// Test unknown but valid slugs; must display the branded "not found" page,
// never the generic TAMÃO storefront or a misleading real participant.
const origin=process.env.TAMAO_DEEP_LINK_ORIGIN||'https://tamao.com.br';
assert.equal(origin,'https://tamao.com.br');
const paths=[
 {path:'/p/',expected:'participant'},
 {path:'/p/sem-cadastro-de-teste-1074/',expected:'participant'},
 {path:'/p/sem-cadastro-de-teste-1074/?ref=ABCDE1',expected:'participant',expectedRef:'ABCDE1'},
 {path:'/agenda/',expected:'agenda'},
 {path:'/agenda/profissional-inexistente-1074/',expected:'agenda'},
 {path:'/agenda/profissional-inexistente-1074/?ref=ABCDE1',expected:'agenda',expectedRef:'ABCDE1'},
 {path:'/convite/',expected:'convite'},
 {path:'/convite/link-de-teste-1074/',expected:'convite'}
];
const signatures={
 participant:/ESPAÇO DO PARTICIPANTE|page-title.*tamao/i,
 agenda:/TAMÃO Agenda|agenda-page/i,
 convite:/CONVITE PESSOAL|TAMÃO.*convite/i
};
const rows=[];
for(const sample of paths){
 let status=null,finalUrl='',text='',contentType='';
 try{
  const result=await fetch(origin+sample.path,{
   redirect:'follow',headers:{'Accept':'text/html','Cache-Control':'no-cache'},
   signal:AbortSignal.timeout(20000)
  });
  status=result.status;finalUrl=result.url;
  contentType=result.headers.get('content-type')||'';
  text=(await result.text()).slice(0,150000);
 }catch(e){
  rows.push({path:sample.path,error:String(e?.message||e)});
  continue;
 }
 rows.push({path:sample.path,status,finalUrl,contentType,
  expectedRef:sample.expectedRef||'',
  finalRef:new URL(finalUrl).searchParams.get('ref')||'',
  expected:sample.expected,
  signatureMatches:signatures[sample.expected].test(text),
  rootStorefront:/Pediu\? Tá na mão|id="tamao-initial-splash"|Carregando preços, serviços/i.test(text),
  excerpt:text.replace(/\s+/g,' ').slice(0,150)});
}
console.log('Official raw-HTTP deep-link evidence:\n'+JSON.stringify(rows,null,2));
if(process.env.TAMAO_REQUIRE_DEEP_LINKS==='1'){
 for(const entry of rows){
  assert.equal(entry.status,200,'HTTP status '+entry.path);
  assert.equal(entry.signatureMatches,true,'Correct app HTML must be served at '+entry.path);
  assert.equal(entry.rootStorefront,false,'Root storefront wrongly served at '+entry.path);
  if(entry.expectedRef)assert.equal(entry.finalRef,entry.expectedRef,
    'Native share/booking link lost original first-touch referral parameter at '+entry.path);
 }
}
