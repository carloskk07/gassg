// Read existing owner/manager accounts and the live catalog. Never create a
// merchant, approve commerce, prepare a charge or manufacture wallet credit.
export async function ownedBillingSnapshot(admin,actorId,requested=''){
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 if(!uuid.test(actorId)||requested&&!uuid.test(requested))throw Error('INVALID_BILLING_ACTOR');
 const memberships=await admin.from('merchant_members')
  .select('merchant_id,member_role',{count:'exact'}).eq('user_id',actorId).eq('active',true)
  .in('member_role',['owner','manager']).order('merchant_id').limit(50);
 if(memberships.error||!Array.isArray(memberships.data)||memberships.count!==memberships.data.length)
  throw Error('OWNED_BILLING_MEMBERSHIP_UNAVAILABLE');
 const ids=memberships.data.map(m=>m.merchant_id);
 if(requested&&!ids.includes(requested))throw Error('MERCHANT_FINANCE_PERMISSION_DENIED');
 const [merchants,plans]=await Promise.all([
  ids.length?admin.from('merchants').select('id,name,status').in('id',ids).order('name'):
   Promise.resolve({data:[],error:null}),
  admin.from('merchant_billing_plans')
   .select('plan_key,display_name,purchase_amount_cents,credit_grant_cents,platform_fee_bps')
   .eq('active',true).eq('billing_mode','prepaid_credit').order('sort_order').limit(20)
 ]);
 if(merchants.error||plans.error||!Array.isArray(merchants.data)||!Array.isArray(plans.data)||
   merchants.data.length!==ids.length)throw Error('OWNED_BILLING_CATALOG_UNAVAILABLE');
 const selected=requested||merchants.data[0]?.id||null;
 let account=null,latestCharge=null;
 if(selected){
  const [balance,latest]=await Promise.all([
   admin.from('merchant_billing_accounts').select('plan_key,credit_balance_cents,credit_reserved_cents')
    .eq('merchant_id',selected).maybeSingle(),
   admin.from('merchant_billing_provider_charges')
    .select('id,payment_request_id,amount_cents,status,created_at')
    .eq('merchant_id',selected).order('created_at',{ascending:false}).limit(1).maybeSingle()
  ]);
  if(balance.error||latest.error)throw Error('OWNED_BILLING_BALANCE_UNAVAILABLE');
  account=balance.data;latestCharge=latest.data;
 }
 return {source:'admin_finance_owned_billing_v1',readOnly:true,paymentsCreated:0,
  accounts:merchants.data,selectedMerchantId:selected,account,latestCharge,
  plans:plans.data.map(p=>({planKey:p.plan_key,title:p.display_name,priceCents:p.purchase_amount_cents,
   creditCents:p.credit_grant_cents,feeBps:p.platform_fee_bps}))};
}
