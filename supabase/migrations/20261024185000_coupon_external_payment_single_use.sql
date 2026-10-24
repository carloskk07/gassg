-- TAMÃO financial integrity: one Mercado Pago Pix payment and one
-- released-net-receipt reference can belong to at most ONE coupon invoice.
-- Canonical receiving account is shared; provider_order_id is already UNIQUE.
-- This is defense in depth against cross-invoice double funding from a
-- webhook retry, provider event mixup or operator reconciliation mistake.
-- No package activation, seed invoice, credit or payment is performed.
-- NULL means not yet attributed and remains valid on multiple unpaid invoices.
-- These identifiers are retained on refunded/reviewed invoices to prevent reuse.

create unique index clube_coupon_invoice_provider_payment_unique
 on public.clube_coupon_paid_invoices(provider_payment_id)
 where provider_payment_id is not null;

create unique index clube_coupon_invoice_net_release_unique
 on public.clube_coupon_paid_invoices(net_proceeds_reference)
 where net_proceeds_reference is not null;
