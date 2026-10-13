// V1.219 — Short, explicit propagation window for verifiable portal evidence.
// No retries for authorization, role, origin, HTML, runtime or Turnstile drift.
export const PORTAL_PROPAGATION_DELAYS_MS=Object.freeze([1500,3000]);

export class PortalPropagationPending extends Error{
  constructor(role,stage,reason){
    super('Portal evidence is still propagating.');
    this.name='PortalPropagationPending';
    this.role=role;
    this.stage=stage;
    this.reason=reason;
  }
}

export function isTransientPortalHttp(status){
  return Number.isInteger(status)&&(
    status===404||status===408||status===425||status===429||
    (status>=500&&status<=599)
  );
}

// Only a complete simultaneous pass is accepted. Partial responses are never
// carried into a later attempt or persisted as if they were one snapshot.
export async function verifyPortalSetWithPropagation(entries,verify,{
  sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
  report=(_details)=>{}
}={}){
  if(!Array.isArray(entries)||entries.length!==3)
    throw new Error('PORTAL_EVIDENCE_ENTRY_COUNT_INVALID');
  for(let attempt=1;attempt<=PORTAL_PROPAGATION_DELAYS_MS.length+1;attempt++){
    try{
      const portals=await Promise.all(entries.map(([role,cfg])=>verify(role,cfg)));
      if(portals.length!==entries.length)
        throw new Error('PORTAL_EVIDENCE_INCOMPLETE');
      return portals;
    }catch(error){
      if(!(error instanceof PortalPropagationPending))throw error;
      const delay=PORTAL_PROPAGATION_DELAYS_MS[attempt-1];
      if(delay===undefined)throw error;
      report({role:error.role,stage:error.stage,reason:error.reason,attempt});
      await sleep(delay);
    }
  }
  throw new Error('PORTAL_EVIDENCE_RETRY_UNREACHABLE');
}
