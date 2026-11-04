-- TAMÃO V1.810 — cupons por valor mínimo, válidos para todo o catálogo.
-- Não modifica/cupons previamente pagos, não habilita vendas e não cria saldo.
ALTER TABLE public.clube_coupon_paid_packages
 ADD COLUMN min_order_cents integer NOT NULL DEFAULT 0
   CHECK(min_order_cents BETWEEN 0 AND 1000000);
ALTER TABLE public.clube_coupon_paid_invoices
 ADD COLUMN min_order_cents integer NOT NULL DEFAULT 0
   CHECK(min_order_cents BETWEEN 0 AND 1000000);

-- Um novo pacote geral; antigos pacotes permanecem como rascunhos legados.
-- O preço de venda não cobre o valor de face: exige reserva integral no
-- orçamento único patrocinado, além dos gates existentes.
INSERT INTO public.clube_coupon_paid_packages
 (package_key,title,sale_price_cents,coupon_face_cents,coupons_per_pack,
  valid_days,sponsored_by_owner,min_order_cents,funding_verified,
  legal_terms_verified,redeem_settlement_verified,sale_enabled)
VALUES
 ('all_products_3x5_sponsor',
  '3 cupons de R$ 5 para pedidos a partir de R$ 50',
  890,500,3,180,true,5000,false,false,false,false)
ON CONFLICT (package_key) DO NOTHING;

-- Copia a condição de uso ao registrar o pedido de compra de cupons.
-- Mudanças futuras no catálogo nunca alteram as regras de cupons já pagos.
CREATE FUNCTION public.clube_coupon_general_invoice_snapshot_v1_810()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog AS $$
DECLARE v_min integer;
BEGIN
 SELECT min_order_cents INTO v_min
 FROM public.clube_coupon_paid_packages WHERE package_key=NEW.package_key;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'COUPON_PACKAGE_NOT_FOUND' USING ERRCODE='23503';
 END IF;
 IF NEW.min_order_cents<>0 AND NEW.min_order_cents<>v_min THEN
   RAISE EXCEPTION 'COUPON_MINIMUM_CLIENT_OVERRIDE' USING ERRCODE='42501';
 END IF;
 NEW.min_order_cents:=v_min;
 RETURN NEW;
END $$;
CREATE TRIGGER clube_coupon_general_invoice_snapshot_v1_810
 BEFORE INSERT ON public.clube_coupon_paid_invoices
 FOR EACH ROW EXECUTE FUNCTION public.clube_coupon_general_invoice_snapshot_v1_810();

CREATE FUNCTION public.clube_coupon_general_invoice_immutable_v1_810()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog AS $$
BEGIN
 IF OLD.min_order_cents IS DISTINCT FROM NEW.min_order_cents THEN
   RAISE EXCEPTION 'COUPON_MINIMUM_SNAPSHOT_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER clube_coupon_general_invoice_immutable_v1_810
 BEFORE UPDATE ON public.clube_coupon_paid_invoices
 FOR EACH ROW EXECUTE FUNCTION public.clube_coupon_general_invoice_immutable_v1_810();

-- Proteção obrigatória no banco; não depende de tela ou de categoria/SKU.
-- A cotação é a fonte autoritativa do total bruto do pedido.
CREATE FUNCTION public.clube_coupon_general_minimum_reserve_v1_810()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog AS $$
DECLARE v_min integer;
        v_total integer;
BEGIN
 IF NEW.status<>'reserved' OR NEW.reserved_quote_id IS NULL THEN
   RETURN NEW;
 END IF;
 SELECT min_order_cents INTO v_min FROM public.clube_coupon_paid_invoices
 WHERE id=NEW.invoice_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'COUPON_INVOICE_NOT_FOUND' USING ERRCODE='23503'; END IF;
 SELECT gross_total_cents INTO v_total FROM public.quotes WHERE id=NEW.reserved_quote_id;
 IF NOT FOUND OR v_total<GREATEST(v_min,NEW.face_cents) THEN
   RAISE EXCEPTION 'COUPON_MINIMUM_ORDER_NOT_MET' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER clube_coupon_general_minimum_reserve_v1_810
 BEFORE UPDATE OF status,reserved_quote_id ON public.clube_coupon_paid_issuances
 FOR EACH ROW EXECUTE FUNCTION public.clube_coupon_general_minimum_reserve_v1_810();

