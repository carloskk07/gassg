import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const src=read('js/home-showcase.js');
const a=src.indexOf('function homeQuoteCouponRail(){'),b=src.indexOf('\n// TAMÃO V1.341',a);
assert.ok(a>=0&&b>a);
const ctx={globalThis:{liveReady:()=>false,liveRuntime:{session:{user:{id:'owner'}}}},
 clubePaidCouponOptions:()=>[{voucherId:'valid'}]};
vm.runInNewContext(src.slice(a,b)+';this.coupon=homeQuoteCouponRail;',ctx);
const anonymous=ctx.coupon();
assert.match(anonymous,/Cupons, descontos e Clube/);
assert.doesNotMatch(anonymous,/1 cupom emitido/);
assert.match(anonymous,/Ver cupons e Clube/);
ctx.globalThis.liveReady=()=>true;
ctx.globalThis.liveRuntime.session=null;
assert.doesNotMatch(ctx.coupon(),/1 cupom emitido/);
ctx.globalThis.liveRuntime.session={user:{id:'owner'}};
assert.match(ctx.coupon(),/1 cupom emitido na sua conta/);
ctx.clubePaidCouponOptions=()=>[{voucherId:'a'},{voucherId:'b'}];
assert.match(ctx.coupon(),/2 cupons emitidos na sua conta/);
ctx.clubePaidCouponOptions=()=>[];
assert.match(ctx.coupon(),/Cupons, descontos e Clube/);
for(const markup of [anonymous,ctx.coupon()]){
 assert.equal((markup.match(/class="tamao-home-coupon-rail"/g)||[]).length,1);
 assert.match(markup,/onclick="go\(\\'club\\'\)"/);
 assert.doesNotMatch(markup,/economia garantida|desconto garantido|\b\d+%/i);
}
assert.ok(src.indexOf('city-price-grid')<src.indexOf('homeQuoteCouponRail()+'));
new vm.Script(src);
console.log('PASS: coupon count only from ready user-scoped vouchers; no invented discount');
