import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const core=read('js/core.js'),css=read('css/base.css'),hat=read('icons/santa-hat.svg');
new vm.Script(core,{filename:'js/core.js'});
const shellStart=core.indexOf('function shell(content){');
const start=core.indexOf('function tamaoSeasonalWordmark(',shellStart);
const end=core.indexOf('\n  const r=route();',start);
assert.ok(shellStart>0&&start>shellStart&&end>start,
 'Seasonal helper must be local to independently executable shared shell');
const ctx=vm.createContext({Date});
vm.runInContext(core.slice(start,end)+'\nthis.brand=tamaoSeasonalWordmark;',ctx);
const wordmark=(month,day)=>ctx.brand(new Date(2026,month-1,day,12));
for(const [month,day] of [[11,15],[11,16],[12,24],[12,25],[12,31],[1,1],[1,6]]){
 const mark=wordmark(month,day);
 assert.match(mark,/^TAMÃ<span class="tamao-santa-o"/,'Only final O gets decorative anchor');
 assert.match(mark,/>O<img src="\.\/icons\/santa-hat\.svg"/,'The hat belongs directly after O');
 assert.match(mark,/left:1px;bottom:calc\(100% - 5px\)/,
   'Only positive left offset, not above Ã');
 assert.match(mark,/aria-hidden="true".*pointer-events:none/,'Decoration must be inert');
}
for(const [month,day] of [[11,14],[10,31],[1,7],[2,1],[7,20]])
 assert.equal(wordmark(month,day),'TAMÃO','Original logo outside Christmas season '+month+'/'+day);
assert.match(core,/<span class="brand-name">\$\{tamaoSeasonalWordmark\(\)\}<\/span>/,
 'All three portal headers reuse the local seasonal wordmark');
assert.equal((core.match(/class="brand-name"/g)||[]).length,1,'One shared header');
assert.doesNotMatch(css,/tamao-santa-o/,'Do not inflate strictly budgeted startup CSS');
assert.match(hat,/<svg[^>]+viewBox="0 0 48 45"/);
assert.doesNotMatch(hat,/<(?:script|foreignObject|image|use)\b|\b(?:href|xlink:href)\s*=/i,
 'Self-contained static vector');
console.log('V1.1036 PASS — hat exactly on O, three portals, safe SVG, zero startup CSS growth, Jan 7 rollback.');
