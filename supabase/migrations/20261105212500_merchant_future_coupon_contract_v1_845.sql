-- TAMÃO #845 — consentimento prospectivo dos PARCEIROS para novos cupons pagos.
-- Não vende/emite cupons, não altera quaisquer vouchers anteriores,
-- não modifica cashback, ressarcimento, crédito, billing ou launch control.
-- Apenas o proprietário pode aceitar e revogar. O checkout segue bloqueado
-- para a modalidade sem ressarcimento até implementar e testar toda a liquidação.
CREATE TABLE public.merchant_coupon_terms_v1_845 (
  terms_version integer PRIMARY KEY CHECK(terms_version=1),
  max_coupon_face_cents integer NOT NULL CHECK(max_coupon_face_cents=500),
  min_order_cents integer NOT NULL CHECK(min_order_cents=1000),
  standard_flex_fee_bps integer NOT NULL CHECK(standard_flex_fee_bps=900),
  funded_flex_fee_bps integer NOT NULL CHECK(funded_flex_fee_bps=800),
  terms_text text NOT NULL CHECK(length(terms_text)>500),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.merchant_coupon_terms_v1_845 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.merchant_coupon_terms_v1_845 FROM public,anon,authenticated;
INSERT INTO public.merchant_coupon_terms_v1_845
(terms_version,max_coupon_face_cents,min_order_cents,standard_flex_fee_bps,funded_flex_fee_bps,terms_text)
VALUES
(1,500,1000,900,800,
'Aceite VOLUNTÁRIO E ESPECÍFICO para futuros cupons pagos do Clube TAMÃO custeados pela revenda. Somente cupons NOVOS expressamente identificados para esta modalidade, vendidos depois da sua ativação técnica e do aceite válido, poderão gerar desconto de até R$ 5,00 por pedido com compra mínima de R$ 10,00, desde que o cliente escolha a revenda participante e o desconto seja confirmado atomicamente no pedido. Para esses cupons elegíveis, a revenda assume o valor do desconto e não recebe ressarcimento TAMÃO. A receita de venda do cupom ao cliente pertence à plataforma emissora, não à revenda. Como contrapartida, a taxa Flex NORMAL é 9% e poderá ser 8% sobre o valor LÍQUIDO exclusivamente no pedido em que um cupom novo dessa modalidade for efetivamente aplicado; pacotes pré-pagos mantêm taxas próprias. Exemplo informativo: venda de R$ 20,00 com cupom novo de R$ 5,00 deixa R$ 15,00 a pagar diretamente à revenda, e uma taxa Flex de 8% seria R$ 1,20, sem ressarcimento dos R$ 5,00; a redução de taxa não necessariamente cobre o custo do desconto. O aceite isolado NÃO ativa cupons novos, não reduz taxas nem gera cobranças. Cupons anteriormente vendidos, direitos dos compradores, reembolsos, cashback e obrigações históricas de ressarcimento permanecem integralmente intactos, inclusive após o aceite. A revenda pode revogar para NOVAS transações; compromissos congelados em pedidos válidos anteriores devem ser cumpridos. O cliente não paga o valor da compra ao TAMÃO, mas diretamente à revenda. A implantação da modalidade depende de integração técnica e testes próprios, com comunicação prévia e condições transparentes aos compradores.');
CREATE TABLE public.merchant_coupon_consents_v1_845 (
  merchant_id uuid PRIMARY KEY REFERENCES public.merchants(id) ON DELETE RESTRICT,
  opted_in boolean NOT NULL,
  terms_version integer NOT NULL REFERENCES public.merchant_coupon_terms_v1_845(terms_version),
  accepted_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  accepted_at timestamptz NOT NULL,
  revoked_at timestamptz,
  version integer NOT NULL CHECK(version>=1),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((opted_in AND revoked_at IS NULL) OR (NOT opted_in AND revoked_at IS NOT NULL))
);
ALTER TABLE public.merchant_coupon_consents_v1_845 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.merchant_coupon_consents_v1_845 FROM public,anon,authenticated;
CREATE TABLE public.merchant_coupon_consent_events_v1_845 (
  request_id uuid PRIMARY KEY,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  operation text NOT NULL CHECK(operation IN ('accept','revoke')),
  terms_version integer NOT NULL CHECK(terms_version=1),
  contract_version integer NOT NULL CHECK(contract_version>=1),
  max_coupon_face_cents integer NOT NULL CHECK(max_coupon_face_cents=500),
  min_order_cents integer NOT NULL CHECK(min_order_cents=1000),
  standard_flex_fee_bps integer NOT NULL CHECK(standard_flex_fee_bps=900),
  funded_flex_fee_bps integer NOT NULL CHECK(funded_flex_fee_bps=800),
  terms_text_snapshot text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(merchant_id,contract_version)
);
CREATE INDEX merchant_coupon_consent_events_merchant_v1_845
 ON public.merchant_coupon_consent_events_v1_845(merchant_id,recorded_at DESC);
ALTER TABLE public.merchant_coupon_consent_events_v1_845 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.merchant_coupon_consent_events_v1_845 FROM public,anon,authenticated;
CREATE FUNCTION public.merchant_coupon_event_immutable_v1_845()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$BEGIN
 RAISE EXCEPTION 'MERCHANT_COUPON_EVENT_IMMUTABLE' USING ERRCODE='42501';
END;$$;
REVOKE ALL ON FUNCTION public.merchant_coupon_event_immutable_v1_845()
 FROM public,anon,authenticated;
CREATE TRIGGER merchant_coupon_event_immutable_v1_845_trg
 BEFORE UPDATE OR DELETE ON public.merchant_coupon_consent_events_v1_845
 FOR EACH ROW EXECUTE FUNCTION public.merchant_coupon_event_immutable_v1_845();

CREATE FUNCTION public.merchant_coupon_contract_v1_845(
 p_actor uuid,p_merchant uuid,p_operation text,
 p_terms_version integer DEFAULT NULL,p_expected_version integer DEFAULT NULL,
 p_request_id uuid DEFAULT NULL,p_consent boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
DECLARE
 v_role text;
 v_terms public.merchant_coupon_terms_v1_845%rowtype;
 v_state public.merchant_coupon_consents_v1_845%rowtype;
 v_old public.merchant_coupon_consent_events_v1_845%rowtype;
 v_version integer:=0;
 v_replay boolean:=false;
BEGIN
 IF p_actor IS NULL OR p_merchant IS NULL OR p_operation NOT IN ('view','accept','revoke')
    OR p_operation IS NULL
    OR NOT EXISTS(SELECT 1 FROM auth.users
                  WHERE id=p_actor AND is_anonymous=false)
 THEN RAISE EXCEPTION 'MERCHANT_COUPON_CONTRACT_INVALID'
   USING ERRCODE='22023'; END IF;
 SELECT member_role INTO v_role FROM public.merchant_members
 WHERE merchant_id=p_merchant AND user_id=p_actor AND active=true;
 IF v_role IS NULL OR v_role NOT IN ('owner','manager')
 THEN RAISE EXCEPTION 'MERCHANT_COUPON_CONTRACT_FORBIDDEN'
   USING ERRCODE='42501'; END IF;
 SELECT * INTO v_terms FROM public.merchant_coupon_terms_v1_845
 WHERE terms_version=1 AND enabled=true;
 IF NOT FOUND THEN RAISE EXCEPTION 'MERCHANT_COUPON_TERMS_UNAVAILABLE'
   USING ERRCODE='42501'; END IF;
 IF (SELECT platform_fee_bps FROM public.merchant_billing_plans
     WHERE plan_key='flex_daily' AND active) IS DISTINCT FROM v_terms.standard_flex_fee_bps
 THEN RAISE EXCEPTION 'MERCHANT_COUPON_FLEX_RATE_CHANGED'
   USING ERRCODE='40001'; END IF;
 IF p_operation='view' THEN
   SELECT * INTO v_state FROM public.merchant_coupon_consents_v1_845
   WHERE merchant_id=p_merchant;
 ELSE
   IF v_role<>'owner' THEN
     RAISE EXCEPTION 'MERCHANT_COUPON_OWNER_REQUIRED' USING ERRCODE='42501';
   END IF;
   IF p_terms_version IS DISTINCT FROM v_terms.terms_version
      OR p_expected_version IS NULL OR p_expected_version NOT BETWEEN 0 AND 2147483600
      OR p_request_id IS NULL
      OR (p_operation='accept' AND p_consent IS DISTINCT FROM true)
   THEN RAISE EXCEPTION 'MERCHANT_COUPON_ACCEPTANCE_INVALID'
     USING ERRCODE='22023'; END IF;
   -- Serialize owner decisions made from multiple tabs.
   PERFORM 1 FROM public.merchants WHERE id=p_merchant FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'MERCHANT_COUPON_MERCHANT_MISSING'
     USING ERRCODE='P0002'; END IF;
   SELECT * INTO v_state FROM public.merchant_coupon_consents_v1_845
   WHERE merchant_id=p_merchant FOR UPDATE;
   v_version:=coalesce(v_state.version,0);
   SELECT * INTO v_old FROM public.merchant_coupon_consent_events_v1_845
   WHERE request_id=p_request_id;
   IF FOUND THEN
     IF v_old.merchant_id<>p_merchant OR v_old.actor_user_id<>p_actor
        OR v_old.operation<>p_operation
        OR v_old.terms_version<>p_terms_version
        OR v_old.contract_version<>v_version
        OR v_state.opted_in IS DISTINCT FROM (p_operation='accept')
     THEN RAISE EXCEPTION 'MERCHANT_COUPON_REPLAY_CONFLICT'
       USING ERRCODE='23505'; END IF;
     v_replay:=true;
   ELSE
     IF p_expected_version<>v_version
     THEN RAISE EXCEPTION 'MERCHANT_COUPON_VERSION_STALE'
       USING ERRCODE='40001'; END IF;
     IF (p_operation='accept' AND coalesce(v_state.opted_in,false))
        OR (p_operation='revoke' AND NOT coalesce(v_state.opted_in,false))
     THEN RAISE EXCEPTION 'MERCHANT_COUPON_STATE_CONFLICT'
       USING ERRCODE='40001'; END IF;
     IF p_operation='accept' THEN
       INSERT INTO public.merchant_coupon_consents_v1_845
       (merchant_id,opted_in,terms_version,accepted_by,accepted_at,revoked_at,version)
       VALUES(p_merchant,true,v_terms.terms_version,p_actor,clock_timestamp(),null,1)
       ON CONFLICT(merchant_id) DO UPDATE SET
         opted_in=true,terms_version=excluded.terms_version,
         accepted_by=excluded.accepted_by,accepted_at=excluded.accepted_at,
         revoked_at=null,version=public.merchant_coupon_consents_v1_845.version+1,
         updated_at=clock_timestamp()
       RETURNING * INTO v_state;
     ELSE
       UPDATE public.merchant_coupon_consents_v1_845
       SET opted_in=false,revoked_at=clock_timestamp(),version=version+1,
           updated_at=clock_timestamp()
       WHERE merchant_id=p_merchant RETURNING * INTO v_state;
     END IF;
     INSERT INTO public.merchant_coupon_consent_events_v1_845
       (request_id,merchant_id,actor_user_id,operation,terms_version,
       contract_version,max_coupon_face_cents,min_order_cents,
       standard_flex_fee_bps,funded_flex_fee_bps,terms_text_snapshot)
     VALUES(p_request_id,p_merchant,p_actor,p_operation,v_terms.terms_version,
       v_state.version,v_terms.max_coupon_face_cents,v_terms.min_order_cents,
       v_terms.standard_flex_fee_bps,v_terms.funded_flex_fee_bps,v_terms.terms_text);
   END IF;
 END IF;
 RETURN pg_catalog.jsonb_build_object(
   'source','merchant_coupon_contract_v1_845','merchantId',p_merchant,
   'readOnly',p_operation='view','replayed',v_replay,
   'optedIn',coalesce(v_state.opted_in,false),
   'version',coalesce(v_state.version,0),'termsVersion',v_terms.terms_version,
   'termsText',v_terms.terms_text,'maxCouponFaceCents',v_terms.max_coupon_face_cents,
   'minOrderCents',v_terms.min_order_cents,
   'normalFlexFeeBps',v_terms.standard_flex_fee_bps,
   'fundedFlexFeeBps',v_terms.funded_flex_fee_bps,
   'acceptedAt',v_state.accepted_at,'revokedAt',v_state.revoked_at,
   'futureCouponsOnly',true,'checkoutEnabled',false,
   'feeReductionEnabled',false,'existingPaidCouponsUntouched',true,
   'moneyMoved',false);
END;
$fn$;
REVOKE ALL ON FUNCTION public.merchant_coupon_contract_v1_845(
 uuid,uuid,text,integer,integer,uuid,boolean) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.merchant_coupon_contract_v1_845(
 uuid,uuid,text,integer,integer,uuid,boolean) TO service_role;
