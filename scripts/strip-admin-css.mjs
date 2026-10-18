import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// A CSS selector rooted at an admin-specific class/id cannot match an
// ordinary customer/merchant page, unless that class is intentionally shared.
// We do not remove mixed selectors, nested component selectors, keyframes,
// variables, media blocks or any admin CSS in the admin portal.
const ROOT_ADMIN=/^[.#](admin-[a-z0-9_-]+)(?=$|[\s.#:[>+~])/i;
const PROTECTED_ADMIN_SCRIPTS=new Set(['admin-acquisition.js','admin.js','admin-activations.js']);

export function publicAdminClassReferences(dir){
  const root=typeof dir==='string'?dir:fileURLToPath(dir);
  const tokens=new Set();
  for(const file of fs.readdirSync(root)){
    if(!file.endsWith('.js')||PROTECTED_ADMIN_SCRIPTS.has(file))continue;
    const source=fs.readFileSync(path.join(root,file),'utf8');
    for(const token of source.matchAll(/\badmin-[a-z0-9_-]+\b/gi))tokens.add(token[0].toLowerCase());
  }
  return tokens;
}

export function stripAdminOnlyCss(source,{sharedAdminClasses=new Set()}={}){
  if(typeof source!=='string')throw new TypeError('CSS must be a string');
  const shared=new Set([...sharedAdminClasses].map(s=>String(s).toLowerCase()));
  const frames=[],ranges=[];
  let blockStart=0,quote=null,inComment=false;
  for(let i=0;i<source.length;i++){
    const ch=source[i],next=source[i+1];
    if(inComment){if(ch==='*'&&next==='/'){inComment=false;i++;}continue;}
    if(quote){if(ch===quote&&source[i-1]!=='\\')quote=null;continue;}
    if(ch==='/'&&next==='*'){inComment=true;i++;continue;}
    if(ch==="'"||ch==='"'){quote=ch;continue;}
    if(ch==='{'){
      frames.push({header:source.slice(blockStart,i).trim(),open:i,start:blockStart});
      blockStart=i+1;
      continue;
    }
    if(ch!=='}')continue;
    const node=frames.pop();
    if(!node)throw new Error('Unbalanced CSS close');
    const atRules=frames.every(frame=>frame.header.startsWith('@'));
    const inKeyframes=frames.some(frame=>/@(?:-[a-z]+-)?keyframes\b/i.test(frame.header));
    const body=source.slice(node.open+1,i);
    // Conservative: a simple leaf rule must be unconditionally admin-rooted.
    if(atRules&&!inKeyframes&&!node.header.startsWith('@')&&!body.includes('{')){
      const selectors=node.header.split(',').map(s=>s.trim()).filter(Boolean);
      const roots=selectors.map(s=>ROOT_ADMIN.exec(s)?.[1]?.toLowerCase()||null);
      if(roots.length&&roots.every(root=>root&&!shared.has(root))){
        ranges.push({start:node.start,end:i+1});
      }
    }
    blockStart=i+1;
  }
  if(frames.length||quote||inComment)throw new Error('Unbalanced CSS source');
  let css=source;
  for(const range of ranges.reverse()){
    css=css.slice(0,range.start)+css.slice(range.end);
  }
  return {css,removedRules:ranges.length,removedBytes:source.length-css.length};
}
