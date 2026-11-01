\set ON_ERROR_STOP on
-- Integration test against disposable PostgreSQL 17. No production connection.
create role anon nologin;
create role authenticated nologin;
create schema auth;
grant usage on schema auth to anon, authenticated;
create table auth.users(
 id uuid primary key,
 is_anonymous boolean not null default false,
 email_confirmed_at timestamptz,
 phone_confirmed_at timestamptz
);
create function auth.uid() returns uuid language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table public.platform_admins(
 user_id uuid primary key references auth.users(id),
 active boolean not null,
 admin_role text not null
);

-- Isolated Storage metadata fixture; real files are NEVER manipulated by tests.
create schema storage;
create table storage.buckets(
 id text primary key,name text,public boolean,
 file_size_limit bigint,allowed_mime_types text[]
);
create table storage.objects(
 bucket_id text references storage.buckets(id),
 name text,owner_id text,metadata jsonb not null default '{}'::jsonb,
 primary key(bucket_id,name)
);
alter table storage.objects enable row level security;
grant usage on schema storage to anon,authenticated;
-- Supabase Storage grants SELECT to authenticated; RLS still scopes each object.
grant insert,select,delete on storage.objects to authenticated;

insert into auth.users(id,is_anonymous,email_confirmed_at) values
 ('00000000-0000-0000-0000-000000000011',false,now()),
 ('00000000-0000-0000-0000-000000000022',false,now()),
 ('00000000-0000-0000-0000-000000000033',false,now()),
 ('00000000-0000-0000-0000-000000000044',true,null);
insert into public.platform_admins(user_id,active,admin_role)
 values ('00000000-0000-0000-0000-000000000033',true,'superadmin');

\i supabase/migrations/20261018131000_discovery_shared_verticals.sql
\i supabase/migrations/20261101195756_discovery_live_ride_seat_management_v1_493.sql

-- Newly-installed verticals never activate existing product marketplace.
select count(*) as unactivated_cities from public.discovery_vertical_cities;
select count(*) as unbilled_days from public.discovery_advertising_daily_ledger;
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000011';
insert into storage.objects(bucket_id,name,owner_id,metadata)
values('tamao-discovery-photos','00000000-0000-0000-0000-000000000011/11111111-1111-1111-1111-111111111111.jpg',
 '00000000-0000-0000-0000-000000000011',
 '{"mimetype":"image/jpeg"}'::jsonb);
insert into public.discovery_listings(
 vertical,title,description,state_code,city_key,city_name,
 whatsapp_e164,photo_urls
) values(
 'professionals','Eletricista experiente','Atendimento profissional na região com orçamento direto.',
 'RS','sao-gabriel','São Gabriel','+5555999999999',
 array['00000000-0000-0000-0000-000000000011/11111111-1111-1111-1111-111111111111.jpg']
) returning id as listing_id \gset

select set_config('tamao.test.listing_id', :'listing_id', false);

insert into public.discovery_professional_details(
 listing_id,occupation,service_area,years_experience
) values ((current_setting('tamao.test.listing_id'))::uuid,'Eletricista','São Gabriel e localidades próximas',12);

-- Fotos já referenciadas não podem ser deletadas pela Storage API,
-- mesmo pelo próprio anunciante. Apenas uploads não associados admitem limpeza.
do $photo_guard$
declare n integer;
begin
 delete from storage.objects
  where bucket_id='tamao-discovery-photos'
   and name='00000000-0000-0000-0000-000000000011/11111111-1111-1111-1111-111111111111.jpg';
 get diagnostics n=row_count;
 if n<>0 then raise exception 'REFERENCED_PHOTO_DELETED';end if;
end $photo_guard$;
insert into storage.objects(bucket_id,name,owner_id,metadata)
values('tamao-discovery-photos',
 '00000000-0000-0000-0000-000000000011/99999999-9999-9999-9999-999999999999.jpg',
 '00000000-0000-0000-0000-000000000011',
 '{"mimetype":"image/jpeg"}'::jsonb);
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000022';
do $photo_cross_owner$
declare n integer;
begin
 delete from storage.objects
  where bucket_id='tamao-discovery-photos'
   and name='00000000-0000-0000-0000-000000000011/99999999-9999-9999-9999-999999999999.jpg';
 get diagnostics n=row_count;
 if n<>0 then raise exception 'CROSS_OWNER_PHOTO_DELETED';end if;
end $photo_cross_owner$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000011';
delete from storage.objects
 where bucket_id='tamao-discovery-photos'
  and name='00000000-0000-0000-0000-000000000011/99999999-9999-9999-9999-999999999999.jpg';
do $photo_cleanup$
declare n integer;
begin
 select count(*) into n from storage.objects
  where bucket_id='tamao-discovery-photos'
   and name='00000000-0000-0000-0000-000000000011/99999999-9999-9999-9999-999999999999.jpg';
 if n<>0 then raise exception 'UNLINKED_PHOTO_CLEANUP_DENIED';end if;
end $photo_cleanup$;

-- Atomic photo unlink regression: a forged owner cannot alter the draft;
-- deleting one image must retain others, then Storage RLS permits cleanup.
insert into storage.objects(bucket_id,name,owner_id,metadata)
values('tamao-discovery-photos',
  '00000000-0000-0000-0000-000000000011/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg',
  '00000000-0000-0000-0000-000000000011',
  '{"mimetype":"image/jpeg"}'::jsonb);
