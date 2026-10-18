import assert from 'node:assert/strict';
import fs from 'node:fs';

// Same selector + identical at-rule scope + later complete property override:
// the earlier block is dead cascade. Prevent legacy visual versions from
// accumulating in the same stylesheet while respecting responsive rules,
// distinct @media/@supports contexts and !important precedence.
function deadRules(source){
  const stack=[],rules=[];let chunk=0,quote=null,inComment=false;
  for(let i=0;i<source.length;i++){
    const char=source[i],next=source[i+1];
    if(inComment){if(char==='*'&&next==='/'){inComment=false;i++;}continue;}
    if(!quote&&char==='/'&&next==='*'){inComment=true;i++;continue;}
    if(quote){if(char===quote&&source[i-1]!=='\\')quote=null;continue;}
    if(char==="'"||char==='"'){quote=char;continue;}
    if(char==='{'){
      stack.push({head:source.slice(chunk,i).trim(),start:i});
      chunk=i+1;
      continue;
    }
    if(char!=='}')continue;
    const current=stack.pop();
    assert.ok(current,'Unexpected closing CSS brace');
    const body=source.slice(current.start+1,i);
    if(!body.includes('{')&&!current.head.startsWith('@')&&current.head.length<=300){
      const properties=new Map();
      for(const fragment of body.split(';')){
        const colon=fragment.indexOf(':');
        if(colon<0)continue;
        const name=fragment.slice(0,colon).trim(),value=fragment.slice(colon+1).trim();
        if(/^[a-z-]+$/.test(name)&&value)properties.set(name,value);
      }
      if(properties.size)rules.push({
        selector:current.head,
        scope:stack.filter(item=>item.head.startsWith('@')).map(item=>item.head).join('\\n'),
        properties
      });
    }
    chunk=i+1;
  }
  assert.equal(stack.length,0,'Unclosed CSS block');
  const seen=new Map(),dead=new Set();
  for(const rule of rules){
    if(rule.scope.includes('@keyframes'))continue;
    const key=rule.scope+'\\n--\\n'+rule.selector;
    for(const older of seen.get(key)||[]){
      if([...older.properties].every(([name,value])=>
        rule.properties.has(name)&&(!value.includes('!important')||rule.properties.get(name).includes('!important')))){
        dead.add(rule.selector+' ['+rule.scope+']');
      }
    }
    if(!seen.has(key))seen.set(key,[]);
    seen.get(key).push(rule);
  }
  return [...dead].sort();
}

for(const path of ['css/components.css','css/marketing-premium.css']){
  const data=fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
  assert.deepEqual(deadRules(data),[],'CSS legacy override blocks must be consolidated in '+path);
}
console.log('CSS internal cascade guard: no fully shadowed duplicate selector blocks.');
