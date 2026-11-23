// CNPJ 2026+: 12 caracteres base alfanuméricos e dois verificadores numéricos.
// Validação de formato/DV não comprova situação ATIVA na Receita Federal.
export function normalizeOperatorCnpj(value){
  return String(value??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
}
export function isValidOperatorCnpj(value){
  const c=normalizeOperatorCnpj(value);
  if(!/^[A-Z0-9]{12}[0-9]{2}$/.test(c)||c.slice(0,12)===c[0].repeat(12))
    return false;
  const code=char=>char.charCodeAt(0)-48;
  const weights1=[5,4,3,2,9,8,7,6,5,4,3,2];
  const weights2=[6,5,4,3,2,9,8,7,6,5,4,3,2];
  const digit=(prefix,weights)=>{
    const sum=[...prefix].reduce((total,ch,i)=>total+code(ch)*weights[i],0);
    const mod=sum%11;
    return mod<2?0:11-mod;
  };
  const first=digit(c.slice(0,12),weights1);
  if(Number(c[12])!==first)return false;
  return Number(c[13])===digit(c.slice(0,13),weights2);
}
