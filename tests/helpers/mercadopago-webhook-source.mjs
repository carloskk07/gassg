import fs from 'node:fs';
// The same handlers are imported by the signed webhook and the machine worker.
export function readMercadoPagoWebhookSource(){
 const read=p=>fs.readFileSync(new URL('../../supabase/functions/billing-payment-webhook-mercadopago/'+p,import.meta.url),'utf8');
 return read('handlers.ts').replace(/^export \{[^\n]+\};\n/gm,'')+read('index.ts').slice(read('index.ts').indexOf('Deno.serve('));
}

export function readAdsIndependentCheckoutSource(){
 const read=p=>fs.readFileSync(new URL('../../supabase/functions/ads-independent-checkout/'+p,import.meta.url),'utf8');
 return read('handlers.ts').replace(/^export \{[^\n]+\};\n/gm,'')+read('index.ts').slice(read('index.ts').indexOf('Deno.serve('));
}