update public.discovery_listings
 set photo_urls=array_append(photo_urls,
 '00000000-0000-0000-0000-000000000011/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg')
 where id=current_setting('tamao.test.listing_id')::uuid;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000022';
do $unlink_cross_owner$
begin
  begin
    perform public.discovery_unlink_listing_photo(
      current_setting('tamao.test.listing_id')::uuid,
      '00000000-0000-0000-0000-000000000011/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg');
    raise exception 'CROSS_OWNER_PHOTO_UNLINK_ALLOWED';
  exception when insufficient_privilege then null;
  end;
end $unlink_cross_owner$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000011';
select public.discovery_unlink_listing_photo(
  current_setting('tamao.test.listing_id')::uuid,
  '00000000-0000-0000-0000-000000000011/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg')
 as photo_unlinked;
do $unlink_preserve$
declare paths text[];
begin
 select photo_urls into paths from public.discovery_listings
  where id=current_setting('tamao.test.listing_id')::uuid;
 if cardinality(paths)<>1
   or paths[1]<>'00000000-0000-0000-0000-000000000011/11111111-1111-1111-1111-111111111111.jpg'
   then raise exception 'ATOMIC_UNLINK_LOST_OTHER_PHOTO';end if;
end $unlink_preserve$;
delete from storage.objects where bucket_id='tamao-discovery-photos'
 and name='00000000-0000-0000-0000-000000000011/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg';
do $unlink_cleanup$
declare n integer;
begin
 select count(*) into n from storage.objects where bucket_id='tamao-discovery-photos'
 and name='00000000-0000-0000-0000-000000000011/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg';
 if n<>0 then raise exception 'ATOMIC_UNLINK_STORAGE_CLEANUP_DENIED';end if;
end $unlink_cleanup$;

-- Owner-only listing RPC: include drafts without exposing internal owner UUID.
do $$
declare n integer;
begin
 select count(*) into n from public.discovery_my_listings();
 if n<>1 then raise exception 'OWNER_DRAFT_LIST_MISSING';end if;
end $$;

-- Direct status overwrite is impossible and the subscriber must submit review.
-- An external URL must never pass review as a verified photo.
insert into public.discovery_listings(
 vertical,title,description,state_code,city_key,city_name,whatsapp_e164,photo_urls
) values('professionals','Rascunho com foto externa',
 'Anúncio de exemplo sem upload próprio que deve ser recusado na revisão.',
 'RS','sao-gabriel','São Gabriel','+5555999999999',
 array['https://external.example/tracker.jpg']) returning id as fake_photo_id \gset
select set_config('tamao.test.fake_photo_id', :'fake_photo_id', false);
insert into public.discovery_professional_details(listing_id,occupation,service_area)
 values(:'fake_photo_id','Eletricista','São Gabriel e arredores');
do $$
begin
 begin
  perform public.discovery_transition_listing(current_setting('tamao.test.fake_photo_id')::uuid,'review');
  raise exception 'EXTERNAL_PHOTO_SUBMITTED';
 exception when invalid_parameter_value then null;
 end;
end $$;
select public.discovery_transition_listing((current_setting('tamao.test.listing_id'))::uuid,'review') as owner_submitted;
-- A reviewed/published photo cannot be silently removed by its owner.
do $review_photo_guard$
begin
 begin
  perform public.discovery_unlink_listing_photo(
    current_setting('tamao.test.listing_id')::uuid,
    '00000000-0000-0000-0000-000000000011/11111111-1111-1111-1111-111111111111.jpg');
  raise exception 'REVIEW_PHOTO_UNLINK_BYPASS';
 exception when insufficient_privilege then null;
 end;
end $review_photo_guard$;
-- A regular advertiser cannot read another person's moderation queue.
do $$
begin
 begin
  perform count(*) from public.discovery_admin_review_queue();
  raise exception 'OWNER_READ_ADMIN_REVIEW_QUEUE';
 exception when insufficient_privilege then null;
 end;
end $$;

do $$
declare v_status text;
begin
 select status into v_status from public.discovery_listings
 where id=(current_setting('tamao.test.listing_id'))::uuid;
 if v_status!='review' then raise exception 'OWNER_REVIEW_FAILED';end if;
end $$;

set request.jwt.claim.sub='00000000-0000-0000-0000-000000000022';
do $$
declare n integer;
begin
 select count(*) into n from public.discovery_my_listings();
 if n<>0 then raise exception 'CROSS_TENANT_OWNER_RPC';end if;
end $$;
-- Another user cannot insert into the first user's Storage prefix.
do $$
begin
 begin
  insert into storage.objects(bucket_id,name,owner_id,metadata) values(
    'tamao-discovery-photos',
    '00000000-0000-0000-0000-000000000011/22222222-2222-2222-2222-222222222222.jpg',
    '00000000-0000-0000-0000-000000000022','{"mimetype":"image/jpeg"}'::jsonb);
  raise exception 'CROSS_TENANT_PHOTO_UPLOAD';
 exception when insufficient_privilege then null;
 end;
