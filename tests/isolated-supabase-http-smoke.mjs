import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

// Real localhost Auth / gateway / Edge test only; no account creation,
// no provider credentials and no remote API calls.
assert.equal(process.env.CI,'true');
assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
assert.equal(process.env.SUPABASE_DB_PASSWORD||'','');
const output=execFileSync('supabase',['status','-o','env'],{
  encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']
});
const env=Object.fromEntries(output.split('\n').map(line=>{
  const m=line.match(/^([A-Z_]+)=(.*)$/);
  return m?[m[1],m[2].replace(/^["']|["']$/g,'')]:null;
}).filter(Boolean));
const base=env.API_URL||env.SUPABASE_URL||'';
const anon=env.ANON_KEY||env.SUPABASE_ANON_KEY||'';
assert.match(base,/^http:\/\/(?:127\.0\.0\.1|localhost):54321\/?$/);
assert.ok(anon.length>25,'local Supabase anon key missing');
const headers={
  apikey:anon,
  Authorization:'Bearer '+anon,
  Origin:'http://localhost:5173',
  'Content-Type':'application/json'
};
const health=await fetch(base+'/auth/v1/health',{signal:AbortSignal.timeout(25000)});
assert.equal(health.status,200,'local Auth health must be available');
for(const slug of ['create-order','merchant-orders','get-order']){
  const res=await fetch(base+'/functions/v1/'+slug,{
    method:'POST',
    headers,
    body:JSON.stringify({quoteId:'00000000-0000-4000-8000-000000000001'}),
    signal:AbortSignal.timeout(45000)
  });
  const body=await res.json();
  assert.equal(res.status,401,slug+' must deny use of anon JWT as a user session');
  assert.equal(body.error,'UNAUTHORIZED',
    slug+' must execute its OWN auth.getUser guard rather than a generic gateway error');
}
console.log('PASS local Auth health and 3 real Edge handlers reject anonymous JWT (no writes).');
