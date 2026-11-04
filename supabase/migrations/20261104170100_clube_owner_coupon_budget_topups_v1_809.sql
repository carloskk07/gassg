-- TAMÃO V1.809 — owner-controlled optional coupon-budget replenishments.
-- A replenishment is an OWNER GUARANTEE / spending commitment, not a bank
-- transaction, voucher issuance, Pix payment, revenue, or customer credit.
-- No replenishment occurs until the superadmin explicitly confirms the amount.
-- Customer vouchers are issued only by the existing paid-order settlement flow.
--
-- Bounded exposure: R$1..R$10,000 per confirmed event, R$100,000 lifetime
-- maximum including the initial R$100. This cap can be reviewed through a
-- separate audited code/migration change, never client-supplied SQL.
ALTER TABLE public.platform_clube_sponsor_pool_v1_807
  DROP CONSTRAINT platform_clube_sponsor_pool_v1_807_authorized_cents_check;
ALTER TABLE public.platform_clube_sponsor_pool_v1_807
  ADD CONSTRAINT clube_sponsor_authorized_cap_v1_809
  CHECK (authorized_cents BETWEEN 10000 AND 10000000);

ALTER TABLE public.platform_clube_sponsor_pool_v1_807
  DROP CONSTRAINT platform_clube_sponsor_pool_v1_807_owner_guaranteed_cents_check;
ALTER TABLE public.platform_clube_sponsor_pool_v1_807
  ADD CONSTRAINT clube_sponsor_owner_guarantee_cap_v1_809
  CHECK (owner_guaranteed_cents BETWEEN 0 AND 10000000);

CREATE TABLE public.platform_clube_sponsor_topups_v1_809(
  request_id uuid PRIMARY KEY,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id),
  amount_cents integer NOT NULL CHECK (amount_cents BETWEEN 100 AND 1000000),
  source text NOT NULL DEFAULT 'owner_personal_guarantee'
      CHECK (source='owner_personal_guarantee'),
  authorized_total_cents integer NOT NULL
      CHECK (authorized_total_cents BETWEEN 10000 AND 10000000),
  guaranteed_total_cents integer NOT NULL
      CHECK (guaranteed_total_cents BETWEEN 0 AND 10000000),
  pool_version integer NOT NULL CHECK (pool_version>0),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX clube_sponsor_topups_actor_time_v1_809
 ON public.platform_clube_sponsor_topups_v1_809
 (actor_user_id,recorded_at DESC);
ALTER TABLE public.platform_clube_sponsor_topups_v1_809 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_clube_sponsor_topups_v1_809 FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.platform_clube_sponsor_topups_v1_809 TO service_role;

