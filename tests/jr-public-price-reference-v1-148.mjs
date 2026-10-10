import assert from 'node:assert/strict';
import fs from 'node:fs';

const customer=fs.readFileSync(new URL('../js/customer.js',import.meta.url),'utf8');

assert.ok(customer.includes("merchant:'Gas e Lenheira do JR'"),'referência pública deve identificar a JR');
assert.ok(customer.includes('minimum:115.90')&&customer.includes('usual:120.00')&&customer.includes('maximum:125.00'),'faixa comercial JR precisa permanecer 115,90 / 120,00 / 125,00');
assert.ok(customer.includes('R$ 120,00</strong> como valor usual informado'),'home deve destacar R$ 120,00 como referência usual');
assert.ok(customer.includes('R$ 115,90 a R$ 125,00'),'home deve mostrar a faixa completa');
assert.ok(customer.includes('entrega incluída'),'home deve comunicar entrega incluída na referência informada');
assert.ok(customer.includes('A disponibilidade e o valor final são confirmados para o seu CEP antes do pedido.'),'preço de referência não pode fingir oferta ativa');
assert.ok(customer.includes("showJrPublicReference=!testDemo"),'referência não pode contaminar o ambiente automatizado de teste');
assert.ok(customer.includes("market?.realSupplyConfigured===false"),'referência deve aparecer quando ainda não existe supply live configurado');
assert.ok(customer.includes("BRL.format(JR_PUBLIC_P13_REFERENCE.usual)+' ref.'"),'starter deve mostrar a referência usual em vez de esconder todo preço');
assert.ok(!customer.includes('JR • oferta ativa'),'referência não pode fabricar disponibilidade');

console.log('V1.148 passou: preços reais informados pela JR aparecem como referência pública sem fabricar oferta ou disponibilidade.');
