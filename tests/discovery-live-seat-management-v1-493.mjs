import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Real owner module and form callbacks; all data is local/synthetic.
const read=x=>fs.readFileSync(new URL('../'+x,import.meta.url),'utf8');
const source=read('js/discovery-owner.js');
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const owner={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',email:'owner@example.invalid'};
const publication={id,vertical:'rides',status:'published',title:'Carona eventual autorizada',
 city_name:'São Gabriel',state_code:'RS',description:'Viagem eventual de teste sem pessoas reais.',
 whatsapp_e164:'+5555999999999',photo_urls:[]};
let remaining=2,changes=[],seatError=null,holdList=null;
const afterDeparture=new Date(Date.now()+86400000*4).toISOString();
const client={
 auth:{signOut:async()=>({error:null})},
 rpc:async(name,args)=>{
  if(name==='discovery_my_listings'){
   if(holdList)return holdList;
   return {data:[{...publication}],error:null};
  }
  if(name==='discovery_update_ride_seats'){
   changes.push(args);
   if(seatError)return {data:null,error:seatError};
   remaining=args.p_seats_available;
   return {data:remaining,error:null};
  }
  throw Error('unexpected RPC '+name);
 },
 from(name){
  assert.equal(name,'discovery_ride_details');
  return {select(columns){
   assert.equal(columns,'listing_id,seats_total,seats_available,departure_at');
   return {in:async(key,ids)=>{
    assert.equal(key,'listing_id');
    assert.equal(Array.from(ids).join(','),id);
    return {data:[{listing_id:id,seats_total:4,seats_available:remaining,departure_at:afterDeparture}],error:null};
   }};
  }};
 }
};
const ctx={console,Date,URL,URLSearchParams,location:{origin:'https://tamao.com.br',search:''},
 route:()=> 'advertise',shell:x=>x,render:()=>{},esc:x=>String(x??'').replaceAll('<','&lt;'),
 document:{},CHAMA_BACKEND:{url:'https://example.invalid',publishableKey:'anon'},
 FormData:class{constructor(form){this.form=form}get(key){return this.form.fields[key]}}};
ctx.globalThis=ctx;
vm.runInNewContext(source+';this.state=discoveryOwner;',ctx);
const s=ctx.state;s.phase='ready';s.user=owner;s.client=client;s.items=[];
assert.equal(await ctx.discoveryOwnerRefresh(),true);
assert.match(ctx.discoveryOwnerPage(),/Atualizar vagas/);
assert.match(ctx.discoveryOwnerPage(),/Vagas disponíveis agora \(de 4\)/);
assert.match(ctx.discoveryOwnerPage(),/value="2"/);
const submit=n=>ctx.discoveryOwnerUpdateRideSeats({preventDefault(){},target:{fields:{seats:String(n)}}},id);
assert.equal(await submit(0),false);
assert.equal(changes.length,1);
assert.equal(changes[0].p_listing_id,id);
assert.equal(changes[0].p_seats_available,0);
assert.equal(s.items[0].liveSeats.seats_available,0);
assert.match(s.notice,/retirada das buscas públicas/);
assert.match(ctx.discoveryOwnerPage(),/value="0"/);
assert.equal(await submit(2),false);
assert.equal(remaining,2);
assert.match(s.notice,/Vagas atualizadas/);
const previous=changes.length;
assert.equal(await submit(5),false);
assert.equal(changes.length,previous,'client must reject more than vehicle capacity');
assert.match(s.error,/entre zero e a capacidade/);
seatError={code:'42501',message:'RIDE_NOT_EDITABLE'};
assert.equal(await submit(1),false);
assert.equal(remaining,2,'rejected mutation must preserve last confirmed capacity');
assert.equal(s.items[0].liveSeats.seats_available,2);
assert.match(s.error,/não tem permissão/);
seatError=null;
// A delayed refresh from a signed-out owner cannot resurrect a private draft.
let releaseList;
holdList=new Promise(resolve=>{releaseList=resolve});
const pending=ctx.discoveryOwnerRefresh();
await ctx.discoveryOwnerLogout();
releaseList({data:[{...publication}],error:null});
assert.equal(await pending,false);
assert.equal(s.user,null);
assert.equal(s.items.length,0);
const audit=read('.github/workflows/audit.yml');
assert.ok(audit.includes('node tests/discovery-live-seat-management-v1-493.mjs'));
const migration=read('supabase/migrations/20261101195756_discovery_live_ride_seat_management_v1_493.sql');
assert.match(migration,/for update of l,r/);
assert.match(migration,/l.owner_id=v_actor/);
assert.match(migration,/l.status='published'/);
assert.match(migration,/p_seats_available>v_total/);
assert.match(migration,/revoke all on function public.discovery_update_ride_seats/);
console.log('PASS: owner carona live seat adjustment, denied or invalid updates, no stale-owner disclosure');
