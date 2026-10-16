import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../js/customer.js',import.meta.url),'utf8');
const match=source.match(/function startCustomerAvailability\(\)\{[\s\S]*?\n\}/);
assert.ok(match,'deve existir autoridade única para iniciar a consulta');

function exercise({test=false,ready=false,globalSupply}={}){
  const calls=[];
  const context=vm.createContext({
    globalThis:{__CHAMA_TEST__:test,liveReady:()=>ready,liveRuntime:{marketStatus:globalSupply===undefined?null:{realSupplyConfigured:globalSupply}}},
    startHomeOrder:()=>{calls.push('real_consultation');return 'real_consultation';},
    openPrelaunchCustomerLead:()=>{calls.push('availability_notice');return 'availability_notice';}
  });
  const result=vm.runInContext(match[0]+';startCustomerAvailability()',context);
  return {calls,result};
}
assert.deepEqual(exercise({ready:true}),{calls:['real_consultation'],result:'real_consultation'},
  'sessão operacional pronta não pode encaminhar comprador direto ao cadastro de aviso');
assert.deepEqual(exercise({ready:true,globalSupply:false}),{calls:['real_consultation'],result:'real_consultation'},
  'sem revendas, o comprador pode explorar produtos; pedido real só surge com cotação válida');
assert.deepEqual(exercise({ready:true,globalSupply:true}),{calls:['real_consultation'],result:'real_consultation'},
  'revenda configurada deve manter consulta real por CEP');
assert.deepEqual(exercise({ready:false}),{calls:['real_consultation'],result:'real_consultation'},
  'na inicialização, permitir explorar produtos; preço final exige sessão e oferta elegível');
assert.deepEqual(exercise({test:true}),{calls:['real_consultation'],result:'real_consultation'},
  'jornada interna de teste deve permanecer isolada e funcional');

assert.ok(source.includes("const primaryAction='startCustomerAvailability()'"),
  'o botão principal da home deve respeitar a mesma autoridade');
assert.ok(source.includes('const primaryAction=\'startCustomerAvailability()\'')&&source.includes('class="primary starter-cta" onclick="${primaryAction}"'),
  'o CTA principal por CEP deve usar o mesmo fluxo seguro, sem cartão duplicado');
assert.ok(source.includes('Ainda não encontramos uma revenda que entregue neste CEP.') &&
  source.includes('onclick="openPrelaunchCustomerLead()">Receber aviso de disponibilidade'),
  'sem oferta, deve haver CTA explícito para aviso com consentimento, e não um pedido falso');
assert.ok(source.includes("showPublicP13Reference=!testDemo") &&
  source.includes('minimum:115.90') && source.includes('usual:120.00') && source.includes('maximum:125.00'),
  'a referência pública neutra P13 deve ser preservada');
assert.match(match[0],/return startHomeOrder\(\)/,
  'primeiro CTA apenas seleciona produtos; nenhuma compra é criada');
assert.doesNotMatch(match[0],/liveCreateOrder|checkout\(/,
  'consulta de vitrine não pode iniciar pagamento nem pedido');
console.log('V1.149: abrir vitrine mesmo sem revendas, sem criar pedido, e conferir CEP depois.');
