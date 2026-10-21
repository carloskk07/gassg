import assert from 'node:assert/strict';
import fs from 'node:fs';
import {compactReleasedCssComments} from '../scripts/build-live-portals.mjs';
const original=fs.readFileSync(new URL('../css/components.css',import.meta.url),'utf8');
const optimized=compactReleasedCssComments(original);
assert.ok(original.includes('/* TAMÃO V1.134 — Admin Command Center */'),'Keep original audit markers');
assert.ok(optimized.length<original.length-5000,'Production CSS must reduce startup size');
assert.doesNotMatch(optimized,/\/\* TAMÃO V1.134/);
assert.equal(compactReleasedCssComments('a{content:"/*keep*/";}/*discard*/b{display:grid}'),
 'a{content:"/*keep*/";}b{display:grid}');
assert.equal(compactReleasedCssComments('/*!license*/a{display:block}'), '/*!license*/a{display:block}');
assert.equal(compactReleasedCssComments('a{background:url("/*not-comment*/")}'),'a{background:url("/*not-comment*/")}');
assert.throws(()=>compactReleasedCssComments('a{}/*'),/Unclosed stylesheet comment/);
console.log('PASS production-only CSS comment optimization, source preserved and quoted values unchanged');
