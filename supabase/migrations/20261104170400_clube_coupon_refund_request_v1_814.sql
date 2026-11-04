-- V1.814: pedido de cancelamento/reembolso de um pacote pago.
-- O pedido não é prova de estorno e não gera movimentação bancária.
-- O comprador recebe protocolo sem precisar esperar uma revenda.
CREATE TABLE public.clube_coupon_refund_requests_v1_814 (
  invoice_id uuid PRIMARY KEY REFERENCES public.clube_coupon_paid_invoices(id) ON DELETE RESTRICT,
  customer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL UNIQUE,
  reason text NOT NULL CHECK (reason IN ('arrependimento','sem_atendimento','outro')),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','in_review','refunded','closed')),
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX clube_coupon_refund_requests_customer_v1_814
 ON public.clube_coupon_refund_requests_v1_814(customer_user_id,received_at DESC);
ALTER TABLE public.clube_coupon_refund_requests_v1_814 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clube_coupon_refund_requests_v1_814 FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.clube_coupon_refund_requests_v1_814 TO service_role;

-- FOR UPDATE shares the invoice lock with voucher-reservation/checkout RPCs:
-- refunds cannot slip between a quote and a completed coupon-backed order.
CREATE FUNCTION public.clube_coupon_refund_request_v1_814(
  p_customer uuid,p_invoice uuid,p_request uuid,p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE inv public.clube_coupon_paid_invoices%rowtype;
        existing public.clube_coupon_refund_requests_v1_814%rowtype;
        v_request public.clube_coupon_refund_requests_v1_814%rowtype;
BEGIN
 IF p_customer IS NULL OR p_invoice IS NULL OR p_request IS NULL
    OR p_reason IS NULL OR p_reason NOT IN ('arrependimento','sem_atendimento','outro')
 THEN RAISE EXCEPTION 'COUPON_REFUND_INVALID_INPUT' USING ERRCODE='22023'; END IF;
 SELECT * INTO inv FROM public.clube_coupon_paid_invoices
 WHERE id=p_invoice FOR UPDATE;
 IF NOT FOUND OR inv.customer_user_id IS DISTINCT FROM p_customer
 THEN RAISE EXCEPTION 'COUPON_REFUND_INVOICE_NOT_OWNED' USING ERRCODE='42501'; END IF;
 IF inv.status IN ('refunded','cancelled','expired')
 THEN RAISE EXCEPTION 'COUPON_REFUND_ALREADY_CLOSED' USING ERRCODE='22023'; END IF;
 SELECT * INTO existing FROM public.clube_coupon_refund_requests_v1_814
 WHERE invoice_id=p_invoice;
 IF FOUND THEN
   RETURN pg_catalog.jsonb_build_object('ok',true,'replayed',true,
    'invoiceId',p_invoice,'requestId',existing.request_id,'status',existing.status,
    'receivedAt',existing.received_at,'refundConfirmed',existing.status='refunded');
 END IF;
 IF EXISTS (SELECT 1 FROM public.clube_coupon_refund_requests_v1_814
            WHERE request_id=p_request) THEN
   RAISE EXCEPTION 'COUPON_REFUND_IDEMPOTENCY_CONFLICT' USING ERRCODE='23505';
 END IF;
 INSERT INTO public.clube_coupon_refund_requests_v1_814
   (invoice_id,customer_user_id,request_id,reason)
 VALUES(p_invoice,p_customer,p_request,p_reason) RETURNING * INTO v_request;
 RETURN pg_catalog.jsonb_build_object('ok',true,'replayed',false,
  'invoiceId',p_invoice,'requestId',v_request.request_id,'status',v_request.status,
  'receivedAt',v_request.received_at,'refundConfirmed',false);
END $$;

-- The buyer's cancellation request freezes NEW use of this package.
-- Already-reserved/redeemed coupons require finance review, not automatic reversal.
CREATE FUNCTION public.clube_coupon_refund_block_reservation_v1_814()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.status='reserved' AND EXISTS(
   SELECT 1 FROM public.clube_coupon_refund_requests_v1_814 r
   WHERE r.invoice_id=NEW.invoice_id AND r.status<>'closed'
 ) THEN RAISE EXCEPTION 'COUPON_REFUND_PENDING' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER clube_coupon_refund_block_reservation_v1_814
 BEFORE UPDATE OF status,reserved_quote_id ON public.clube_coupon_paid_issuances
 FOR EACH ROW EXECUTE FUNCTION public.clube_coupon_refund_block_reservation_v1_814();

CREATE FUNCTION public.clube_coupon_refund_block_order_v1_814()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.clube_coupon_refund_requests_v1_814 r
   WHERE r.invoice_id=NEW.invoice_id AND r.status<>'closed')
 THEN RAISE EXCEPTION 'COUPON_REFUND_PENDING' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER clube_coupon_refund_block_order_v1_814
 BEFORE INSERT ON public.clube_coupon_paid_order_applications
 FOR EACH ROW EXECUTE FUNCTION public.clube_coupon_refund_block_order_v1_814();

REVOKE ALL ON FUNCTION public.clube_coupon_refund_request_v1_814(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.clube_coupon_refund_request_v1_814(uuid,uuid,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.clube_coupon_refund_block_reservation_v1_814() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.clube_coupon_refund_block_order_v1_814() FROM PUBLIC,anon,authenticated;

-- When an independently verified PSP refund changes the invoice's authoritative
-- status, close the buyer's protocol in the SAME DB transaction. A request
-- by itself never sets the protocol to refunded.
CREATE FUNCTION public.clube_coupon_refund_sync_verified_v1_814()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.status='refunded' AND OLD.status IS DISTINCT FROM NEW.status THEN
   UPDATE public.clube_coupon_refund_requests_v1_814
     SET status='refunded',updated_at=clock_timestamp()
   WHERE invoice_id=NEW.id AND customer_user_id=NEW.customer_user_id
     AND status IN ('requested','in_review');
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER clube_coupon_refund_sync_verified_v1_814
 AFTER UPDATE OF status ON public.clube_coupon_paid_invoices
 FOR EACH ROW EXECUTE FUNCTION public.clube_coupon_refund_sync_verified_v1_814();
REVOKE ALL ON FUNCTION public.clube_coupon_refund_sync_verified_v1_814()
 FROM PUBLIC,anon,authenticated;
