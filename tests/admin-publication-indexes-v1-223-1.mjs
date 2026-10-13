import assert from 'node:assert/strict';
import fs from 'node:fs';
const sql=fs.readFileSync(new URL('../supabase/migrations/20261013191500_portal_attestation_fk_indexes_v1_223_1.sql',import.meta.url),'utf8');
assert.match(sql,/create index if not exists portal_attestation_observations_episode_fk_v1_223_1\s+on tamao_internal\.portal_attestation_observations_v1_223\(episode_id\);/i);
assert.match(sql,/create index if not exists portal_attestation_state_episode_fk_v1_223_1\s+on tamao_internal\.portal_attestation_state_v1_223\(active_episode_id\);/i);
assert.doesNotMatch(sql,/drop |delete |truncate |update |insert |grant /i);
console.log('V1.223.1 PASS — new private FK references indexed without modifying evidence or authorization.');
