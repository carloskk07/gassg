import fs from 'node:fs';
import path from 'node:path';
import {buildLivePortals} from './build-live-portals.mjs';
import {validatePortalRole} from './generate-runtime-config.mjs';

const root=path.resolve(new URL('..',import.meta.url).pathname);
const role=validatePortalRole(process.env.CHAMA_PORTAL_ROLE,{required:true});
const sourceSha=String(process.env.CHAMA_SOURCE_SHA||process.env.COMMIT_REF||process.env.HEAD||'unknown').trim();
const outRoot=path.join(root,'dist','netlify-build');
const publish=path.join(root,'dist','netlify');

const env={...process.env,CHAMA_SOURCE_SHA:sourceSha};
buildLivePortals(env,{outputRoot:outRoot});

const source=path.join(outRoot,role);
if(!fs.existsSync(source))throw new Error('portal bundle ausente para role '+role);

fs.rmSync(publish,{recursive:true,force:true});
fs.mkdirSync(path.dirname(publish),{recursive:true});
fs.cpSync(source,publish,{recursive:true});

const buildMeta=JSON.parse(fs.readFileSync(path.join(publish,'portal-build.json'),'utf8'));
if(buildMeta.portalRole!==role)throw new Error('portal-build role mismatch');
if(sourceSha!=='unknown'&&buildMeta.sourceSha!==sourceSha)throw new Error('portal-build source SHA mismatch');

console.log('Netlify portal pronto: '+role+' -> '+path.relative(root,publish));