end $$;
do $$
declare v_seen integer; v_changed integer;
begin
 select count(*) into v_seen from public.discovery_listings
 where id=(current_setting('tamao.test.listing_id'))::uuid;
 if v_seen<>0 then raise exception 'CROSS_TENANT_READ_LEAK';end if;
 update public.discovery_listings set title='Invasão de outro anunciante'
 where id=(current_setting('tamao.test.listing_id'))::uuid;
 get diagnostics v_changed=row_count;
 if v_changed<>0 then raise exception 'CROSS_TENANT_WRITE_LEAK';end if;
 begin
  perform public.discovery_transition_listing((current_setting('tamao.test.listing_id'))::uuid,'published','tentativa invasora');
  raise exception 'NON_ADMIN_PUBLISHED';
 exception when insufficient_privilege then null;
 end;
end $$;

-- Verified permanent-account gate rejects anonymous advertising.
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000044';
do $$
begin
 begin
  insert into public.discovery_listings(
   vertical,title,description,state_code,city_key,city_name,
   whatsapp_e164,photo_urls
  ) values (
   'professionals','Anúncio sem identidade','Descrição de exemplo que não pode ser publicada.',
   'RS','sao-gabriel','São Gabriel','+5555999999999',
   array['https://example.test/image.jpg']
  );
  raise exception 'ANONYMOUS_ADVERTISER_ALLOWED';
 exception when insufficient_privilege then null;
 end;
end $$;

-- Admin is the only actor permitted to enable the category in a city.
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000033';
-- Only the superadmin can inspect the actual list pending analysis.
do $$
declare n integer;
begin
 select count(*) into n from public.discovery_admin_review_queue();
 if n<>1 then raise exception 'ADMIN_REVIEW_QUEUE_MISMATCH';end if;
end $$;
select public.discovery_set_vertical_city('professionals','RS','sao-gabriel',
  'São Gabriel',true,'Lote de teste isolado');
select public.discovery_transition_listing((current_setting('tamao.test.listing_id'))::uuid,'published',
  'Documento validado em teste') as admin_published;

set role anon;
reset request.jwt.claim.sub;
do $$
declare v_public integer; v_private integer;
begin
 select count(*) into v_public from public.discovery_listings
 where id=(current_setting('tamao.test.listing_id'))::uuid;
 if v_public<>1 then raise exception 'PUBLISHED_LISTING_INVISIBLE';end if;
 select count(*) into v_private from public.discovery_vertical_cities
 where vertical='stays';
 if v_private<>0 then raise exception 'OTHER_VERTICAL_NOT_CLOSED';end if;
end $$;

-- Public search must expose the one verified record and hide non-public metadata.
do $$
declare v_found integer; v_wrong_city integer; v_stays integer;
begin
 select count(*) into v_found from public.discovery_public_search(
   p_vertical=>'professionals',p_state_code=>'RS',p_city_key=>'sao-gabriel');
 if v_found<>1 then raise exception 'DISCOVERY_PUBLIC_SEARCH_FAILED';end if;
 select count(*) into v_found from public.discovery_public_search(
   p_vertical=>'professionals',p_listing_id=>current_setting('tamao.test.listing_id')::uuid);
 if v_found<>1 then raise exception 'SHARED_LISTING_NOT_FOUND';end if;
 select count(*) into v_found from public.discovery_public_search(
   p_vertical=>'professionals',p_offset=>1);
 if v_found<>0 then raise exception 'PUBLIC_PAGINATION_OFFSET_IGNORED';end if;
 select count(*) into v_found from public.discovery_public_search(
   p_vertical=>'rides',p_listing_id=>current_setting('tamao.test.listing_id')::uuid);
 if v_found<>0 then raise exception 'SHARED_LISTING_CROSS_VERTICAL_LEAK';end if;
 select count(*) into v_wrong_city from public.discovery_public_search(
   p_vertical=>'professionals',p_state_code=>'RS',p_city_key=>'porto-alegre');
 if v_wrong_city<>0 then raise exception 'DISCOVERY_CITY_FILTER_FAILED';end if;
 select count(*) into v_stays from public.discovery_public_search(
   p_vertical=>'stays');
 if v_stays<>0 then raise exception 'DISCOVERY_STAY_LEAK';end if;
end $$;

-- Authentic reporting: one verified visitor, owner/anon rejected,
-- duplicate report idempotent, daily per-user throttle and admin-only review.
reset role;
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000022';
select public.discovery_submit_report(
 current_setting('tamao.test.listing_id')::uuid,
 'incorrect_information','O endereço aproximado do anúncio precisa de revisão'
) as submitted_report_id \gset
select set_config('tamao.test.submitted_report_id', :'submitted_report_id', false);
do $reporttest$
declare v_same bigint;v_expected bigint;
begin
 v_expected:=current_setting('tamao.test.submitted_report_id')::bigint;
 select public.discovery_submit_report(
  current_setting('tamao.test.listing_id')::uuid,
  'incorrect_information','O anúncio ainda contém informação incorreta'
 ) into v_same;
 if v_same<>v_expected then raise exception 'REPORT_NOT_IDEMPOTENT';end if;
 begin
  perform count(*) from public.discovery_admin_report_queue();
  raise exception 'ADMIN_REPORT_QUEUE_LEAK';
 exception when insufficient_privilege then null;end;
end $reporttest$;
select public.discovery_submit_report(
 current_setting('tamao.test.listing_id')::uuid,
 'suspected_fraud','Há possível informação de contato não confiável no anúncio');
select public.discovery_submit_report(
 current_setting('tamao.test.listing_id')::uuid,
 'unsafe_content','O conteúdo requer inspeção de segurança antes de prosseguir');
