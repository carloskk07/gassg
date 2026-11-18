import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const source=read('js/agenda.js');
const migration=read('supabase/migrations/20261118133000_agenda_global_search_v1_1067.sql');
const css=read('css/agenda.css');
const ci=read('.github/workflows/isolated-supabase-integration.yml');
const audit=read('.github/workflows/audit.yml');
const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
const pendingTimers=[];
const elements={
 cards:{innerHTML:'',hidden:false},
 result:{textContent:''},
 empty:{textContent:'',hidden:false},
 pagination:{innerHTML:''},
 search:{value:'',focusCalls:0,focus(){this.focusCalls++;}}
};
const panel={
 querySelector(selector){return ({
  '#agenda-directory-cards':elements.cards,
  '#agenda-directory-result':elements.result,
  '#agenda-directory-empty':elements.empty,
  '#agenda-directory-pagination':elements.pagination
 })[selector]||null;},
 querySelectorAll(selector){
  assert.equal(selector,'[data-agenda-directory-card]');
  return Object.values(legacyCards);
 }
};
const legacyCards={};
const ctx=vm.createContext({
 location:{pathname:'/agenda/',search:'',hash:'',origin:'https://tamao.com.br'},
 URL,URLSearchParams,render(){},route:()=> 'agenda',shell:html=>html,
 CHAMA_BACKEND:{url:'https://example.supabase.co',publishableKey:'public'},
 BRL:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),
 esc:escape,crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'},
 document:{getElementById:id=>({
  'agenda-directory':panel,
  'agenda-directory-search':elements.search
 })[id]||null},
 setTimeout(fn){pendingTimers.push(fn);return pendingTimers.length;},
 clearTimeout(){pendingTimers.length=0;}
});
vm.runInContext(source,ctx,{filename:'js/agenda.js'});
const state=vm.runInContext('agendaRuntime',ctx);
const original=Array.from({length:31},(_,i)=>({
 slug:'barbearia-esteio-'+String(i+1).padStart(2,'0'),
 title:'Barbearia Esteio '+String(i+1).padStart(2,'0'),
 city:i%2?'Porto Alegre':'São Gabriel',
 about:i===0?'Cortes e maquiagem':'Cortes e barba',
 photo_path:null
}));
let requested=[];
state.client={
 async rpc(name,args){
  requested.push({name,...args});
  assert.equal(name,'agenda_search_directory');
  assert.ok(args.p_limit<=24);
  const matches=original.filter(row=>ctx.agendaDirectoryMatches(row,args.p_query));
  const rows=matches.slice(args.p_offset,args.p_offset+args.p_limit);
  return {data:rows.map(row=>({...row,total_count:String(matches.length)})),error:null};
 }
};
state.phase='ready';
await ctx.agendaRefreshDirectory();
assert.equal(state.directoryMode,'server');
assert.equal(state.directory.length,12);
assert.equal(state.directoryTotal,31);
assert.equal(requested[0].p_offset,0);
assert.equal(requested[0].p_limit,12);
assert.match(elements.result.textContent,/Mostrando 12 de 31/);
assert.match(elements.pagination.innerHTML,/Ver mais profissionais/);
assert.equal(elements.cards.hidden,false);
assert.equal((elements.cards.innerHTML.match(/data-agenda-directory-card/g)||[]).length,12);
assert.doesNotMatch(elements.cards.innerHTML,/owner_id|customer_phone|whatsapp_e164/);

await ctx.agendaRefreshDirectory({append:true});
assert.equal(state.directory.length,24);
assert.equal(requested.at(-1).p_offset,12);
assert.match(elements.result.textContent,/Mostrando 24 de 31/);
await ctx.agendaRefreshDirectory({append:true});
assert.equal(state.directory.length,31);
assert.equal(new Set(state.directory.map(x=>x.slug)).size,31);
assert.equal(requested.at(-1).p_offset,24);
assert.doesNotMatch(elements.pagination.innerHTML,/Ver mais profissionais/);

