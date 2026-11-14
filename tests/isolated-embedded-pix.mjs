import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {pixFixture} from './helpers/pix-fixture.mjs';
assert.equal(process.env.CI,'true');
for(const key of ['SUPABASE_ACCESS_TOKEN','SUPABASE_DB_PASSWORD','SUPABASE_SERVICE_ROLE_KEY','MERCADOPAGO_ACCESS_TOKEN'])assert.equal(process.env[key]||'','');
const sql=q=>execFileSync('psql',['--host=127.0.0.1','--port=54322','--username=postgres','--dbname=postgres','--no-psqlrc','--set=ON_ERROR_STOP=1','--tuples-only','--no-align','--quiet','--command='+q],{encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},timeout:120000}).trim();
assert.equal(sql('select current_database()'),'postgres');
const before=sql('select count(*) from public.ads_independent_checkouts_v1_886');
sql(`begin;
do $test$
declare u uuid:=gen_random_uuid();m uuid;c uuid;d uuid;o uuid;a uuid;r jsonb;q jsonb;ref text;denied boolean;sig text;
begin
 insert into auth.users(id,instance_id,aud,role,is_sso_user,is_anonymous,email,email_confirmed_at)
 values(u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',false,false,'pix-fixture-'||u::text||'@example.invalid',clock_timestamp());
 insert into public.platform_admins(user_id,active,admin_role) values(u,true,'superadmin');
 update public.ads_independent_sales_controls_v1_886 set sales_enabled=true where singleton;
 r:=public.ads_independent_submit_v1_884(u,gen_random_uuid(),'Anunciante sintético','Campanha Pix em banco descartável','Descrição exclusivamente sintética para teste de cobrança Pix isolada.','São Gabriel','RS','https://example.invalid/pix',1990,7);
 c:=(r->>'campaignId')::uuid;
 perform public.admin_ads_independent_action_v1_884(u,'approve',c,1,'Revisão sintética dentro da transação descartável');
 r:=public.ads_independent_checkout_reserve_v1_886(u,c,gen_random_uuid());ref:=r->>'externalReference';
 denied:=false;
 begin perform public.ads_pix_begin(gen_random_uuid(),c,'owner');exception when sqlstate '42501' then denied:=true;end;
 if not denied then raise exception 'PIX_FOREIGN_OWNER';end if;
 denied:=false;
 begin perform public.ads_pix_begin(u,c,'system_repair');exception when sqlstate '42501' then denied:=true;end;
 if not denied then raise exception 'PIX_REPAIR_CREATED_OBLIGATION';end if;
 perform public.ads_pix_begin(u,c,'owner');
 r:=public.ads_pix_claim(u,c,null,null);q:=public.ads_pix_claim(u,c,null,null);
 if r->>'canCreate'<>'true' or q->>'canCreate'<>'false' then raise exception 'PIX_DOUBLE_CREATE';end if;
 denied:=false;
 begin perform public.ads_pix_attach(u,c,'12345678901','123456789',4990,'${pixFixture()}',clock_timestamp()+interval '1 day');exception when sqlstate '42501' then denied:=true;end;
 if not denied then raise exception 'PIX_AMOUNT_MISMATCH';end if;
 perform public.ads_pix_attach(u,c,'12345678901','123456789',1990,'${pixFixture()}',clock_timestamp()+interval '1 day');
 if (select count(*) from public.ads_independent_checkouts_v1_886 where campaign_id=c)<>1 then raise exception 'PIX_PARALLEL_OBLIGATION';end if;
 r:=public.ads_independent_payment_fact_v1_886(repeat('a',64),ref,'12345678901','123456789',1990,'BRL','approved','accredited',true);
 if r->>'paymentApproved'<>'true' or r->>'autoPublished'<>'false' then raise exception 'PIX_CANONICAL_APPROVAL';end if;
 q:=public.ads_independent_payment_fact_v1_886(repeat('a',64),ref,'12345678901','123456789',1990,'BRL','approved','accredited',true);
 if q->>'recorded'<>'false' then raise exception 'PIX_DUPLICATE_RECEIPT';end if;
 r:=public.ads_independent_submit_v1_884(u,gen_random_uuid(),'Legado sintético','Campanha anterior para migração','Descrição sintética para testar encerramento do checkout anterior.','São Gabriel','RS','https://example.invalid/legacy',1990,7);
 d:=(r->>'campaignId')::uuid;
 perform public.admin_ads_independent_action_v1_884(u,'approve',d,1,'Revisão sintética para migração de cobrança existente');
 r:=public.ads_independent_checkout_reserve_v1_886(u,d,gen_random_uuid());
 perform public.ads_independent_checkout_attach_v1_886(d,r->>'externalReference','123456789-legacy','https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=123456789-legacy');
 perform public.ads_pix_begin(u,d,'owner');denied:=false;
 begin perform public.ads_pix_claim(u,d,'123456789-legacy',null);exception when sqlstate '42501' then denied:=true;end;
 if not denied then raise exception 'PIX_LEGACY_NOT_CLOSED';end if;
 r:=public.ads_pix_claim(u,d,'123456789-legacy',repeat('b',64));
 if r->>'canCreate'<>'true' or (select checkout_url is not null from public.ads_independent_checkouts_v1_886 where campaign_id=d) then raise exception 'PIX_LEGACY_LINK_RETAINED';end if;
 select external_reference into ref from public.ads_independent_checkouts_v1_886 where campaign_id=d;
 r:=public.ads_independent_payment_fact_v1_886(repeat('c',64),ref,'12345678902','123456789',1990,'BRL','approved','accredited',true);
 if r->>'paymentApproved'<>'true' then raise exception 'PIX_EARLY_WEBHOOK_LOST';end if;
 insert into public.merchants(name,cnpj,status,online,accepts_citywide,last_seen_at,delivery_fee_confirmed_at,delivery_fee_cents)
 values('PIX ISOLATED SELLER','99887766550099','pending',false,true,clock_timestamp(),clock_timestamp(),0) returning id into m;
 insert into public.orders(public_code,customer_id,status,address_text,address_number,postal_code,customer_phone_digits,payment_method,payment_timing,gross_total_cents,total_cents,delivery_fee_cents_snapshot,merchant_id,attempted_merchant_ids,offer_expires_at,version)
 values('PIX-'||substr(u::text,1,8),u,'PREPARING','Rua Sintética 20','20','97300000','51999998888','pix','prepaid',1990,1990,0,m,array[m],clock_timestamp()+interval '10 minutes',1) returning id into o;
 insert into public.merchant_sale_payment_attempts(order_id,merchant_id,provider,checkout_mode,external_reference,amount_cents,status,payment_method_snapshot,verification_level,funds_owner)
 values(o,m,'mercadopago','pix',gen_random_uuid()::text,1990,'preparing','pix','provider','merchant') returning id into a;
 denied:=false;
 begin perform public.merchant_sale_pix_attach(gen_random_uuid(),o,a,'ORD-native-proof',1990,'${pixFixture()}',clock_timestamp()+interval '1 day');exception when sqlstate '42501' then denied:=true;end;
 if not denied then raise exception 'SALE_PIX_FOREIGN_CUSTOMER';end if;
 r:=public.merchant_sale_pix_attach(u,o,a,'ORD-native-proof',1990,'${pixFixture()}',clock_timestamp()+interval '1 day');
 if r->>'status'<>'pending' or (select pix_br_code from public.merchant_sale_payment_attempts where id=a)<>'${pixFixture()}' then raise exception 'SALE_PIX_PERSISTENCE_FAILED';end if;
 for sig in select unnest(array['public.ads_pix_begin(uuid,uuid,text)','public.ads_pix_claim(uuid,uuid,text,text)','public.ads_pix_attach(uuid,uuid,text,text,integer,text,timestamptz)','public.merchant_sale_pix_attach(uuid,uuid,uuid,text,bigint,text,timestamptz)']) loop
  if has_function_privilege('anon',sig,'EXECUTE') or has_function_privilege('authenticated',sig,'EXECUTE') then raise exception 'PIX_PUBLIC_AUTHORITY_LEAK';end if;
 end loop;
end;$test$;
rollback;`);
assert.equal(sql('select count(*) from public.ads_independent_checkouts_v1_886'),before);
console.log('PASS: disposable Postgres native Pix, same obligation, owner/amount guards, one create, retired legacy, early webhook and seller-owned payment.');
