import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const dir=path.resolve(ROOT,'../supabase/email-templates');
const config=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
const templates=config.templates;
assert.equal(templates.length,13,'Cobrir os 6 Auth + 7 alertas oficiais, sem tipos redundantes');
const files=fs.readdirSync(dir).filter(x=>x.endsWith('.html')).sort();
assert.deepEqual(files,templates.map(x=>x.file).sort(),'1 arquivo por modelo sem sobras');
const ids=new Set(),subjects=new Set();
for(const t of templates){
  assert.ok(!ids.has(t.slug),'Slug duplicado: '+t.slug);
  ids.add(t.slug);
  assert.match(t.subject,/^TAMÃO \| /);
  assert.doesNotMatch(t.subject,/Your |password|email address/i);
  assert.ok(!subjects.has(t.subject),'Assunto duplicado: '+t.subject);
  subjects.add(t.subject);
  const html=fs.readFileSync(path.join(dir,t.file),'utf8');
  assert.match(html,/lang="pt-BR"/);
  assert.match(html,/<table role="presentation"/);
  assert.match(html,/#087a4a/);
  assert.match(html,/Pediu\? Tá na mão\./);
  assert.doesNotMatch(html,/<script\b|<form\b|<img\b|javascript:|http:\/\/|https:\/\/|onerror=|onclick=|data:image/i);
  assert.doesNotMatch(html,/(Your sign-in link|Confirm email address|Reset password|You've been invited)/i);
  const variables=[...html.matchAll(/{{\s*\.([A-Za-z]+)\s*}}/g)].map(x=>x[1]);
  assert.ok(variables.every(v=>['ConfirmationURL','Token','NewEmail','OldEmail','Provider','FactorType'].includes(v)),
    'Only documented Go template variables: '+t.slug);
  if(t.requiredVariable){
    const variable=RegExp('\\{\\{\\s*\\.'+t.requiredVariable.match(/[A-Za-z]+$/)[0]+'\\s*\\}\\}','g');
    assert.equal((html.match(variable)||[]).length,1,'Exactly one intended variable: '+t.slug);
  }
  if(t.type==='auth'&&t.slug!=='reauthentication'){
    assert.match(html,/<a href="{{ \.ConfirmationURL }}"/,'Auth CTA must retain Supabase-generated link');
    assert.equal((html.match(/{{ \.ConfirmationURL }}/g)||[]).length,1);
  }else{
    assert.doesNotMatch(html,/<a\b/,'No unverified external navigation on security alerts or OTP');
    assert.doesNotMatch(html,/\.ConfirmationURL/,'No confirmation URL on OTP or security notifications');
  }
  if(t.type==='notification')assert.doesNotMatch(html,/{{ \.Token }}/);
}
console.log('TAMÃO Auth email brand pack PASS: 13 existing Supabase template types, subjects in pt-BR, secure single-use links, no tracking or new services.');
