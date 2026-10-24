// TAMÃO — read-only Mercado Pago released-money evidence for a paid coupon.
// No wallet, invoice, benefit, or payout mutation. CSV is untrusted input.
// Source: /v1/account/release_report/{file_name}; use only listed report names.
const REQUIRED=["DATE","SOURCE_ID","EXTERNAL_REFERENCE","RECORD_TYPE",
  "DESCRIPTION","NET_CREDIT_AMOUNT","NET_DEBIT_AMOUNT","GROSS_AMOUNT"];

export function releasedMoneyCents(value){
  const raw=String(value??"").trim();
  if(!/^-?\d{1,12}\.\d{2}$/.test(raw))return null;
  const negative=raw.startsWith("-");
  const positive=negative?raw.slice(1):raw;
  const [units,cents]=positive.split(".");
  const amount=Number(units)*100+Number(cents);
  return Number.isSafeInteger(amount)?negative?-amount:amount:null;
}

export function parseReleasedMoneyCsv(source){
  if(typeof source!=="string"||!source||source.length>1_000_000)
    throw new Error("MP_RELEASE_CSV_SIZE_INVALID");
  const input=source.replace(/^\uFEFF/,"");
  const firstLine=input.slice(0,input.search(/[\r\n]/)<0?Math.min(input.length,500):input.search(/[\r\n]/));
  const delimiter=firstLine.includes(";")&&!firstLine.includes(",")?";":",";
  const rows=[];let row=[],cell="",quoted=false,afterQuote=false;
  for(let i=0;i<input.length;i++){
    const ch=input[i];
    if(quoted){
      if(ch==='"'&&input[i+1]==='"'){cell+='"';i++;continue;}
      if(ch==='"'){quoted=false;afterQuote=true;continue;}
      cell+=ch;continue;
    }
    if(ch==='"'&&!cell&&!afterQuote){quoted=true;continue;}
    if(ch===delimiter||ch==="\n"||ch==="\r"){
      row.push(cell);cell="";afterQuote=false;
      if(ch!==delimiter){
        if(row.some(x=>x!==""))rows.push(row);
        row=[];
        if(ch==="\r"&&input[i+1]==="\n")i++;
        if(rows.length>5001)throw new Error("MP_RELEASE_CSV_TOO_MANY_ROWS");
      }
      continue;
    }
    if(ch==='"'||afterQuote)throw new Error("MP_RELEASE_CSV_QUOTES_INVALID");
    cell+=ch;
  }
  if(quoted)throw new Error("MP_RELEASE_CSV_UNCLOSED_QUOTE");
  if(cell!==""||row.length){row.push(cell);if(row.some(x=>x!==""))rows.push(row);}
  if(rows.length<1)throw new Error("MP_RELEASE_CSV_EMPTY");
  const headers=rows.shift().map(x=>x.trim().toUpperCase());
  if(new Set(headers).size!==headers.length||
     REQUIRED.some(k=>!headers.includes(k))||
     headers.some(h=>!h||!/^[A-Z][A-Z0-9_]*$/.test(h)))
     throw new Error("MP_RELEASE_CSV_COLUMNS_UNVERIFIED");
  const output=[];
  for(const values of rows){
    if(values.length!==headers.length)throw new Error("MP_RELEASE_CSV_ROW_UNVERIFIED");
    const item={};
    for(let j=0;j<headers.length;j++)item[headers[j]]=values[j].trim();
    output.push(item);
  }
  return {rows:output,rowsExamined:output.length};
}

