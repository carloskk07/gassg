// Synthetic, non-payable bank-code fixture. Never use this key in production.
export function pixFixture(cents=1990){
 const tlv=(id,value)=>id+String(value.length).padStart(2,'0')+value;
 const account=tlv('00','br.gov.bcb.pix')+tlv('01','TAMAO-TESTE-NAO-PAGAVEL');
 let code=tlv('00','01')+tlv('01','12')+tlv('26',account)+tlv('52','0000')+
  tlv('53','986')+tlv('54',(cents/100).toFixed(2))+tlv('58','BR')+
  tlv('59','TAMAO TESTE')+tlv('60','SAO GABRIEL')+tlv('62',tlv('05','TESTE'))+'6304';
 let crc=0xffff;
 for(const byte of Buffer.from(code,'ascii')){
  crc^=byte<<8;
  for(let bit=0;bit<8;bit++)crc=((crc&0x8000)?(crc<<1)^0x1021:crc<<1)&0xffff;
 }
 return code+crc.toString(16).toUpperCase().padStart(4,'0');
}