do $reporttest$
begin
 begin
  perform public.discovery_submit_report(
   current_setting('tamao.test.listing_id')::uuid,'other',
   'Quarta denúncia no mesmo dia deve ser recusada pelo banco');
  raise exception 'REPORT_RATE_LIMIT_BYPASSED';
 exception when sqlstate '22023' then null;end;
end $reporttest$;
reset role;
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000011';
do $reporttest$
begin
 begin
  perform public.discovery_submit_report(
   current_setting('tamao.test.listing_id')::uuid,'other',
   'O próprio anunciante não pode denunciar seu anúncio');
  raise exception 'OWNER_REPORT_ALLOWED';
 exception when sqlstate '22023' then null;end;
end $reporttest$;
reset role;
set role anon;
reset request.jwt.claim.sub;
do $reporttest$
begin
 begin
  perform public.discovery_submit_report(
   current_setting('tamao.test.listing_id')::uuid,'other',
   'Envio anônimo não pode contornar exigência de verificação');
  raise exception 'ANONYMOUS_REPORT_ALLOWED';
 exception when insufficient_privilege then null;end;
end $reporttest$;
reset role;
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000033';
do $reporttest$
declare n integer;
begin
 select count(*) into n from public.discovery_admin_report_queue();
 if n<>3 then raise exception 'ADMIN_REPORT_COUNT_INVALID';end if;
end $reporttest$;
-- Suspensão pública imediata e retomada somente após resolver denúncias.
select public.discovery_transition_listing(
 current_setting('tamao.test.listing_id')::uuid,'paused',
 'Suspensão durante análise de relatos reais');
do $reporttest$
declare n integer;
begin
 select count(*) into n from public.discovery_admin_listing_overview();
 if n<>1 then raise exception 'ADMIN_LIVE_LISTINGS_INCOMPLETE';end if;
 begin
   perform public.discovery_transition_listing(
     current_setting('tamao.test.listing_id')::uuid,'published',
     'Reativação insegura com denúncias abertas');
   raise exception 'REPORT_REACTIVATION_BYPASS';
 exception when sqlstate '22023' then null;end;
end $reporttest$;
select public.discovery_review_report(
 current_setting('tamao.test.submitted_report_id')::bigint,
 'resolved','Analisada a denúncia e adotadas providências');
do $reporttest$
begin
 begin
  perform public.discovery_review_report(
   current_setting('tamao.test.submitted_report_id')::bigint,
   'dismissed','Tentativa indevida de alterar decisão já concluída');
  raise exception 'REPORT_REOPEN_ALLOWED';
 exception when sqlstate '22023' then null;end;
end $reporttest$;
-- Resolver as outras denúncias para permitir uma reativação consciente.
do $reporttest$
declare report_row record;
begin
 for report_row in select id from public.discovery_admin_report_queue() loop
   perform public.discovery_review_report(
     report_row.id,'resolved','Análise concluída e providências documentadas');
 end loop;
end $reporttest$;
select public.discovery_transition_listing(
 current_setting('tamao.test.listing_id')::uuid,'published',
 'Reativação autorizada após conclusão das denúncias');
reset role;

-- Carona sem foto não bloqueia o anúncio; outros tipos exigem foto real.
-- Tudo dentro de uma transação descartada após o teste.
reset role;
begin;
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000011';
insert into public.discovery_listings(
 vertical,title,description,state_code,city_key,city_name,whatsapp_e164,photo_urls)
values('rides','Carona eventual sem foto',
 'Trajeto casual para compartilhar despesas, sem reserva nem pagamento pela plataforma.',
 'RS','sao-gabriel','São Gabriel','+5555999999999','{}')
 returning id as ride_without_photo \gset
insert into public.discovery_ride_details(
 listing_id,departure_state,departure_city,destination_state,destination_city,
 departure_at,seats_total,seats_available)
values(:'ride_without_photo'::uuid,'RS','São Gabriel','RS','Bagé',
 now()+interval '3 days',3,3);
select public.discovery_transition_listing(:'ride_without_photo'::uuid,'review');
insert into public.discovery_listings(
 vertical,title,description,state_code,city_key,city_name,whatsapp_e164,photo_urls)
values('professionals','Prestador sem foto bloqueado',
 'Profissional com descrição completa, mas sem uma imagem de marketing validada.',
 'RS','sao-gabriel','São Gabriel','+5555999999999','{}')
 returning id as pro_without_photo \gset
insert into public.discovery_professional_details(listing_id,occupation,service_area)
values(:'pro_without_photo'::uuid,'Eletricista','São Gabriel e região');
select set_config('tamao.test.pro_without_photo', :'pro_without_photo', true);
do $photocheck$
begin
 begin
   perform public.discovery_transition_listing(
     current_setting('tamao.test.pro_without_photo')::uuid,'review');
   raise exception 'PRO_PHOTO_GATE_BYPASSED';
 exception when sqlstate '22023' then null;end;
end $photocheck$;
rollback;
-- Quotas de uploads: custo limitado mesmo com rajada de chamadas do mesmo usuário.
reset role;
begin;
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000011';
do $quota_fixture$
declare
 v_actor text:=(select auth.uid())::text;
 v_existing integer;
 i integer;
 v_path text;
