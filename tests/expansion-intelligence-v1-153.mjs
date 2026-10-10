import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseAnpPage,checkedCity,refreshAnpProspects} from '../supabase/functions/_shared/anp-prospects.js';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261010172500_expansion_intelligence_v1_153.sql');
const worker=read('supabase/functions/expansion-worker/index.ts');
const workflow=read('.github/workflows/expansion-sync.yml');
const admin=read('supabase/functions/admin-ops/index.ts');
const ui=read('js/admin-acquisition.js');
const anp=read('supabase/functions/_shared/anp-prospects.js');

const region=checkedCity('São Gabriel','rs');
assert.deepEqual(region,{city:'São Gabriel',state:'RS',cityKey:'SAO GABRIEL'});
assert.throws(()=>checkedCity('São Gabriel','XX'),/INVALID_CITY/);
const base={cnpj:'39774375000144',razaoSocial:'REVENDAS DE TESTE LTDA',
  uf:'RS',municipio:'SAO GABRIEL',endereco:'RUA CENTRAL',distribuidora:'BRANCA',
  autorizacao:'GLPT00001',statusSIGAF:'',codigoSIMP:'123'};
const fixture=(page,pages,records,rows)=>({
  status:200,title:'Dados Encontrados',succeeded:true,data:rows,
  searchPageFilter:{numeroPagina:page,totalPagina:pages,totalRegistro:records,tamanhoPagina:5000}
});
const parsed=parseAnpPage(fixture(1,1,1,[base]),{...region,page:1});
assert.equal(parsed.rows.length,1);
assert.equal(parsed.rows[0].legal_name,'REVENDAS DE TESTE LTDA');
assert.equal(parsed.rows[0].cnpj,'39774375000144');
assert.equal(parsed.rows[0].anp_authorization,'GLPT00001');
assert.throws(()=>parseAnpPage({status:200,data:[]},{...region,page:1}),/ANP_RESPONSE_FORMAT_UNKNOWN/);
assert.throws(()=>parseAnpPage(fixture(1,4,6000,[base]),{...region,page:1}),/ANP_PAGINATION/);
assert.throws(()=>parseAnpPage(fixture(1,1,1,[{...base,uf:'SP'}]),{...region,page:1}),/ANP_ROW_INVALID/);

function mockAdmin(){
  const calls={batch:[],refresh:[],city:[]};
  let previous=null;
  const from=table=>{
    const chain={
      upsert:async(row)=>{(table==='market_cities'?calls.city:calls.refresh).push(row);return {error:null}},
      select:()=>chain,eq:()=>chain,
      maybeSingle:async()=>({data:previous,error:null})
    };
    return chain;
  };
  const rpc=async(name,args)=>{
    assert.equal(name,'upsert_anp_prospect_batch');
    calls.batch.push(...args.p_rows);
    return {data:args.p_rows.length,error:null};
  };
  return {calls,from,rpc,setPrevious:x=>previous=x};
}
const a=mockAdmin();
const old=globalThis.fetch;
try{
  globalThis.fetch=async url=>{
    const p=Number(new URL(url).searchParams.get('numeropagina'));
    assert.ok(String(url).startsWith('https://revendedoresapi.anp.gov.br/v1/glp?'));
    const record=p===1?base:{...base,cnpj:'39774375000145',razaoSocial:'OUTRA REVENDA DE TESTE LTDA'};
    return new Response(JSON.stringify(fixture(p,2,2,[record])),{status:200});
  };
  const r=await refreshAnpProspects(a,'São Gabriel','RS');
  assert.equal(r.status,'ok');
  assert.equal(r.lastCount,2);
  assert.equal(a.calls.batch.length,2,'todas as páginas foram importadas');
  assert.equal(a.calls.refresh.at(-1).status,'ok');

  const fail=mockAdmin();
  globalThis.fetch=async url=>{
    const p=Number(new URL(url).searchParams.get('numeropagina'));
    if(p===2)return new Response('{"status":503}',{status:503});
    return new Response(JSON.stringify(fixture(1,2,2,[base])),{status:200});
  };
  const x=await refreshAnpProspects(fail,'São Gabriel','RS');
  assert.equal(x.status,'unavailable','2ª página indisponível não vira sucesso');
  assert.equal(fail.calls.batch.length,0,'lotes parciais jamais importados');
  assert.equal(fail.calls.refresh.at(-1).status,'unavailable');
}finally{globalThis.fetch=old;}

for(const key of ['upsert_anp_prospect_batch','discover_expansion_city','expansion_due_cities',
  'queue_ready_city_notifications','admin_handle_city_notification']){
  assert.ok(sql.includes('function public.'+key+'('),key+' migration');
}
assert.ok(sql.includes('prospect_status text')===false,'importação não modifica estágio humano');
assert.ok(sql.includes('on conflict(cnpj) do update set'));
assert.ok(sql.includes('status not in (\\'closed\\',\\'converted\\')'));
assert.ok(sql.includes('unique(lead_id,postal_code,notification_type)'));
assert.ok(sql.includes('on conflict(lead_id,postal_code,notification_type) do nothing'));
assert.ok(sql.includes('if not public.market_city_ready(v_row.city,v_row.state)'));
assert.ok(sql.includes('l.consent_at is not null'));
assert.ok(sql.includes('insert into public.platform_admin_audit'));
assert.ok(sql.includes('revoke all on public.city_opening_notifications from public,anon,authenticated'));
assert.ok(sql.includes('grant execute on function public.expansion_due_cities(integer) to service_role'));
assert.ok(worker.includes('verifyGithubOidc(bearer.slice(7))'));
assert.ok(worker.includes('const OIDC_AUDIENCE="tamao-expansion-worker"'));
assert.ok(worker.includes('githubMainSha()'));
assert.ok(worker.includes('queue_ready_city_notifications'));
assert.ok(worker.includes('automaticallySent:0'));
assert.ok(workflow.includes("cron: '19 * * * *'"));
assert.ok(workflow.includes('id-token: write'));
assert.ok(!workflow.includes('SERVICE_ROLE_KEY'));
assert.ok(admin.includes('"expansion-notifications"'));
assert.ok(admin.includes('admin_handle_city_notification'));
assert.ok(ui.includes('adminCityNotificationsSection()'));
assert.ok(ui.includes('O TAMÃO ainda não envia automaticamente.'));
assert.ok(anp.includes('searchPageFilter'));
assert.ok(anp.includes('numeropagina:String(page)'));
console.log('V1.153: ANP oficial paginada, sync OIDC, filas idempotentes, consentimento e confirmação manual.');
