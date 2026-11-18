-- TAMÃO Agenda V1.1067 — search all public, active schedules with bounded pages.
-- Public read-only API. NEVER exposes private owner, booking or customer data.
-- Keeps agenda_public_directory() intact for older clients during deployment.
begin;

create function public.agenda_search_directory(
 p_query text default '',
 p_limit integer default 12,
 p_offset integer default 0
)
returns table (
 slug text,
 title text,
 city text,
 about text,
 photo_path text,
 total_count bigint
)
language sql stable security definer set search_path='pg_catalog'
as $search$
 with request as (
  select
   pg_catalog.translate(
    pg_catalog.lower(pg_catalog.btrim(pg_catalog.left(coalesce(p_query,''),80))),
    'áàâãäéèêëíìîïóòôõöúùûüç',
    'aaaaaeeeeiiiiooooouuuuc'
   ) as terms,
   greatest(1,least(coalesce(p_limit,12),24)) as take,
   greatest(0,coalesce(p_offset,0)) as skip
 ),
 eligible as (
  select p.id,p.slug,p.title,p.city,pg_catalog.left(p.about,180) as about,
   p.photo_paths[1] as photo_path,p.created_at
  from public.agenda_pages p
  cross join request r
  where p.published is true
   and exists(
    select 1 from public.agenda_services s
    where s.page_id=p.id and s.active is true
   )
   and exists(
    select 1 from public.agenda_hours h
    where h.page_id=p.id
   )
   and (
    r.terms='' or
    not exists(
     select 1
     from pg_catalog.regexp_split_to_table(r.terms,'[[:space:]]+') as word(token)
     where pg_catalog.strpos(
      pg_catalog.translate(
       pg_catalog.lower(pg_catalog.concat_ws(' ',p.title,p.city,pg_catalog.left(p.about,180))),
       'áàâãäéèêëíìîïóòôõöúùûüç',
       'aaaaaeeeeiiiiooooouuuuc'
      ),word.token
     )=0
    )
   )
 )
 select e.slug,e.title,e.city,e.about,e.photo_path,
  pg_catalog.count(*) over() as total_count
 from eligible e
 order by e.created_at desc,e.id desc
 limit (select take from request)
 offset (select skip from request)
$search$;

revoke all on function public.agenda_search_directory(text,integer,integer)
 from public,anon,authenticated;
grant execute on function public.agenda_search_directory(text,integer,integer)
 to anon,authenticated;

commit;