begin
 select count(*) into v_existing from storage.objects
  where bucket_id='tamao-discovery-photos' and owner_id=v_actor;
 if v_existing>=24 then raise exception 'PHOTO_QUOTA_FIXTURE_FULL';end if;
 for i in v_existing+1..24 loop
   v_path:=v_actor||'/11111111-1111-4111-8111-'||lpad(i::text,12,'0')||'.jpg';
   insert into storage.objects(bucket_id,name,owner_id,metadata)
   values('tamao-discovery-photos',v_path,v_actor,
     '{"mimetype":"image/jpeg"}'::jsonb);
 end loop;
 if public.discovery_storage_quota_ok('tamao-discovery-photos') then
    raise exception 'PHOTO_QUOTA_NOT_ENFORCED';end if;
 begin
    insert into storage.objects(bucket_id,name,owner_id,metadata)
    values('tamao-discovery-photos',v_actor||'/22222222-2222-4222-8222-222222222222.jpg',v_actor,
    '{"mimetype":"image/jpeg"}'::jsonb);
    raise exception 'DISCOVERY_STORAGE_QUOTA_BYPASSED';
 exception when insufficient_privilege then null;end;
end $quota_fixture$;
rollback;

-- V1.416: real PostgreSQL 17 filtering, all actors isolated and rolled back.
-- These fixtures exist ONLY in disposable CI, never in Supabase production.
reset role;
begin;
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000011';
insert into public.discovery_listings(
 vertical,title,description,state_code,city_key,city_name,whatsapp_e164,photo_urls
) values(
 'rides','Carona São Gabriel para Bagé',
 'Viagem eventual combinada diretamente com os passageiros, horários declarados.',
 'RS','sao-gabriel','São Gabriel','+5555999999999',
 array['00000000-0000-0000-0000-000000000011/11111111-1111-1111-1111-111111111111.jpg']
) returning id as filter_ride_id \gset
insert into public.discovery_ride_details(
 listing_id,departure_state,departure_city,destination_state,destination_city,
 departure_at,seats_total,seats_available,proposed_cost_share_cents
) values(:'filter_ride_id','RS','São Gabriel','RS','Bagé',
 clock_timestamp()+interval '7 days',4,2,3500);
select public.discovery_transition_listing(:'filter_ride_id'::uuid,'review');
insert into public.discovery_listings(
 vertical,title,description,state_code,city_key,city_name,whatsapp_e164,photo_urls
) values(
 'stays','Pousada teste da região',
 'Hospedagem anunciada com condições e valores confirmados diretamente com o responsável.',
 'RS','sao-gabriel','São Gabriel','+5555999999999',
 array['00000000-0000-0000-0000-000000000011/11111111-1111-1111-1111-111111111111.jpg']
) returning id as filter_stay_id \gset
insert into public.discovery_stay_details(
 listing_id,property_type,guests,bedrooms,beds,price_from_brl_cents,price_unit
) values(:'filter_stay_id','inn',4,2,3,28900,'night');
select public.discovery_transition_listing(:'filter_stay_id'::uuid,'review');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000033';
select public.discovery_set_vertical_city('rides','RS','sao-gabriel',
 'São Gabriel',true,'Teste isolado de consulta por vagas');
select public.discovery_set_vertical_city('stays','RS','sao-gabriel',
 'São Gabriel',true,'Teste isolado de consulta de hospedagens');
select public.discovery_transition_listing(:'filter_ride_id'::uuid,'published',
 'Documento e trajeto revisados no teste');
select public.discovery_transition_listing(:'filter_stay_id'::uuid,'published',
 'Hospedagem revisada no ambiente isolado');
set role anon;
reset request.jwt.claim.sub;
do $filter_contract$
declare n int;
begin
 select count(*) into n from public.discovery_public_search(
   p_vertical=>'professionals',p_occupation_query=>'eletric');
 if n<>1 then raise exception 'PROFESSION_FILTER_MISSED';end if;
 select count(*) into n from public.discovery_public_search(
   p_vertical=>'professionals',p_occupation_query=>'Encanador');
 if n<>0 then raise exception 'PROFESSION_FILTER_LEAK';end if;
 select count(*) into n from public.discovery_public_search(
   p_vertical=>'rides',p_min_seats=>2);
 if n<>1 then raise exception 'RIDE_SEATS_FILTER_MISSED';end if;
 select count(*) into n from public.discovery_public_search(
   p_vertical=>'rides',p_min_seats=>3);
 if n<>0 then raise exception 'RIDE_SEATS_FILTER_LEAK';end if;
 select count(*) into n from public.discovery_public_search(
   p_vertical=>'rides',p_min_seats=>99);
 if n<>0 then raise exception 'INVALID_RIDE_SEATS_NOT_CLOSED';end if;
 select count(*) into n from public.discovery_public_search(
   p_vertical=>'stays',p_property_type=>'inn',p_max_price_cents=>30000);
 if n<>1 then raise exception 'STAY_TYPE_PRICE_FILTER_MISSED';end if;
 select count(*) into n from public.discovery_public_search(
   p_vertical=>'stays',p_property_type=>'hotel');
 if n<>0 then raise exception 'STAY_PROPERTY_TYPE_FILTER_LEAK';end if;
 select count(*) into n from public.discovery_public_search(
   p_vertical=>'stays',p_max_price_cents=>25000);
 if n<>0 then raise exception 'STAY_PRICE_FILTER_LEAK';end if;
 select count(*) into n from public.discovery_public_search(
   p_vertical=>'stays',p_max_price_cents=>-1);
 if n<>0 then raise exception 'NEGATIVE_PRICE_NOT_CLOSED';end if;
 select count(*) into n from public.discovery_public_search(
   p_vertical=>'rides',p_property_type=>'inn');
 if n<>0 then raise exception 'CROSS_VERTICAL_FILTER_LEAK';end if;
