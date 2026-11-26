-- CANDIDATE ONLY. Not a migration; do not run in production.
-- Validate in disposable PostgreSQL before generating the canonical migration.
-- Caller must wrap in a disposable transaction and roll it back.
create function public.agenda_create_atomic(
 p_slug text,p_title text,p_city text,p_service text,
 p_duration integer,p_price_cents integer,p_schedule text
) returns jsonb
language plpgsql security invoker set search_path='pg_catalog'
as $$
declare
 v_user uuid:=auth.uid();
 v_page uuid;
 v_existing public.agenda_pages%rowtype;
 v_days integer[];
 v_day integer;
 v_close integer;
 v_slug text:=btrim(p_slug);
begin
 if v_user is null or not public.discovery_verified_account() then
  raise exception 'AGENDA_VERIFIED_LOGIN_REQUIRED' using errcode='42501';
 end if;
 -- Existing RLS policies and triggers additionally require verified ownership.
 if v_slug is null or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  or length(v_slug) not between 4 and 60
  or length(btrim(coalesce(p_title,''))) not between 3 and 100
  or length(btrim(coalesce(p_city,''))) not between 2 and 100
  or length(btrim(coalesce(p_service,''))) not between 3 and 100
  or p_duration is null or p_duration not between 15 and 240 or p_duration%15<>0
  or p_price_cents is null or p_price_cents not between 0 and 2000000
  or p_schedule is null or p_schedule not in ('weekdays','week_sat','all_week')
 then raise exception 'AGENDA_SETUP_INVALID' using errcode='22023';end if;
 -- Serialize this endpoint for the same owner. Existing UNIQUE constraints
 -- also protect against callers of the older page creation endpoint.
 perform pg_advisory_xact_lock(hashtextextended('agenda-atomic:'||v_user::text,0));
 select * into v_existing from public.agenda_pages where owner_id=v_user;
 if found then
  return jsonb_build_object('id',v_existing.id,'slug',v_existing.slug,
   'published',v_existing.published,'created',false);
 end if;
 insert into public.agenda_pages(slug,title,city,published)
 values(v_slug,btrim(p_title),btrim(p_city),false)
 returning id into v_page;
 insert into public.agenda_services(page_id,title,duration_min,price_cents,active)
 values(v_page,btrim(p_service),p_duration,p_price_cents,true);
 v_days:=case p_schedule when 'all_week' then array[0,1,2,3,4,5,6]
  when 'week_sat' then array[1,2,3,4,5,6] else array[1,2,3,4,5] end;
 foreach v_day in array v_days loop
  v_close:=case when p_schedule='week_sat' and v_day=6 then 780 else 1080 end;
  insert into public.agenda_hours(page_id,weekday,opens_min,closes_min)
  values(v_page,v_day,540,v_close);
 end loop;
 update public.agenda_pages set published=true
 where id=v_page and owner_id=v_user and not published;
 if not found then raise exception 'AGENDA_SETUP_NOT_PUBLISHED';end if;
 return jsonb_build_object('id',v_page,'slug',v_slug,'published',true,'created',true);
 -- Any error rolls back the entire request, including a slug conflict.
end
$$;
revoke all on function public.agenda_create_atomic(text,text,text,text,integer,integer,text) from public,anon,authenticated;
grant execute on function public.agenda_create_atomic(text,text,text,text,integer,integer,text) to authenticated;
