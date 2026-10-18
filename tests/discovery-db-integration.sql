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
grant insert on storage.objects to authenticated;

insert into auth.users(id,is_anonymous,email_confirmed_at) values
 ('00000000-0000-0000-0000-000000000011',false,now()),
 ('00000000-0000-0000-0000-000000000022',false,now()),
 ('00000000-0000-0000-0000-000000000033',false,now()),
 ('00000000-0000-0000-0000-000000000044',true,null);
insert into public.platform_admins(user_id,active,admin_role)
 values ('00000000-0000-0000-0000-000000000033',true,'superadmin');

\i supabase/migrations/20261018131000_discovery_shared_verticals.sql

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
 select count(*) into v_wrong_city from public.discovery_public_search(
   p_vertical=>'professionals',p_state_code=>'RS',p_city_key=>'porto-alegre');
 if v_wrong_city<>0 then raise exception 'DISCOVERY_CITY_FILTER_FAILED';end if;
 select count(*) into v_stays from public.discovery_public_search(
   p_vertical=>'stays');
 if v_stays<>0 then raise exception 'DISCOVERY_STAY_LEAK';end if;
end $$;

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
end $$;

reset role;
select 'DISCOVERY_POSTGRES_RLS_INTEGRATION_OK' as result;
