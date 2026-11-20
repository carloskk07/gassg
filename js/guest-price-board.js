// V1.1087: read only regional estimates on the public homepage, with no Auth
// client, anonymous Supabase user, quote, order, or address registration.
let tamaoGuestPriceBoardSeq=0;
async function tamaoGuestCityPriceBoard(){
 if(globalThis.__CHAMA_TEST__===true||!globalThis.liveRequested?.()||
    typeof customerOriginSafe!=='function'||!customerOriginSafe()||
    typeof homeMarketRegion!=='function'||typeof CHAMA_BACKEND==='undefined'||
    !CHAMA_BACKEND.url||!CHAMA_BACKEND.publishableKey)return null;
 const rt=globalThis.liveRuntime;
 if(!rt||globalThis.liveReady?.()===true)return null;
 const selected=homeMarketRegion();
 const city=String(selected?.city||''),uf=String(selected?.state||'');
 if(!/^[\p{L}\p{M} .'-]{2,80}$/u.test(city)||!/^[A-Z]{2}$/.test(uf))return null;
 if(rt.cityPriceSnapshot?.city===city&&rt.cityPriceSnapshot?.state===uf&&
    Date.now()-Number(rt.lastCityPriceBoardAt||0)<90000)return rt.cityPriceSnapshot;
 const sequence=++tamaoGuestPriceBoardSeq;
 const response=await fetch(CHAMA_BACKEND.url+'/rest/v1/rpc/public_city_price_board_v1_341',{
   method:'POST',cache:'no-store',
   headers:{'apikey':CHAMA_BACKEND.publishableKey,'Content-Type':'application/json'},
   body:JSON.stringify({p_city:city,p_state:uf})
 });
 if(!response.ok)throw new Error('Regional price board unavailable');
 const data=await response.json();
 if(data?.source!=='public_city_price_board_v1_341'||data.city!==city||data.state!==uf||
    data.kind!=='eligible_merchant_estimates'||data.real!==true||
    data.notAQuote!==true||data.requiresPostalConfirmation!==true||
    !Number.isSafeInteger(data.productCount)||data.productCount<0||
    !Array.isArray(data.products)||data.products.length!==data.productCount||
    data.products.length>120||
    !Number.isFinite(Date.parse(String(data.checkedAt||'')))||
    data.products.some(p=>!p||!/^[A-Z][A-Z0-9_]{1,31}$/.test(String(p.code||''))||
     !Number.isSafeInteger(p.fromCents)||p.fromCents<=0||
     !Number.isSafeInteger(p.toCents)||p.toCents<p.fromCents||
     !Number.isSafeInteger(p.merchantCount)||p.merchantCount<1||
     !Number.isFinite(Date.parse(String(p.updatedAt||'')))))
   throw new Error('Regional price board integrity failed');
 const current=homeMarketRegion();
 if(sequence!==tamaoGuestPriceBoardSeq||globalThis.liveRuntime!==rt||
    globalThis.liveReady?.()===true||current.city!==city||current.state!==uf)
   return null;
 rt.cityPriceSnapshot=data;
 rt.lastCityPriceBoardAt=Date.now();
 if(route()==='home')render();
 return data;
}
globalThis.tamaoGuestCityPriceBoard=tamaoGuestCityPriceBoard;
if(route()==='home')tamaoGuestCityPriceBoard().catch(()=>{});
window.addEventListener('hashchange',()=>{
 if(route()==='home')tamaoGuestCityPriceBoard().catch(()=>{});
});
