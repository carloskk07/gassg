import assert from 'node:assert/strict';

// V1.973 — real Chromium on disposable Supabase, two independently authenticated
// browser contexts. Read-only UX review: no user creation, financial action,
// credential transfer or mock browser implementation in this helper.
const SIZES=[{width:320,height:740},{width:360,height:800},{width:768,height:900},{width:1280,height:960},{width:1920,height:1080}];
const ADMIN_SECTIONS=['overview','orders','customers','partners','growth','prospects',
 'enablement','catalog','finance','ads','alerts','incidents','audit','system',
 'activations','discovery'];
// V1.977 — inspect actual selected tasks, not only their parent landing pages.
// Selection uses the existing browser UI entry and is read-only on disposable SQL.
const ADMIN_SUBTASKS=['support','partners-applications','partners-verification',
 'ads-finance','ads-refunds','ads-diagnostics','growth-benefits','growth-budget',
 'finance-billing','finance-homologation','finance-reconciliation'];
const MERCHANT_WORKSPACES=['start','setup','growth','settings','finance'];
const DOM_PROBE=[
 'JSON.stringify((()=>{',
 "const ids=[...document.querySelectorAll('[id]')].map(e=>e.id).filter(Boolean);",
 'const dup=ids.filter((id,i)=>ids.indexOf(id)!==i);',
 "const main=document.getElementById('tamao-main');",
 "const headings=[...(main?.querySelectorAll('h1')||[])].filter(e=>e.getClientRects().length);",
 "const controls=[...(main?.querySelectorAll('input,select,textarea')||[])].filter(e=>e.type!=='hidden'&&e.getClientRects().length);",
 "const labels=[...document.querySelectorAll('label[for]')].map(l=>l.htmlFor);",
 "const unnamed=controls.filter(e=>!e.closest('label')&&!e.getAttribute('aria-label')&&!e.getAttribute('aria-labelledby')&&(!e.id||!labels.includes(e.id))).map(e=>e.id||e.tagName).slice(0,15);",
 "const buttons=[...(main?.querySelectorAll('button')||[])].filter(e=>e.getClientRects().length);",
 "const unbuttoned=buttons.filter(e=>!e.textContent.trim()&&!e.getAttribute('aria-label')&&!e.title).length;",
 "const physical=screen.width||innerWidth;",
 "const offenders=innerWidth>physical+1?[...document.querySelectorAll('body *')].filter(e=>e.getClientRects().length).map(e=>{",
 "const r=e.getBoundingClientRect(),style=getComputedStyle(e);return {tag:e.tagName,id:e.id,cls:typeof e.className==='string'?e.className.slice(0,80):'',left:Math.round(r.left),right:Math.round(r.right),min:style.minWidth,whiteSpace:style.whiteSpace,txt:(e.textContent||'').trim().slice(0,70),parent:String(e.parentElement?.className||'').slice(0,80)}}).filter(e=>e.right>physical+1&&e.left<physical).sort((a,b)=>b.right-a.right).slice(0,12):[];",
 'return {viewport:innerWidth,physical,offenders,scrollWidth:document.documentElement.scrollWidth,',
 'heading:headings[0]?.textContent?.trim()||"",headingCount:headings.length,',
 'dup:[...new Set(dup)].slice(0,12),unnamed,unbuttoned,',
 'adminStatus:typeof adminRuntime==="undefined"?null:adminRuntime.status,',
 'merchantStatus:typeof merchantRuntime==="undefined"?null:merchantRuntime.status,',
 'renderError:window.__lastRenderError||null};',
 '})())'
].join('');

