#!/usr/bin/env node
// Read-only public deployment evidence. Never deploys, modifies Supabase,
// authenticates users or accepts arbitrary origins supplied in a PR.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const PORTAL_ORIGINS={
  customer:'https://tamao.com.br',
  merchant:'https://parceiro.tamao.com.br',
  admin:'https://admin.tamao.com.br'
};
const HEX=/^[a-f0-9]{40}$/;
function optionalSha(raw,label){
  const sha=String(raw||'').trim().toLowerCase();
  if(sha)assert.match(sha,HEX,label+' must be a full 40-character Git SHA');
  return sha;
}
export async function inspectLivePortals({
  fetcher=fetch,
  candidateSha='',
  expectedLiveSha='',
  nonce='release-check'
}={}){
  const candidate=optionalSha(candidateSha,'candidateSha');
  const liveBase=optionalSha(expectedLiveSha,'expectedLiveSha');
  const portalEntries=await Promise.all(Object.entries(PORTAL_ORIGINS).map(async ([role,origin])=>{
    const url=origin+'/portal-build.json?release_probe='+encodeURIComponent(nonce);
    try{
      const resp=await fetcher(url,{
        method:'GET',redirect:'error',headers:{'Cache-Control':'no-cache'},
        signal:AbortSignal.timeout(12000)
      });
      if(!resp.ok)throw new Error('HTTP '+resp.status);
      const body=await resp.text();
      if(body.length>100000)throw new Error('Oversize portal manifest');
      let m;try{m=JSON.parse(body)}catch{throw new Error('Invalid JSON')}
      if(m.schemaVersion!==1)throw new Error('Unsupported schemaVersion');
      if(m.portalRole!==role)throw new Error('Wrong portal role');
      for(const [key,expected] of Object.entries(PORTAL_ORIGINS)){
        if(m[key+'Origin']!==expected)throw new Error('Incorrect '+key+'Origin');
      }
      if(typeof m.sourceSha!=='string'||!HEX.test(m.sourceSha)){
        throw new Error('Missing or invalid source SHA');
      }
      return {role,origin,valid:true,sourceSha:m.sourceSha};
    }catch(error){
      return {role,origin,valid:false,sourceSha:null,error:String(error?.message||error).slice(0,180)};
    }
  }));
  const errors=portalEntries.filter(p=>!p.valid).map(p=>p.role+': '+p.error);
  const shas=new Set(portalEntries.filter(p=>p.valid).map(p=>p.sourceSha));
  if(shas.size>1)errors.push('Different deployed Git SHAs between customer/merchant/admin');
  const liveSha=shas.size===1?[...shas][0]:null;
  if(liveBase&&liveSha!==liveBase)errors.push('Live source SHA differs from the expected stable main branch');
  if(candidate&&liveSha===candidate)errors.push('Release candidate unexpectedly already deployed to public');
  return {
    result:errors.length===0?'LIVE_BASELINE_SYNCED_RELEASE_NOT_DEPLOYED':'BLOCKED',
    ok:errors.length===0,
    candidateSha:candidate||null,
    expectedLiveSha:liveBase||null,
    liveSha,
    releaseAlreadyDeployed:!!candidate&&liveSha===candidate,
    portals:portalEntries,
    errors
  };
}
function runningAsScript(){
  return process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
}
if(runningAsScript()){
  const report=await inspectLivePortals({
    candidateSha:process.env.TAMAO_CANDIDATE_SHA,
    expectedLiveSha:process.env.TAMAO_EXPECTED_LIVE_SHA,
    nonce:process.env.GITHUB_RUN_ID||'manual'
  });
  const output=String(process.env.TAMAO_REPORT_FILE||'').trim();
  if(output){
    fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});
    fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n','utf8');
  }
  console.log(JSON.stringify(report,null,2));
  if(!report.ok)process.exitCode=1;
}
