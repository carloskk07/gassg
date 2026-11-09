import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import {DISCOVERY_LANDING_SLUGS,writeDiscoveryLandingPages} from '../scripts/build-discovery-landings.mjs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const customer=read('js/customer.js'),discovery=read('js/discovery.js'),owner=read('js/discovery-owner.js');
for(const [name,src] of Object.entries({customer,discovery,owner}))
 assert.doesNotThrow(()=>new vm.Script(src,{filename:name+'.js'}));
assert.doesNotMatch(customer,/\['🏡','Hospedagens','Lugares para ficar','\/#stays'\]/);
assert.match(customer,/Caronas','Viagens compartilhadas/);
assert.match(discovery,/filter\(\(\[key\]\)=>key!=='stays'\)/);
assert.match(discovery,/if\(kind==='stays'\)return shell\('<section/);
assert.match(discovery,/Hospedagens temporariamente indisponíveis/);
assert.match(discovery,/if\(kind==='stays'\)return;\s*if\(kind&&discoveryState/);
assert.match(owner,/Object\.entries\(\{professionals:'Profissionais',rides:'Caronas'\}\)/);
assert.doesNotMatch(owner,/Object\.entries\(\{professionals:'Profissionais',rides:'Caronas',stays:/);
assert.match(owner,/Hospedagens temporariamente indisponíveis para novos anúncios/);
// Preserve the offline editing/import code for a future supervised reopening.
assert.match(owner,/function discoveryOwnerImportStay\(\)/);
assert.match(owner,/stays:'discovery_stay_details'/);
// A paused surface must not silently change other verticals or any billing contract.
assert.match(discovery,/rides:\['Caronas'/);
assert.match(discovery,/professionals:\['Profissionais'/);
assert.match(discovery,/Nenhuma reserva|reservas de hospedagem/);
assert.match(owner,/p_next_status:'review'|p_next_status:'draft'|p_next_status:'published'|operation:'review'|p_next_status:'review'/);
// Search and driver ride contact must keep their security checks.
assert.match(discovery,/discoveryConfirmRideContact\(anchor\)/);
assert.match(discovery,/discoveryRideAvailable\(current\)/);
assert.deepEqual([...DISCOVERY_LANDING_SLUGS],
 ['profissionais','ar/profesionales','caronas','ar/viajes-compartidos']);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'tamao-stays-pause-'));
try{
 const urls=writeDiscoveryLandingPages(root,{origin:'https://tamao.com.br',indexing:true});
 assert.deepEqual(urls,[...DISCOVERY_LANDING_SLUGS].map(x=>'/'+x+'/'));
 for(const slug of ['hospedagens','ar/alojamientos']){
  const s=fs.readFileSync(path.join(root,slug,'index.html'),'utf8');
  assert.match(s,/noindex,nofollow,noarchive,nosnippet/);
  assert.doesNotMatch(s,/href="https:\/\/tamao\.com\.br\/#(?:stays|advertise)"/);
  assert.match(s,/href="https:\/\/tamao\.com\.br\/"/);
 }
 for(const slug of DISCOVERY_LANDING_SLUGS){
  const s=fs.readFileSync(path.join(root,slug,'index.html'),'utf8');
  assert.match(s,/index,follow,max-image-preview:large/);
 }
}finally{fs.rmSync(root,{recursive:true,force:true})}
console.log('V1.914 PASS: stays hidden, public direct route paused, owner signup removed, old SEO pages noindex; caronas and merchant payments untouched.');
