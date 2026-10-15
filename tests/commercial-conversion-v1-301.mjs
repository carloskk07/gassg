import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const growth=read('js/growth.js'),legal=read('js/legal.js');
const analytics=read('js/analytics.js'),bootstrap=read('js/bootstrap.js');
const css=read('css/components.css'),audit=read('.github/workflows/audit.yml');
for(const [file,code] of [['growth',growth],['legal',legal],['analytics',analytics],['bootstrap',bootstrap]])
  new vm.Script(code,{filename:file+'.js'});
const cut=(src,name)=>{
 const found=src.indexOf('function '+name+'(');
 assert.ok(found>=0,'missing function '+name);
 const start=src.slice(Math.max(0,found-6),found)==='async '?found-6:found;
 const end=src.indexOf('\n}',found);
 assert.ok(end>start,'missing end '+name);
 return src.slice(start,end+2);
};
const slice=(name)=>{
 const start=growth.indexOf('function '+name+'(){');
 const end=growth.indexOf('\nfunction ',start+15);
 return growth.slice(start,end>start?end:undefined);
};
const sponsor=slice('sponsorsLanding'),merchants=slice('merchantsLanding'),earn=slice('earn');
assert.equal((sponsor.match(/onclick="openSponsorContact\(\)"/g)||[]).length,2);
assert.match(sponsor,/aria-label="Como iniciar uma parceria de marca"/);
assert.match(sponsor,/Apresente sua marca/);
assert.match(sponsor,/Orçamento e critérios/);
assert.doesNotMatch(sponsor,/centenas de anunciantes|garantimos resultados/);
assert.match(merchants,/aria-label="Como começar a vender pelo TAMÃO"/);
assert.match(merchants,/Prepare sua operação/);
assert.match(merchants,/Após habilitação/);
assert.match(merchants,/prelaunchMerchantLeadSection\(\)/);
assert.match(merchants,/merchantFeeLabel/);
assert.match(earn,/tamao-cro-paths/);
for(const target of ["go('refer')","go('club')","go('merchants')"])
 assert.ok(earn.includes(target));
assert.match(earn,/referralRateLabel/);
for(const mark of ['.tamao-cro-steps','.tamao-cro-paths','@media(max-width:520px)'])
 assert.ok(css.includes(mark));
assert.ok(bootstrap.includes('openSponsorContact,'));
assert.match(legal,/<option value="sponsor">Parceria de marca<\/option>/);
assert.ok(legal.includes("uiKind==='sponsor'?'general':uiKind"));
assert.ok(legal.includes("[Parcerias e patrocínios] "));
assert.ok(audit.includes('node tests/commercial-conversion-v1-301.mjs'));

let routeName='sponsors',visible='',focused=false;
const fields={
 'public-request-kind':{value:'general'},
 'public-request-message':{value:''},
 'public-contact-name':{focus:()=>{focused=true}}
};
const ctx=vm.createContext({
 route:()=>routeName,go:n=>{routeName=n;},setTimeout:cb=>cb(),
 document:{getElementById:id=>fields[id]||null,
 querySelector:k=>k==='.public-contact-card'?{scrollIntoView:()=>{visible=k}}:null},
 globalThis:{contactKindChanged:()=>{}}
});
vm.runInContext(cut(growth,'openSponsorContact')+'\nthis.open=openSponsorContact;',ctx);
ctx.open();
assert.equal(routeName,'contact');
assert.equal(fields['public-request-kind'].value,'sponsor');
assert.match(fields['public-request-message'].value,/Tenho interesse em uma parceria/);
assert.equal(visible,'.public-contact-card');assert.equal(focused,true);
fields['public-request-message'].value='Mensagem personalizada';
ctx.open();
assert.equal(fields['public-request-message'].value,'Mensagem personalizada');

const elements={
 '#public-request-submit':{disabled:false,textContent:'Enviar solicitação'},
 '#public-request-result':{textContent:'',className:''},
 '#public-request-kind':{value:'sponsor'},
 '#public-privacy-action':{value:''},
 '#public-contact-name':{value:'Responsável'},
 '#public-contact-channel':{value:'email'},
 '#public-contact-value':{value:'marca@example.com'},
 '#public-request-message':{value:'Gostaria de conhecer os formatos de divulgação regional.'},
 '#public-request-website':{value:''},
 '#public-request-ack':{checked:true}
};
let payload=null,toastText='';
const send=vm.createContext({
 document:{querySelector:k=>elements[k]||null},
 globalThis:{publicRequestSubmit:async body=>{payload=body;return {message:'Contato recebido',protocol:'ref123'}}},
 toast:s=>{toastText=String(s)},String
});
vm.runInContext(cut(legal,'submitPublicRequest')+'\nthis.send=submitPublicRequest;',send);
await send.send();
assert.equal(toastText,'');
assert.equal(payload.requestKind,'general');
assert.match(payload.message,/^\[Parcerias e patrocínios\] /);
assert.equal(payload.contactValue,'marca@example.com');
assert.equal(elements['#public-request-result'].className,'lead-result success');
assert.equal(payload.acknowledged,true);

assert.ok(analytics.includes("['merchants','merchant-join','sponsors']"));
assert.ok(analytics.includes("'home','learn','earn','merchants','sponsors','contact'"));
assert.ok(analytics.includes("marketingAnalyticsState.lastLandingRoute=current"));
let current='home',count=[];
const track=vm.createContext({
 marketingAnalyticsState:{landingAttempted:false,lastLandingRoute:null},
 marketingTrack:(event,audience)=>{count.push({event,audience,route:current});return Promise.resolve(true)},
 marketingAnalyticsAudience:()=>current==='sponsors'?'merchant':'customer',
 route:()=>current
});
vm.runInContext(cut(analytics,'marketingTrackLandingOnce')+'\nthis.observe=marketingTrackLandingOnce;',track);
track.observe();track.observe();current='sponsors';track.observe();track.observe();
assert.equal(count.length,2);assert.equal(count[1].audience,'merchant');
current='merchant-orders';track.observe();assert.equal(count.length,2);
console.log('V1.301 PASS — sponsor inquiry, merchant flow, earning paths and route impressions.');