end $filter_contract$;
-- Store the synthetic ID in a session GUC: psql does not interpolate
-- colon variables inside dollar-quoted PL/pgSQL blocks.
select set_config('tamao.test.live_ride_id', :'filter_ride_id', false);
-- Live seat changes are allowed ONLY for the verified owner of the same
-- already-reviewed future carona. Zero hides it; restoring re-exposes it.
do $anon_cannot_change_ride$
begin
 begin
  perform public.discovery_update_ride_seats(current_setting('tamao.test.live_ride_id')::uuid,0);
  raise exception 'ANON_CHANGED_SEATS';
 exception when insufficient_privilege then null;end;
end $anon_cannot_change_ride$;
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000022';
do $stranger_cannot_change_ride$
begin
 begin
  perform public.discovery_update_ride_seats(current_setting('tamao.test.live_ride_id')::uuid,0);
  raise exception 'STRANGER_CHANGED_SEATS';
 exception when insufficient_privilege then null;end;
end $stranger_cannot_change_ride$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000011';
do $ride_seat_capacity$
begin
 begin
  perform public.discovery_update_ride_seats(current_setting('tamao.test.live_ride_id')::uuid,5);
  raise exception 'ABOVE_TOTAL_CAPACITY_ALLOWED';
 exception when invalid_parameter_value then null;end;
 begin
  perform public.discovery_update_ride_seats(current_setting('tamao.test.live_ride_id')::uuid,-1);
  raise exception 'NEGATIVE_AVAILABLE_SEATS_ALLOWED';
 exception when invalid_parameter_value then null;end;
 if public.discovery_update_ride_seats(current_setting('tamao.test.live_ride_id')::uuid,0)<>0
 then raise exception 'ZERO_SEATS_UPDATE_FAILED';end if;
end $ride_seat_capacity$;
set role anon;
reset request.jwt.claim.sub;
do $ride_hidden_when_full$
declare n int;
begin
 select count(*) into n from public.discovery_public_search(
   p_vertical=>'rides',p_listing_id=>current_setting('tamao.test.live_ride_id')::uuid);
 if n<>0 then raise exception 'FULL_CARONA_STILL_PUBLIC';end if;
end $ride_hidden_when_full$;
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000011';
do $ride_reopen$
begin
 if public.discovery_update_ride_seats(current_setting('tamao.test.live_ride_id')::uuid,2)<>2
 then raise exception 'RESTORE_CAPACITY_FAILED';end if;
end $ride_reopen$;
set role anon;
reset request.jwt.claim.sub;
do $ride_reappears$
declare n int;
begin
 select count(*) into n from public.discovery_public_search(
   p_vertical=>'rides',p_listing_id=>current_setting('tamao.test.live_ride_id')::uuid,p_min_seats=>2);
 if n<>1 then raise exception 'RESTORED_CARONA_NOT_PUBLIC';end if;
end $ride_reappears$;
rollback;
set role anon;
reset request.jwt.claim.sub;

-- Public role must never read billing, audit, or private advertising terms.
do $$
begin
 begin
  perform count(*) from public.discovery_advertising_daily_ledger;
  raise exception 'PUBLIC_BILLING_LEAK';
 exception when insufficient_privilege then null;
 end;
end $$;


-- An authenticated visitor must not read the publisher's internal user UUID.
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000022';
do $$
begin
 begin
  perform owner_id from public.discovery_listings
  where id=(current_setting('tamao.test.listing_id'))::uuid;
  raise exception 'PUBLISHER_INTERNAL_ID_EXPOSED';
 exception when insufficient_privilege then null;
 end;
end $$;

-- The owner can pause without needing a second administrator, but cannot
-- silently edit an approved public advertisement.
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000011';
do $$
declare v_changed integer;
begin
 update public.discovery_listings set title='Alteração silenciosa proibida'
 where id=(current_setting('tamao.test.listing_id'))::uuid;
 get diagnostics v_changed=row_count;
 if v_changed<>0 then raise exception 'PUBLISHED_LISTING_EDITABLE';end if;
end $$;
select public.discovery_transition_listing((current_setting('tamao.test.listing_id'))::uuid,'paused')
  as owner_paused;

-- A paused approved advert must never be editable without returning to draft.
do $$
declare v_changed integer;
begin
 update public.discovery_listings set title='Mudança silenciosa após pausa'
 where id=(current_setting('tamao.test.listing_id'))::uuid;
 get diagnostics v_changed=row_count;
 if v_changed<>0 then raise exception 'PAUSED_APPROVAL_EDIT_BYPASS';end if;
end $$;
select public.discovery_transition_listing(
 (current_setting('tamao.test.listing_id'))::uuid,'draft',
 'Editar e reenviar conteúdo aprovado') as owner_reopened;
update public.discovery_listings set title='Atendimento revisado pelo anunciante'
 where id=(current_setting('tamao.test.listing_id'))::uuid;
select public.discovery_transition_listing(
 (current_setting('tamao.test.listing_id'))::uuid,'review') as owner_resubmitted;


set role anon;
reset request.jwt.claim.sub;
do $$
declare v_visible integer;
begin
 select count(*) into v_visible from public.discovery_listings
 where id=(current_setting('tamao.test.listing_id'))::uuid;
 if v_visible<>0 then raise exception 'PAUSED_LISTING_VISIBLE';end if;
