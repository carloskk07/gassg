import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../js/customer.js',import.meta.url),'utf8');
const groupStart=source.indexOf('function homeProductGroup(');
const groupEnd=source.indexOf('function homeFilterProducts(',groupStart);
const balancedStart=source.indexOf('function homeBalancedHighlights(');
const balancedEnd=source.indexOf('function home(){',balancedStart);
assert.ok(groupStart>=0&&groupEnd>groupStart&&balancedStart>groupEnd&&balancedEnd>balancedStart);
const context=vm.createContext({});
vm.runInContext(source.slice(groupStart,groupEnd)+source.slice(balancedStart,balancedEnd)+
 '\nthis.balance=homeBalancedHighlights;',context);
const items=['CHARCOAL10','WATER20','CHARCOAL2','CHARCOAL3','WOOD_SACK','ICE_BLOCK',
 'P13','WOOD100','OTHER_A','CHARCOAL4','ICE2'].map(code=>[code,{name:code}]);
const ranked=Array.from(context.balance(items),x=>x[0]);
assert.deepEqual(ranked.slice(0,6),['CHARCOAL10','WATER20','WOOD_SACK','ICE_BLOCK','P13','OTHER_A'],
 'First six highlights must represent six distinct available families');
assert.equal(ranked.length,items.length);
assert.deepEqual(new Set(ranked),new Set(items.map(x=>x[0])));
assert.deepEqual(ranked.filter(code=>code.startsWith('CHARCOAL')),
 ['CHARCOAL10','CHARCOAL2','CHARCOAL3','CHARCOAL4'],
 'Within each family the existing product sort must remain');
const single=Array.from(context.balance([['CHARCOAL2',{}],['CHARCOAL4',{}]]),x=>x[0]);
assert.deepEqual(single,['CHARCOAL2','CHARCOAL4'],
 'When just one family exists, do not add imaginary categories');
const empty=context.balance([]);assert.equal(empty.length,0);
assert.match(source,/homeBalancedHighlights\(homeProductEntries/);
assert.match(source,/const show=matched&&\(chosen!=='all'\|\|visible<6\)/,
 'Category filters must still show every matching package, not just highlights');
assert.match(source,/onClick|onclick="homeChooseProduct\('/);
new vm.Script(source);
console.log('PASS: diverse public highlights, stable product selection and complete category filters');
