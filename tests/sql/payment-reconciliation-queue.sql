\set ON_ERROR_STOP on
-- Disposable Postgres only; no provider calls and every fixture rolls back.
begin;
do $test$
declare signature text; role_name text;
begin
 if (select enabled from public.platform_payment_reconciliation_config where id) then
  raise exception 'new worker must be installed disabled';
 end if;
 if (select active from cron.job where jobname='tamao-payment-reconciliation') then
  raise exception 'new schedule must wait for tested Edge activation';
 end if;
 foreach signature in array array[
  'public.platform_payment_reconciliation_authorize(text)',
  'public.platform_payment_reconciliation_claim(integer)',
  'public.platform_payment_reconciliation_finish(text,uuid,uuid,text,text,text)',
  'public.platform_payment_reconciliation_tick()'
 ] loop
  foreach role_name in array array['anon','authenticated'] loop
   if has_function_privilege(role_name,signature,'execute') then
    raise exception 'browser role can invoke machine function %',signature;
   end if;
  end loop;
 end loop;
 if has_table_privilege('authenticated','public.platform_payment_reconciliation_queue','select')
   or has_table_privilege('anon','public.platform_payment_reconciliation_config','select') then
  raise exception 'private payment queue exposed';
 end if;
 if (select count(*) from pg_trigger where not tgisinternal and tgname in (
  'payment_reconciliation_billing','payment_reconciliation_coupon',
  'payment_reconciliation_mobility','payment_reconciliation_advertising',
  'payment_reconciliation_merchant_sale'))<>5 then
  raise exception 'all five source tables must enqueue future changes';
 end if;
end $test$;
delete from public.platform_payment_reconciliation_queue;
update public.platform_payment_reconciliation_config set enabled=true,token_sha256=repeat('a',64) where id;
insert into public.platform_payment_reconciliation_queue(kind,resource_id,next_check_at)
select (array['billing','coupon','mobility','advertising','merchant_sale'])[1+(n%5)],
 ('90000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'2000-01-01'::timestamptz
from generate_series(1,10) n;
create temp table claims_a as select * from public.platform_payment_reconciliation_claim(4);
create temp table claims_b as select * from public.platform_payment_reconciliation_claim(8);
do $test$
declare item record; done boolean;
begin
 if public.platform_payment_reconciliation_authorize(repeat('b',64)) then raise exception 'wrong secret accepted'; end if;
 if not public.platform_payment_reconciliation_authorize(repeat('a',64)) then raise exception 'correct machine hash rejected'; end if;
 if (select count(*) from claims_a)<>4 or (select count(*) from claims_b)<>6 then raise exception 'bounded non-overlapping lease failure'; end if;
 if exists(select 1 from claims_a a join claims_b b using(kind,resource_id)) then raise exception 'lease overlap'; end if;
 select * into item from claims_a limit 1;
 done:=public.platform_payment_reconciliation_finish(item.kind,item.resource_id,gen_random_uuid(),'verified','PROVIDER_AND_LEDGER_CONFIRMED','paid');
 if done then raise exception 'another worker overwrote a lease'; end if;
 done:=public.platform_payment_reconciliation_finish(item.kind,item.resource_id,item.lease_token,'verified','PROVIDER_AND_LEDGER_CONFIRMED','paid');
 if not done then raise exception 'owned result not recorded'; end if;
 if public.platform_payment_reconciliation_finish(item.kind,item.resource_id,item.lease_token,'retry','LATE_REPLY',null) then
  raise exception 'late response replaced confirmed result';
 end if;
 if (select last_outcome from public.platform_payment_reconciliation_queue where kind=item.kind and resource_id=item.resource_id)<>'verified' then raise exception 'result missing'; end if;
 if (select count(*) from public.platform_payment_reconciliation_claim(8))<>0 then raise exception 'leased/backoff jobs claimed again'; end if;
end $test$;
rollback;
\echo 'PASS: private queue, five source triggers, disabled activation, bounded leases, stale replies and scheduled retry.'
