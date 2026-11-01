-- Exact service modality is verified at the authoritative write boundary.
-- Existing mobility_create_request matches "táxi" inside "mototáxi" for car.
-- The user-facing selector must never be the only line of defense.
-- No browser grants, new payable actions, identity claims or RLS changes.
create function public.mobility_service_category_guard()
returns trigger language plpgsql security invoker
set search_path=pg_catalog as $mobility_category$
declare v_category text;
begin
 if new.service not in ('moto','carro') or new.listing_id is null or
    new.driver_id is null then
  raise exception 'MOBILITY_INVALID_SERVICE_CATEGORY'
    using errcode='22023';
 end if;
 -- Only a real, currently published professional and the exact owner.
 -- Distinguish motorcycle taxonomy BEFORE matching the word "táxi".
 select case
   when d.occupation ~* '(motot[aá]xi|moto.?taxi)' then 'moto'
   when d.occupation ~* '(motorista|t[aá]xi|taxista)' then 'carro'
   else null
 end into v_category
 from public.discovery_listings l
 join public.discovery_professional_details d on d.listing_id=l.id
 where l.id=new.listing_id and l.owner_id=new.driver_id
   and l.vertical='professionals' and l.status='published'
   and exists(select 1 from public.discovery_vertical_cities c
     where c.vertical='professionals' and c.state_code=l.state_code
       and c.city_key=l.city_key and c.enabled);
 if v_category is distinct from new.service then
  raise exception 'MOBILITY_PROVIDER_SERVICE_MISMATCH'
    using errcode='42501';
 end if;
 return new;
end $mobility_category$;
revoke all on function public.mobility_service_category_guard()
 from public,anon,authenticated;
create trigger mobility_enforce_service_category
before insert or update of service,listing_id,driver_id
on public.mobility_requests
for each row execute function public.mobility_service_category_guard();

-- The browser still only uses the pre-existing participant-scoped RPC.
-- No SECURITY DEFINER body changes, so the fail-closed launch ACL signature
-- remains byte-for-byte as reviewed.
