// V1.1074 — Scope the Cloudflare Pages Function budget to URLs which
// actually need server-side HTML routing. Product/order/admin assets stay
// entirely static; merchant and admin portals never invoke these Functions.
export const TAMAO_PAGES_FUNCTIONS_CUSTOMER=Object.freeze({
 version:1,
 include:['/p/*','/agenda/*'],
 exclude:['/p/index.html','/p/page.js','/p/style.css',
  '/agenda/index.html','/agenda/exemplo/*']
});
export const TAMAO_PAGES_FUNCTIONS_OTHER=Object.freeze({
 version:1,
 include:['/__customer_only_native_pages/*'],
 exclude:[]
});
export const tamaoPagesFunctionsRouting=role=>
 JSON.stringify(role==='customer'?TAMAO_PAGES_FUNCTIONS_CUSTOMER:TAMAO_PAGES_FUNCTIONS_OTHER,null,2)+'\n';
