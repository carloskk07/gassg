import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

// Private owner rehearsal: real existing frontend + a LOCAL, disposable Supabase.
// This server must never listen on a public interface or point at the live project.
const PRODUCTION_URL="url:'https://lgugwujpunhslavewffd.supabase.co'";
const PRODUCTION_KEY="publishableKey:'sb_publishable_3FLGyrWHrUZ5vQc59Iowug_pekOZ9u_'";
const PRODUCTION_CSP='https://lgugwujpunhslavewffd.supabase.co wss://lgugwujpunhslavewffd.supabase.co';
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp',
  '.ico':'image/x-icon','.webmanifest':'application/manifest+json'};

const exactReplace=(source,from,to)=>{
  assert.equal(source.split(from).length,2,'Unsafe local demo: upstream production config changed');
  return source.replace(from,to);
};
const isLoopbackRequest=(req,port)=>{
  const remote=req.socket.remoteAddress||'';
  return (remote==='127.0.0.1'||remote==='::ffff:127.0.0.1')
    &&req.headers.host==='127.0.0.1:'+port;
};

export async function startOwnerLocalDemo({api,anon,customer,merchant,admin,
  root=path.resolve('.'),ports=[4179,4180,4181]}={}){
  assert.equal(process.env.CI,'true','Use a local-only disposable CI-style fixture');
  assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
  assert.equal(process.env.SUPABASE_DB_PASSWORD||'','');
  assert.equal(api,'http://127.0.0.1:54321','Never run this demo against an external project');
  assert.ok(typeof anon==='string'&&anon.length>20);
  assert.deepEqual(ports,[4179,4180,4181],'Never rebind to public/alternate ports');
  for(const actor of [customer,merchant,admin]){
    assert.ok(actor?.session?.access_token?.length>100,'All local Auth actors must be signed in');
    assert.ok(actor.session?.refresh_token?.length>8);
  }
  const backend=fs.readFileSync(path.join(root,'js/backend.js'),'utf8');
  const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const localBackend=exactReplace(
    exactReplace(backend,PRODUCTION_URL,'url:'+JSON.stringify(api)),
    PRODUCTION_KEY,'publishableKey:'+JSON.stringify(anon)
  );
  const cspIndex=exactReplace(index,PRODUCTION_CSP,api)
    .replace('content="index,follow,max-image-preview:large"','content="noindex,nofollow,noarchive"');
  assert.ok(cspIndex.includes('<script src="./js/runtime-config.js"></script>'));
  const html=cspIndex.replace('<script src="./js/runtime-config.js"></script>',
    '<script src="./js/owner-local-session.js"></script>\n  <script src="./js/runtime-config.js"></script>');
  const roles=[
    {role:'customer',port:ports[0],actor:customer,route:'/#home',
      store:'localStorage',key:'chama-sg-customer-auth-v2'},
    {role:'merchant',port:ports[1],actor:merchant,route:'/?merchant=1#merchant',
      store:'sessionStorage',key:'chama-sg-merchant-auth-v1'},
    {role:'admin',port:ports[2],actor:admin,route:'/?admin=1#admin',
      store:'sessionStorage',key:'chama-sg-admin-auth-v1'}
  ];
  const servers=[];
  try{
    for(const {role,port,actor,route,store,key} of roles){
      const origin='http://127.0.0.1:'+port;
      // Keep Supabase's own refreshed session across page reloads, but
      // replace credentials when a brand-new disposable Auth actor starts.
      const sessionScript='(()=>{const s='+JSON.stringify(JSON.stringify(actor.session))+';'
        +'let old=null;try{old=JSON.parse('+store+'.getItem('+JSON.stringify(key)+')||"null")}catch{};'
        +'if(old?.user?.id!=='+JSON.stringify(actor.session.user.id)+')'
        +store+'.setItem('+JSON.stringify(key)+',s);})();';
      const server=http.createServer((req,res)=>{
        const headers={'Cache-Control':'no-store, max-age=0',
          'X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow',
          'Referrer-Policy':'no-referrer'};
        try{
          if(!isLoopbackRequest(req,port))return res.writeHead(403,headers).end('Forbidden');
          if(req.method!=='GET'&&req.method!=='HEAD')return res.writeHead(405,headers).end('Method not allowed');
          const url=new URL(req.url||'/',origin);
          if(url.pathname==='/__owner-demo-health'){
            return res.writeHead(200,{...headers,'Content-Type':'application/json'})
              .end(JSON.stringify({ok:true,role,localOnly:true}));
          }
          if(url.pathname==='/js/owner-local-session.js')
            return res.writeHead(200,{...headers,'Content-Type':MIME['.js']}).end(sessionScript);
          const requested=decodeURIComponent(url.pathname);
          const relative=requested==='/'?'index.html':requested.slice(1);
          // Never serve .env, .git, tests, SQL, CI artifacts, credentials or
          // any arbitrary checked-in source file from this loopback server.
          const publicAsset=/^(?:js|css|icons|assets|images|img|fonts)\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(relative)
            &&!relative.split('/').some(segment=>segment==='..'||segment.startsWith('.'));
          if(!publicAsset&&!['index.html','manifest.webmanifest','favicon.ico'].includes(relative))
            return res.writeHead(404,headers).end('Not found');
          const full=path.resolve(root,relative);
          if(!full.startsWith(root+path.sep)||!fs.statSync(full).isFile())
            return res.writeHead(404,headers).end('Not found');
          const rel=path.relative(root,full).replaceAll(path.sep,'/');
          let body=rel==='index.html'?html:
            rel==='js/backend.js'?localBackend:fs.readFileSync(full);
          if(rel==='index.html'&&url.pathname==='/'&&url.search===''&&url.hash==='')
            headers['X-TAMAO-Demo-Role']=role;
          return res.writeHead(200,{...headers,'Content-Type':MIME[path.extname(full)]||'application/octet-stream'}).end(body);
        }catch{return res.writeHead(404,headers).end('Not found')}
      });
      await new Promise((resolve,reject)=>{
        server.once('error',reject);
        server.listen(port,'127.0.0.1',resolve);
      });
      servers.push(server);
      console.log('TAMÃO LOCAL '+role.toUpperCase()+': '+origin+route);
    }
    return {roles:roles.map(({role,port,route})=>({role,url:'http://127.0.0.1:'+port+route})),
      close:async()=>{await Promise.all(servers.map(server=>new Promise(done=>server.close(done))))}};
  }catch(e){
    await Promise.all(servers.map(server=>new Promise(done=>server.close(done))));
    throw e;
  }
}
