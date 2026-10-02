-- Chama São Gabriel — continuous merchant compliance enforcement v1.7.7
-- Compliance must remain valid after activation. Any loss of required
-- verification suspends the merchant; recovery never auto-reactivates it.

create or replace function public.enforce_compliance_continuity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_merchant_id uuid;
  v_cnpj_status text;
  v_anp_status text;
  v_has_active_p13 boolean:=false;
  v_is_active boolean:=false;
begin
  if tg_op='DELETE' then
    v_merchant_id:=old.merchant_id;

    update public.merchants
    set status='suspended',
        online=false,
        updated_at=clock_timestamp()
    where id=v_merchant_id
      and status='active';

    return old;
  end if;

  v_merchant_id:=new.merchant_id;
  v_cnpj_status:=new.cnpj_status;
  v_anp_status:=new.anp_status;

  select (m.status='active')
  into v_is_active
  from public.merchants m
  where m.id=v_merchant_id;

  if coalesce(v_is_active,false) is false then
    return new;
  end if;

  select exists(
    select 1
    from public.catalog_items ci
    where ci.merchant_id=v_merchant_id
      and ci.product_code='P13'
      and ci.active
  )
  into v_has_active_p13;

  if v_cnpj_status<>'verified'
     or (v_has_active_p13 and v_anp_status<>'verified') then
    update public.merchants
    set status='suspended',
        online=false,
        updated_at=clock_timestamp()
    where id=v_merchant_id
      and status='active';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_compliance_continuity()
from public, anon, authenticated;
grant execute on function public.enforce_compliance_continuity()
to postgres, service_role;

drop trigger if exists enforce_compliance_continuity_trg
on public.merchant_compliance;

create trigger enforce_compliance_continuity_trg
after insert or update of cnpj_status,anp_status
on public.merchant_compliance
for each row
execute function public.enforce_compliance_continuity();

drop trigger if exists enforce_compliance_delete_suspension_trg
on public.merchant_compliance;

create trigger enforce_compliance_delete_suspension_trg
before delete
on public.merchant_compliance
for each row
execute function public.enforce_compliance_continuity();
