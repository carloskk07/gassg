import assert from 'node:assert/strict';
import fs from 'node:fs';

const customer=fs.readFileSync(new URL('../js/customer.js',import.meta.url),'utf8');

assert.ok(!customer.includes("merchant:'Gas e Lenheira do JR'"),'referência pública não deve favorecer ou identificar uma revenda');
assert.ok(customer.includes('minimum:115.90')&&customer.includes('usual:120.00')&&customer.includes('maximum:125.00'),'faixa comercial pública precisa permanecer 115,90 / 120,00 / 125,00');
assert.ok(customer.includes('R$ 120,00</strong> como valor usual'),'home deve destacar R$ 120,00 como referência usual');
assert.ok(customer.includes('R$ 115,90 a R$ 125,00'),'home deve mostrar a faixa completa');
assert.ok(customer.includes('entrega incluída'),'home deve comunicar entrega incluída na referência informada');
assert.ok(customer.includes('A disponibilidade, a revenda disponível e o valor final são confirmados para o seu CEP antes do pedido.'),'preço de referência não pode fingir oferta ativa');
assert.ok(customer.includes("showPublicP13Reference=!testDemo"),'referência não pode contaminar o ambiente automatizado de teste');
assert.ok(customer.includes("market?.realSupplyConfigured===false"),'referência deve aparecer quando ainda não existe supply live configurado');
assert.ok(customer.includes("BRL.format(PUBLIC_P13_REFERENCE.usual)+' ref.'"),'starter deve mostrar a referência usual em vez de esconder todo preço');
assert.ok(!customer.includes('Gas e Lenheira do JR • P13'),'referência pública precisa ser imparcial entre revendas');

console.log('V1.148 passou: faixa pública do P13 aparece sem favorecer uma revenda e sem fabricar oferta ou disponibilidade.');
