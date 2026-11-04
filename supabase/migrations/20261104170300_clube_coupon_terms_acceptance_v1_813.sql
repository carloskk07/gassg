-- TAMÃO V1.813 — consentimento de compra do pacote, versionado e auditável.
-- Não ativa vendas, revendas, Pix ou cupons. Registros antigos sem termos
-- (se existirem) permanecem intocados; compras novas exigem aceite na Edge.
ALTER TABLE public.clube_coupon_paid_invoices
 ADD COLUMN terms_version text,
 ADD COLUMN terms_accepted_at timestamptz,
 ADD CONSTRAINT clube_coupon_terms_pair_v1_813 CHECK (
   (terms_version IS NULL AND terms_accepted_at IS NULL) OR
   (terms_version IS NOT NULL AND terms_accepted_at IS NOT NULL
     AND length(terms_version) BETWEEN 12 AND 64)
 );

-- Não é permitido reinterpretar o aceite de uma compra já criada.
CREATE FUNCTION public.clube_coupon_terms_immutable_v1_813()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.terms_version IS DISTINCT FROM OLD.terms_version OR
    NEW.terms_accepted_at IS DISTINCT FROM OLD.terms_accepted_at THEN
   RAISE EXCEPTION 'COUPON_TERMS_SNAPSHOT_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER clube_coupon_terms_immutable_v1_813
 BEFORE UPDATE ON public.clube_coupon_paid_invoices
 FOR EACH ROW EXECUTE FUNCTION public.clube_coupon_terms_immutable_v1_813();
REVOKE ALL ON FUNCTION public.clube_coupon_terms_immutable_v1_813()
 FROM PUBLIC,anon,authenticated;
