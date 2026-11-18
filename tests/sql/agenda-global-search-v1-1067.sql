\set ON_ERROR_STOP on
-- V1.1067: isolated, disposable Postgres ONLY; never use against production.
-- 34 synthetic owner accounts; ALL rolled back, including Auth users.
begin;
do $fixture$
declare
 i int; v_user uuid;v_page uuid;
begin
 for i in 1..34 loop
  v_user:=gen_random_uuid();
  insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,is_anonymous,created_at,updated_at)
  values(v_user,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'agenda-search-ci-'||i||'@example.org',now(),false,now(),now());
  perform set_config('request.jwt.claim.sub',v_user::text,true);
  insert into public.agenda_pages(owner_id,slug,title,about,city,published)
  values(v_user,'agenda-pesquisa-ci-'||lpad(i::text,2,'0'),
   'Barbearia pública '||lpad(i::text,2,'0'),
   'Corte de cabelo e barba','São Gabriel',i<>32)
  returning id into v_page;
  if i<>33 then
   insert into public.agenda_services(page_id,owner_id,title,duration_min,price_cents)
   values(v_page,v_user,'Corte',30,3500);
  end if;
  if i<>34 then
   insert into public.agenda_hours(page_id,owner_id,weekday,opens_min,closes_min)
   values(v_page,v_user,1,540,1080);
  end if;
 end loop;
end
$fixture$;

do $test$
declare
 n integer; total bigint; unique_count integer;
begin
 if not has_function_privilege('anon','public.agenda_search_directory(text,integer,integer)','execute')
  or not has_function_privilege('authenticated','public.agenda_search_directory(text,integer,integer)','execute')
 then raise exception 'AGENDA_SEARCH_PUBLIC_RPC_NOT_GRANTED';end if;
 if has_table_privilege('anon','public.agenda_pages','select')
  or has_table_privilege('anon','public.agenda_services','select')
  or has_table_privilege('anon','public.agenda_appointments','select')
 then raise exception 'AGENDA_SEARCH_LEAKED_PRIVATE_TABLE_ACCESS';end if;

 select count(*),max(total_count) into n,total
 from public.agenda_search_directory('',12,0);
 if n<>12 or total<>31 then
  raise exception 'AGENDA_SEARCH_FIRST_PAGE_INCORRECT: rows %, total %',n,total;end if;

 select count(*) into n from public.agenda_search_directory('',12,12);
 if n<>12 then raise exception 'AGENDA_SEARCH_SECOND_PAGE_INCORRECT';end if;
 select count(*) into n from public.agenda_search_directory('',12,24);
 if n<>7 then raise exception 'AGENDA_SEARCH_LAST_PAGE_INCORRECT: %',n;end if;

 with all_pages as (
  select slug from public.agenda_search_directory('',12,0)
  union all select slug from public.agenda_search_directory('',12,12)
  union all select slug from public.agenda_search_directory('',12,24)
 )
 select count(distinct slug) into unique_count from all_pages;
 if unique_count<>31 then raise exception 'AGENDA_SEARCH_DUPLICATES_OR_HIDDEN: %',unique_count;end if;

 select count(*),max(total_count) into n,total
 from public.agenda_search_directory('BARBEARIA SAO GABRIEL',12,0);
 if n<>12 or total<>31 then raise exception 'AGENDA_SEARCH_ACCENT_OR_TOKENS_FAILED: % %',n,total;end if;
 select count(*),max(total_count) into n,total
 from public.agenda_search_directory('corte',12,0);
 if n<>12 or total<>31 then raise exception 'AGENDA_SEARCH_SPECIALITY_NOT_FOUND: % %',n,total;end if;
 select count(*) into n from public.agenda_search_directory('inexistente',12,0);
 if n<>0 then raise exception 'AGENDA_SEARCH_FALSE_MATCH';end if;
 select count(*) into n from public.agenda_search_directory('%',12,0);
 if n<>0 then raise exception 'AGENDA_SEARCH_WILDCARD_INTERPRETED';end if;
 select count(*) into n from public.agenda_search_directory('',200,0);
 if n<>24 then raise exception 'AGENDA_SEARCH_PAGE_SIZE_NOT_CAPPED';end if;
 select count(*) into n from public.agenda_search_directory('',-1,-5);
 if n<>1 then raise exception 'AGENDA_SEARCH_BAD_ARGUMENTS';end if;
 select count(*) into n from public.agenda_search_directory('',12,99);
 if n<>0 then raise exception 'AGENDA_SEARCH_OUT_OF_RANGE_OFFSET';end if;

 if exists (
  select 1 from public.agenda_search_directory('',24,0) t
  where to_jsonb(t)?'owner_id' or to_jsonb(t)?'whatsapp_e164'
    or to_jsonb(t)?'customer_phone' or to_jsonb(t)?'page_id'
 ) then raise exception 'AGENDA_SEARCH_PRIVATE_FIELDS_EXPOSED';end if;
end $test$;

-- Public reads must work as the actual anonymous PostgREST role, not only postgres.
set local role anon;
do $anon$
declare n integer;total bigint;
begin
 select count(*),max(total_count) into n,total
 from public.agenda_search_directory('sao gabriel',12,0);
 if n<>12 or total<>31 then raise exception 'AGENDA_SEARCH_ANON_ACCESS_FAILED: % %',n,total;end if;
end $anon$;
reset role;

rollback;
\echo V1.1067 PASS: >24 published profiles, exact pages, accents, ACL, no PII, no persisted fixture.
