const OPERATIONAL_MERCHANT_ROLES=new Set(["owner","manager","operator"]);

export function isOperationalMerchantRole(role){
  return OPERATIONAL_MERCHANT_ROLES.has(String(role??""));
}

export function operationalMerchantMemberships(memberships=[]){
  return (Array.isArray(memberships)?memberships:[])
    .filter((membership)=>membership?.active!==false&&isOperationalMerchantRole(membership?.member_role));
}

/**
 * @param {Array<{merchant_id:string,member_role:string,active?:boolean}>} memberships
 * @param {string|null} [requestedMerchantId]
 */
export function selectMerchantMembership(memberships=[],requestedMerchantId=null){
  const active=(Array.isArray(memberships)?memberships:[])
    .filter((membership)=>membership?.active!==false);

  if(requestedMerchantId){
    return active.find((membership)=>membership?.merchant_id===requestedMerchantId)??null;
  }

  return operationalMerchantMemberships(active)[0]??active[0]??null;
}
