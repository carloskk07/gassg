import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT=path.resolve(new URL('..',import.meta.url).pathname);
const read=name=>fs.readFileSync(path.join(ROOT,name),'utf8');
const html=read('index.html');
const sw=read('sw.js');

// All classic scripts and global CSS used by the shell must have exactly
// one source and be eligible for the same offline snapshot. This prevents a
// freshly deployed shell from silently mixing old and new frontend modules.
const shellAssets=[...html.matchAll(/(?:src|href)="(\.\/(?:js|css)\/[^"#?]+)"/g)].map(m=>m[1]);
assert.equal(new Set(shellAssets).size,shellAssets.length,'index.html carrega JS/CSS duplicado');

const assetsBlock=sw.match(/const ASSETS=\[([\s\S]*?)\];/);
assert.ok(assetsBlock,'lista ASSETS do service worker não encontrada');
const cachedAssets=[...assetsBlock[1].matchAll(/'(\.\/[^']+)'/g)].map(m=>m[1]);
assert.equal(new Set(cachedAssets).size,cachedAssets.length,'lista do cache contém asset duplicado');
const missing=shellAssets.filter(item=>!cachedAssets.includes(item));
assert.deepEqual(missing,[],'JS/CSS carregado pelo index deve constar no snapshot do service worker');
for(const item of shellAssets) assert.ok(fs.existsSync(path.join(ROOT,item)),'asset não encontrado: '+item);

// The main CSS and the late-loaded premium CSS currently contain some
// historical competing declarations. Record existing debt but reject *new*
// cross-file conflicts: new styles should be canonical or media scoped in
// their own stylesheet, not another override appended over older releases.
function declarations(css){
  const source=css.replace(/\/\*[\s\S]*?\*\//g,'');
  const entries=new Map();
  for(const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)){
    const selector=match[1].trim();
    if(selector.startsWith('@')||selector.length>300)continue;
    const props={};
    for(const fragment of match[2].split(';')){
      const colon=fragment.indexOf(':');
      if(colon<0)continue;
      const key=fragment.slice(0,colon).trim();
      const value=fragment.slice(colon+1).trim();
      if(/^[a-z-]+$/.test(key)&&value)props[key]=value;
    }
    for(const name of selector.split(',').map(item=>item.trim()).filter(Boolean)){
      if(!entries.has(name))entries.set(name,[]);
      entries.get(name).push(props);
    }
  }
  return entries;
}
const components=declarations(read('css/components.css'));
const premium=declarations(read('css/marketing-premium.css'));
const conflicts=[];
for(const [selector,rules] of components){
  const after=premium.get(selector);
  if(!after)continue;
  const first=Object.assign({},...rules);
  const second=Object.assign({},...after);
  if(Object.keys(second).some(key=>key in first&&first[key]!==second[key]))conflicts.push(selector);
}
// Existing cross-file overrides identified during the 2026-10-17 inventory.
// Removing an entry is welcome; adding another is a regression.
const baseline=new Set([
  '.home-discover-tile',
  '.marketing-hero .hero-grid',
  '.marketing-hero .purchase-starter',
  '.marketing-hero .hero-lead',
  '.home-discover-art',
  '.home-discover-heading h2',
  '.marketing-hero .starter-cta',
  '.home-discover-heading',
  '.marketing-hero h1',
  '.home-discover',
  '.home-discover-tile strong',
  '.home-discover-action',
  '.tamao-network-hero',
  '.merchant-landing-premium',
  '.home-editorial-visual',
  '.home-discover-tile:focus-visible',
  '.topbar-inner',
  '.home-discover-heading p',
  '.marketing-hero h1::after'
]);
const newConflicts=conflicts.filter(item=>!baseline.has(item));
assert.deepEqual(newConflicts,[],'Novas sobreposições CSS entre components e marketing-premium: '+newConflicts.join(', '));

console.log('Assets da página e do cache em sincronia: '+shellAssets.length);
console.log('Sobreposições CSS históricas identificadas: '+conflicts.length+'; novas: '+newConflicts.length);
