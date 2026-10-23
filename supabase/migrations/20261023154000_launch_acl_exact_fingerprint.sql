-- Exact, fail-closed effective grant inventory for the *full* migrated database.
-- Unlike the old launch gate, this includes column-only grants and compares
-- live RLS policy expressions and SECURITY DEFINER source bodies. Unexpected
-- new privileges, policy weakening or modified privileged RPCs block launch.
-- All other commercial, offer, payment and portal gates remain untouched.
CREATE OR REPLACE FUNCTION public.tamao_launch_acl_posture_v1()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='pg_catalog,public'
AS $scan$
WITH t AS (
 SELECT c.oid,c.relname,c.relrowsecurity,
  (SELECT coalesce(jsonb_agg(r.x||':'||p.x ORDER BY r.x,p.x),'[]'::jsonb)
   FROM (VALUES('anon'),('authenticated')) r(x)
   CROSS JOIN (VALUES('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(x)
   WHERE has_table_privilege(r.x,c.oid,p.x)) tbl,
  (SELECT coalesce(jsonb_agg(r.x||':'||p.x||':'||a.attname ORDER BY r.x,p.x,a.attname),'[]'::jsonb)
   FROM pg_attribute a CROSS JOIN (VALUES('anon'),('authenticated')) r(x)
   CROSS JOIN (VALUES('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) p(x)
   WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    AND a.attacl IS NOT NULL
    AND has_column_privilege(r.x,c.oid,a.attnum,p.x)
    AND NOT has_table_privilege(r.x,c.oid,p.x)) col,
  (SELECT coalesce(jsonb_agg(
    md5(pol.polname||':'||pol.polcmd::text||':'||pol.polpermissive::text||':'||
        (SELECT coalesce(string_agg(coalesce(r.rolname,'PUBLIC'),',' ORDER BY coalesce(r.rolname,'PUBLIC')),'') FROM unnest(pol.polroles) AS role_oid LEFT JOIN pg_roles r ON r.oid=role_oid)||':'||coalesce(pg_get_expr(pol.polqual,pol.polrelid),'')||':'||
        coalesce(pg_get_expr(pol.polwithcheck,pol.polrelid),''))
    ORDER BY pol.polname),'[]'::jsonb)
   FROM pg_policy pol WHERE pol.polrelid=c.oid) policies
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN('r','p')
), f AS (
 SELECT p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS sig,
  has_function_privilege('anon',p.oid,'EXECUTE') an,
  has_function_privilege('authenticated',p.oid,'EXECUTE') au,
  p.proconfig,md5(p.prosrc) src
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.prosecdef
 AND (has_function_privilege('anon',p.oid,'EXECUTE')
   OR has_function_privilege('authenticated',p.oid,'EXECUTE'))
)
SELECT jsonb_build_object(
 'tableDigest',
 (SELECT md5(coalesce(string_agg(
  md5(jsonb_build_object('name',relname,'rls',relrowsecurity,'table',tbl,
     'columns',col,'policies',policies)::text), '|' ORDER BY relname COLLATE "C"),''))
  FROM t WHERE tbl<>'[]'::jsonb OR col<>'[]'::jsonb),
 'rpcDigest',
 (SELECT md5(coalesce(jsonb_agg(jsonb_build_object(
  'signature',sig,'anon',an,'auth',au,'config',proconfig,'body',src)
  ORDER BY sig),'[]'::jsonb)::text) FROM f),
 'tableCount',(SELECT count(*) FROM t WHERE tbl<>'[]'::jsonb OR col<>'[]'::jsonb),
 'rpcCount',(SELECT count(*) FROM f)
);
$scan$;
REVOKE ALL ON FUNCTION public.tamao_launch_acl_posture_v1() FROM PUBLIC,anon,authenticated;
-- Supabase migrations run under supabase_admin; the non-superuser postgres
-- maintenance role needs explicit EXECUTE to inspect the catalog. Never
-- grant the scanner to anon or authenticated.
GRANT EXECUTE ON FUNCTION public.tamao_launch_acl_posture_v1() TO postgres;
-- This pure catalog scanner runs under the *existing* SECURITY DEFINER
-- readiness function. No direct browser EXECUTE is granted.

DO $install$
DECLARE
 v_def text;
 v_old text:=$old$
  -- Segurança fundamental: medir privilégio EFETIVO, incluindo herança de PUBLIC.
  -- O data plane do TAMÃO é Edge/RPC server-side; browser não deve ter DML direto
  -- em nenhuma tabela public.
  if exists(
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relkind in ('r','p')
      and (
        pg_catalog.has_table_privilege('anon',c.oid,'SELECT')
        or pg_catalog.has_table_privilege('anon',c.oid,'INSERT')
        or pg_catalog.has_table_privilege('anon',c.oid,'UPDATE')
        or pg_catalog.has_table_privilege('anon',c.oid,'DELETE')
        or pg_catalog.has_table_privilege('anon',c.oid,'TRUNCATE')
        or pg_catalog.has_table_privilege('anon',c.oid,'REFERENCES')
        or pg_catalog.has_table_privilege('anon',c.oid,'TRIGGER')
        or pg_catalog.has_table_privilege('authenticated',c.oid,'SELECT')
        or pg_catalog.has_table_privilege('authenticated',c.oid,'INSERT')
        or pg_catalog.has_table_privilege('authenticated',c.oid,'UPDATE')
        or pg_catalog.has_table_privilege('authenticated',c.oid,'DELETE')
        or pg_catalog.has_table_privilege('authenticated',c.oid,'TRUNCATE')
        or pg_catalog.has_table_privilege('authenticated',c.oid,'REFERENCES')
        or pg_catalog.has_table_privilege('authenticated',c.oid,'TRIGGER')
      )
  ) then
    v_security:=array_append(v_security,'browser_sensitive_table_acl');
  end if;

  -- Toda tabela public do produto precisa permanecer RLS-on, inclusive tabelas
  -- adicionadas no futuro que ainda não existiam quando a allowlist original nasceu.
  if exists(
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relkind in ('r','p')
      and not c.relrowsecurity
  ) then
    v_security:=array_append(v_security,'sensitive_table_rls_disabled');
  end if;

  -- Detectar EXECUTE efetivo (inclusive PUBLIC) em qualquer SECURITY DEFINER.
  -- Única exceção intencional: claim_my_pilot_partner_invite(uuid,text), que
  -- deriva o usuário de auth.uid() e foi desenhado para authenticated.
  if exists(
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.prosecdef
      and p.oid<>'public.claim_my_pilot_partner_invite(uuid,text)'::pg_catalog.regprocedure
      and (
        pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
        or pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
      )
  ) then
    v_security:=array_append(v_security,'admin_rpc_browser_exposure');
  end if;

$old$;
 v_replacement text:=$replacement$
  -- Reviewed narrow grants: seven exposed tables (five table-level, two
  -- column-only) with RLS and verified policy expressions, and 28 reviewed
  -- authenticated SECURITY DEFINER signatures/bodies. All other grants or
  -- body/policy changes remain fail-closed until separately tested.
  -- The fingerprints were computed from the commercial database on
  -- 23 October 2026 using the same catalog query as the function above.
  if (public.tamao_launch_acl_posture_v1()->>'tableDigest')
     is distinct from '67838fe06fa43d7692e12d8e11a3de91' then
    v_security:=array_append(v_security,'browser_sensitive_table_acl');
  end if;

  -- Preserve the original global guard: even an unrelated/new public
  -- table without browser grants must retain RLS.
  if exists(
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p')
      and not c.relrowsecurity
  ) then
    v_security:=array_append(v_security,'sensitive_table_rls_disabled');
  end if;

  if (public.tamao_launch_acl_posture_v1()->>'rpcDigest')
     is distinct from 'd795df150e91d9d758b6ccb4fd0386cd' then
    v_security:=array_append(v_security,'admin_rpc_browser_exposure');
  end if;

$replacement$;
BEGIN
 SELECT pg_catalog.pg_get_functiondef('public.platform_launch_readiness()'::pg_catalog.regprocedure)
 INTO v_def;
 IF v_def IS NULL OR pg_catalog.strpos(v_def,v_old)=0
   OR pg_catalog.length(v_def)-pg_catalog.length(pg_catalog.replace(v_def,v_old,''))<>pg_catalog.length(v_old)
 THEN
   RAISE EXCEPTION 'LAUNCH_ACL_BASELINE_DRIFT_BLOCKED' USING ERRCODE='42501';
 END IF;
 -- Substitution targets only the byte-exact historical ACL section. Use
 -- current pg_get_functiondef to PRESERVE hosted merchant compliance/ANP
 -- checks, financial gating and all other later versioned changes.
 EXECUTE pg_catalog.replace(v_def,v_old,v_replacement);
END $install$;

-- The migration NEVER updates platform_launch_control and NEVER enables LIVE.