async function inspect(page,role,section,size){
 await page.send('Emulation.setDeviceMetricsOverride',{
  width:size.width,height:size.height,deviceScaleFactor:1,
  mobile:size.width<800,screenWidth:size.width,screenHeight:size.height
 });
 const data=JSON.parse(await page.evaluate(DOM_PROBE));
 const label=role+'/'+section+'/'+size.width;
 assert.equal(data.viewport,size.width,label+' wrong viewport; device '+data.physical+'px; scroll '+data.scrollWidth+'px; overflow sources '+JSON.stringify(data.offenders));
 assert.ok(data.heading.length>0,label+' missing visible H1');
 assert.equal(data.headingCount,1,label+' must have exactly one visible page H1');
 assert.equal(role==='admin'?data.adminStatus:data.merchantStatus,
  'ready',label+' lost authenticated backend');
 assert.deepEqual(data.dup,[],label+' duplicate IDs');
 assert.deepEqual(data.unnamed,[],label+' visible form controls without accessible labels');
 assert.equal(data.unbuttoned,0,label+' buttons without accessible names');
 assert.ok(data.scrollWidth<=data.viewport+3,
  label+' horizontal document overflow '+(data.scrollWidth-data.viewport)+'px');
 assert.equal(data.renderError,null,label+' JS renderer exception');
 return {role,section,width:size.width,headings:data.headingCount,
  unnamedInputs:data.unnamed.length,unnamedSample:data.unnamed,
  iconButtonsWithoutName:data.unbuttoned};
}
export async function auditAuthenticatedScreensV1973({adminPage,merchantPage}){
 assert.ok(adminPage?.evaluate&&adminPage?.send&&adminPage?.wait);
 assert.ok(merchantPage?.evaluate&&merchantPage?.send);
 const findings=[];
 try{
  for(const section of ADMIN_SECTIONS){
   const allowed=await adminPage.evaluate('adminRoleCanSection('+JSON.stringify(section)+')');
   if(allowed!==true)continue;
   await adminPage.evaluate('adminSetSection('+JSON.stringify(section)+');true');
   await adminPage.wait(
    'adminRuntime.section==='+JSON.stringify(section)+
    '&&document.getElementById("admin-current-section-title")?.textContent?.trim().length>0',
    'authenticated Admin section '+section,16000);
   for(const size of SIZES)findings.push(await inspect(adminPage,'admin',section,size));
  }
  for(const size of SIZES)findings.push(await inspect(merchantPage,'merchant','operation',size));
  // These selections do not approve a revenda, create Pix, or perform billing.
  for(const taskId of ADMIN_SUBTASKS){
   const allowed=await adminPage.evaluate(
    'adminTaskNavChoices().some(t=>t.id==='+JSON.stringify(taskId)+')');
   if(allowed!==true)continue;
   const selected=await adminPage.evaluate(
    '(()=>{const control=document.getElementById("admin-task-nav");'+
    'if(!control)return false;control.value='+JSON.stringify(taskId)+';'+
    'adminSelectTaskFromUi();return true})()');
   assert.equal(selected,true,'Admin task select must exist for '+taskId);
   await adminPage.wait(
    'adminCurrentTaskFromState()==='+JSON.stringify(taskId)+
    '&&document.getElementById("admin-current-section-title")?.textContent?.trim().length>0',
    'authenticated Admin task '+taskId,17000);
   for(const size of SIZES)
    findings.push(await inspect(adminPage,'admin','task/'+taskId,size));
  }
  for(const area of MERCHANT_WORKSPACES){
   // A shortcut is not accessible merely because scrollIntoView() returned.
   // The destination, any enclosing drawers and the keyboard focus must agree.
   const jump=JSON.parse(await merchantPage.evaluate(
    'JSON.stringify((()=>{const names={start:"merchant-workspace-start",'+
      'setup:"merchant-workspace-setup",growth:"merchant-workspace-growth",'+
      'settings:"merchant-workspace-settings",finance:"merchant-workspace-finance"};'+
      'const ok=merchantWorkspaceJump('+JSON.stringify(area)+');'+
      'const panel=document.getElementById(names['+JSON.stringify(area)+']);'+
      'let parentsOpen=true;for(let p=panel?.parentElement;p;p=p.parentElement)'+
      'if(p.tagName==="DETAILS"&&!p.open)parentsOpen=false;'+
      'return {ok,focused:!!panel?.contains(document.activeElement),'+
      'expanded:panel?.tagName!=="DETAILS"||panel.open,parentsOpen}})())'));
   if(jump.ok!==true)continue; // Roles may legitimately hide a workspace.
   assert.equal(jump.focused,true,'Partner focus did not reach '+area);
   assert.equal(jump.expanded,true,'Partner workspace remained collapsed '+area);
   assert.equal(jump.parentsOpen,true,'Partner ancestor drawer remained closed '+area);
   for(const size of SIZES)
    findings.push(await inspect(merchantPage,'merchant','workspace/'+area,size));
  }
  // Log diagnostics even if the following keyboard interaction fails.
  const diagnostics={
   screens:findings.length,
   subtasks:ADMIN_SUBTASKS.length,
   merchantWorkspaces:MERCHANT_WORKSPACES.length,
   sections:new Set(findings.map(x=>x.role+'/'+x.section)).size,
   unnamedInputs:findings.filter(x=>x.unnamedInputs>0).map(x=>({
    screen:x.role+'/'+x.section+'/'+x.width,count:x.unnamedInputs,sample:x.unnamedSample
   })),
   iconButtonsWithoutName:findings.filter(x=>x.iconButtonsWithoutName>0).map(x=>({
    screen:x.role+'/'+x.section+'/'+x.width,count:x.iconButtonsWithoutName
   })).slice(0,30)
  };
  console.log('V1.973 SCREEN_MATRIX '+JSON.stringify(diagnostics));
  const jump=JSON.parse(await merchantPage.evaluate(
   'JSON.stringify((()=>{'+
   'const ok=merchantWorkspaceJump("orders");'+
   'return {ok,focused:document.activeElement?.tagName,section:document.getElementById("merchant-live-orders")!=null}})())'));
  assert.equal(jump.ok,true,'partner order navigation must respond');
  assert.equal(jump.section,true,'partner order destination must exist');
  assert.equal(jump.focused,'H2','merchant keyboard focus must reach order heading');
  // The audited browser screens are read-only; no financial action was triggered.
 }finally{
  // Never leave another test in mobile metrics or on a different Admin tab.
  await adminPage.send('Emulation.setDeviceMetricsOverride',{
   width:1280,height:960,deviceScaleFactor:1,mobile:false,screenWidth:1280,screenHeight:960
  }).catch(()=>{});
  await merchantPage.send('Emulation.setDeviceMetricsOverride',{
   width:1280,height:960,deviceScaleFactor:1,mobile:false,screenWidth:1280,screenHeight:960
  }).catch(()=>{});
  await adminPage.evaluate('adminSetSection("orders");true').catch(()=>{});
 }
 return findings;
}
