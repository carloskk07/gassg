import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src=fs.readFileSync(new URL('../js/admin-acquisition.js',import.meta.url),'utf8');
new vm.Script(src,{filename:'js/admin-acquisition.js'});
function fn(name){
  const a=src.indexOf('function '+name+'(');
  const b=src.indexOf('\n}',a);
  assert.ok(a>=0&&b>a,'Missing '+name);
  return src.slice(a,b+2);
}
const originalReport={state:'RS',city:'São Gabriel',
  prospects:Array.from({length:15},(_,index)=>({
    cnpj:String(index+1).padStart(14,'0'),
    legal_name:'Revenda '+(index+1),
    prospect_status:'uncontacted',contact_attempts:0
  }))};
const target=String(15).padStart(14,'0');
let role='operations',opens=0,focus=0,scroll=0;
const frameQueue=[];
const adminRuntime={
  status:'ready',
  session:{user:{id:'user-1'}},prospectLoadedFor:'user-1',
  prospectState:'RS',prospectCity:'São Gabriel',
  prospectLoadedAt:new Date().toISOString(),
  prospectLoading:false,prospectError:null,prospectReport:originalReport
};
const details={
  open:false,
  querySelector:key=>key==='summary'?{focus:()=>focus++}:null,
  scrollIntoView:()=>scroll++
};
Object.defineProperty(details,'open',{
  get(){return opens>0},
  set(value){if(value)opens++}
});
const ctx=vm.createContext({
  adminRuntime,Date,Intl,Number,String,Math,Array,Object,Set,
  adminRoleCanSection:section=>section==='prospects'&&role!=='finance',
  adminCurrentRole:()=>role,
  requestAnimationFrame:fn=>frameQueue.push(fn),
  document:{getElementById:id=>id==='prospect-editor-'+target?details:null},
  toast:()=>{throw new Error('No valid editor should yield a toast in this test')}
});
vm.runInContext(fn('adminProspectFollowupSnapshot')+'\n'+fn('adminOpenProspectFollowup')+
  '\nthis.snapshot=adminProspectFollowupSnapshot;this.open=adminOpenProspectFollowup;',ctx);
assert.equal(ctx.snapshot(originalReport).items.length,10);
assert.equal(ctx.snapshot(originalReport).allItems.length,15);
function click({change=()=>{},shouldOpen=false}={}){
  const before=opens;
  ctx.open(target);
  assert.equal(frameQueue.length,1,'One deferred frame per valid click');
  change();
  frameQueue.shift()();
  assert.equal(opens-before,shouldOpen?1:0,
    'Deferred editor opening must respect the current authorized snapshot');
}
click({shouldOpen:true}); // #15 lives on page two; never restrict to items.slice(0,10)
click({change:()=>{role='readonly'}});
role='operations';
click({change:()=>{adminRuntime.prospectCity='Outra cidade'}});
adminRuntime.prospectCity='São Gabriel';
click({change:()=>{adminRuntime.prospectReport={...originalReport,prospects:originalReport.prospects.slice(0,14)}}});
adminRuntime.prospectReport=originalReport;
click({change:()=>{adminRuntime.prospectLoading=true}});
adminRuntime.prospectLoading=false;
click({change:()=>{adminRuntime.prospectError='Consulta em erro'}});
adminRuntime.prospectError=null;
click({change:()=>{adminRuntime.status='loading'}});
adminRuntime.status='ready';
const session=adminRuntime.session;
click({change:()=>{adminRuntime.session={user:{id:'user-2'}}}});
adminRuntime.session=session;
const stamp=adminRuntime.prospectLoadedAt;
click({change:()=>{adminRuntime.prospectLoadedAt=new Date(Date.now()-20*60000).toISOString()}});
adminRuntime.prospectLoadedAt=stamp;
assert.equal(frameQueue.length,0);
const before=opens;
ctx.open('not-a-cnpj');
assert.equal(frameQueue.length,0);
role='readonly';ctx.open(target);assert.equal(frameQueue.length,0);
assert.equal(opens,before);
assert.equal(focus,1);
assert.equal(scroll,1);
console.log('CRM async context gate passed: city, role, session, freshness, errors, removal and page 2.');