ctx.agendaDirectoryFilter('MAQUIAGEM');
assert.equal(state.directoryLoading,true);
assert.equal(elements.cards.hidden,true,'Old results must hide during a different search');
assert.match(elements.result.textContent,/Buscando profissionais/);
assert.equal(pendingTimers.length,1,'The input must be debounced');
await ctx.agendaRefreshDirectory(); // clears timer, identical to scheduled call
assert.equal(state.directoryQuery,'MAQUIAGEM');
assert.equal(state.directory.length,1);
assert.equal(state.directoryTotal,1);
assert.equal(requested.at(-1).p_offset,0,'Changing query restarts page one');
assert.match(elements.result.textContent,/1 profissional encontrado/);
assert.equal(elements.cards.hidden,false);
assert.equal(elements.search.focusCalls,0,'The active input must not be replaced or refocused');
ctx.agendaDirectoryClearSearch();
assert.equal(elements.search.focusCalls,1);
assert.equal(state.directoryQuery,'');
await ctx.agendaRefreshDirectory();
assert.equal(state.directoryTotal,31);

// Stale in-flight remote results must never replace a newer query.
let release;
state.client={
 rpc(){
  return new Promise(resolve=>{release=resolve;});
 }
};
const stale=ctx.agendaRefreshDirectory();
ctx.agendaDirectoryFilter('Barbearia 01');
release({data:[{...original[2],total_count:'1'}],error:null});
await stale;
assert.equal(state.directoryQuery,'Barbearia 01');
assert.equal(state.directoryTotal,31,'Stale remote responses cannot overwrite last settled query');
assert.equal(state.directoryLoading,true);
state.client={rpc:async(name,args)=>({
 data:[{...original[0],total_count:'1'}],error:null
})};
await ctx.agendaRefreshDirectory();
assert.equal(state.directory.length,1);
assert.equal(state.directory[0].slug,original[0].slug);

// Legacy API remains an explicit, limited fallback while migrations propagate.
state.client={rpc:async(name)=>name==='agenda_search_directory'?
 {error:{code:'PGRST202'},data:null}:
 {data:original.slice(0,24),error:null}};
await ctx.agendaRefreshDirectory();
assert.equal(state.directoryMode,'legacy');
assert.equal(state.directory.length,24);
assert.match(elements.result.textContent,/resultados disponíveis nesta consulta/);
assert.match(ctx.agendaDirectoryView(),/Busca limitada aos profissionais desta consulta/);

// No database response may be mistaken for an empty, verified directory.
state.client={rpc:async()=>({error:{code:'42P01'},data:null})};
state.directoryMode='server';
await ctx.agendaRefreshDirectory();
assert.match(state.directoryError,/Não foi possível buscar profissionais/);
assert.match(elements.pagination.innerHTML,/Tentar novamente/);

assert.match(migration,/security definer set search_path='pg_catalog'/i);
assert.match(migration,/where p.published is true/);
assert.match(migration,/agenda_services.*page_id=p.id and s.active is true/s);
assert.match(migration,/agenda_hours.*page_id=p.id/s);
assert.match(migration,/revoke all on function public\.agenda_search_directory\(text,integer,integer\)/);
assert.match(migration,/grant execute on function public\.agenda_search_directory\(text,integer,integer\)\s+to anon,authenticated/);
assert.doesNotMatch(migration,/select\s+p\.\*|owner_id\s+as|customer_phone|whatsapp_e164|insert\s+into|update\s+public\.agenda_|delete\s+from/i);
assert.match(ci,/tests\/sql\/agenda-global-search-v1-1067\.sql/);
assert.match(audit,/node tests\/agenda-global-search-v1-1067\.mjs/);
for(const name of ['.agenda-directory-pagination','#agenda-directory-cards[hidden]','#agenda-directory-empty[hidden]'])
 assert.ok(css.includes(name),'Missing pagination UI: '+name);
console.log('V1.1067 PASS: all 31 records, exact pages, debounce, stale safety, migration ACL and compatibility fallback.');
