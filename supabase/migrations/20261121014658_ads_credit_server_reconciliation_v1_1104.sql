-- V1.1104: the server reconciles the original Ads credit Pix even after
-- the advertiser closes their browser. This does not create a payment, charge,
-- refund or replacement wallet. Existing queue auth, leases and cron remain.
ALTER TABLE public.platform_payment_reconciliation_queue
 DROP CONSTRAINT platform_payment_reconciliation_queue_kind_check,
 ADD CONSTRAINT platform_payment_reconciliation_queue_kind_check
 CHECK (kind IN ('billing','coupon','mobility','advertising','merchant_sale','ads_credit'));

CREATE OR REPLACE FUNCTION public.platform_payment_reconciliation_enqueue()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE v_kind text; v_row jsonb; v_resource uuid;
BEGIN
 v_kind:=CASE tg_table_name
  WHEN 'merchant_billing_provider_charges' THEN 'billing'
  WHEN 'clube_coupon_paid_invoices' THEN 'coupon'
  WHEN 'mobility_fee_pix_invoices_v1_837' THEN 'mobility'
  WHEN 'ads_independent_checkouts_v1_886' THEN 'advertising'
  WHEN 'merchant_sale_payment_attempts' THEN 'merchant_sale'
  WHEN 'ads_credit_topups_v1_1097' THEN 'ads_credit'
  ELSE null END;
 IF tg_table_schema<>'public' OR v_kind IS NULL
 THEN RAISE EXCEPTION 'PAYMENT_QUEUE_SOURCE_INVALID'; END IF;
 v_row:=to_jsonb(new);
 v_resource:=(v_row->>CASE WHEN v_kind='advertising' THEN 'campaign_id' ELSE 'id' END)::uuid;
 INSERT INTO public.platform_payment_reconciliation_queue(kind,resource_id,next_check_at)
 VALUES(v_kind,v_resource,clock_timestamp()+interval '30 seconds')
 ON CONFLICT(kind,resource_id) DO UPDATE
 SET next_check_at=least(platform_payment_reconciliation_queue.next_check_at,excluded.next_check_at),
     priority=0;
 RETURN new;
END $fn$;
REVOKE ALL ON FUNCTION public.platform_payment_reconciliation_enqueue()
 FROM public,anon,authenticated,service_role;

-- Enqueue only original topup changes; never enqueue a billing request by
-- merely opening the page. Existing credit controls remain unchanged.
CREATE TRIGGER payment_reconciliation_ads_credit
 AFTER INSERT OR UPDATE OF status,provider_payment_id,provider_status,reversed_cents
 ON public.ads_credit_topups_v1_1097 FOR EACH ROW
 EXECUTE FUNCTION public.platform_payment_reconciliation_enqueue();

-- Include existing paid payments so later partial/full provider reversals can
-- be detected. A fresh PSP lookup remains mandatory for every ledger change.
INSERT INTO public.platform_payment_reconciliation_queue(kind,resource_id,next_check_at)
 SELECT 'ads_credit',id,clock_timestamp()+interval '30 seconds'
 FROM public.ads_credit_topups_v1_1097
 WHERE status<>'reserved'
 ON CONFLICT(kind,resource_id) DO NOTHING;
