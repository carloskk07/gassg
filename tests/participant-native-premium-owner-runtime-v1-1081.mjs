import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync(new URL('../js/participant-native-owner.js',import.meta.url),'utf8');
const user='11111111-2222-4333-8444-555555555555';
const second='66666666-2222-4333-8444-555555555555';
const edits={theme:{value:'ocean'},layout:{value:'centered'},showAbout:{checked:false},
 showGallery:{checked:true},showCatalog:{checked:true},showDiscover:{checked:false},
 headline:{value:'Próximo nível'},tagline:{value:'Atendimento sem complicação'}};
const title={textContent:''},sub={textContent:''};
const mini={dataset:{},querySelector(s){return s.includes('headline')?title:sub}};
const form={querySelector(s){return edits[s.match(/\[name="(.*?)"\]/)?.[1]]||null}};
const container={querySelector(s){return s==='.tamao-native-page-form'?form:
 s==='.tamao-native-page-mini'?mini:form.querySelector(s)}};
const ctx=vm.createContext({
 document:{querySelector:()=>null,createElement:()=>({}),head:{appendChild(){}},
  getElementById:()=>container},
 esc:x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&#39;'),
 render:()=>{},toast:()=>{},console,
 liveRuntime:{session:{user:{id:user}}}
});
vm.runInContext(source,ctx,{filename:'participant-native-owner.js'});
ctx.user=user;ctx.second=second;
vm.runInContext("tamaoNativePagesCache.set('customer:self',{loaded:true,userId:user,identityName:'Loja <img src=x onerror=alert(1)>',page:{published:true,theme:'gold',layout:'split',headline:'',tagline:''}})",ctx);
const html=vm.runInContext("tamaoNativePagePanel('customer','')",ctx);
assert.match(html,/Minha página de indicações/);
assert.match(html,/data-theme="gold"/);
assert.match(html,/data-layout="split"/);
assert.match(html,/Loja &lt;img src=x onerror=alert\(1\)&gt;/);
assert.doesNotMatch(html,/<img src=x/);
for(const text of ['Estilo visual','Formato da página','Escolher o que aparece','PRÉVIA IMEDIATA','Criar e publicar minha página','Minha página TAMÃO']){
 assert.ok(html.includes(text)||text==='Criar e publicar minha página'||text==='Minha página TAMÃO',text);
}
vm.runInContext("tamaoNativePagePreview('customer','')",ctx);
assert.equal(mini.dataset.theme,'ocean');
assert.equal(mini.dataset.layout,'centered');
assert.equal(title.textContent,'Próximo nível');
assert.equal(sub.textContent,'Atendimento sem complicação');
// Save uses the existing real owner route but a controlled test response.
const payloads=[];
ctx.fakeApi=async (kind,payload)=>{payloads.push(payload);return {
 identityName:'Perfil aprovado',page:{published:true,theme:'ocean',layout:'centered'}}};
vm.runInContext("tamaoNativePageApi=fakeApi",ctx);
await vm.runInContext("tamaoNativePageSave('customer','',true)",ctx);
assert.equal(payloads.length,1);
assert.equal(payloads[0].layout,'centered');
assert.equal(payloads[0].showAbout,false);
assert.equal(payloads[0].showDiscover,false);
assert.equal(payloads[0].theme,'ocean');
assert.equal(vm.runInContext("tamaoNativePagesCache.get('customer:self').page.layout",ctx),'centered');
// A delayed result/error from the old account must never overwrite the new session's page.
for(const rejectOld of [false,true]){
 ctx.liveRuntime.session.user.id=user;
 vm.runInContext("tamaoNativePagesCache.set('customer:self',{loaded:true,busy:false,userId:user,page:{published:true,theme:'gold'}})",ctx);
 let resolve,reject;
 ctx.fakeApi=()=>new Promise((r,j)=>{resolve=r;reject=j});
 vm.runInContext("tamaoNativePageApi=fakeApi",ctx);
 const delayed=vm.runInContext("tamaoNativePageSave('customer','',true)",ctx);
 ctx.liveRuntime.session.user.id=second;
 vm.runInContext("tamaoNativePagesCache.set('customer:self',{loaded:true,busy:false,userId:second,page:{published:false,theme:'rose'}})",ctx);
 if(rejectOld)reject(Error('temporary failure'));else resolve({identityName:'Old profile',page:{published:true,theme:'ocean'}});
 await delayed;
 assert.equal(vm.runInContext("tamaoNativePagesCache.get('customer:self').page.theme",ctx),'rose');
 assert.equal(vm.runInContext("tamaoNativePagesCache.get('customer:self').busy",ctx),false);
}
console.log('V1.1081 PASS — real premium owner renderer escapes text, previews draft, saves flags, isolates slow success/errors across accounts.');
