// TAMÃO V1.307 — only read protected evidence; never issue activation commands.
const adminActivationDesk={data:null,actor:null,role:null,checkedAt:null,loading:false,error:null};
async function adminActivationLoad({force=false}={}){
  const actor=String(adminRuntime.session?.user?.id||''),role=adminCurrentRole();
  if(!adminReady()||!actor||!['superadmin','operations','readonly'].includes(role))return null;
  if(adminActivationDesk.loading)return null;
  if(!force&&adminActivationDesk.actor===actor&&adminActivationDesk.role===role&&
     Date.now()-Date.parse(adminActivationDesk.checkedAt||'')<120000)return adminActivationDesk.data;
  adminActivationDesk.loading=true;adminActivationDesk.error=null;render();
  try{
    const specs=[
      ['ads','ads-placement-readiness','admin_ads_placement_readiness_v1_236'],
      ['adsQueue','ads-campaign-queue','admin_ads_campaign_queue_v1_233'],
      ['clube','clube-campaign-queue','admin_clube_campaign_queue_v1_241'],
      ['terms','clube-terms-queue','admin_clube_terms_queue_v1_242']
    ];
    const values=await Promise.allSettled([
      ...specs.map(([,action])=>adminInvoke({action})),
      adminLoadGovernanceGates({force:true}),
      adminPushReliabilityLoadFromUi()
    ]);
    if(!adminReady()||actor!==String(adminRuntime.session?.user?.id||'')||role!==adminCurrentRole())return null;
    const evidence={};
    specs.forEach(([key,,source],i)=>{
      const d=values[i].status==='fulfilled'?values[i].value:null;
      const safe=d?.source===source&&(
        key==='ads'?d.readOnly===true&&d.publicEnabled===false&&d.billingEnabled===false&&d.readyToSell===false:
        key==='adsQueue'?d.noCharge===true&&d.adsLive===false:
        key==='clube'?d.readOnly===true&&d.couponSalesEnabled===false&&d.campaignsActive===0:
        d.readOnly===true&&d.couponSalesEnabled===false&&d.noContractsSigned===true);
      evidence[key]=safe?d:null;
    });
    const governance=values[4].status==='fulfilled'?values[4].value:null;
    evidence.governance=governance?.source==='admin_governance_gates_v1_304'&&governance.readOnly===true&&
      adminRuntime.governance?.loadedFor===actor&&adminRuntime.governance?.role===role?governance:null;
    const push=adminRuntime.pushReliability||{};
    evidence.push=push.loadedFor===actor&&push.data?.source==='admin_push_reliability_v1_294'&&
      push.data.readOnly===true&&push.data.gates?.automaticDeliveryVerified===false&&
      Date.now()-Date.parse(push.checkedAt||'')<120000?push.data:null;
    adminActivationDesk.data=evidence;adminActivationDesk.actor=actor;
    adminActivationDesk.role=role;adminActivationDesk.checkedAt=new Date().toISOString();
    return evidence;
  }catch(error){
    if(actor===String(adminRuntime.session?.user?.id||'')){
      adminActivationDesk.data=null;adminActivationDesk.error='Não foi possível conferir as ativações.';
    }
    return null;
  }finally{adminActivationDesk.loading=false;render();}
}
