import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const edge=read('supabase/functions/participant-pages/index.ts');
const migration=read('supabase/migrations/20261119160000_participant_driver_advertiser_v1_1080.sql');
const page=read('p/page.js');
const owner=read('js/participant-native-owner.js');
const discovery=read('js/discovery-owner.js');
const ads=read('js/ads-planner.js');
const old=read('tests/participant-native-pages-v1-1072.mjs');

for(const name of ['p/page.js','js/participant-native-owner.js',
 'js/discovery-owner.js','js/ads-planner.js']){
 new vm.Script(read(name),{filename:name});
}
assert.match(migration,/CHECK \(kind IN \('merchant','customer','listing','agenda','driver','advertiser'\)\)/);
assert.match(migration,/DROP CONSTRAINT participant_pages_v1_1072_kind_check/);
assert.doesNotMatch(migration,/\b(?:GRANT|CREATE POLICY|DISABLE ROW LEVEL SECURITY)\b/i);
assert.match(edge,/const KINDS=new Set\(\["merchant","customer","listing","agenda","driver","advertiser"\]\)/);
assert.match(edge,/if\(kind==="driver"\)/);
assert.match(edge,/if\(kind==="advertiser"\)/);
assert.match(edge,/l\.vertical!=="professionals"/);
assert.match(edge,/l\.owner_id!==actor/);
assert.match(edge,/c\.owner_user_id!==actor/);
assert.match(edge,/from\("discovery_professional_details"\)/);
assert.match(edge,/from\("discovery_vertical_cities"\)/);
assert.match(edge,/\.eq\("state_code",l\.state_code\)\.eq\("city_key",l\.city_key\)/);
assert.match(edge,/l\.status==="published"&&city\?\.enabled===true/);
assert.match(edge,/const moto=\/\(motot\[aá\]xi\|moto\.\?taxi\)\/i/);
assert.match(edge,/const carro=!moto&&\/\(motorista\|t\[aá\]xi\|taxista\)\/i/);
assert.match(edge,/c\.status==="active"/);
assert.match(edge,/Date\.parse\(String\(c\.run_ends_at\|\|""\)\)>now/);
assert.match(edge,/Boolean\(safeAdvertiserURL\(c\.destination_url\)\)/);
assert.match(edge,/if\(publishing&&!canPublish\)throw new PageError\("NOT_PUBLISHED",409\)/);
assert.match(edge,/if\(page\.kind==="driver"\)/);
assert.match(edge,/base\.driverMode=source\.driverMode/);
assert.match(edge,/if\(page\.kind==="advertiser"\)/);
assert.match(edge,/base\.destinationUrl=safeAdvertiserURL\(c\.destination_url\)/);
assert.match(edge,/await auth\.auth\.getUser\(token\)/);
assert.match(edge,/if\(!code\)throw new PageError\('NOT_FOUND',404\)/);
assert.doesNotMatch(edge,/insert\("mobility_requests"\)|create-order|wallet_entries|payment_intents|commission_ledger/);

assert.match(owner,/tamaoNativePageKind\(kind\)/);
assert.match(owner,/\['listing','driver'\]\.includes\(kind\)\?globalThis\.discoveryOwner\?\.client/);
assert.match(owner,/advertiser:'Minha página do anunciante'/);
assert.match(discovery,/from\('discovery_professional_details'\)/);
assert.match(discovery,/\.in\('listing_id',professionalIds\)/);
assert.match(discovery,/pageKind=x\.vertical==='professionals'.*x\.driverMode/);
assert.match(discovery,/tamaoParticipantNativePanel\(pageKind,id\)/);
assert.match(ads,/c\.status==='active'&&String\(c\.effectiveStatus\|\|c\.status\)==='active'/);
assert.match(ads,/tamaoParticipantNativePanel\('advertiser',id\)/);

const start=page.indexOf(' function externalAdvertiserURL(raw){');
const end=page.indexOf('\n // The same five',start);
assert.ok(start>0&&end>start,'Advertiser URL verifier must be isolated');
const context=vm.createContext({URL});
vm.runInContext(page.slice(start,end),context);
assert.equal(context.externalAdvertiserURL('https://empresa.example.com/campanha'),
 'https://empresa.example.com/campanha');
for(const unsafe of [
 'http://empresa.example.com','javascript:alert(1)','https://localhost/test',
 'https://127.0.0.1/','https://empresa.local/oferta',
 'https://empresa.internal/oferta','https://user@empresa.example.com/',
 'https://empresa.example.com/a b','https://[::1]/','https://empresa.example.com/<iframe>'
]){
 assert.equal(context.externalAdvertiserURL(unsafe),'',unsafe);
}
assert.match(page,/official\(ref,\{corrida:data\.listingId,modalidade:data\.driverMode\},"mobility"\)/);
assert.match(page,/main\.rel="noopener noreferrer nofollow sponsored"/);
assert.match(page,/main\.referrerPolicy="no-referrer"/);
assert.match(page,/main\.target="_blank"/);
assert.match(page,/if\(ref\)u\.searchParams\.set\("ref",ref\)/);
assert.match(page,/data\.kind==="driver"/);
assert.match(page,/data\.kind==="advertiser"/);
assert.match(old,/INVALID_MERCHANT_CHOICE/);
console.log('PASS V1.1080: authenticated owner, published driver taxonomy/city, active Ads, URL safety, native links and no new financial authority.');
