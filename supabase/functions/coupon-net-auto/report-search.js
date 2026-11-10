// V1.939 — pure, read-only parser for the MP released-money report search API.
// A processing report is not settlement, and account-level results never
// prove the source invoice without the separate CSV/order/PSP binding.
const FILE_RE=/^[A-Za-z0-9][A-Za-z0-9._-]{7,140}\.csv$/;
const MAX_REPORTS=10;
export function inspectReportSearch(raw){
 const unavailable={complete:false,files:[],pending:0,
   reason:"MP_RELEASE_SEARCH_INCOMPLETE"};
 if(!raw||typeof raw!=="object"||Array.isArray(raw))return unavailable;
 if(!Array.isArray(raw.results)||!raw.paging||
    typeof raw.paging!=="object"||Array.isArray(raw.paging))return unavailable;
 const total=Number(raw.paging.total);
 if(!Number.isSafeInteger(total)||total<0||total>50||
    raw.results.length!==total)return unavailable;
 if(raw.results.some(item=>!item||typeof item!=="object"||
    Array.isArray(item)||typeof item.status!=="string"))
  return unavailable;
 const pending=raw.results.filter(item=>
   ["pending","processing"].includes(item.status.toLowerCase())).length;
 const processed=raw.results.filter(item=>
   item.status.toLowerCase()==="processed"&&
   item.currency_id==="BRL"&&item.is_test===false);
 if(processed.some(item=>!FILE_RE.test(String(item.file_name??""))))
  return {...unavailable,reason:"MP_RELEASE_SEARCH_FILENAME_INVALID"};
 const files=[...new Set(processed.map(item=>String(item.file_name)))];
 if(files.length>MAX_REPORTS)
  return {...unavailable,reason:"MP_RELEASE_SEARCH_TOO_MANY_FILES"};
 return {complete:true,files,pending,reason:null};
}
