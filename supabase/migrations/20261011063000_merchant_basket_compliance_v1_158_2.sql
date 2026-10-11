-- V1.158.2: regulatory checks by basket, independent of payment channel.
-- Requires V1.158.1. Never weaken GLP/ANP requirements.
create or replace function public.merchant_basket_compliance_current(
 p_merchant_id uuid,p_product_codes text[]
)
returns boolean language sql stable security definer
set search_path to pg_catalog
as $func$
select coalesce(
 p_merchant_id is not null
 and p_product_codes is not null
 and cardinality(p_product_codes)>0
 and public.merchant_cnpj_compliance_current(p_merchant_id)
 and (
   select count(*)=cardinality(p_product_codes)
     and bool_and(code<>''
       and (p.product_code is not null
         or public.is_glp_product_code(code)
         or public.is_glp_container_product_code(code)))
     and (not bool_or(
       public.is_glp_product_code(code)
       or public.is_glp_container_product_code(code)
       or coalesce(p.delivery_class in ('regulated_glp','regulated_glp_container'),false)
     ) or public.merchant_anp_verification_current(p_merchant_id))
   from (
     select upper(trim(coalesce(x,''))) as code
     from unnest(p_product_codes) as v(x)
   ) requested
   left join public.product_delivery_profiles p
     on p.product_code=requested.code and p.active
 ),false);
$func$;
revoke all on function public.merchant_basket_compliance_current(uuid,text[])
  from public,anon,authenticated;
grant execute on function public.merchant_basket_compliance_current(uuid,text[])
  to service_role;

create or replace function public.merchant_has_compliant_catalog_item(p_merchant_id uuid)
returns boolean language sql stable security definer set search_path to pg_catalog
as $func$
select p_merchant_id is not null and exists(
 select 1 from public.catalog_items ci
 where ci.merchant_id=p_merchant_id and ci.active
   and public.merchant_basket_compliance_current(p_merchant_id,array[ci.product_code])
);
$func$;
revoke all on function public.merchant_has_compliant_catalog_item(uuid)
  from public,anon,authenticated;
grant execute on function public.merchant_has_compliant_catalog_item(uuid)
  to service_role;

create or replace function public.enforce_quote_item_regulatory_authority()
returns trigger language plpgsql security definer set search_path to pg_catalog
as $func$
declare v_merchant_id uuid;
begin
 select merchant_id into v_merchant_id from public.quotes
 where id=new.quote_id for share;
 if v_merchant_id is null or not public.merchant_basket_compliance_current(
     v_merchant_id,array[new.product_code]
 ) then
   raise exception 'QUOTE_PRODUCT_REGULATORY_NOT_AUTHORIZED' using errcode='40001';
 end if;
 return new;
end;
$func$;
revoke all on function public.enforce_quote_item_regulatory_authority()
  from public,anon,authenticated;
drop trigger if exists quote_item_regulatory_authority_trg on public.quote_items;
create trigger quote_item_regulatory_authority_trg
before insert or update of quote_id,product_code on public.quote_items
for each row execute function public.enforce_quote_item_regulatory_authority();

create or replace function public.enforce_order_item_regulatory_authority()
returns trigger language plpgsql security definer set search_path to pg_catalog
as $func$
declare v_merchant_id uuid;
begin
 select merchant_id into v_merchant_id from public.orders
 where id=new.order_id for share;
 if v_merchant_id is null or not public.merchant_basket_compliance_current(
     v_merchant_id,array[new.product_code]
 ) then
   raise exception 'ORDER_PRODUCT_REGULATORY_NOT_AUTHORIZED' using errcode='40001';
 end if;
 return new;
end;
$func$;
revoke all on function public.enforce_order_item_regulatory_authority()
  from public,anon,authenticated;
drop trigger if exists order_item_regulatory_authority_trg on public.order_items;
create trigger order_item_regulatory_authority_trg
before insert or update of order_id,product_code on public.order_items
for each row execute function public.enforce_order_item_regulatory_authority();

create or replace function public.enforce_order_basket_regulatory_authority()
returns trigger language plpgsql security definer set search_path to pg_catalog
as $func$
declare v_codes text[];
begin
 if (
   new.merchant_id is distinct from old.merchant_id
   and new.status not in ('CANCELLED','SETTLED')
 ) or (
   new.status in ('PREPARING','OUT_FOR_DELIVERY')
   and old.status is distinct from new.status
 ) then
   select array_agg(oi.product_code order by oi.product_code)
     into v_codes from public.order_items oi where oi.order_id=new.id;
   if coalesce(cardinality(v_codes),0)>0
      and not public.merchant_basket_compliance_current(new.merchant_id,v_codes)
   then
     raise exception 'ORDER_BASKET_REGULATORY_NOT_AUTHORIZED'
       using errcode='40001';
   end if;
 end if;
 return new;
end;
$func$;
revoke all on function public.enforce_order_basket_regulatory_authority()
  from public,anon,authenticated;
drop trigger if exists order_basket_regulatory_authority_trg on public.orders;
create trigger order_basket_regulatory_authority_trg
before update of merchant_id,status on public.orders
for each row execute function public.enforce_order_basket_regulatory_authority();
