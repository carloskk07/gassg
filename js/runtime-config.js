// Generated/default public runtime configuration.
// Dedicated live origins remain blank until custom/free isolated hosts are configured.
globalThis.CHAMA_CUSTOMER_ORIGIN='';
globalThis.CHAMA_MERCHANT_ORIGIN='';
globalThis.CHAMA_ADMIN_ORIGIN='';
globalThis.CHAMA_TURNSTILE_SITE_KEY='';
globalThis.CHAMA_PORTAL_ROLE='';

// The current GitHub Pages site is an internal pre-launch lab, not a live commerce
// origin. It deliberately reuses the deterministic browser simulation so the full
// customer ↔ merchant ↔ delivery flow can be exercised without creating real orders.
const chamaHost=String(location.hostname||'').toLowerCase();
const chamaPath=String(location.pathname||'/');
globalThis.CHAMA_INTERNAL_PILOT=
  chamaHost==='carloskk07.github.io'&&/^\/gassg(?:\/|$)/.test(chamaPath);

if(globalThis.CHAMA_INTERNAL_PILOT===true){
  globalThis.__CHAMA_TEST__=true;
}
