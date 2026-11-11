// V1.939 — pure, read-only parser for the MP released-money report search API.
// A processing report is not settlement, and account-level results never
// prove the source invoice without the separate CSV/order/PSP binding.
const FILE_RE=/^[A-Za-z0-9][A-Za-z0-9._-]{7,140}\.csv$/;
const MAX_REPORTS=10;
export function inspectReportSearch(raw){
 const unavailable={complete:false,files:[],pending:0,blocked:0,
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
 // GET /release_report/search differs from GET /list: a downloadable
 // report may have status "enabled" and omit "is_test" entirely. These
 // fields identify only a candidate FILE, never payment or net settlement.
 const statuses=new Set(["enabled","processed","pending","processing","failed","deleted"]);
 if(raw.results.some(item=>!statuses.has(item.status.toLowerCase())))
  return {...unavailable,reason:"MP_RELEASE_SEARCH_STATUS_UNKNOWN"};
 const pending=raw.results.filter(item=>
   ["pending","processing"].includes(item.status.toLowerCase())).length;
 const blocked=raw.results.filter(item=>item.status.toLowerCase()==="failed").length;
 const downloadable=raw.results.filter(item=>
   ["enabled","processed"].includes(item.status.toLowerCase())&&
   item.currency_id==="BRL"&&item.is_test!==true);
 // download_date is the optional timestamp of a previous download;
 // its absence must not force a human to fetch the file first. The actual
 // GET of the CSV and exact transaction checks prove downloadability.
 if(downloadable.some(item=>
   item.sub_type!=="release"||item.format!=="CSV"||
   (item.download_date!=null&&item.download_date!==""&&
    !Number.isFinite(Date.parse(String(item.download_date))))))
  return {...unavailable,reason:"MP_RELEASE_SEARCH_FILE_METADATA_INVALID"};
 if(downloadable.some(item=>!FILE_RE.test(String(item.file_name??""))))
  return {...unavailable,reason:"MP_RELEASE_SEARCH_FILENAME_INVALID"};
 const files=[...new Set(downloadable.map(item=>String(item.file_name)))];
 if(files.length>MAX_REPORTS)
  return {...unavailable,reason:"MP_RELEASE_SEARCH_TOO_MANY_FILES"};
 return {complete:true,files,pending,blocked,reason:null};
}
