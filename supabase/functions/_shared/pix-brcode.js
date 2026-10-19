// Validate a PIX BR Code returned by a payment provider before persisting
// or presenting it. Validation is structural only: it is NOT evidence of a
// payable provider charge, active receiver, or settled payment.
function tlvFields(raw){
  const fields=[];
  for(let i=0;i<raw.length;){
    if(i+4>raw.length||!/^\d{4}$/.test(raw.slice(i,i+4)))return null;
    const id=raw.slice(i,i+2),length=Number(raw.slice(i+2,i+4));
    const end=i+4+length;
    if(end>raw.length)return null;
    fields.push({id,value:raw.slice(i+4,end)});
    i=end;
  }
  return fields;
}
function pixCrc16(raw){
  let crc=0xffff;
  for(let i=0;i<raw.length;i++){
    crc^=raw.charCodeAt(i)<<8;
    for(let bit=0;bit<8;bit++){
      crc=((crc&0x8000)?((crc<<1)^0x1021):(crc<<1))&0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4,"0");
}
/**
 * @param {unknown} value
 * @param {{expectedAmountCents?: number|null}} [options]
 * @returns {{valid:boolean,reason:string|null}}
 */
export function validatePixBrCode(value,{expectedAmountCents=null}={}){
  const raw=typeof value==="string"?value:"";
  // BR Codes use ASCII: reject hidden whitespace and multibyte characters
  // rather than trimming or otherwise altering the bank-facing payload.
  if(raw.length<30||raw.length>8192||!/^[\x20-\x7e]+$/.test(raw)){
    return {valid:false,reason:"PIX_BR_CODE_FORMAT_INVALID"};
  }
  const fields=tlvFields(raw);
  if(!fields?.length||fields.at(-1)?.id!=="63"
    ||fields.at(-1)?.value.length!==4
    ||!/^[0-9a-fA-F]{4}$/.test(fields.at(-1).value)
    ||raw.slice(-8,-4)!=="6304"){
    return {valid:false,reason:"PIX_BR_CODE_STRUCTURE_INVALID"};
  }
  if(pixCrc16(raw.slice(0,-4))!==fields.at(-1).value.toUpperCase()){
    return {valid:false,reason:"PIX_BR_CODE_CRC_INVALID"};
  }
  const tag=id=>fields.find(f=>f.id===id)?.value??null;
  if(fields[0].id!=="00"||tag("00")!=="01"
    ||tag("53")!=="986"||tag("58")!=="BR"){
    return {valid:false,reason:"PIX_BR_CODE_METADATA_INVALID"};
  }
  const pixAccount=fields.some(f=>{
    const n=Number(f.id);
    if(!Number.isInteger(n)||n<26||n>51)return false;
    const inner=tlvFields(f.value);
    return inner?.some(x=>x.id==="00"&&x.value==="br.gov.bcb.pix")===true;
  });
  if(!pixAccount)return {valid:false,reason:"PIX_BR_CODE_ACCOUNT_INVALID"};
  const amount=tag("54");
  if(amount!=null){
    if(!/^[0-9]{1,13}(?:\.[0-9]{1,2})?$/.test(amount)){
      return {valid:false,reason:"PIX_BR_CODE_AMOUNT_INVALID"};
    }
    const [reais,fraction=""]=amount.split(".");
    const cents=Number(reais)*100+Number(fraction.padEnd(2,"0"));
    if(!Number.isSafeInteger(cents)||cents<=0){
      return {valid:false,reason:"PIX_BR_CODE_AMOUNT_INVALID"};
    }
    if(expectedAmountCents!=null&&cents!==expectedAmountCents){
      return {valid:false,reason:"PIX_BR_CODE_AMOUNT_MISMATCH"};
    }
  }
  return {valid:true,reason:null};
}
