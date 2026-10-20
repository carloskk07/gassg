import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const customer=read('js/customer.js');
const growth=read('js/growth.js');
const merchant=read('js/merchant.js');
const admin=read('js/admin.js');
const core=read('js/core.js');
const css=read('css/components.css');
const premium=read('css/marketing-premium.css');
// Published homepage CSS must also style the expanded checkout with no duplicates.
for(const rule of ['.city-price-research-grid','.city-price-research-item',
  '.tamao-home-coupon-rail','.tamao-home-checkout-compare'])
  assert.ok(premium.includes(rule),'home/checkout CSS regression: '+rule);
assert.ok(premium.includes('@media(max-width:850px)'),
  'published price-first mobile breakpoint must be preserved');
assert.ok(customer.includes('tamao-home-checkout-compare')&&
  customer.includes('tamao-home-coupon-rail'),
  'expanded checkout must reuse the published styled components');
assert.ok(!customer.includes('tamao-checkout-total-compare')&&
  !customer.includes('tamao-checkout-coupon-callout'),
  'avoid stale checkout classes requiring duplicate CSS');
const merchantLogin=merchant.slice(
  merchant.indexOf('function merchantLiveLoginView(){'),
  merchant.indexOf('function merchantLiveNoAccess(){')
);
for(const token of ['merchant-access-grid','merchant-access-story','merchant-access-panel',
  'merchant-access-form','onsubmit="event.preventDefault();merchantLoginFromUi()"',
  'required','pilotInvite','prospectInvite','merchant-email','go(\'merchants\')'])
  assert.ok(merchantLogin.includes(token),'merchant login contract lost: '+token);
assert.ok(merchantLogin.includes('O cadastro da empresa passa por conferência'),
  'merchant cannot bypass commercial onboarding');
const adminLogin=admin.slice(admin.indexOf('function adminLoginView(){'),
  admin.indexOf('function adminNoAccessView(){'));
assert.ok(adminLogin.includes('onsubmit="event.preventDefault();adminLoginFromUi()"'));
assert.ok(adminLogin.includes('adminRuntime.actionPending'),'admin request state must remain');
assert.ok(adminLogin.includes('previamente autorizadas'),'server-based authorization remains clear');
assert.ok(core.includes('skip-to-main')&&core.includes('id="tamao-main"')&&core.includes('tabindex="-1"'),
  'skip-to-content keyboard navigation missing');
assert.ok(core.includes('<nav class="desktop-only desktop-nav" aria-label="Navegação principal">'));
assert.ok(growth.includes('Veja primeiro os produtos e escolha o que precisa.'),
  'how-it-works journey must not force CEP before discovery');
for(const token of ['.home-discover-grid','.merchant-access-grid',
  '.skip-to-main:focus-visible','@media(max-width:540px)',
  '@media(prefers-reduced-motion:reduce)'])
  assert.ok(css.includes(token),'missing responsive UX/a11y system: '+token);
console.log('TAMÃO V1.346: discovery, marketing, merchant/auth, accessibility contracts OK');
