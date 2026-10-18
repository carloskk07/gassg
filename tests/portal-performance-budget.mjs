import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildLivePortals} from '../scripts/build-live-portals.mjs';
import {auditPortalBudgets,measurePortalBundle,readBudgets,ROLES} from '../scripts/portal-performance-budget.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tamao-perf-'));
try{
  buildLivePortals({
    CHAMA_CUSTOMER_ORIGIN:'https://tamao.com.br',
    CHAMA_MERCHANT_ORIGIN:'https://parceiro.tamao.com.br',
    CHAMA_ADMIN_ORIGIN:'https://admin.tamao.com.br',
    CHAMA_TURNSTILE_SITE_KEY:'1x00000000000000000000AA',
    CHAMA_ALLOW_TEST_TURNSTILE:'1',
    CHAMA_SOURCE_SHA:'perf-fixture'
  },{outputRoot:dir});
  const limits=readBudgets().limits,report=auditPortalBudgets(dir);
  assert.deepEqual(report.portals.map(x=>x.role),ROLES);
  assert.equal(report.violations.length,0);
  for(const item of report.portals){
    assert.equal(item.js.requests,limits[item.role].initialJsRequests);
    assert.equal(item.css.requests,limits[item.role].initialCssRequests);
    assert.ok(item.js.gzipBytes<item.js.rawBytes);
    assert.ok(item.js.brotliBytes<item.js.rawBytes);
    assert.ok(item.css.gzipBytes<item.css.rawBytes);
  }
  const roleDir=path.join(dir,'customer'),m=report.portals[0];
  assert.throws(()=>measurePortalBundle(roleDir,{limits:{customer:{
    ...limits.customer,initialJsBytes:m.js.rawBytes-1
  }}}),/initialJsBytes exceeded/);
  const index=path.join(roleDir,'index.html'),old=fs.readFileSync(index,'utf8');
  fs.writeFileSync(index,old.replace('</head>',
    '<script defer src="./js/admin-owner-finance.js?v=perf-fixture"></script></head>'));
  assert.throws(()=>measurePortalBundle(roleDir,{limits}),/Missing startup asset/);
  fs.writeFileSync(index,old);
  const sw=path.join(dir,'admin','sw.js'),oldSw=fs.readFileSync(sw,'utf8');
  fs.writeFileSync(sw,oldSw.replace('const ASSETS=[',
    "const ASSETS=['./js/admin-owner-finance.js?v=perf-fixture',"));
  assert.throws(()=>measurePortalBundle(path.join(dir,'admin'),{limits}),
    /unexpectedly eager or precached/);
  fs.writeFileSync(sw,oldSw);
  console.log('TAMÃO startup budgets PASS: 3 roles, byte limits, cache parity, lazy module isolation');
}finally{fs.rmSync(dir,{recursive:true,force:true})}