CREATE FUNCTION public.admin_clube_sponsor_topup_v1_809(
  p_actor uuid, p_amount_cents integer, p_request uuid, p_expected_version integer
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $func$
DECLARE pool public.platform_clube_sponsor_pool_v1_807%rowtype;
        prev public.platform_clube_sponsor_topups_v1_809%rowtype;
BEGIN
 IF p_actor IS NULL OR NOT EXISTS(
   SELECT 1 FROM public.platform_admins a
   WHERE a.user_id=p_actor AND a.active=true AND a.admin_role='superadmin'
 ) THEN
   RAISE EXCEPTION 'COUPON_OWNER_TOPUP_SUPERADMIN_REQUIRED' USING ERRCODE='42501';
 END IF;
 IF p_request IS NULL OR p_amount_cents IS NULL
   OR p_amount_cents NOT BETWEEN 100 AND 1000000
   OR p_expected_version IS NULL OR p_expected_version<0
 THEN RAISE EXCEPTION 'COUPON_OWNER_TOPUP_INVALID' USING ERRCODE='22023'; END IF;

 -- One row lock serializes concurrent confirmations from the Admin.
 SELECT * INTO pool FROM public.platform_clube_sponsor_pool_v1_807
   WHERE benefit_key='clube_coupons' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'COUPON_OWNER_POOL_MISSING' USING ERRCODE='23514'; END IF;

 SELECT * INTO prev FROM public.platform_clube_sponsor_topups_v1_809
   WHERE request_id=p_request;
 IF FOUND THEN
   IF prev.actor_user_id<>p_actor OR prev.amount_cents<>p_amount_cents
   THEN RAISE EXCEPTION 'COUPON_OWNER_TOPUP_REPLAY_CONFLICT' USING ERRCODE='23505'; END IF;
   RETURN jsonb_build_object(
     'ok',true,'replayed',true,'creditedCents',prev.amount_cents,
     'bankDeposit',false,'vouchersIssued',0,
     'authorizedCents',pool.authorized_cents,
     'ownerGuaranteedCents',pool.owner_guaranteed_cents,
     'encumberedCents',pool.encumbered_cents,
     'remainingCents',pool.reconciled_cents+pool.owner_guaranteed_cents-pool.encumbered_cents,
     'version',pool.version);
 END IF;

 IF pool.version<>p_expected_version
 THEN RAISE EXCEPTION 'COUPON_OWNER_TOPUP_STALE_VERSION' USING ERRCODE='40001'; END IF;
 IF pool.authorized_cents>10000000-p_amount_cents
    OR pool.owner_guaranteed_cents>10000000-p_amount_cents
 THEN RAISE EXCEPTION 'COUPON_OWNER_TOPUP_TOTAL_CAP' USING ERRCODE='23514'; END IF;
 IF pool.reconciled_cents+pool.owner_guaranteed_cents>pool.authorized_cents
    OR pool.encumbered_cents>pool.reconciled_cents+pool.owner_guaranteed_cents
 THEN RAISE EXCEPTION 'COUPON_OWNER_TOPUP_POOL_DRIFT' USING ERRCODE='23514'; END IF;

 UPDATE public.platform_clube_sponsor_pool_v1_807 SET
   authorized_cents=authorized_cents+p_amount_cents,
   owner_guaranteed_cents=owner_guaranteed_cents+p_amount_cents,
   owner_guarantee_source='owner_admin_confirmed_topup_v1_809',
   owner_guaranteed_at=clock_timestamp(),
   version=version+1,
   updated_at=clock_timestamp()
 WHERE benefit_key='clube_coupons'
 RETURNING * INTO pool;

 INSERT INTO public.platform_clube_sponsor_topups_v1_809
   (request_id,actor_user_id,amount_cents,authorized_total_cents,
    guaranteed_total_cents,pool_version)
 VALUES (p_request,p_actor,p_amount_cents,
         pool.authorized_cents,pool.owner_guaranteed_cents,pool.version);

 INSERT INTO public.platform_admin_audit(actor_user_id,action,target_type,target_id,metadata)
 VALUES(p_actor,'clube_coupon_owner_guarantee_topup','clube_coupon_budget',
   p_request::text,jsonb_build_object(
     'source','owner_admin_confirmation','bankDeposit',false,
     'amountCents',p_amount_cents,'poolVersion',pool.version,
     'authorizedTotalCents',pool.authorized_cents,
     'ownerGuaranteedTotalCents',pool.owner_guaranteed_cents,
     'vouchersIssued',0));

 RETURN jsonb_build_object(
   'ok',true,'replayed',false,'creditedCents',p_amount_cents,
   'bankDeposit',false,'vouchersIssued',0,
   'authorizedCents',pool.authorized_cents,
   'ownerGuaranteedCents',pool.owner_guaranteed_cents,
   'encumberedCents',pool.encumbered_cents,
   'remainingCents',pool.reconciled_cents+pool.owner_guaranteed_cents-pool.encumbered_cents,
   'version',pool.version);
END
$func$;
REVOKE ALL ON FUNCTION public.admin_clube_sponsor_topup_v1_809(uuid,integer,uuid,integer)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_clube_sponsor_topup_v1_809(uuid,integer,uuid,integer)
 TO service_role;
