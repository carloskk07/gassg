import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(path)=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const merchant=read('js/merchant.js');
const checkout=read('supabase/functions/order-payment-checkout/index.ts');
const capability=read('supabase/migrations/20261009200000_multi_psp_payment_capability_v1_135.sql');

for(const provider of ['stone','getnet','pagbank','nubank']){
  assert.ok(
    merchant.includes(provider==="pagbank"?"pagbank":provider),
    provider+' precisa permanecer visível no catálogo da revenda'
  );
}

assert.ok(
  merchant.includes('merchantUseProviderManuallyFromUi')
  &&merchant.includes('merchantStopProviderManualUseFromUi')
  &&merchant.includes('Eu uso este PSP')
  &&merchant.includes('EM USO • MANUAL'),
  'revenda precisa conseguir declarar e remover uso manual de um PSP sem credencial'
);

assert.ok(
  merchant.includes('merchantDeclaredProvider:true')
  &&merchant.includes('manualProviderFallback:true')
  &&merchant.includes('automaticVerification:false')
  &&merchant.includes("verificationMode:'merchant_confirmed'")
  &&merchant.includes("channel:'external'"),
  'rota declarada precisa ser explicitamente manual, externa e sem alegação de automação'
);

assert.ok(
  merchant.includes("connectionId:null")
  &&merchant.includes("fundsOwner:'merchant'")
  &&merchant.includes('sem senha ou chave de API')
  &&merchant.includes('TAMÃO não recebe nem repassa'),
  'fallback não pode pedir segredo, custódia ou repasse da venda'
);

assert.ok(
  capability.includes("verification_mode in ('provider_api','device','merchant_confirmed','customer_receipt')")
  &&capability.includes("verification_mode not in ('provider_api','device')")
  &&capability.includes("or (connection_id is not null and provider<>'manual')"),
  'modelo precisa permitir merchant_confirmed sem conexão e exigir conexão somente para automação'
);

assert.ok(
  checkout.includes('.in("verification_mode",["provider_api","device"])')
  &&checkout.includes('NO_AUTOMATED_PAYMENT_ROUTE')
  &&!checkout.includes('.in("verification_mode",["provider_api","device","merchant_confirmed"])'),
  'checkout automático jamais pode consumir rota manual declarada como se fosse PSP homologado'
);

assert.ok(
  merchant.includes("provider.connectReady&&provider.connectionMode==='oauth'")
  &&merchant.includes("merchantPaymentConnectLive(provider,'start')"),
  'fallback manual não pode substituir OAuth quando conexão automática estiver disponível'
);

assert.ok(
  merchant.includes("route?.metadata?.merchantDeclaredProvider===true")
  &&merchant.includes('.map(merchantSerializablePaymentRoute)'),
  'ativação e remoção devem preservar demais rotas e identificar apenas fallback criado pela revenda'
);

console.log('V1.138 passou: multi-PSP manual self-service sem segredos, sem custódia e sem contaminar checkout automático.');
