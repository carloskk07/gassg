import {readFileSync,appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const actions=Object.freeze({
  real_supply_required:'Validar o primeiro fornecedor real.',
  merchant_owner_required:'Vincular responsável operacional permanente.',
  merchant_payment_required:'Confirmar meio de pagamento aceito pela revenda.',
  offerable_supply_required:'Confirmar estoque, preço, taxa, capacidade e disponibilidade.',
  live_portals_verification_required:'Renovar a certificação automática dos três portais.'
});
export function buildSummary(payload){
  const r=payload?.readiness;
  if(payload?.ok!==true||payload?.source!=='github_oidc_edge'||r?.portalsFresh!==true){
    throw new Error('Certificação não comprovada.');
  }
  const flags=[r.securityBlockers,r.unresolvedWarnings,r.blockers];
  if(flags.some(x=>!Array.isArray(x)||x.some(y=>typeof y!=='string'))){
    throw new Error('Contrato de prontidão não reconhecido.');
  }
  const codes=[...new Set(flags.flat())];
  const known=codes.filter(c=>Object.hasOwn(actions,c));
  const unknown=codes.length-known.length;
  const security=r.securityBlockers.length>0;
  const commerce=r.commerceEnabled===true;
  const ready=r.readyToEnable===true&&!security&&codes.length===0;
  return [
    '## TAMÃO — certificação técnica e abertura comercial',
    '',
    '- Portais: certificação técnica atualizada.',
    '- Comércio: '+(commerce?'habilitado':'desabilitado')+'.',
    '- Prontidão: '+(security?'bloqueio de segurança':ready?'requisitos informados satisfeitos':'pendências operacionais ou revisão necessária')+'.',
    '',
    ...known.map(c=>'- '+actions[c]),
    ...(unknown?['- Existem '+unknown+' códigos adicionais; consultar o Admin protegido.']:[]),
    ...(known.length||unknown?[]:['- Nenhuma pendência listada pelo servidor; conferir autorização e operação real no Admin.']),
    '',
    'Não repetir Pix já homologado. Este relatório não altera configurações, não abre comércio e não comprova pedidos reais.',
    ''
  ].join('\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const summary=buildSummary(JSON.parse(readFileSync(process.argv[2],'utf8')));
  if(!process.env.GITHUB_STEP_SUMMARY)throw new Error('Destino de resumo ausente.');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary,{encoding:'utf8'});
}
