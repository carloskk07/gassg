#!/usr/bin/env node
// Read-only verifier for the exact Supabase migration versions tracked in Git.
// Does not connect, apply DDL, access credentials, or modify production.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(fs.readFileSync(path.join(base,'release/integration-v1-164.json'),'utf8'));
const planned=manifest.databaseMigrations.map(filename=>{
 const parsed=/^(\d{14})_(.+)\.sql$/.exec(filename);
 if(!parsed)throw new Error('Invalid versioned migration filename: '+filename);
 return {version:parsed[1],name:parsed[2],filename};
});
export function inspectHistory(history){
 if(!Array.isArray(history))throw new Error('Migration history must be an array');
 const records=history.map(item=>({
   version:String(item?.version||'').trim(),
   name:String(item?.name||'').trim()
 }));
 const targetNames=new Set(planned.map(x=>x.name));
 const matches=records.filter(item=>targetNames.has(item.name)
   ||planned.some(x=>x.version===item.version));
 const issues=[];
 for(const target of planned){
   const found=matches.filter(m=>m.name===target.name||m.version===target.version);
   if(found.length>1)issues.push('Duplicate history records: '+target.name);
   if(found.length===1&&
     (found[0].version!==target.version||found[0].name!==target.name)){
     issues.push('History/source mismatch: '+target.filename+
       ' found as '+found[0].version+'_'+found[0].name);
   }
 }
 if(matches.length>0&&matches.length!==planned.length){
   issues.push('PARTIAL_SCHEMA: only '+matches.length+'/'+planned.length+' release migrations present');
 }
 if(matches.length===planned.length){
   const applied=planned.map(x=>matches.find(m=>m.name===x.name&&m.version===x.version))
     .filter(Boolean);
   if(applied.length!==planned.length)issues.push('Missing exact version/name combinations');
 }
 const status=issues.length?'DRIFT_BLOCKED':matches.length===planned.length
   ?'ALL_RECORDED':'NOT_APPLIED';
 return {
   status,ok:issues.length===0,canPublish:status==='ALL_RECORDED',
   expectedVersions:planned.map(x=>x.version),
   recordedReleaseCount:matches.length,
   errors:issues
 };
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const argv=process.argv.slice(2);
 const idx=argv.indexOf('--input');
 if(idx<0||!argv[idx+1])throw new Error('Provide --input <read-only JSON history snapshot>');
 const history=JSON.parse(fs.readFileSync(path.resolve(argv[idx+1]),'utf8'));
 const result=inspectHistory(Array.isArray(history)?history:history.migrations);
 console.log(JSON.stringify(result,null,2));
 const stage=argv.includes('--require-applied')?'applied':'review';
 if(!result.ok||(stage==='applied'&&!result.canPublish))process.exitCode=1;
}