-- Segundo bloqueio na aplicação final: cobre reservas existentes e replays.
-- O checkout V8 e o lançamento de carteira continuam atômicos: uma falha
-- neste trigger desfaz pedido, reserva e crédito criado na mesma transação.
CREATE FUNCTION public.clube_coupon_general_minimum_apply_v1_810()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog AS $$
DECLARE v_min integer;
        v_total integer;
BEGIN
 SELECT min_order_cents INTO v_min FROM public.clube_coupon_paid_invoices
 WHERE id=NEW.invoice_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'COUPON_INVOICE_NOT_FOUND' USING ERRCODE='23503'; END IF;
 SELECT gross_total_cents INTO v_total FROM public.quotes WHERE id=NEW.quote_id;
 IF NOT FOUND OR v_total<GREATEST(v_min,NEW.face_cents) THEN
   RAISE EXCEPTION 'COUPON_MINIMUM_ORDER_NOT_MET' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER clube_coupon_general_minimum_apply_v1_810
 BEFORE INSERT ON public.clube_coupon_paid_order_applications
 FOR EACH ROW EXECUTE FUNCTION public.clube_coupon_general_minimum_apply_v1_810();

-- Ajuste manual apenas pelo proprietário e somente com pacote DESABILITADO:
-- um contrato comercial ativo não muda silenciosamente. Invoices antigos
-- conservam sua regra no snapshot; reativação requer homologação de termos.
CREATE FUNCTION public.admin_clube_coupon_general_minimum_set_v1_810(
 p_actor uuid,p_min_order_cents integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog AS $$
DECLARE v_pkg public.clube_coupon_paid_packages%rowtype;
BEGIN
 IF p_actor IS NULL OR NOT EXISTS (
   SELECT 1 FROM public.platform_admins
   WHERE user_id=p_actor AND active AND admin_role='superadmin'
 ) THEN
   RAISE EXCEPTION 'COUPON_MINIMUM_SUPERADMIN_REQUIRED' USING ERRCODE='42501';
 END IF;
 IF p_min_order_cents IS NULL OR p_min_order_cents NOT BETWEEN 1000 AND 1000000 THEN
   RAISE EXCEPTION 'COUPON_MINIMUM_INVALID' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_pkg FROM public.clube_coupon_paid_packages
 WHERE package_key='all_products_3x5_sponsor' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'COUPON_GENERAL_PACKAGE_MISSING' USING ERRCODE='23503'; END IF;
 IF v_pkg.sale_enabled THEN
   RAISE EXCEPTION 'COUPON_MINIMUM_REQUIRES_PAUSED_PACKAGE' USING ERRCODE='42501';
 END IF;
 IF v_pkg.min_order_cents=p_min_order_cents THEN
   RETURN pg_catalog.jsonb_build_object('ok',true,'replayed',true,
     'minimumCents',p_min_order_cents,'saleEnabled',false);
 END IF;
 UPDATE public.clube_coupon_paid_packages
 SET min_order_cents=p_min_order_cents,updated_at=clock_timestamp()
 WHERE package_key=v_pkg.package_key;
 INSERT INTO public.platform_admin_audit(actor_user_id,action,target_type,target_id,metadata)
 VALUES(p_actor,'clube_coupon_general_minimum_changed',
   'clube_coupon_paid_package',v_pkg.package_key,
   pg_catalog.jsonb_build_object('previousCents',v_pkg.min_order_cents,
     'minimumCents',p_min_order_cents,'saleEnabled',false));
 RETURN pg_catalog.jsonb_build_object('ok',true,'replayed',false,
   'minimumCents',p_min_order_cents,'saleEnabled',false);
END $$;

-- Fechar execução direta das funções privilegiadas a usuários do navegador.
REVOKE ALL ON FUNCTION public.clube_coupon_general_invoice_snapshot_v1_810() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.clube_coupon_general_invoice_immutable_v1_810() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.clube_coupon_general_minimum_reserve_v1_810() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.clube_coupon_general_minimum_apply_v1_810() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_clube_coupon_general_minimum_set_v1_810(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_clube_coupon_general_minimum_set_v1_810(uuid,integer) TO service_role;
