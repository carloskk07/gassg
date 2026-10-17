import assert from 'node:assert/strict';
import fs from 'node:fs';

// Cross-file source-of-truth gate. The premium stylesheet loads *after*
// components.css. An unconditional declaration for the exact same selector
// and property in the earlier stylesheet is dead code unless !important
// changes cascade precedence. Keep responsive/media rules untouched.
function globalRules(source){
  const rules=[];
  let depth=0,start=0,chunk=0,quote=null,comment=false,head='';
  for(let i=0;i<source.length;i++){
    const ch=source[i],next=source[i+1];
    if(comment){
      if(ch==='*'&&next==='/'){comment=false;i++}
      continue;
    }
    if(!quote&&ch==='/'&&next==='*'){comment=true;i++;continue}
    if(quote){
      if(ch===quote&&source[i-1]!=='\\')quote=null;
      continue;
    }
    if(ch==="'"||ch==='"'){quote=ch;continue}
    if(ch==='{'){
      if(depth===0){head=source.slice(chunk,i).trim();start=i+1}
      depth++;
      chunk=i+1;
    }else if(ch==='}'){
      if(depth===1&&!head.startsWith('@'))rules.push({selector:head,body:source.slice(start,i)});
      depth--;
      assert.ok(depth>=0,'Fechamento CSS inesperado');
      chunk=i+1;
    }
  }
  assert.equal(depth,0,'Blocos CSS não fechados');
  return rules;
}
function declarations(body){
  return Object.fromEntries(body.split(';').map(part=>{
    const colon=part.indexOf(':');
    return colon<0?null:[part.slice(0,colon).trim(),part.slice(colon+1).trim()];
  }).filter(pair=>pair&&/^[a-z-]+$/.test(pair[0])));
}
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const later=new Map();
for(const rule of globalRules(read('css/marketing-premium.css'))){
  for(const selector of rule.selector.split(',').map(s=>s.trim()).filter(Boolean)){
    later.set(selector,{...later.get(selector),...declarations(rule.body)});
  }
}
const dead=[];
for(const rule of globalRules(read('css/components.css'))){
  if(rule.selector.includes(','))continue; // grouped selectors need manual review
  const override=later.get(rule.selector);
  if(!override)continue;
  for(const [property,value] of Object.entries(declarations(rule.body))){
    if(Object.hasOwn(override,property)&&!value.includes('!important')&&!override[property].includes('!important')){
      dead.push(rule.selector+' { '+property+' }');
    }
  }
}
assert.deepEqual(dead,[],'Declarações CSS globais encobertas por marketing-premium: '+dead.join(', '));
console.log('CSS global sem declarações mortas sobrescritas pela segunda folha.');
