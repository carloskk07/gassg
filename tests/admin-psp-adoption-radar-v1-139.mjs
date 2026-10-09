import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(path)=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const admin=read('js/admin.js');
const adminOps=read('supabase/functions/admin-ops/index.ts');
const merchant=read('js/merchant.js');

assert.ok(
  adminOps.includes('customer_label,metadata,confirmed_at,updated_at'),
  'admin-ops precisa transportar metadata das rotas multi-PSP para distinguir adoção manual'
);

assert.ok(
  admin.includes('function adminMerchantDeclaredPspRadar(d)')
  &&admin.includes("route?.verification_mode==='merchant_confirmed'")
  &&admin.includes("route?.metadata?.merchantDeclaredProvider===true")
  &&admin.includes("route?.provider!=='manual'"),
  'radar deve contar somente PSP externo explicitamente declarado pela revenda'
);

assert.ok(
  admin.includes('PSPs realmente usados pelas revendas')
  &&admin.includes('DEMANDA OBSERVADA')
  &&admin.includes('priorizar integrações automáticas onde existe demanda real'),
  'admin precisa transformar declaração em sinal de priorização de produto'
);

assert.ok(
  admin.includes('Sinal de produto, não prova financeira.')
  &&admin.includes('não confirmam pagamento')
  &&admin.includes('NÃO COLETADAS'),
  'radar não pode confundir adoção com prova de pagamento nem incentivar coleta de segredo'
);

assert.ok(
  admin.includes('adminMerchantName(merchantId)')
  &&admin.includes('adminPaymentMethodLabel(method)')
  &&admin.includes('group.merchantMethods.size'),
  'admin precisa identificar revendas, métodos e demanda por provedor'
);

assert.ok(
  merchant.includes('merchantDeclaredProvider:true')
  &&merchant.includes('manualProviderFallback:true')
  &&merchant.includes('automaticVerification:false'),
  'radar deve depender do marcador explícito emitido pela V1.138'
);

assert.ok(
  adminOps.includes('["superadmin","finance","readonly"].includes(actorRole)')
  &&adminOps.includes('merchantPaymentRoutesPromise'),
  'telemetria de adoção deve permanecer dentro do snapshot administrativo autenticado'
);

console.log('V1.139 passou: admin recebe metadata e mostra radar de adoção PSP sem tratar declaração como prova financeira.');
