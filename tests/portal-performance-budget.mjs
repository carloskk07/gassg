import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildLivePortals,compactReleasedMerchantComments} from '../scripts/build-live-portals.mjs';
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
  assert.equal(report.warningUtilization,0.85);
  assert.ok(Array.isArray(report.warnings));
  for(const item of report.portals){
    assert.equal(item.transfer.gzipBytes,item.js.gzipBytes+item.css.gzipBytes);
    assert.equal(item.transfer.brotliBytes,item.js.brotliBytes+item.css.brotliBytes);
    for(const [key,value] of Object.entries(item.budgetUtilization)){
      assert.equal(value.limit,limits[item.role][key]);
      assert.equal(value.remaining,value.limit-value.measured);
      assert.equal(value.ratio,value.measured/value.limit);
    }
    assert.equal(Object.keys(item.budgetUtilization).length,8);
  }
  for(const item of report.portals){
    assert.ok(item.js.requests<=limits[item.role].initialJsRequests,
      item.role+' must not exceed the startup request budget');
    if(item.role==='admin')assert.equal(item.js.requests,limits.admin.initialJsRequests-7,
      'Admin excludes the protected QA center from eager startup as well as public-only modules');
    assert.equal(item.css.requests,limits[item.role].initialCssRequests);
    assert.ok(item.js.gzipBytes<item.js.rawBytes);
    assert.ok(item.js.brotliBytes<item.js.rawBytes);
    assert.ok(item.css.gzipBytes<item.css.rawBytes);
  }
  const merchantSource=fs.readFileSync(new URL('../js/merchant.js',import.meta.url),'utf8');
  const merchantBuilt=fs.readFileSync(path.join(dir,'merchant','js','merchant.js'),'utf8');
  assert.equal(merchantBuilt,compactReleasedMerchantComments(merchantSource),
    'production merchant JavaScript must be the compacted canonical source');
  assert.ok(Buffer.byteLength(merchantSource)-Buffer.byteLength(merchantBuilt)>3000,
    'merchant release must save enough bytes without raising startup limits');
  for(const contract of ['function merchantDriverLivePage(',
     'async function merchantLiveDeliver(','function merchantLiveOrder(']){
    assert.ok(merchantBuilt.includes(contract),'must preserve '+contract);
  }
  assert.equal(fs.readFileSync(new URL('../js/merchant.js',import.meta.url),'utf8'),
    merchantSource,'release compaction must leave repository source untouched');
  assert.throws(()=>compactReleasedMerchantComments('not a merchant script'),
    /Missing canonical merchant/);
  const roleDir=path.join(dir,'customer'),m=report.portals[0];
  assert.throws(()=>measurePortalBundle(roleDir,{limits:{customer:{
    ...limits.customer,initialJsBytes:m.js.rawBytes-1
  }}}),/initialJsBytes exceeded/);
  for(const [key,value] of [
    ['initialJsGzipBytes',m.js.gzipBytes],
    ['initialJsBrotliBytes',m.js.brotliBytes],
    ['initialTransferGzipBytes',m.transfer.gzipBytes],
    ['initialTransferBrotliBytes',m.transfer.brotliBytes]
  ]){
    const reduced={customer:{...limits.customer,[key]:value-1}};
    assert.throws(()=>measurePortalBundle(roleDir,{limits:reduced}),new RegExp(key+' exceeded'));
    assert.ok(measurePortalBundle(roleDir,{limits:reduced,strict:false}).violations.some(s=>s.includes(key+' exceeded')));
    const exact={customer:{...limits.customer,[key]:value}};
    const near=measurePortalBundle(roleDir,{limits:exact});
    assert.ok(near.warnings.some(s=>s.includes(key+' at 100%')));
    assert.equal(near.violations.length,0);
    const missing={customer:{...limits.customer}};
    delete missing.customer[key];
    assert.throws(()=>measurePortalBundle(roleDir,{limits:missing}),new RegExp('invalid budget '+key));
  }
  assert.throws(()=>measurePortalBundle(roleDir,{limits,warningUtilization:1}),/Invalid performance warning threshold/);
  assert.throws(()=>measurePortalBundle(roleDir,{limits,warningUtilization:0}),/Invalid performance warning threshold/);
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
  console.log('TAMÃO startup budgets PASS: 3 roles, raw and compressed limits, preventive warnings, cache parity, lazy module isolation');
}finally{fs.rmSync(dir,{recursive:true,force:true})}
