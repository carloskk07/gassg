import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const discovery=read('js/discovery.js');
const css=read('css/discovery.css');
const shared=read('css/visual-finish.css');
const boot=read('js/bootstrap.js');
const owner=read('js/discovery-owner.js');
const mobility=read('js/mobility.js');
new vm.Script(discovery,{filename:'discovery.js'});

const localPhoto='https://images.unsplash.com/photo-1673528218483-cc37fb93b2fe';
const originalPhoto='https://images.unsplash.com/photo-1633230329626-f0fddf6e1154';
const source='https://unsplash.com/photos/a-highway-with-a-car-driving-down-the-middle-of-it-J5HTafFYXL8';
assert.ok(discovery.includes(localPhoto),'Authentic Rio Grande do Sul photo missing');
assert.ok(discovery.includes(source),'Source and photo author attribution missing');
assert.doesNotMatch(discovery,/photo-1633230329626-f0fddf6e1154/,'Foreign coastal road must be gone');
assert.match(discovery,/alt="Rodovia entre campos em Arroio Grande, Rio Grande do Sul/);
assert.match(discovery,/Foto: Pedro Fritsch · Arroio Grande\/RS · Unsplash/);
assert.match(discovery,/class="rides-photo-credit" href="https:\/\/unsplash\.com\/photos\//);
assert.match(discovery,/target="_blank" rel="noopener noreferrer"/);
assert.match(discovery,/class="rides-hero-primary" onclick="document\.getElementById\('discovery-origin'\)\?\.focus\(\)"/);

for(const kind of ['bolt','droplet','construction','paint','clean','leaf']){
 assert.ok(css.includes('--pros-'+kind+':url("data:image/svg+xml,'),'Missing professional icon '+kind);
}
for(let i=1;i<=6;i++)assert.ok(css.includes('.pros-specialty:nth-child('+i+')'),'Professional icon '+i+' mapping missing');
assert.match(discovery,/class="pros-specialty-icon" aria-hidden="true"><\/span>/,'Specialty name is text; icon itself must be graphic');
assert.doesNotMatch(discovery,/pros-specialty-icon" aria-hidden="true">(?:⚡|◈|▤|◒|✧|✿)/);
assert.match(css,/\.discovery-professionals \.pros-specialty\[aria-pressed="true"\] \.pros-specialty-icon/);
assert.match(css,/\.discovery-professionals \.pros-specialty:focus-visible/);
assert.match(css,/\.discovery-rides \.rides-assurance-item:nth-child\(3\)/);
assert.match(css,/\.discovery-rides \.rides-assurance-symbol::before/);
assert.match(css,/\.discovery-rides \.rides-photo-credit:hover/);
assert.match(discovery,/pros-agenda-icon" aria-hidden="true"><\/div>/);
assert.match(css,/\.discovery-professionals \.pros-agenda-icon::before/);
assert.match(css,/\.discovery-professionals \.pros-partner-symbol b::before/);
assert.doesNotMatch(discovery,/pros-partner-symbol" aria-hidden="true"><span>[^<]+<\/span><b>✳/);
assert.match(discovery,/Anúncios revisados/);
assert.match(discovery,/A contratação e os detalhes do atendimento são combinados diretamente/);

// Preserve every real search, qualification and provider contact guard.
for(const name of ['function discoveryRidesHero()','function discoveryRidesSearch(','function discoveryProfessionalsCategories(','function discoveryConfirmRideContact(','function discoverySearchFromUi(','function discoveryRidesCard(']){
 assert.ok(discovery.includes(name),'Existing real workflow missing '+name);
}
assert.match(owner,/discoveryOwnerUpdateRideSeats/);
assert.match(owner,/Uma concessão por conta|TAMÃO não confirma reservas nem recebe pagamentos de caronas/);
assert.ok(shared.includes('--vf-calendar:')&&shared.includes('--vf-shield:')&&shared.includes('--vf-hand:'));
assert.match(boot,/discoveryPage/);
assert.match(mobility,/mobilityPage/);

console.log('V1.1166 PASS — verified RS photograph, credit, six professional specialty icons, real availability and existing flows preserved');
