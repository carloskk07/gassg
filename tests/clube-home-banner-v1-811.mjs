import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const get=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const customer=get('js/customer.js'), html=get('index.html'), css=get('css/marketing-premium.css'), bonus=get('js/welcome-bonus.js');
new vm.Script(customer);
assert.ok(customer.includes("getElementById('tamao-coupon-home-template')"));
assert.equal(customer.split('${couponBanner}').length-1,2,'both public and internal home variants show banner');
const start=html.indexOf('<template id="tamao-coupon-home-template">');
const end=html.indexOf('</template>',start);
assert.ok(start>0&&end>start,'static banner template exists');
const markup=html.slice(start,end);
const admin=get('js/admin.js'), adminOps=get('supabase/functions/admin-ops/index.ts');
new vm.Script(admin);
assert.ok(admin.includes("clube-coupon-commercial-status"),'Founder can check real commercial release');
assert.ok(admin.includes("clube-coupon-commercial-release"),'Founder can authorize sale via existing verified server');
assert.ok(admin.includes("clube-coupon-commercial-suspend"),'Founder can suspend new sales');
assert.ok(admin.includes("acceptRefund:true,acceptMerchantReimbursement:true"),'Explicit financial terms required');
assert.ok(admin.includes("clube-accept-all"),'Consolidated explicit supplier consent must remain required');
assert.ok(!admin.includes("clube-accept-refund"),'Do not demand four separate redundant checkboxes');
assert.ok(admin.includes("providerSeller") && admin.includes("Recebedor identificado no Mercado Pago"),'Use verified recipient instead of asking again');
assert.ok(adminOps.includes('profileFromMercadoPago:providerSeller!==null'),'Superadmin status must expose confirmed provider profile');
assert.ok(adminOps.includes('COUPON_SELLER_DOCUMENT_MISMATCH'),'Prevent sale registered to a different person');
assert.ok(adminOps.includes("COUPON_RELEASE_OWNER_ATTESTATION_REQUIRED"),'Server must reject missing seller identity');
assert.doesNotMatch(bonus,/Preço do pacote cadastrado\. A venda ainda não está liberada/,'No internal activation warning in homepage');
assert.ok(bonus.includes("p.databaseReleased===true"),'Only show commercial purchase guidance after DB release');


