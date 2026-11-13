import assert from 'node:assert/strict';

// V1.980: actual, completely separate anonymous Chrome contexts on disposable
// Supabase. Only read DOM, take viewport measurements, never send magic link,
// sign in, write to the database, or manipulate privileges.
const VIEWPORTS=[
 {width:320,height:740},{width:360,height:800},{width:768,height:900},
 {width:1280,height:960},{width:1920,height:1080}
];
const PROBE=[
 'JSON.stringify((()=>{',
 'const main=document.getElementById("tamao-main");',
 'const form=main?.querySelector("form");',
 'const input=form?.querySelector(\'input[type="email"]\');',
 'const submit=form?.querySelector(\'button[type="submit"]\');',
 'const ids=[...document.querySelectorAll("[id]")].map(x=>x.id).filter(Boolean);',
 'const dup=ids.filter((id,i)=>ids.indexOf(id)!==i);',
 'const headings=[...(main?.querySelectorAll("h1")||[])].filter(x=>x.getClientRects().length);',
 'const visibleButtons=[...(main?.querySelectorAll("button")||[])].filter(x=>x.getClientRects().length);',
 'const unlabeled=visibleButtons.filter(x=>!x.textContent.trim()&&!x.getAttribute("aria-label")&&!x.title);',
 'const labels=[...document.querySelectorAll("label[for]")].map(x=>x.htmlFor);',
 'const rect=submit?.getBoundingClientRect();',
 'const formRect=form?.getBoundingClientRect();',
 'return {viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,',
 'status:typeof adminRuntime!=="undefined"&&location.search.includes("admin=1")?adminRuntime.status:merchantRuntime.status,',
 'headingCount:headings.length,heading:headings[0]?.textContent.trim()||"",',
 'formCount:main?.querySelectorAll("form").length||0,',
 'inputId:input?.id||"",inputLabeled:!!input&&(labels.includes(input.id)||!!input.getAttribute("aria-label")),',
 'inputRequired:!!input?.required,submitName:submit?.textContent.trim()||"",',
 'submitTop:rect?Math.round(rect.top):null,submitBottom:rect?Math.round(rect.bottom):null,',
 'formTop:formRect?Math.round(formRect.top):null,',
 'duplicateIds:[...new Set(dup)],unlabeledButtons:unlabeled.length,',
 'privateWorkspace:!!main?.querySelector(".merchant-workspace,.admin-panel"),',
 'authPresent:!!sessionStorage.getItem("chama-sg-merchant-auth-v1")||',
 '!!sessionStorage.getItem("chama-sg-admin-auth-v1")||',
 '!!localStorage.getItem("chama-sg-customer-auth-v2"),',
 'renderError:window.__lastRenderError||null',
 '};})())'
].join('');

async function check(page,role,section,size,{firstFold=false}={}){
 await page.send('Emulation.setDeviceMetricsOverride',{
  width:size.width,height:size.height,deviceScaleFactor:1,
  mobile:size.width<800,screenWidth:size.width,screenHeight:size.height
 });
 const d=JSON.parse(await page.evaluate(PROBE));
 const label=role+'/'+section+'/'+size.width;
 assert.equal(d.viewport,size.width,label+' viewport');
 assert.ok(d.scrollWidth<=size.width+3,
  label+' horizontal overflow '+(d.scrollWidth-size.width)+'px');
 assert.equal(d.status,'unauthenticated',label+' role state');
 assert.equal(d.headingCount,1,label+' visible H1');
 assert.equal(d.formCount,1,label+' single focused form');
 assert.equal(d.inputRequired,true,label+' requires email');
 assert.equal(d.inputLabeled,true,label+' label for email');
 assert.equal(d.inputId,role==='admin'?'admin-email':'merchant-email');
 assert.ok(d.submitName.length>=8,label+' meaningful submit label');
 assert.ok(d.formTop<size.height,label+' sign-in form starts below first viewport');
 if(firstFold&&size.width<=360)
  assert.ok(d.submitTop<size.height,label+' login action below first viewport at y='+d.submitTop);
 assert.deepEqual(d.duplicateIds,[],label+' duplicate DOM IDs');
 assert.equal(d.unlabeledButtons,0,label+' unnamed buttons');
 assert.equal(d.privateWorkspace,false,label+' private dashboard visible without session');
 assert.equal(d.authPresent,false,label+' unauthorized browser acquired credentials');
 assert.equal(d.renderError,null,label+' render exception');
 return {role,section,width:size.width,submitTop:d.submitTop,formTop:d.formTop};
}
export async function auditProtectedEntryScreensV1980({guestMerchant,guestAdmin,origin}){
 assert.ok(/^http:\/\/127\.0\.0\.1:4179$/.test(origin));
 const results=[];
 try{
  for(const size of VIEWPORTS){
   results.push(await check(guestMerchant,'merchant','login',size,{firstFold:true}));
   results.push(await check(guestAdmin,'admin','login',size,{firstFold:true}));
  }
  await guestMerchant.navigate(origin+'/?merchant=1#merchant-join');
  await guestMerchant.wait(
   'merchantRuntime.status==="unauthenticated"&&document.querySelector("#tamao-main h1")?.textContent.includes("Cadastre sua revenda")',
   'anonymous revenda signup entry',20000
  );
  for(const size of VIEWPORTS)
   results.push(await check(guestMerchant,'merchant','signup',size));
  const matrix={
   checks:results.length,
   roles:['merchant','admin'],
   areas:['merchant login','admin login','merchant signup'],
   viewports:VIEWPORTS.map(x=>x.width),
   maxLoginButtonTop320:Math.max(...results.filter(x=>x.section==='login'&&x.width===320).map(x=>x.submitTop))
  };
  console.log('V1.980 ANONYMOUS_ENTRY_MATRIX '+JSON.stringify(matrix));
  return matrix;
 }finally{
  for(const page of [guestMerchant,guestAdmin]){
   await page.send('Emulation.setDeviceMetricsOverride',
    {width:1280,height:960,deviceScaleFactor:1,mobile:false,screenWidth:1280,screenHeight:960}).catch(()=>{});
  }
 }
}
