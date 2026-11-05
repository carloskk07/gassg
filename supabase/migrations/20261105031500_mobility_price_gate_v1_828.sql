-- TAMÃO #828: a tarifa deve estar acordada ANTES de iniciar a corrida.
-- Transações antigas ficam com flag false; novas solicitações exigem aceite.
alter table public.mobility_requests
 add column fare_confirmation_required boolean not null default false;
alter table public.mobility_requests
 alter column fare_confirmation_required set default true;

-- Não altera funções SECURITY DEFINER nem expõe novos RPCs à Data API.
-- Guard independente cobre chamadas via RPC e eventuais caminhos internos.
create or replace function public.mobility_fare_required_guard_v1_828()
returns trigger
language plpgsql set search_path=pg_catalog
as $$
begin
 if tg_op='INSERT' then
   new.fare_confirmation_required:=true;
   return new;
 end if;

 if new.fare_confirmation_required is distinct from old.fare_confirmation_required then
   raise exception 'MOBILITY_FARE_GUARD_IMMUTABLE' using errcode='42501';
 end if;

 if new.status is distinct from old.status
    and new.status in ('en_route','arrived','completed')
    and new.fare_confirmation_required
    and not exists(
      select 1 from public.mobility_fare_quotes_v1_826 q
      where q.request_id=new.id
        and q.driver_id=new.driver_id
        and q.rider_id=new.rider_id
        and q.fare_cents between 100 and 10000000
        and q.rider_accepted_at is not null
    )
 then
   raise exception 'MOBILITY_FARE_NOT_ACCEPTED' using errcode='40001';
 end if;
 return new;
end;
$$;
revoke all on function public.mobility_fare_required_guard_v1_828() from public,anon,authenticated;

create trigger mobility_fare_required_guard_v1_828_trg
before insert or update on public.mobility_requests
for each row execute function public.mobility_fare_required_guard_v1_828();

-- Regra de implantação: uma solicitação nova não pode nascer com flag false.
do $$
begin
 if (select column_default from information_schema.columns
     where table_schema='public' and table_name='mobility_requests'
       and column_name='fare_confirmation_required') is distinct from 'true' then
   raise exception 'MOBILITY_FARE_DEFAULT_MISSING';
 end if;
end;
$$;
