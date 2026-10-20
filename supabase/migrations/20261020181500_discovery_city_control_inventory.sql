-- TAMÃO: situação das modalidades por cidade, exclusiva do Superadmin.
-- Não habilita nenhuma cidade nem interfere com produtos, pedidos ou pagamentos.
create function public.discovery_admin_city_matrix(p_limit integer default 100)
returns table(
 vertical text,state_code text,city_key text,city_name text,
 enabled boolean,changed_at timestamptz
)
language plpgsql stable security definer set search_path='pg_catalog'
as $city_matrix$
begin
 if (select auth.uid()) is null or not public.discovery_is_superadmin() then
   raise exception 'ADMIN_REQUIRED' using errcode='42501';
 end if;
 return query
 select c.vertical,c.state_code,c.city_key,c.city_name,c.enabled,c.changed_at
 from public.discovery_vertical_cities c
 order by c.changed_at desc,c.vertical,c.state_code,c.city_key
 limit greatest(1,least(coalesce(p_limit,100),100));
end $city_matrix$;
revoke all on function public.discovery_admin_city_matrix(integer) from public,anon,authenticated;
grant execute on function public.discovery_admin_city_matrix(integer) to authenticated;
