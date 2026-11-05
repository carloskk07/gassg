-- TAMÃO #849: separate prospective buyer and seller contract for merchant-funded
-- paid coupons. No live Pix, merchant onboarding or historical reimbursements.
-- This PREPARATION cannot authorize a sale: two independent DB CHECK stops
-- (#846 launch and this agreement's sales_authorized=false) remain sealed.
INSERT INTO public.clube_coupon_paid_packages
(package_key,title,sale_price_cents,coupon_face_cents,coupons_per_pack,
 valid_days,min_order_cents,funding_verified,legal_terms_verified,
 redeem_settlement_verified,sale_enabled,sponsored_by_owner)
VALUES('partner_general_3x5_849',
 '3 cupons universais de R$ 5 nas revendas participantes',
 890,500,3,180,1000,false,false,false,false,false)
ON CONFLICT(package_key) DO NOTHING;

CREATE TABLE public.clube_partner_coupon_buyer_terms_v1_849(
 terms_version text PRIMARY KEY
   CHECK(terms_version='clube_partner_coupon_terms_v1_846'),
 contract_text text NOT NULL CHECK(length(contract_text)>600),
 effective_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.clube_partner_coupon_buyer_terms_v1_849 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clube_partner_coupon_buyer_terms_v1_849 FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.clube_partner_coupon_buyer_terms_v1_849 TO service_role;
INSERT INTO public.clube_partner_coupon_buyer_terms_v1_849(terms_version,contract_text)
VALUES('clube_partner_coupon_terms_v1_846',
'O comprador adquire cupons digitais pagos novos, identificados no Clube TAMÃO como custeados pela revenda participante, e não como cashback livre. Preço do pacote: R$ 8,90 por três cupons de R$ 5,00. A validade de 180 dias inicia na emissão após o pagamento Pix confirmado; são cupons para produtos do catálogo, em pedidos de valor bruto mínimo R$ 10,00, com no máximo um cupom desta modalidade por pedido elegível. Somente revendas que aceitaram expressamente as condições comerciais podem assumir o desconto. A revenda participante é quem reduz o valor a receber do cliente; o TAMÃO recebe somente o preço do pacote de cupons e sua taxa da plataforma, não o valor integral da compra de produtos. A aceitação do cupom depende de revenda efetivamente participante que atenda seu CEP na data da compra, estoque disponível e condições do pedido. A compra do pacote não garante preço, mercadoria, entrega ou atendimento em determinado bairro, nem obriga revendas que não aderiram. Se não houver revenda participante ou o comprador desistir, ele pode solicitar cancelamento e reembolso através do histórico de compras; o pedido é registrado imediatamente e a restituição Pix depende de confirmação real do provedor e avaliação de cupons já usados ou reservados. Cupom devolvido por cancelamento de pedido retorna ao mesmo voucher pago, dentro da validade e das condições originais; não se converte em cashback universal. Se houver estorno, contestação ou uso conflitante, a reutilização pode ser bloqueada para análise e o suporte deverá decidir pelo direito aplicável sem duplicar valores. Nenhum cupom deste contrato altera cupons antigos patrocinados pelo TAMÃO, condições históricas de reembolso, ressarcimentos de revendas, bônus de boas-vindas ou tarifas de moto e carro. O responsável pela venda e pelos pedidos de reembolso do pacote será identificado com nome, documento, endereço e contato antes da geração do Pix. A compra exige aceite específico desta versão, sem caixa pré-marcada.');

CREATE TABLE public.clube_partner_coupon_sale_agreements_v1_849(
 request_id uuid PRIMARY KEY,
 package_key text NOT NULL REFERENCES public.clube_coupon_paid_packages(package_key)
   CHECK(package_key='partner_general_3x5_849'),
 terms_version text NOT NULL REFERENCES public.clube_partner_coupon_buyer_terms_v1_849(terms_version),
 seller_name text NOT NULL CHECK(length(btrim(seller_name)) BETWEEN 5 AND 150),
 seller_tax_document text NOT NULL CHECK(seller_tax_document ~ '^[0-9]{11}$|^[0-9]{14}$'),
 seller_address text NOT NULL CHECK(length(btrim(seller_address)) BETWEEN 20 AND 260),
 seller_support_email text NOT NULL
  CHECK(seller_support_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
 owner_accepts_refund boolean NOT NULL CHECK(owner_accepts_refund),
 owner_accepts_partner_nonreimbursement boolean NOT NULL
  CHECK(owner_accepts_partner_nonreimbursement),
 sales_authorized boolean NOT NULL DEFAULT false CHECK(NOT sales_authorized),
 signed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 signed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(package_key,signed_at)
);
CREATE INDEX clube_partner_coupon_sale_agreements_recent_v1_849
 ON public.clube_partner_coupon_sale_agreements_v1_849(package_key,signed_at DESC);
ALTER TABLE public.clube_partner_coupon_sale_agreements_v1_849 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clube_partner_coupon_sale_agreements_v1_849 FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.clube_partner_coupon_sale_agreements_v1_849 TO service_role;
CREATE FUNCTION public.clube_partner_coupon_sale_agreement_immutable_v1_849()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$BEGIN RAISE EXCEPTION 'PARTNER_COUPON_SALE_AGREEMENT_IMMUTABLE'
 USING ERRCODE='23514';END;$$;
REVOKE ALL ON FUNCTION public.clube_partner_coupon_sale_agreement_immutable_v1_849()
 FROM PUBLIC,anon,authenticated;
CREATE TRIGGER clube_partner_coupon_sale_agreement_immutable_v1_849
 BEFORE UPDATE OR DELETE ON public.clube_partner_coupon_sale_agreements_v1_849
 FOR EACH ROW EXECUTE FUNCTION public.clube_partner_coupon_sale_agreement_immutable_v1_849();

-- New signature for this modality, independent of historical owner
-- reimbursement acceptance. The administrative action PREPARES a contract;
-- it never activates sales or certifies that partner supply currently exists.
CREATE FUNCTION public.admin_clube_partner_coupon_prepare_v1_849(
 p_actor uuid,p_request uuid,p_seller_name text,p_seller_doc text,
 p_seller_address text,p_seller_email text,p_accept_refund boolean,
 p_accept_no_partner_reimbursement boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $prepare$
DECLARE v_saved public.clube_partner_coupon_sale_agreements_v1_849%rowtype;
 v_package public.clube_coupon_paid_packages%rowtype;
BEGIN
 IF p_actor IS NULL OR p_request IS NULL OR p_seller_name IS NULL
 OR length(btrim(p_seller_name)) NOT BETWEEN 5 AND 150
 OR p_seller_doc IS NULL OR p_seller_doc !~ '^[0-9]{11}$|^[0-9]{14}$'
 OR p_seller_address IS NULL OR length(btrim(p_seller_address)) NOT BETWEEN 20 AND 260
 OR p_seller_email IS NULL OR lower(btrim(p_seller_email))
   !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
 OR p_accept_refund IS DISTINCT FROM true
 OR p_accept_no_partner_reimbursement IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'PARTNER_COUPON_SELLER_ACCEPTANCE_INVALID'
  USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.platform_admins
    WHERE user_id=p_actor AND active AND admin_role='superadmin')
 THEN RAISE EXCEPTION 'PARTNER_COUPON_PREPARATION_FORBIDDEN'
    USING ERRCODE='42501'; END IF;
 SELECT * INTO v_package FROM public.clube_coupon_paid_packages
 WHERE package_key='partner_general_3x5_849' FOR SHARE;
 IF NOT FOUND OR v_package.sponsored_by_owner OR v_package.sale_enabled
 OR v_package.sale_price_cents<>890 OR v_package.coupon_face_cents<>500
 OR v_package.coupons_per_pack<>3 OR v_package.valid_days<>180
 OR v_package.min_order_cents<>1000
 THEN RAISE EXCEPTION 'PARTNER_COUPON_DRAFT_CHANGED'
   USING ERRCODE='42501'; END IF;
 SELECT * INTO v_saved FROM public.clube_partner_coupon_sale_agreements_v1_849
 WHERE request_id=p_request;
 IF FOUND THEN
  IF v_saved.signed_by<>p_actor OR v_saved.seller_name<>btrim(p_seller_name)
    OR v_saved.seller_tax_document<>p_seller_doc
    OR v_saved.seller_address<>btrim(p_seller_address)
    OR v_saved.seller_support_email<>lower(btrim(p_seller_email))
    OR v_saved.terms_version<>'clube_partner_coupon_terms_v1_846'
  THEN RAISE EXCEPTION 'PARTNER_COUPON_PREPARE_REPLAY_CONFLICT'
   USING ERRCODE='23505'; END IF;
 ELSE
  INSERT INTO public.clube_partner_coupon_sale_agreements_v1_849(
   request_id,package_key,terms_version,seller_name,seller_tax_document,
   seller_address,seller_support_email,owner_accepts_refund,
   owner_accepts_partner_nonreimbursement,signed_by
  ) VALUES(p_request,v_package.package_key,'clube_partner_coupon_terms_v1_846',
   btrim(p_seller_name),p_seller_doc,btrim(p_seller_address),
   lower(btrim(p_seller_email)),true,true,p_actor)
  RETURNING * INTO v_saved;
 END IF;
 RETURN pg_catalog.jsonb_build_object(
  'ok',true,'source','clube_partner_coupon_sale_prepare_v1_849',
  'packageKey',v_saved.package_key,'requestId',v_saved.request_id,
  'termsVersion',v_saved.terms_version,'sellerDisclosed',true,
  'salesAuthorized',false,'pixCreated',false,'fundsMoved',false);
END;
$prepare$;
REVOKE ALL ON FUNCTION public.admin_clube_partner_coupon_prepare_v1_849(
 uuid,uuid,text,text,text,text,boolean,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_clube_partner_coupon_prepare_v1_849(
 uuid,uuid,text,text,text,text,boolean,boolean) TO service_role;

CREATE FUNCTION public.clube_partner_coupon_sale_readiness_v1_849(p_package text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog
AS $readiness$
 SELECT pg_catalog.jsonb_build_object(
  'source','clube_partner_coupon_sale_readiness_v1_849',
  'packageKey',p_package,
  'merchantCount',(
    SELECT count(*) FROM public.merchant_coupon_consents_v1_845 c
    JOIN public.merchants m ON m.id=c.merchant_id
    JOIN public.merchant_billing_accounts a ON a.merchant_id=m.id
    WHERE c.opted_in AND c.terms_version=1 AND m.status='active'
      AND m.online AND NOT a.sales_hold),
  'ready',(
   p_package='partner_general_3x5_849'
   AND (SELECT enabled FROM public.clube_partner_coupon_launch_v1_846 WHERE singleton) IS TRUE
   AND EXISTS(SELECT 1 FROM public.clube_coupon_paid_packages p
       WHERE p.package_key=p_package AND p.sale_enabled
         AND p.funding_verified AND p.legal_terms_verified AND p.redeem_settlement_verified
         AND NOT p.sponsored_by_owner AND p.coupon_face_cents BETWEEN 100 AND 500
         AND p.min_order_cents>=1000)
   AND EXISTS(SELECT 1 FROM public.clube_partner_coupon_sale_agreements_v1_849 s
       WHERE s.package_key=p_package AND s.sales_authorized)
   AND EXISTS(SELECT 1 FROM public.merchant_coupon_consents_v1_845 c
       JOIN public.merchants m ON m.id=c.merchant_id
       JOIN public.merchant_billing_accounts a ON a.merchant_id=m.id
       WHERE c.opted_in AND c.terms_version=1 AND m.status='active'
         AND m.online AND NOT a.sales_hold)
  )
 );
$readiness$;
REVOKE ALL ON FUNCTION public.clube_partner_coupon_sale_readiness_v1_849(text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.clube_partner_coupon_sale_readiness_v1_849(text)
 TO service_role;


-- Buyer-facing commercial seller terms MUST match the last signed disclosure
-- at the moment of invoice issuance. This guard is scoped to this future
-- package, never historical or isolated synthetic coupon invoices.
CREATE FUNCTION public.clube_partner_coupon_buyer_invoice_guard_v1_849()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $buyer_guard$
DECLARE v_sign public.clube_partner_coupon_sale_agreements_v1_849%rowtype;
 v_ready jsonb;
BEGIN
 IF new.package_key<>'partner_general_3x5_849' THEN RETURN new; END IF;
 SELECT * INTO v_sign FROM public.clube_partner_coupon_sale_agreements_v1_849
 WHERE package_key=new.package_key ORDER BY signed_at DESC LIMIT 1;
 SELECT public.clube_partner_coupon_sale_readiness_v1_849(new.package_key)
 INTO v_ready;
 IF NOT FOUND OR v_sign.request_id IS NULL OR v_sign.sales_authorized IS DISTINCT FROM true
    OR v_ready->>'ready' IS DISTINCT FROM 'true'
    OR new.funding_mode_v1_846<>'partner_funded'
    OR new.terms_version<>'clube_partner_coupon_terms_v1_846'
    OR new.funding_terms_version_v1_846 IS DISTINCT FROM new.terms_version
    OR new.terms_accepted_at IS NULL
    OR new.seller_name IS DISTINCT FROM v_sign.seller_name
    OR new.seller_tax_document IS DISTINCT FROM v_sign.seller_tax_document
    OR new.seller_address IS DISTINCT FROM v_sign.seller_address
    OR new.seller_support_email IS DISTINCT FROM v_sign.seller_support_email
    OR new.sale_price_cents<>890 OR new.coupon_face_cents<>500
    OR new.coupons_per_pack<>3 OR new.min_order_cents<>1000
    OR new.sponsor_covered_cents<>0
 THEN RAISE EXCEPTION 'PARTNER_COUPON_BUYER_CONTRACT_UNVERIFIED'
   USING ERRCODE='42501'; END IF;
 RETURN new;
END;
$buyer_guard$;
REVOKE ALL ON FUNCTION public.clube_partner_coupon_buyer_invoice_guard_v1_849()
 FROM PUBLIC,anon,authenticated;
CREATE TRIGGER z_clube_partner_coupon_buyer_invoice_guard_v1_849
 BEFORE INSERT ON public.clube_coupon_paid_invoices
 FOR EACH ROW EXECUTE FUNCTION public.clube_partner_coupon_buyer_invoice_guard_v1_849();
