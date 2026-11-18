\set ON_ERROR_STOP on
-- TAMÃO Agenda V1.1070: fully disposable owner/visitor security check. NEVER run on production.
begin;
set local statement_timeout='90s';

-- Owner A has published page; owner B has unpublished page; anonymous C cannot edit.
insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,is_anonymous,created_at,updated_at)
values
 ('10700000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','agenda-premium-owner-a@example.invalid',now(),false,now(),now()),
 ('10700000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','agenda-premium-owner-b@example.invalid',now(),false,now(),now()),
 ('10700000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','agenda-premium-unverified@example.invalid',now(),false,now(),now());
-- The existing Agenda trigger requires a verified owner identity for profile creation.
-- Create each disposable profile under its real simulated owner, then revoke C's verification.
select set_config('request.jwt.claim.sub','10700000-0000-4000-8000-000000000001',true);
insert into public.agenda_pages(id,owner_id,slug,title,city,published)
values('10700000-0000-4000-8000-000000000011','10700000-0000-4000-8000-000000000001',
 'agenda-premium-rls-public-a','Barbearia A','São Gabriel',true);
select set_config('request.jwt.claim.sub','10700000-0000-4000-8000-000000000002',true);
insert into public.agenda_pages(id,owner_id,slug,title,city,published)
values('10700000-0000-4000-8000-000000000022','10700000-0000-4000-8000-000000000002',
 'agenda-premium-rls-private-b','Clínica B','São Gabriel',false);
select set_config('request.jwt.claim.sub','10700000-0000-4000-8000-000000000003',true);
insert into public.agenda_pages(id,owner_id,slug,title,city,published)
values('10700000-0000-4000-8000-000000000033','10700000-0000-4000-8000-000000000003',
 'agenda-premium-rls-anonymous-c','Agenda C','São Gabriel',false);
update auth.users set is_anonymous=true,email_confirmed_at=null
where id='10700000-0000-4000-8000-000000000003';
insert into public.agenda_page_design(page_id,template,headline)
values ('10700000-0000-4000-8000-000000000011','black-gold','Marca A');

do $permissions$
begin
 if not (select relrowsecurity from pg_class where oid='public.agenda_page_design'::regclass)
   or not has_table_privilege('anon','public.agenda_page_design','SELECT')
   or has_table_privilege('anon','public.agenda_page_design','UPDATE')
   or has_table_privilege('anon','public.agenda_page_design','INSERT')
   or has_table_privilege('authenticated','public.agenda_page_design','DELETE')
 then raise exception 'AGENDA_PREMIUM_BROWSER_PRIVILEGE_DRIFT'; end if;
 if exists(select 1 from information_schema.columns
           where table_schema='public' and table_name='agenda_page_design' and column_name='owner_id')
 then raise exception 'AGENDA_PREMIUM_PRIVATE_OWNER_UUID_LEAK';end if;
end $permissions$;

set local role anon;
do $anonymous$
declare v_count int;
begin
 select count(*) into v_count from public.agenda_page_design;
 if v_count<>1 then raise exception 'AGENDA_ANON_SAW_UNPUBLISHED_DESIGN_%',v_count;end if;
 if not exists(select 1 from public.agenda_page_design
               where page_id='10700000-0000-4000-8000-000000000011'
               and template='black-gold')
 then raise exception 'AGENDA_ANON_CANNOT_VIEW_PUBLISHED_DESIGN';end if;
end $anonymous$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','10700000-0000-4000-8000-000000000001',true);
do $owner_a$
declare v_changed int;v_unauthorized boolean:=false;
begin
 update public.agenda_page_design set headline='Marca A renovada',template='elegance'
 where page_id='10700000-0000-4000-8000-000000000011';
 get diagnostics v_changed=row_count;
 if v_changed<>1 then raise exception 'AGENDA_OWNER_COULD_NOT_EDIT';end if;
 update public.agenda_page_design set headline='A invadiu B'
 where page_id='10700000-0000-4000-8000-000000000022';
 get diagnostics v_changed=row_count;
 if v_changed<>0 then raise exception 'AGENDA_OWNER_CROSS_PAGE_UPDATE';end if;
 begin
  insert into public.agenda_page_design(page_id,template)
  values('10700000-0000-4000-8000-000000000022','clean');
 exception when insufficient_privilege then v_unauthorized:=true;end;
 if not v_unauthorized then raise exception 'AGENDA_CROSS_OWNER_INSERT_ALLOWED';end if;
end $owner_a$;

select set_config('request.jwt.claim.sub','10700000-0000-4000-8000-000000000002',true);
do $owner_b$
declare v_count int;
begin
 select count(*) into v_count from public.agenda_page_design;
 if v_count<>1 then raise exception 'AGENDA_PRIVATE_OWNER_CANNOT_VIEW_OWN_PAGE';end if;
 insert into public.agenda_page_design(page_id,template,headline)
 values('10700000-0000-4000-8000-000000000022','clean','Marca B');
 update public.agenda_page_design set font_style='classic'
 where page_id='10700000-0000-4000-8000-000000000022';
 if not exists(select 1 from public.agenda_page_design
               where page_id='10700000-0000-4000-8000-000000000022'
               and font_style='classic')
 then raise exception 'AGENDA_UNPUBLISHED_OWNER_SAVE_FAILED';end if;
end $owner_b$;

select set_config('request.jwt.claim.sub','10700000-0000-4000-8000-000000000003',true);
do $unverified$
declare v_denied boolean:=false;
begin
 begin
  insert into public.agenda_page_design(page_id,template)
  values('10700000-0000-4000-8000-000000000033','clean');
 exception when insufficient_privilege then v_denied:=true;end;
 if not v_denied then raise exception 'AGENDA_UNVERIFIED_PROFILE_EDIT_ACCEPTED';end if;
end $unverified$;
reset role;

-- Publishing a page reveals its theme but not the private agenda_pages table.
update public.agenda_pages set published=true
where id='10700000-0000-4000-8000-000000000022';
set local role anon;
do $published$
begin
 if (select count(*) from public.agenda_page_design)<>2 then
  raise exception 'AGENDA_PUBLISH_DID_NOT_REVEAL_DESIGN';end if;
end $published$;
reset role;

-- Invalid theme input must fail at the database boundary even if client validation is bypassed.
do $invalid$
declare v_denied boolean:=false;
begin
 begin
  update public.agenda_page_design set primary_color='red'
  where page_id='10700000-0000-4000-8000-000000000011';
 exception when check_violation then v_denied:=true;end;
 if not v_denied then raise exception 'AGENDA_INVALID_COLOR_ACCEPTED';end if;
end $invalid$;

rollback;
\echo V1.1070 PASS: anon published-only, verified owner insert/update, no cross-account writes, private page and invalid data, zero persisted fixtures.
