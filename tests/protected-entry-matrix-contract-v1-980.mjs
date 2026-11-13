import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const matrix=read('tests/isolated-protected-entry-screens-v1-980.mjs');
const browser=read('tests/isolated-live-portal-browser.mjs');
const admin=read('js/admin.js');
const merchant=read('js/merchant.js');
const audit=read('.github/workflows/audit.yml');
assert.match(browser,/auditProtectedEntryScreensV1980\(\{guestMerchant,guestAdmin,origin\}\)/);
assert.match(browser,/openRole\('merchant',null,'\/\?merchant=1#merchant'\)/);
assert.match(browser,/openRole\('admin',null,'\/\?admin=1#admin'\)/);
assert.match(browser,/assert\.deepEqual\(auth,\{customer:!!session&&role==='customer',merchant:!!session&&role==='merchant',admin:!!session&&role==='admin'\}/);
assert.match(browser,/else if\(session\)\{/);
assert.match(matrix,/^\/\/ V1\.980: actual/m);
for(const width of [320,360,768,1280,1920])
 assert.match(matrix,new RegExp('width:'+width+'\\b'));
assert.match(matrix,/await guestMerchant\.navigate\(origin\+'\/\?merchant=1#merchant-join'\)/);
assert.match(matrix,/assert\.equal\(d\.status,'unauthenticated'/);
assert.match(matrix,/assert\.equal\(d\.headingCount,1/);
assert.match(matrix,/assert\.equal\(d\.formCount,1/);
assert.match(matrix,/assert\.equal\(d\.inputLabeled,true/);
assert.match(matrix,/assert\.deepEqual\(d\.duplicateIds,\[\]/);
assert.match(matrix,/assert\.equal\(d\.authPresent,false/);
assert.match(matrix,/assert\.equal\(d\.privateWorkspace,false/);
assert.match(matrix,/assert\.equal\(d\.renderError,null/);
assert.match(matrix,/firstFold&&size\.width<=360/);
assert.match(matrix,/V1\.980 ANONYMOUS_ENTRY_MATRIX/);
assert.doesNotMatch(matrix,/\.(?:click|submit)\(|adminLoginFromUi\(|merchantLoginFromUi\(|adminPerform\(|merchantPerformAction\(|createPayment\(|generatePix\(/);
assert.match(admin,/function adminLoginView\(\)/);
assert.match(admin,/id="admin-email".*type="email"/);
assert.match(merchant,/function merchantLiveLoginView\(\)/);
assert.match(merchant,/id="merchant-email".*type="email"/);
const loginStart=merchant.indexOf('function merchantLiveLoginView(){');
const loginEnd=merchant.indexOf('function merchantLiveNoAccess(){',loginStart);
const login=merchant.slice(loginStart,loginEnd);
assert.ok(login.indexOf('<form class="card flat form-stack merchant-access-form"')<
 login.indexOf('merchant-access-secondary'),
 'Onboarding form must precede optional advertising alternative');
assert.match(login,/Quer só anunciar seu comércio\?/);
const css=read('css/components.css');
assert.match(css,/@media\(max-width:540px\)[\s\S]*?\.merchant-access-points\{display:none\}/);

assert.match(audit,/node tests\/protected-entry-matrix-contract-v1-980\.mjs/);
console.log('V1.980 PASS: isolated anonymous Admin/merchant login and signup, 5 widths, accessible form and zero transaction triggers.');
