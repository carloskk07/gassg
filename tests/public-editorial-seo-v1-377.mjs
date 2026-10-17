import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {writePublicLandingPages,PUBLIC_LANDING_SLUGS} from '../scripts/build-public-landing-pages.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'tamao-editorial-'));
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
try{
 assert.deepEqual(Array.from(PUBLIC_LANDING_SLUGS),['como-funciona','para-revendas','para-marcas','indicacoes']);
 const urls=writePublicLandingPages(root,{origin:'https://tamao.com.br',indexing:true});
 assert.equal(urls.length,4);
 const headings=new Set();
 const descriptions=new Set();
 for(const slug of PUBLIC_LANDING_SLUGS){
  const file=path.join(root,slug,'index.html');
  assert.ok(fs.existsSync(file),'missing static page: '+slug);
  const html=fs.readFileSync(file,'utf8');
  assert.match(html,/<!doctype html>/i);
  assert.match(html,/lang="pt-BR"/);
  assert.match(html,/<main id="conteudo">/);
  assert.match(html,/Pular para o conteúdo/);
  assert.match(html,/name="robots" content="index,follow,max-image-preview:large"/);
  assert.match(html,new RegExp('rel="canonical" href="https://tamao\\.com\\.br/'+slug+'/"'));
  assert.match(html,new RegExp('property="og:url" content="https://tamao\\.com\\.br/'+slug+'/"'));
  assert.match(html,/name="description" content="[^"]{70,200}"/);
  assert.match(html,/\/css\/landing-editorial\.css/);
  assert.match(html,/\/assets\/tamao-products-sprite\.webp/);
  assert.match(html,/<details><summary>/);
  assert.match(html,/href="\/#terms"/);
  assert.doesNotMatch(html,/<script|checkout\(|localStorage|supabase|oauth|password|access_token/i);
  assert.doesNotMatch(html,/resultados garantidos|vendas garantidas|preço mais baixo garantido|entrega garantida/i);
  const title=html.match(/<title>(.*?)<\/title>/)?.[1];
  const meta=html.match(/name="description" content="([^"]+)"/)?.[1];
  assert.ok(title&&meta); headings.add(title);descriptions.add(meta);
  assert.ok(!html.includes('href="https://parceiro.tamao.com.br"'),'do not jump directly to protected portal');
 }
 assert.equal(headings.size,4);assert.equal(descriptions.size,4);
 const merchant=fs.readFileSync(path.join(root,'para-revendas','index.html'),'utf8');
 assert.match(merchant,/Sem exclusividade/);
 assert.match(merchant,/não há mensalidade/);
 assert.match(merchant,/taxa do TAMÃO incide sobre pedidos concluídos/);
 assert.match(merchant,/href="\/\?entrada=revenda"/);
 const sponsor=fs.readFileSync(path.join(root,'para-marcas','index.html'),'utf8');
 assert.match(sponsor,/Nenhuma campanha é ativada automaticamente/);
 assert.match(sponsor,/href="\/\?entrada=marca"/);
 const network=fs.readFileSync(path.join(root,'indicacoes','index.html'),'utf8');
 assert.match(network,/não representa promessa de renda/);
 assert.match(network,/href="\/\?entrada=indicar"/);
 const buyer=fs.readFileSync(path.join(root,'como-funciona','index.html'),'utf8');
 assert.match(buyer,/A revenda precisa aceitar/);
 assert.match(buyer,/href="\/\#learn"/);
 const noindex=fs.mkdtempSync(path.join(os.tmpdir(),'tamao-editorial-preview-'));
 try{
  writePublicLandingPages(noindex,{origin:'https://tamao.com.br',indexing:false});
  assert.match(fs.readFileSync(path.join(noindex,'para-marcas','index.html'),'utf8'),/noindex,nofollow,noarchive,nosnippet/);
 }finally{fs.rmSync(noindex,{recursive:true,force:true})}
 const live=read('scripts/build-live-portals.mjs');
 const publicBuild=read('scripts/build-public-site.mjs');
 const core=read('js/core.js');
 const css=read('css/landing-editorial.css');
 const marketing=read('css/marketing-premium.css');
 assert.match(live,/if\(role==='customer'\)writePublicLandingPages/);
 assert.match(live,/PUBLIC_LANDING_SLUGS\.map/);
 assert.match(publicBuild,/writePublicLandingPages\(out,\{origin:publicOrigin,indexing:cloudflare&&indexing\}\)/);
 assert.match(publicBuild,/PUBLIC_LANDING_SLUGS\.map/);
 assert.match(core,/site-footer-editorial/);
 assert.match(core,/officialCustomerHost&&!globalThis\.merchantPortalRequested/);
 for(const token of ['.ed-hero-grid','.ed-product-gas','.ed-btn-primary','.ed-faq','@media(max-width:680px)','@media(prefers-reduced-motion:reduce)']){
  assert.ok(css.includes(token),'missing editorial CSS '+token);
 }
 for(const token of ['.marketing-hero .hero-grid','.home-discover-grid','.site-footer-editorial','@media(max-width:620px)']){
  assert.ok(marketing.includes(token),'missing SPA polish '+token);
 }
 console.log('TAMÃO V1.377 PASS — four independent SEO pages, trusted CTA handoff, mobile design, canonical/robots/OG and portal isolation.');
}finally{fs.rmSync(root,{recursive:true,force:true})}
