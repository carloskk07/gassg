import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// One real verified GoTrue owner is downgraded to "anonymous" inside a
// single disposable PostgreSQL ROLLBACK transaction. This tests actual
// RLS under SET LOCAL ROLE authenticated, not a string/regex inspection.
export function verifyAnonymousDraftEditGuard({sql,q,owner}){
 assert.equal(process.env.CI,'true');
 assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
 assert.equal(process.env.SUPABASE_DB_PASSWORD||'','');
 const listing=randomUUID();
 const result=sql(`
BEGIN;
INSERT INTO public.discovery_listings(
 id,owner_id,vertical,status,title,description,state_code,city_key,city_name,whatsapp_e164
) VALUES (
 ${q(listing)}::uuid,${q(owner.id)}::uuid,'professionals','draft',
 'Ficha descartável CI','Rascunho anterior à troca de identidade CI',
 'RS','sao-gabriel','São Gabriel','+5555999999999'
);
UPDATE auth.users SET is_anonymous=false,email_confirmed_at=clock_timestamp()
 WHERE id=${q(owner.id)}::uuid;
SELECT set_config('request.jwt.claim.sub',${q(owner.id)},true);
SET LOCAL ROLE authenticated;
SELECT public.discovery_verified_account();
SELECT public.discovery_owner_can_edit_details(${q(listing)}::uuid,'professionals');
WITH edited AS (UPDATE public.discovery_listings
 SET description='Apenas conta verificada pode alterar'
 WHERE id=${q(listing)}::uuid RETURNING 1)
 SELECT count(*) FROM edited;
RESET ROLE;
UPDATE auth.users SET is_anonymous=true WHERE id=${q(owner.id)}::uuid;
SET LOCAL ROLE authenticated;
SELECT public.discovery_verified_account();
SELECT public.discovery_owner_can_edit_details(${q(listing)}::uuid,'professionals');
WITH edited AS (UPDATE public.discovery_listings
 SET description='ALTERACAO_INDEVIDA_ANONIMA'
 WHERE id=${q(listing)}::uuid RETURNING 1)
 SELECT count(*) FROM edited;
RESET ROLE;
SELECT description='Apenas conta verificada pode alterar'
 FROM public.discovery_listings WHERE id=${q(listing)}::uuid;
ROLLBACK;`);
 const verdicts=result.split(/\r?\n/).map(x=>x.trim())
  .filter(x=>['t','f','0','1'].includes(x));
 assert.deepEqual(verdicts,['t','t','1','f','f','0','t'],
  'anonymous signed-in users must neither edit an old verified draft nor its details');
 assert.equal(sql("SELECT count(*) FROM public.discovery_listings WHERE id="+q(listing)+"::uuid"),
  '0','all synthetic discovery data must be rolled back');
 console.log('PASS: real PostgreSQL RLS allows verified owner edits but rejects a previously verified owner after anonymous downgrade, with all data rolled back.');
}
