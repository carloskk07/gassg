-- TAMÃO Agenda V1.1069: personalized professional pages, no booking/payment mutation.
-- The profile design is independent of appointments, prices and payment settings.
create table if not exists public.agenda_page_design (
 page_id uuid primary key references public.agenda_pages(id) on delete cascade,
 owner_id uuid not null default auth.uid() references auth.users(id),
 template text not null default 'clean'
   constraint agenda_design_template_allowed check (template in ('black-gold','elegance','clean')),
 primary_color text not null default '#174f48'
   constraint agenda_design_primary_hex check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
 accent_color text not null default '#76c5ae'
   constraint agenda_design_accent_hex check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
 headline text not null default ''
   constraint agenda_design_headline_length check (char_length(headline)<=100),
 tagline text not null default ''
   constraint agenda_design_tagline_length check (char_length(tagline)<=220),
 cover_index smallint not null default -1
   constraint agenda_design_cover_range check (cover_index between -1 and 5),
 logo_index smallint not null default -1
   constraint agenda_design_logo_range check (logo_index between -1 and 5),
 service_images jsonb not null default '{}'::jsonb
   constraint agenda_design_services_json check (jsonb_typeof(service_images)='object' and pg_column_size(service_images)<=4096),
 staff_images jsonb not null default '{}'::jsonb
   constraint agenda_design_staff_json check (jsonb_typeof(staff_images)='object' and pg_column_size(staff_images)<=4096),
 highlights text[] not null default '{}'::text[]
   constraint agenda_design_highlights_limit check (cardinality(highlights)<=4 and char_length(array_to_string(highlights,' '))<=285),
 street_address text not null default ''
   constraint agenda_design_street_length check (char_length(street_address)<=180),
 instagram text not null default ''
   constraint agenda_design_instagram_safe check (instagram ~ '^[A-Za-z0-9._]{0,30}$'),
 show_about boolean not null default true,
 show_team boolean not null default true,
 show_gallery boolean not null default true,
 show_location boolean not null default true,
 show_highlights boolean not null default true,
 updated_at timestamptz not null default now()
);
-- The public Agenda RPC intentionally keeps agenda_pages private under RLS.
-- A narrow internal boolean check allows public themes only for published pages,
-- without opening the underlying owner profile table to public SELECT.
create schema if not exists tamao_acl;
create or replace function tamao_acl.agenda_design_published(p_page_id uuid)
returns boolean
language sql stable security definer set search_path to 'pg_catalog'
as 'select exists(select 1 from public.agenda_pages p where p.id=p_page_id and p.published);';
revoke all on function tamao_acl.agenda_design_published(uuid) from public;
grant usage on schema tamao_acl to anon,authenticated;
grant execute on function tamao_acl.agenda_design_published(uuid) to anon,authenticated;

create index if not exists agenda_page_design_owner_idx on public.agenda_page_design(owner_id);
alter table public.agenda_page_design enable row level security;
revoke all on public.agenda_page_design from public,anon,authenticated;
grant select on public.agenda_page_design to anon,authenticated;
grant insert,update on public.agenda_page_design to authenticated;

-- Anonymous visitors can only read themes of explicitly published pages.
drop policy if exists agenda_design_public_select on public.agenda_page_design;
create policy agenda_design_public_select on public.agenda_page_design
 for select to anon,authenticated
 using (
  owner_id=(select auth.uid())
  or (select tamao_acl.agenda_design_published(page_id))
 );
-- A user cannot create a design under somebody else's page or reassign ownership.
drop policy if exists agenda_design_owner_insert on public.agenda_page_design;
create policy agenda_design_owner_insert on public.agenda_page_design
 for insert to authenticated
 with check (
  owner_id=(select auth.uid()) and (select public.discovery_verified_account())
  and exists(select 1 from public.agenda_pages p
   where p.id=page_id and p.owner_id=(select auth.uid()))
 );
drop policy if exists agenda_design_owner_update on public.agenda_page_design;
create policy agenda_design_owner_update on public.agenda_page_design
 for update to authenticated
 using (owner_id=(select auth.uid()))
 with check (
  owner_id=(select auth.uid()) and (select public.discovery_verified_account())
  and exists(select 1 from public.agenda_pages p
   where p.id=page_id and p.owner_id=(select auth.uid()))
 );
comment on table public.agenda_page_design is
 'Owner-controlled visual presentation for real TAMÃO Agenda pages; zero booking/financial privileges';