export function couponReleasedNetEvidence(csv,{invoice,order,reportFileName}){
  // Strong three-way bind: local invoice -> authenticated PSP order -> MP
  // released money CSV. A matching net line is NOT merchant bank settlement.
  const empty=(reason,rowsExamined=0)=>({source:"coupon_mp_released_net_evidence_v1",
    readOnly:true,moneyMoved:false,merchantPayoutVerified:false,
    couponFundingApplied:false,eligible:false,reason,rowsExamined,
    netCents:null,evidenceReference:null});
  if(!invoice||invoice.status!=="paid"||!invoice.paid_at||
    !invoice.provider_order_id||!invoice.provider_payment_id||
    !Number.isSafeInteger(invoice.sale_price_cents)||
    !Number.isSafeInteger(invoice.coupon_face_cents)||
    !Number.isSafeInteger(invoice.coupons_per_pack))
    return empty("COUPON_PAID_PROOF_INCOMPLETE");
  const payments=Array.isArray(order?.transactions?.payments)?order.transactions.payments:[];
  const pix=payments.find(p=>String(p?.id??"")===String(invoice.provider_payment_id));
  const cents=value=>{
    const raw=String(value??"");
    if(!/^\d{1,12}(?:\.\d{1,2})?$/.test(raw))return null;
    return releasedMoneyCents(Number(raw).toFixed(2));
  };
  const reversed=["refunded","partially_refunded","charged_back","chargeback",
    "disputed","in_mediation","canceled","failed"];
  if(String(order?.id??"")!==String(invoice.provider_order_id)||
    String(order?.external_reference??"")!==String(invoice.id)||
    cents(order?.total_amount)!==invoice.sale_price_cents||
    (order?.currency_id&&order.currency_id!=="BRL")||
    String(order?.status??"").toLowerCase()!=="processed"||
    !pix||String(pix?.payment_method?.id??"")!=="pix"||
    String(pix?.payment_method?.type??"")!=="bank_transfer"||
    !["processed","accredited","approved"].includes(String(pix.status??"").toLowerCase())||
    (Array.isArray(order?.transactions?.refunds)&&order.transactions.refunds.length>0)||
    [order?.status,pix?.status].some(v=>reversed.includes(String(v??"").toLowerCase())))
    return empty("COUPON_PROVIDER_BINDING_UNVERIFIED");
  const parsed=parseReleasedMoneyCsv(csv);
  const matches=parsed.rows.filter(row=>
    row.RECORD_TYPE.toLowerCase()==="release"&&
    row.DESCRIPTION.toLowerCase()==="payment"&&
    row.SOURCE_ID===String(invoice.provider_payment_id)&&
    row.EXTERNAL_REFERENCE===String(invoice.id));
  if(matches.length!==1)return empty(matches.length>1?
    "COUPON_RELEASE_AMBIGUOUS":"COUPON_RELEASE_NOT_FOUND",parsed.rowsExamined);
  const row=matches[0];
  const gross=releasedMoneyCents(row.GROSS_AMOUNT);
  const net=releasedMoneyCents(row.NET_CREDIT_AMOUNT);
  const debit=releasedMoneyCents(row.NET_DEBIT_AMOUNT);
  const validDate=Number.isFinite(Date.parse(row.DATE));
  if((row.CURRENCY&&row.CURRENCY!=="BRL")||
    gross!==invoice.sale_price_cents||net===null||net<=0||
    net>gross||debit!==0||!validDate)
    return empty("COUPON_RELEASE_VALUES_UNVERIFIED",parsed.rowsExamined);
  if(net<invoice.coupon_face_cents*invoice.coupons_per_pack)
    return empty("COUPON_RELEASE_NET_INSUFFICIENT",parsed.rowsExamined);
  // The official file and provider payment ID together identify evidence,
  // but no net-funding RPC is called by this read-only diagnostic.
  const ref="mp-release:"+reportFileName+":"+row.SOURCE_ID;
  if(ref.length>240)return empty("COUPON_RELEASE_REFERENCE_TOO_LONG",parsed.rowsExamined);
  return {...empty("PROVIDER_RELEASE_CANDIDATE",parsed.rowsExamined),
    eligible:true,netCents:net,evidenceReference:ref,
    releaseDate:new Date(row.DATE).toISOString()};
}
