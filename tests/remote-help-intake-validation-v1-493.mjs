import assert from 'node:assert/strict';
import fs from 'node:fs';

// These deliberately INVALID requests stop BEFORE quota, contact validation,
// database writes or support-case creation. Probe only the published handler.
const backend=fs.readFileSync(new URL('../js/backend.js',import.meta.url),'utf8');
const url=/url:'([^']+)'/.exec(backend)?.[1]||'';
const apikey=/publishableKey:'([^']+)'/.exec(backend)?.[1]||'';
assert.match(url,/^https:\/\/[a-z0-9-]+\.supabase\.co$/);
assert.match(apikey,/^sb_publishable_[A-Za-z0-9_-]+$/);
const endpoint=url+'/functions/v1/submit-public-request';
const CUSTOMER='https://tamao.com.br';
const FAKE_ORIGIN='https://not-tamao.example.invalid';

async function probe({method='POST',origin=CUSTOMER,contentType='application/json',
  body='{}'}={}){
  let lastError=null;
  for(let attempt=1;attempt<=3;attempt++){
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await fetch(endpoint,{
        method,
        headers:{
          apikey,
          Origin:origin,
          ...(contentType?{'Content-Type':contentType}:{})
        },
        ...(['POST','PUT','PATCH'].includes(method)?{body}:{ }),
        signal:controller.signal
      });
      const raw=await response.text();
      let data=null;
      try{data=JSON.parse(raw)}catch{
        if(method!=='OPTIONS')throw Error('support HTTP '+response.status+' non-JSON body');
      }
      if([500,502,504].includes(response.status)&&attempt<3){
        lastError=Error('Transient support HTTP '+response.status);
        continue;
      }
      return {status:response.status,body:data,response};
    }catch(error){
      lastError=error;
      if(attempt===3)throw error;
    }finally{clearTimeout(timeout)}
  }
  throw lastError||Error('support handler not reachable');
}

// No real identity, message, consent or record is transmitted.
const blocked=await probe({origin:FAKE_ORIGIN});
assert.equal(blocked.status,403,'unknown origins denied before accepting a request');
assert.equal(blocked.body.error,'ORIGIN_NOT_ALLOWED');
assert.notEqual(blocked.response.headers.get('access-control-allow-origin'),FAKE_ORIGIN);
const invalid=await probe();
assert.equal(invalid.status,400,'allowed origin must reach actual handler');
assert.equal(invalid.body.error,'ACK_REQUIRED',
  'without consent, request must fail before quota and any database insertion');
assert.equal(invalid.response.headers.get('access-control-allow-origin'),CUSTOMER);
assert.equal(invalid.response.headers.get('cache-control'),'no-store');
const wrongType=await probe({contentType:'text/plain'});
assert.equal(wrongType.status,415);
assert.equal(wrongType.body.error,'INVALID_CONTENT_TYPE');
const options=await probe({method:'OPTIONS'});
assert.equal(options.status,200);
assert.equal(options.response.headers.get('access-control-allow-origin'),CUSTOMER);
assert.match(options.response.headers.get('access-control-allow-headers'),/idempotency-key/);
console.log(JSON.stringify({
  ok:true,handler:'submit-public-request',remoteStatus:'reachable',
  rejectedUnknownOrigin:true,consentRequired:true,contentTypeGuard:true,
  corsPreflight:true,requestOrPersonalDataCreated:false
}));