end $$;

do $$
declare v_result integer;
begin
 select count(*) into v_result from public.discovery_public_search(p_vertical=>'professionals');
 if v_result<>0 then raise exception 'PAUSED_LISTING_IN_SEARCH';end if;
end $$;

-- Re-publication after renewed review and city closure remain admin powers.
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000033';
select public.discovery_transition_listing((current_setting('tamao.test.listing_id'))::uuid,'published',
  'Retomada validada na revisão') as admin_republished;
select public.discovery_set_vertical_city('professionals','RS','sao-gabriel',
  'São Gabriel',false,'Encerramento isolado de teste');

set role anon;
reset request.jwt.claim.sub;
do $$
declare v_visible integer;
begin
 select count(*) into v_visible from public.discovery_listings
 where id=(current_setting('tamao.test.listing_id'))::uuid;
 if v_visible<>0 then raise exception 'DISABLED_CITY_EXPOSED';end if;
end $$;

do $$
declare v_result integer;
begin
 select count(*) into v_result from public.discovery_public_search(p_vertical=>'professionals');
 if v_result<>0 then raise exception 'DISABLED_CITY_IN_SEARCH';end if;
 select count(*) into v_result from public.discovery_public_search(
   p_listing_id=>current_setting('tamao.test.listing_id')::uuid);
 if v_result<>0 then raise exception 'DISABLED_CITY_SHARED_LINK_LEAK';end if;
end $$;


-- Private evidence regression: immutable owner folder, no public disclosure,
-- no cross-account listing attachment, superadmin-only review access.
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000011';
insert into public.discovery_listings(
 vertical,title,description,state_code,city_key,city_name,whatsapp_e164
) values('professionals','Novo cadastro com licença privada',
 'Cadastro em rascunho com comprovante confidencial para avaliação do admin.',
 'RS','sao-gabriel','São Gabriel','+5555999999999')
returning id as private_listing_id \gset
select set_config('tamao.test.private_listing_id', :'private_listing_id',false);
insert into storage.objects(bucket_id,name,owner_id,metadata)
values('tamao-discovery-documents',
 '00000000-0000-0000-0000-000000000011/'||:'private_listing_id'||
 '/22222222-2222-2222-2222-222222222222.pdf',
 '00000000-0000-0000-0000-000000000011',
 '{"mimetype":"application/pdf"}'::jsonb);
insert into public.discovery_documents(listing_id,kind,object_path) values(
 :'private_listing_id','supporting',
 '00000000-0000-0000-0000-000000000011/'||:'private_listing_id'||
 '/22222222-2222-2222-2222-222222222222.pdf');
do $$
declare n int;
begin
 select count(*) into n from public.discovery_documents
 where listing_id=current_setting('tamao.test.private_listing_id')::uuid;
 if n<>1 then raise exception 'OWNER_DOCUMENT_MISSING';end if;
end $$;

-- Remoção só após apagar os bytes; teste negativo contra REST direto.
do $guard_test$
begin
 begin
  delete from public.discovery_documents
   where listing_id=current_setting('tamao.test.private_listing_id')::uuid;
  raise exception 'ORPHANED_METADATA_DELETE_ALLOWED';
 exception when invalid_parameter_value then null;
 end;
end $guard_test$;
-- Storage isolado é apenas uma fixture de metadados: em operação real,
-- a exclusão do objeto ocorre exclusivamente pelo SDK Storage.remove().
delete from storage.objects
 where bucket_id='tamao-discovery-documents'
 and name='00000000-0000-0000-0000-000000000011/'||
 current_setting('tamao.test.private_listing_id')||
 '/22222222-2222-2222-2222-222222222222.pdf';
delete from public.discovery_documents
 where listing_id=current_setting('tamao.test.private_listing_id')::uuid;
do $$
declare n integer;
begin
 select count(*) into n from public.discovery_documents
 where listing_id=current_setting('tamao.test.private_listing_id')::uuid;
 if n<>0 then raise exception 'OWNER_DRAFT_DOCUMENT_DELETE_FAILED';end if;
end $$;
insert into storage.objects(bucket_id,name,owner_id,metadata) values(
 'tamao-discovery-documents',
 '00000000-0000-0000-0000-000000000011/'||
 current_setting('tamao.test.private_listing_id')||
 '/22222222-2222-2222-2222-222222222222.pdf',
 '00000000-0000-0000-0000-000000000011',
 '{"mimetype":"application/pdf"}'::jsonb);
insert into public.discovery_documents(listing_id,kind,object_path) values(
 current_setting('tamao.test.private_listing_id')::uuid,'supporting',
 '00000000-0000-0000-0000-000000000011/'||
 current_setting('tamao.test.private_listing_id')||
 '/22222222-2222-2222-2222-222222222222.pdf');

