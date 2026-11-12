// V1.963: preserve the merchant's currently edited fields and open tasks
// across live order refreshes, not across merchant, role or session changes.
// This is a same-render DOM snapshot only: no storage or server mutation.
let merchantLastRenderedScope='';
function merchantUiRenderScope(){
 const rt=globalThis.merchantRuntime||{},role=String(rt.merchant?.memberRole||'');
 const user=String(rt.session?.user?.id||''),merchant=String(rt.merchant?.merchantId||'');
 if(globalThis.merchantPortalRequested?.()!==true||rt.status!=='ready'||
    !user||!merchant||!['owner','manager','operator'].includes(role))return '';
 const page=typeof route==='function'?String(route()):'merchant';
 if(!['merchant','merchant-orders','merchant-team','catalog','merchant-metrics'].includes(page))return '';
 return [user,merchant,role,Number(rt.accessEpoch||0),page].join('|');
}
function merchantUiBeforeRender(app){
 const scope=merchantUiRenderScope();
 if(!scope||scope!==merchantLastRenderedScope||
    typeof app?.querySelectorAll!=='function')return {scope,details:[],fields:[]};
 const safeId=id=>/^[A-Za-z][A-Za-z0-9_-]{0,100}$/.test(String(id||''));
 const details=Array.from(app.querySelectorAll('details[id]')).slice(0,80)
  .filter(el=>safeId(el.id)).map(el=>({id:el.id,open:el.open===true}));
 const active=typeof document!=='undefined'?document.activeElement:null;
 const tag=String(active?.tagName||'').toUpperCase();
 const editing=active&&app.contains?.(active)&&
  ['INPUT','TEXTAREA','SELECT'].includes(tag)&&
  active.disabled!==true&&active.readOnly!==true&&
  !['hidden','password','file'].includes(String(active.type||'').toLowerCase());
 const fields=[];
 if(editing){
  for(const el of Array.from(app.querySelectorAll('input[id],textarea[id],select[id]')).slice(0,160)){
   if(!safeId(el.id)||el.disabled===true||el.readOnly===true)continue;
   const kind=String(el.tagName||'').toUpperCase(),type=String(el.type||'').toLowerCase();
   if(!['INPUT','TEXTAREA','SELECT'].includes(kind)||
      ['hidden','password','file','submit','button','reset','image'].includes(type))continue;
   if(['checkbox','radio'].includes(type)){
    if(el.checked!==el.defaultChecked)
     fields.push({id:el.id,kind,type,checked:el.checked===true});
   }else{
    const value=String(el.value??'');
    if(value.length>2048)continue;
    const initial=kind==='SELECT'
      ?String(Array.from(el.options||[]).find(o=>o.defaultSelected)?.value??
        el.options?.[0]?.value??'')
      :String(el.defaultValue??'');
    if(value!==initial||el===active)fields.push({id:el.id,kind,type,value});
   }
  }
 }
 const focus=editing&&safeId(active.id)?{
  id:active.id,start:Number.isInteger(active.selectionStart)?active.selectionStart:null,
  end:Number.isInteger(active.selectionEnd)?active.selectionEnd:null
 }:null;
 return {scope,details,fields,focus};
}
function merchantUiAfterRender(app,snapshot){
 const scope=merchantUiRenderScope();
 merchantLastRenderedScope=scope;
 if(!app||!scope||snapshot?.scope!==scope||
    typeof app.querySelectorAll!=='function')return;
 const nodes=new Map(Array.from(app.querySelectorAll('[id]')).slice(0,350)
  .map(el=>[el.id,el]));
 for(const record of snapshot.details||[]){
  const node=nodes.get(record.id);
  if(String(node?.tagName||'').toUpperCase()==='DETAILS')
   node.open=record.open===true;
 }
 for(const field of snapshot.fields||[]){
  const node=nodes.get(field.id);
  if(!node||node.disabled===true||node.readOnly===true||
     String(node.tagName||'').toUpperCase()!==field.kind||
     String(node.type||'').toLowerCase()!==field.type)continue;
  if(['checkbox','radio'].includes(field.type))node.checked=field.checked===true;
  else if(field.kind!=='SELECT'||Array.from(node.options||[]).some(o=>o.value===field.value))
   node.value=field.value;
 }
 const focused=snapshot.focus&&nodes.get(snapshot.focus.id);
 if(focused&&typeof focused.focus==='function'&&
    focused.disabled!==true&&focused.readOnly!==true){
  focused.focus({preventScroll:true});
  if(snapshot.focus.start!==null&&snapshot.focus.end!==null&&
     typeof focused.setSelectionRange==='function'){
   try{focused.setSelectionRange(snapshot.focus.start,snapshot.focus.end)}catch{}
  }
 }
}
function merchantUiRender(app,html){
 const snapshot=merchantUiBeforeRender(app);
 app.innerHTML=html;
 merchantUiAfterRender(app,snapshot);
}
merchantLastRenderedScope=merchantUiRenderScope();
globalThis.merchantUiRender=merchantUiRender;
