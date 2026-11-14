// V1.939 — pure, read-only parser for the MP released-money report search API.
// A processing report is not settlement, and account-level results never
// prove the source invoice without the separate CSV/order/PSP binding.
const FILE_RE=/^[A-Za-z0-9][A-Za-z0-9._-]{7,140}\.csv$/;
const MAX_REPORTS=10;
// Account history grows forever. A fresh invoice must not be blocked just
// because unrelated older daily reports exceed the account-wide limits.
// Official creation-date filters cover reports made since before payment;
// file contents and the authenticated Order remain the financial proof.
export async function discoverInvoiceReleaseReports(invoice,providerGet,nowMs=Date.now()){
 const paid=Date.parse(invoice?.paid_at);
 if(invoice?.status!=='paid'||!Number.isFinite(paid)||paid>nowMs||!Number.isFinite(nowMs))
  throw Error('MP_REPORT_INVOICE_WINDOW_INVALID');
 const date=value=>new Date(value).toISOString().replace(/\.\d{3}Z$/,'Z');
 const query=new URLSearchParams({range:'date_created',range_begin_date:date(paid-86400000),
  range_end_date:date(nowMs),currency_id:'BRL',format:'CSV',limit:'50',offset:'0'});
 let raw=await providerGet('/v1/account/release_report/search?'+query);
 const total=Number(raw?.paging?.total);
 if(!Number.isSafeInteger(total)||total<0||total>50||!Array.isArray(raw?.results)||raw.results.length>total)
  return {complete:false,files:[],pending:0,blocked:0,reason:'MP_RELEASE_INVOICE_WINDOW_INCOMPLETE'};
 const items=[...raw.results],ids=new Set();
 const addIds=rows=>{
  for(const row of rows){
   const id=String(row?.id??'');
   if(!/^[1-9][0-9]{0,19}$/.test(id)||ids.has(id))throw Error('MP_RELEASE_INVOICE_WINDOW_DUPLICATED');
   ids.add(id);
  }
 };
 addIds(items);
 for(let page=1;items.length<total&&page<=5;page++){
  if(!items.length)break;
  query.set('offset',String(items.length));
  raw=await providerGet('/v1/account/release_report/search?'+query);
  if(Number(raw?.paging?.total)!==total||Number(raw?.paging?.offset)!==items.length||
    !Array.isArray(raw?.results)||!raw.results.length||raw.results.length>total-items.length)
   throw Error('MP_RELEASE_INVOICE_WINDOW_PAGE_INVALID');
  addIds(raw.results);items.push(...raw.results);
 }
 return inspectReportSearch({paging:{total},results:items});
}
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
