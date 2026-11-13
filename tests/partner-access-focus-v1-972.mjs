import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const core=read('js/core.js'),merchant=read('js/merchant.js'),
 audit=read('.github/workflows/audit.yml');
new vm.Script(core,{filename:'core.js'});
new vm.Script(merchant,{filename:'merchant.js'});
function take(src,start,end){
 const a=src.indexOf(start),b=src.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'Boundary missing: '+start);
 return src.slice(a,b);
}
let page='merchant',invite='';
const entry=vm.createContext({
 route:()=>page,shell:s=>s,esc:x=>String(x),
 globalThis:{merchantRuntime:{status:'unauthenticated'},
 merchantPilotInviteToken:()=>invite,merchantProspectInviteToken:()=>''}
});
vm.runInContext(take(merchant,'function merchantLiveLoginView(){','function merchantLiveNoAccess(){')+
 '\nthis.login=merchantLiveLoginView;',entry);
let html=entry.login();
assert.match(html,/Entrar no painel da revenda/);
assert.match(html,/id="merchant-email"/);
assert.match(html,/merchantLoginFromUi\(\)/);
assert.match(html,/Enviar meu link de acesso/);
assert.doesNotMatch(html,/merchant-access-points|merchant-access-about|merchant-access-footnote/,
 'Real login must be email-first, not a second commercial landing page');
page='merchant-join';html=entry.login();
assert.match(html,/Cadastre sua revenda no TAMÃO/);
assert.match(html,/merchant-access-points/);
assert.match(html,/merchant-access-footnote/);
assert.match(html,/Continuar meu cadastro/);
page='merchant';invite='invite-test';
html=entry.login();
assert.match(html,/Continue seu cadastro/);
assert.match(html,/Convite reconhecido/);
assert.match(html,/merchant-access-footnote/);
// Every protected merchant screen gets a concise legal footer, not public
// navigation and 11 irrelevant sales/service links.
const shellSrc=take(core,'function siteFooter(','function setMode(m){');
const env={
 route:()=>page,state:{mode:'customer',user:{}},
 runtimeStrip:()=>'',activeOrder:()=>null,
 globalThis:{adminPortalRequested:()=>false,merchantPortalRequested:()=>true,
  merchantRuntime:{status:'unauthenticated',merchant:null},
  __CHAMA_TEST__:false,location:{hostname:'parceiro.tamao.com.br'}},
 esc:s=>String(s)
};
vm.runInNewContext(shellSrc+'\nthis.shell=shell;this.footer=siteFooter;this.mobile=bottomNav;',env);
html=env.shell('<section><h1>Acesso</h1></section>');
const header=html.slice(html.indexOf('<header'),html.indexOf('</header>'));
const footer=html.slice(html.indexOf('<footer'),html.indexOf('</footer>')+9);
assert.match(header,/Ver site/);
assert.doesNotMatch(header,/Operação<\/button>|Catálogo<\/button>|Parceiros<\/button>|Alternar modo/);
assert.doesNotMatch(html,/class="bottom-nav"/);
assert.match(footer,/Informações legais do Parceiro/);
for(const link of ['https://tamao.com.br/#privacy','https://tamao.com.br/#terms','https://tamao.com.br/#home'])
 assert.ok(footer.includes(link));
assert.doesNotMatch(footer,/Caronas|Minhas corridas|Anunciar|Para marcas|Indicações/);
env.globalThis.merchantRuntime={status:'ready',merchant:{memberRole:'owner'}};
html=env.shell('<section><h1>Operação</h1></section>');
assert.match(html,/Meu painel/);
assert.match(html,/class="bottom-nav"/);
assert.match(html,/aria-label="Informações legais do Parceiro"/);
env.globalThis.merchantRuntime={status:'ready',merchant:{memberRole:'driver'}};
assert.match(env.mobile('merchant'),/Entregas/);
assert.doesNotMatch(env.mobile('merchant'),/Catálogo|Equipe/);
env.globalThis.merchantRuntime={status:'unavailable',merchant:{memberRole:'driver'},session:{access_token:'local-verified-session'}};
assert.match(env.mobile('merchant'),/Entregas/,'Offline authorized driver keeps delivery recovery');
env.globalThis.merchantRuntime={status:'unavailable',merchant:{memberRole:'driver'},session:null};
assert.equal(env.mobile('merchant'),'','No session means no privileged footer navigation');
env.globalThis.merchantPortalRequested=()=>false;
html=env.shell('<h1>Produtos</h1>');
assert.match(html,/Caronas/);
assert.match(html,/Para marcas/);
assert.match(html,/Comprar/);
env.globalThis.adminPortalRequested=()=>true;
assert.equal(env.footer({adminPortal:true}),'');
assert.match(env.mobile('admin'),/Admin/);
assert.match(audit,/node tests\/partner-access-focus-v1-972\.mjs/);
console.log('V1.972 partner PASS: one email action, invite-safe onboarding, lean protected legal footer and no fake unauthenticated shortcuts.');