const begin=admin.indexOf('function adminCouponCommercialReleaseView(){');
const finish=admin.indexOf('\nfunction adminClubeCouponPreviewView()',begin);
assert.ok(begin>0&&finish>begin,'Coupon commercial view must be defined');
const doc='11144477735'; // synthetic validation-only identity
const fake={
  providerConfigured:true,commercialEnabled:false,privateEmergencyStop:false,
  profileFromMercadoPago:true,
  providerSeller:{name:'Vendedor Validado',taxDocument:doc,supportEmail:'ajuda@example.com',address:''},
  seller:null
};
const runtime={session:{user:{id:'account-1'}}};
const commercial={data:fake,loadedFor:'account-1'};
const escaped=x=>String(x).replace(/&/g,'&amp;').replace(/"/g,'&quot;')
  .replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;');
const scenario=vm.createContext({adminRuntime:runtime,adminCouponCommercial:commercial,
  adminCurrentRole:()=> 'superadmin',esc:escaped});
vm.runInContext(admin.slice(begin,finish)+'\nthis.view=adminCouponCommercialReleaseView;',scenario);
const verifiedHtml=scenario.view();
assert.match(verifiedHtml,/Recebedor identificado no Mercado Pago/);
assert.match(verifiedHtml,/CPF\/CNPJ com final 7735/);
assert.match(verifiedHtml,/id="clube-seller-name"/);
assert.match(verifiedHtml,/id="clube-seller-tax"/);
assert.equal((verifiedHtml.match(/type="checkbox"/g)||[]).length,1,
 'One explicit consolidated consent replaces four separate switches');
assert.match(verifiedHtml,/reembolso/);
assert.match(verifiedHtml,/ressarcimento às revendas/);
assert.match(verifiedHtml,/antes da entrada de revendas/);
assert.match(verifiedHtml,/divulgação desses dados/);
assert.match(verifiedHtml,/id="clube-seller-address"/);
assert.match(verifiedHtml,/id="clube-seller-support"/);
commercial.data={...fake,profileFromMercadoPago:false,providerSeller:null};
const fallbackHtml=scenario.view();
assert.doesNotMatch(fallbackHtml,/Recebedor identificado no Mercado Pago/);
assert.match(fallbackHtml,/Nome do titular da conta Mercado Pago/);
assert.match(fallbackHtml,/CPF\/CNPJ do recebedor/);
assert.match(fallbackHtml,/Não foi possível recuperar os dados do titular/);
commercial.data={...fake,providerSeller:{...fake.providerSeller,name:'<img src=x onerror=alert(1)>'}};
assert.doesNotMatch(scenario.view(),/<img src=x onerror=alert\(1\)>/,
 'Name from payment provider must never be trusted HTML');


// Regression: global Admin renders must not erase the partially entered
// seller address, support email, terms checkbox or typing caret.
const adminBootstrap=get('js/bootstrap.js');
assert.ok(adminBootstrap.includes('adminCouponCommercialCaptureFocus()') &&
  adminBootstrap.includes('adminCouponCommercialRestoreFocus(focus)'),
  'Admin shell must preserve the focused field when replacing #app');
const draftStart=admin.indexOf('const adminCouponCommercial={');
const draftEnd=admin.indexOf('async function adminCouponCommercialRefresh()',draftStart);
const viewStart=admin.indexOf('function adminCouponCommercialReleaseView(){');
const viewEnd=admin.indexOf('\nfunction adminClubeCouponPreviewView()',viewStart);
assert.ok(draftStart>0&&draftEnd>draftStart&&viewStart>draftEnd&&viewEnd>viewStart);
const dom={nodes:Object.create(null),activeElement:null,
  getElementById(id){return this.nodes[id]||null}};
const runtime={session:{user:{id:'founder-A'}}};
const state=vm.createContext({document:dom,adminRuntime:runtime,
  adminCurrentRole:()=> 'superadmin',
  esc:x=>String(x).replace(/&/g,'&amp;').replace(/"/g,'&quot;')
   .replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;')});
vm.runInContext(admin.slice(draftStart,draftEnd)+admin.slice(viewStart,viewEnd)+
  '\nthis.api={input:adminCouponCommercialDraftInput,'+
  'capture:adminCouponCommercialCaptureFocus,'+
  'restore:adminCouponCommercialRestoreFocus,'+
  'view:adminCouponCommercialReleaseView,'+
  'draft:adminCouponCommercialDraft,commercial:adminCouponCommercial};',state);
const scenarioData={commercialEnabled:false,providerConfigured:true,
  privateEmergencyStop:false,profileFromMercadoPago:false,
  providerSeller:null,seller:{address:'',supportEmail:''}};
state.api.commercial.data=scenarioData;
state.api.commercial.loadedFor='founder-A';
dom.nodes['clube-commercial-release-button']={id:'clube-commercial-release-button'};
const address={id:'clube-seller-address',type:'text',value:'Rua Sete de Setembro, 100, Centro',
  selectionStart:23,selectionEnd:23};
const email={id:'clube-seller-support',type:'email',value:'contato@empresa.com',
  selectionStart:13,selectionEnd:13};
dom.nodes[address.id]=address;
dom.nodes[email.id]=email;
dom.activeElement=address;
const saved=state.api.capture();
state.api.input(email);
state.api.input({id:'clube-accept-all',checked:true});
assert.equal(saved.id,'clube-seller-address');
assert.equal(saved.start,23);
let content=state.api.view();
assert.match(content,/value="Rua Sete de Setembro, 100, Centro"/);
assert.match(content,/value="contato@empresa.com"/);
assert.match(content,/id="clube-accept-all"[^>]* checked/);
assert.ok(!admin.includes('localStorage.setItem("clube-seller'),
  'Seller drafts must remain in RAM, not persist to disk');
let focusCalls=0,selection=null;
dom.nodes[address.id]={id:address.id,type:'text',
  focus:opts=>{if(opts?.preventScroll)focusCalls++;},
  setSelectionRange:(a,b)=>{selection=[a,b];}};
state.api.restore(saved);
assert.equal(focusCalls,1,'focused input must be restored after render');
assert.deepEqual(selection,[23,23],'restore typing position');
runtime.session.user.id='founder-B';
state.api.commercial.loadedFor='founder-B';
content=state.api.view();
assert.doesNotMatch(content,/Rua Sete de Setembro, 100, Centro|contato@empresa.com/);
assert.doesNotMatch(content,/id="clube-accept-all"[^>]* checked/);
state.api.restore(saved);
assert.equal(focusCalls,1,'never restore focus from another account');

for(const term of ['CLUBE TAMÃO','Cupons','Cashback','Indicações',"go('club')","go('earn')",'DESCONTOS EM COMPRAS ELEGÍVEIS','CUPONS','confirmados no Clube'])
 assert.ok(markup.includes(term),'banner missing: '+term);
for(const claim of ['ILUSTRAÇÃO DE CUPOM','EXEMPLO','R$ 5','Comprar agora','Compre seu pacote','Desconto garantido','Cupom disponível','Compre por Pix'])
 assert.ok(!markup.includes(claim),'cannot advertise sales before approval: '+claim);
assert.equal((markup.match(/<section /g)||[]).length,1);
assert.match(markup,/class="tamao-coupon-banner"/);
assert.match(markup,/class="tamao-coupon-price-board" hidden/);
assert.match(markup,/data-coupon-price/);
assert.match(markup,/data-coupon-minimum/);
assert.match(markup,/class="tamao-coupon-banner-main" onclick="tamaoWelcomeShowSignup\(\)"/);
assert.doesNotMatch(markup,/onclick="go\('club'\)">Quero participar/);
assert.ok(bonus.includes("clube_coupon_home_prices_v1_820") && bonus.includes("all_products_3x5_sponsor"));
assert.ok(bonus.includes("liveUpgradeAccount(email)"),'welcome signup must use real account confirmation');
assert.ok(css.includes('.tamao-coupon-banner-ticket')&&css.includes('@media(max-width:760px)'),'voucher must be responsive');
assert.ok(start>html.indexOf('<div id="toast"'),'banner template must survive app route rendering');
console.log('V1.811 PASS — truthful, responsive campaign banner as static HTML, two home routes and no merchant JS cost.');
