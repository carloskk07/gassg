\set ON_ERROR_STOP on
-- Disposable test only. Function, fixtures and failure injection all rolled back.
begin;
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

do $test$
declare
 v_owner uuid:=gen_random_uuid();
 v_other uuid:=gen_random_uuid();
 v_unverified uuid:=gen_random_uuid();
 v_draft uuid:=gen_random_uuid();
 v_slug text:='atomic-ci-'||substr(gen_random_uuid()::text,1,8);
 v_page uuid;
 v_first jsonb;
 v_again jsonb;
begin
 if has_function_privilege('anon','public.agenda_create_atomic(text,text,text,text,integer,integer,text)','execute')
 or not has_function_privilege('authenticated','public.agenda_create_atomic(text,text,text,text,integer,integer,text)','execute')
 or (select prosecdef from pg_proc where oid='public.agenda_create_atomic(text,text,text,text,integer,integer,text)'::regprocedure)
 then raise exception 'ATOMIC_RPC_ACL_INVALID';end if;
 insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,is_anonymous,created_at,updated_at)
 values
 (v_owner,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',v_owner||'@example.org',now(),false,now(),now()),
 (v_other,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',v_other||'@example.org',now(),false,now(),now()),
 (v_unverified,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',v_unverified||'@example.org',null,false,now(),now()),
 (v_draft,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',v_draft||'@example.org',now(),false,now(),now());
 perform set_config('request.jwt.claim.sub',v_owner::text,true);
 execute 'set local role authenticated';
 v_first:=public.agenda_create_atomic(v_slug,'Barbearia CI','São Gabriel','Corte',45,3500,'week_sat');
 v_page:=(v_first->>'id')::uuid;
 if not coalesce((v_first->>'created')::boolean,false) or not coalesce((v_first->>'published')::boolean,false)
 or (select count(*) from public.agenda_pages where id=v_page and owner_id=v_owner and published)<>1
 or (select count(*) from public.agenda_services where page_id=v_page and owner_id=v_owner and active and duration_min=45 and price_cents=3500)<>1
 or (select count(*) from public.agenda_hours where page_id=v_page and owner_id=v_owner and opens_min=540 and ((weekday between 1 and 5 and closes_min=1080) or (weekday=6 and closes_min=780)))<>6
 then raise exception 'ATOMIC_SETUP_INCOMPLETE';end if;
 v_again:=public.agenda_create_atomic(v_slug||'-other','Nome diferente','Outra cidade','Outro serviço',30,100,'all_week');
 if v_again->>'id' is distinct from v_first->>'id' or (v_again->>'created')::boolean is distinct from false
 or (select count(*) from public.agenda_services where page_id=v_page)<>1
 or (select count(*) from public.agenda_hours where page_id=v_page)<>6
 then raise exception 'ATOMIC_REPLAY_MUTATED';end if;
 perform set_config('request.jwt.claim.sub',v_other::text,true);
 if exists(select 1 from public.agenda_pages where id=v_page) then raise exception 'ATOMIC_FOREIGN_PAGE_VISIBLE';end if;
 begin
  perform public.agenda_create_atomic(v_slug,'Outra barbearia','São Gabriel','Corte',45,3500,'week_sat');
  raise exception 'ATOMIC_DUPLICATE_SLUG_ACCEPTED';
 exception when unique_violation then null;
 end;
 if exists(select 1 from public.agenda_pages where owner_id=v_other) then raise exception 'ATOMIC_COLLISION_ORPHAN';end if;
 perform set_config('request.jwt.claim.sub',v_unverified::text,true);
 begin
  perform public.agenda_create_atomic(v_slug||'-unverified','Barbearia CI','São Gabriel','Corte',45,3500,'week_sat');
  raise exception 'ATOMIC_UNVERIFIED_ACCEPTED';
 exception when insufficient_privilege then null;
 end;
 perform set_config('request.jwt.claim.sub',v_draft::text,true);
 insert into public.agenda_pages(slug,title,city,published) values(v_slug||'-draft','Rascunho CI','São Gabriel',false);
 v_again:=public.agenda_create_atomic(v_slug||'-draft2','Nome diferente','Outra cidade','Outro serviço',30,100,'all_week');
 if (v_again->>'created')::boolean is distinct from false or (v_again->>'published')::boolean is distinct from false
 or exists(select 1 from public.agenda_services where owner_id=v_draft)
 then raise exception 'ATOMIC_DRAFT_MUTATED';end if;
 execute 'reset role';
 -- Fail after page and service creation, not merely on input validation.
 execute 'create function pg_temp.atomic_ci_fail_hours() returns trigger language plpgsql as $f$ begin raise exception ''ATOMIC_CI_HOURS_FAILURE''; end $f$';
 execute 'create trigger atomic_ci_fail_hours before insert on public.agenda_hours for each row execute function pg_temp.atomic_ci_fail_hours()';
 perform set_config('request.jwt.claim.sub',v_other::text,true);
 execute 'set local role authenticated';
 begin
  perform public.agenda_create_atomic(v_slug||'-failure','Barbearia CI','São Gabriel','Corte',45,3500,'week_sat');
  raise exception 'ATOMIC_FAILURE_NOT_RAISED';
 exception when raise_exception then
  if sqlerrm<>'ATOMIC_CI_HOURS_FAILURE' then raise;end if;
 end;
 if exists(select 1 from public.agenda_pages where owner_id=v_other)
 or exists(select 1 from public.agenda_services where owner_id=v_other)
 or exists(select 1 from public.agenda_hours where owner_id=v_other)
 then raise exception 'ATOMIC_PARTIAL_WRITE';end if;
 execute 'reset role';
end
$test$;
rollback;
\echo PASS: atomic onboarding ACL, replay, existing draft, slug conflict and injected rollback.