set request.jwt.claim.sub='00000000-0000-0000-0000-000000000022';
do $$
declare n integer;
begin
 select count(*) into n from public.discovery_documents
 where listing_id=current_setting('tamao.test.private_listing_id')::uuid;
 if n<>0 then raise exception 'CROSS_OWNER_DOCUMENT_LEAK';end if;
 select count(*) into n from storage.objects
 where bucket_id='tamao-discovery-documents'
 and name like '00000000-0000-0000-0000-000000000011/%';
 if n<>0 then raise exception 'CROSS_OWNER_STORAGE_LEAK';end if;
 delete from public.discovery_documents
 where listing_id=current_setting('tamao.test.private_listing_id')::uuid;
 get diagnostics n=row_count;
 if n<>0 then raise exception 'CROSS_OWNER_DOCUMENT_DELETE';end if;
 begin
  insert into public.discovery_documents(listing_id,kind,object_path)
   values(current_setting('tamao.test.private_listing_id')::uuid,'identity',
   '00000000-0000-0000-0000-000000000011/'||
   current_setting('tamao.test.private_listing_id')||
   '/33333333-3333-3333-3333-333333333333.pdf');
  raise exception 'CROSS_OWNER_DOCUMENT_WRITE';
 exception when insufficient_privilege then null;
 end;
end $$;

set request.jwt.claim.sub='00000000-0000-0000-0000-000000000033';
do $$
declare n integer;
begin
 select count(*) into n from public.discovery_documents
 where listing_id=current_setting('tamao.test.private_listing_id')::uuid;
 if n<>1 then raise exception 'ADMIN_DOCUMENT_LOOKUP_FAILED';end if;
 select count(*) into n from storage.objects where bucket_id='tamao-discovery-documents';
 if n<>1 then raise exception 'ADMIN_PRIVATE_STORAGE_DENIED';end if;
end $$;

set role anon;
reset request.jwt.claim.sub;
do $$
begin
 begin
  perform count(*) from public.discovery_documents;
  raise exception 'PUBLIC_DOCUMENT_TABLE_VISIBLE';
 exception when insufficient_privilege then null;
 end;
 begin
  perform count(*) from storage.objects where bucket_id='tamao-discovery-documents';
  raise exception 'PUBLIC_DOCUMENT_STORAGE_VISIBLE';
 exception when insufficient_privilege then null;
 end;
end $$;

reset role;
\i supabase/migrations/20261020181500_discovery_city_control_inventory.sql
\i supabase/migrations/20261020192500_discovery_admin_readiness.sql
\i supabase/migrations/20261020214500_discovery_documents_owner_hardening.sql
-- A mismatched Storage uploader MUST NOT be accepted merely because the
-- private object exists under the advertised path.
reset role;
insert into storage.objects(bucket_id,name,owner_id,metadata)
values(
 'tamao-discovery-documents',
 '00000000-0000-0000-0000-000000000011/'||
 current_setting('tamao.test.private_listing_id')||
 '/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.pdf',
 '00000000-0000-0000-0000-000000000022',
 '{"mimetype":"application/pdf"}'::jsonb
);
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000011';
do $document_guard_v2$
declare
 n integer;
begin
 select count(*) into n from public.discovery_documents
  where listing_id=current_setting('tamao.test.private_listing_id')::uuid;
 if n<>1 then raise exception 'VERIFIED_OWNER_LOST_DOCUMENT_READ';end if;
 begin
  insert into public.discovery_documents(listing_id,kind,object_path)
  values(current_setting('tamao.test.private_listing_id')::uuid,
    'supporting',
    '00000000-0000-0000-0000-000000000011/'||
    current_setting('tamao.test.private_listing_id')||
    '/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.pdf');
  raise exception 'FOREIGN_STORAGE_UPLOADER_WAS_ACCEPTED';
 exception when insufficient_privilege then null;end;
end $document_guard_v2$;
reset role;
-- Revocation of verification must not preserve private owner access.
update auth.users set is_anonymous=true,email_confirmed_at=null
 where id='00000000-0000-0000-0000-000000000011';
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000011';
do $document_guard_v2$
declare n integer;
begin
 select count(*) into n from public.discovery_documents
 where listing_id=current_setting('tamao.test.private_listing_id')::uuid;
 if n<>0 then raise exception 'UNVERIFIED_OWNER_CAN_READ_PRIVATE_DOCUMENTS';end if;
end $document_guard_v2$;
reset role;
update auth.users set is_anonymous=false,email_confirmed_at=clock_timestamp()
 where id='00000000-0000-0000-0000-000000000011';
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000033';
do $city_test$
declare n int;
begin
 select count(*) into n from public.discovery_admin_city_matrix();
 if n<1 then raise exception 'ADMIN_CITY_MATRIX_EMPTY';end if;
 if (public.discovery_admin_readiness()->>'source')<>'discovery_admin_readiness_v1' then
   raise exception 'ADMIN_READINESS_SOURCE_INVALID';
 end if;
 if (public.discovery_admin_readiness()->>'canDeclareCommercialReadiness')<>'false' then
   raise exception 'ADMIN_DIAGNOSTIC_OVERCERTIFIED';
 end if;
end $city_test$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000022';
do $city_test$
begin
 begin
  perform public.discovery_admin_city_matrix();
  raise exception 'NONADMIN_CITY_MATRIX_EXPOSED';
 exception when insufficient_privilege then null;end;
 begin
   perform public.discovery_admin_readiness();
   raise exception 'NONADMIN_DIAGNOSTIC_EXPOSED';
 exception when insufficient_privilege then null;end;
end $city_test$;
reset role;
set role anon;
reset request.jwt.claim.sub;
do $city_test$
begin
 begin
  perform public.discovery_admin_city_matrix();
  raise exception 'ANONYMOUS_CITY_MATRIX_EXPOSED';
 exception when insufficient_privilege then null;end;
end $city_test$;
reset role;
select 'DISCOVERY_POSTGRES_RLS_AND_PRIVATE_DOCUMENTS_OK' as result;
