import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {DISCOVERY_LANDING_SLUGS,writeDiscoveryLandingPages} from '../scripts/build-discovery-landings.mjs';

const slugs=['profissionais','ar/profesionales','caronas','ar/viajes-compartidos','hospedagens','ar/alojamientos'];
assert.deepEqual(Array.from(DISCOVERY_LANDING_SLUGS),slugs,'exactly one informational route per locale and vertical');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'tamao-discovery-seo-'));
try{
 const out=writeDiscoveryLandingPages(root,{origin:'https://tamao.com.br',indexing:true});
 assert.deepEqual(out,slugs.map(s=>'/'+s+'/'));
 const canonical=new Set();
 for(let i=0;i<slugs.length;i++){
  const slug=slugs[i],lang=slug.startsWith('ar/')?'es-AR':'pt-BR';
  const html=fs.readFileSync(path.join(root,slug,'index.html'),'utf8');
  assert.match(html,new RegExp('<html lang="'+lang+'">'));
  assert.match(html,/meta name="robots" content="index,follow,max-image-preview:large"/);
  assert.match(html,/<main id="conteudo">/);
  assert.match(html,/<a class="ed-skip"/);
  assert.match(html,/href="\/css\/landing-editorial\.css"/);
  assert.match(html,/rel="alternate" hreflang="pt-BR"/);
  assert.match(html,/rel="alternate" hreflang="es-AR"/);
  assert.match(html,/rel="alternate" hreflang="x-default"/);
  assert.match(html,/property="og:url"/);
  assert.match(html,/class="ed-faq-items"/);
  assert.match(html,/class="ed-proof-grid"/);
  assert.doesNotMatch(html,/checkout\(|create_order|supabase|fake results|reserva confirmada|pagamento recebido|disponibilidade garantida|preços garantidos/i);
  assert.doesNotMatch(html,/<script\b|<form\b|<input\b|data-private|secret_token/i);
  const self='https://tamao.com.br/'+slug+'/';
  assert.ok(html.includes('<link rel="canonical" href="'+self+'">'));
  assert.ok(html.includes('<meta property="og:url" content="'+self+'">'));
  assert.ok(!canonical.has(self),'duplicate canonical');
  canonical.add(self);
  const k=i%2===0?i+1:i-1,other='https://tamao.com.br/'+slugs[k]+'/';
  assert.ok(html.includes('href="'+other+'"'),'reciprocal language pair');
  const vertical=i<2?'professionals':i<4?'rides':'stays';
  assert.ok(html.includes('href="https://tamao.com.br/#'+vertical+'"'),'uses existing discovery flow');
  assert.ok(html.includes('href="https://tamao.com.br/#advertise"'),'uses existing advertiser flow');
  assert.ok(!html.includes('href="https://parceiro.tamao.com.br"'),'no protected portal shortcut');
  if(lang==='es-AR')assert.match(html,/portugués|directamente|anunciante/);
 }
 const isolated=fs.mkdtempSync(path.join(os.tmpdir(),'tamao-seo-preview-'));
 try{
  writeDiscoveryLandingPages(isolated,{origin:'https://tamao.com.br',indexing:false});
  const html=fs.readFileSync(path.join(isolated,'ar/alojamientos/index.html'),'utf8');
  assert.match(html,/noindex,nofollow,noarchive,nosnippet/);
 }finally{fs.rmSync(isolated,{recursive:true,force:true})}
 const live=fs.readFileSync(new URL('../scripts/build-live-portals.mjs',import.meta.url),'utf8');
 const build=fs.readFileSync(new URL('../scripts/build-public-site.mjs',import.meta.url),'utf8');
 assert.ok(live.includes("if(role==='customer')writeDiscoveryLandingPages("),'only public role emits pages');
 assert.ok(live.includes('[...PUBLIC_LANDING_SLUGS,...DISCOVERY_LANDING_SLUGS]'),'live sitemap must include six URLs');
 assert.ok(build.includes("writeDiscoveryLandingPages(out,{origin:publicOrigin,indexing:cloudflare&&indexing})"));
 assert.ok(build.includes('[...PUBLIC_LANDING_SLUGS,...DISCOVERY_LANDING_SLUGS]'));
 assert.throws(()=>writeDiscoveryLandingPages(root,{origin:'http://tamao.com.br',indexing:true}),/invalid public origin/);
 console.log('PASS discovery SEO: six static PT/es-AR routes, hreflang, canonical/OG, sitemap, isolation and no fictional inventory');
}finally{fs.rmSync(root,{recursive:true,force:true})}
