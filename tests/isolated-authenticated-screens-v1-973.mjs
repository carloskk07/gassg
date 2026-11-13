import assert from 'node:assert/strict';

// V1.973 — real Chromium on disposable Supabase, two independently authenticated
// browser contexts. Read-only UX review: no user creation, financial action,
// credential transfer or mock browser implementation in this helper.
const SIZES=[{width:360,height:800},{width:768,height:900},{width:1280,height:960}];
const ADMIN_SECTIONS=['overview','orders','customers','partners','growth','prospects',
 'enablement','catalog','finance','ads','alerts','incidents','audit','system',
 'activations','discovery'];
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
 'return {viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,',
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
 assert.equal(data.viewport,size.width,label+' wrong viewport');
 assert.ok(data.heading.length>0,label+' missing visible H1');
 assert.equal(role==='admin'?data.adminStatus:data.merchantStatus,
  'ready',label+' lost authenticated backend');
 assert.deepEqual(data.dup,[],label+' duplicate IDs');
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
  const jump=JSON.parse(await merchantPage.evaluate(
   'JSON.stringify((()=>{'+
   'const ok=merchantWorkspaceJump("orders");'+
   'return {ok,focused:document.activeElement?.tagName,section:document.getElementById("merchant-live-orders")!=null}})())'));
  assert.equal(jump.ok,true,'partner order navigation must respond');
  assert.equal(jump.section,true,'partner order destination must exist');
  assert.equal(jump.focused,'H2','merchant keyboard focus must reach order heading');
  // Real keyboard/viewport checks happen with actual Chrome, not mocked HTML.
  console.log('V1.973 SCREEN_MATRIX '+JSON.stringify({
   screens:findings.length,sections:new Set(findings.map(x=>x.role+'/'+x.section)).size,
   unnamedInputs:findings.filter(x=>x.unnamedInputs>0).map(x=>({
    screen:x.role+'/'+x.section+'/'+x.width,count:x.unnamedInputs,
    sample:x.unnamedSample
   })).slice(0,25),
   iconButtonsWithoutName:findings.filter(x=>x.iconButtonsWithoutName>0).map(x=>({
    screen:x.role+'/'+x.section+'/'+x.width,count:x.iconButtonsWithoutName
   })).slice(0,25)
  }));
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
