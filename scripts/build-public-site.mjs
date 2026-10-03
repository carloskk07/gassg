import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(new URL('..',import.meta.url).pathname);
const outName=process.argv[2]||'dist';
const out=path.resolve(root,outName);

const files=['index.html','manifest.webmanifest','sw.js','robots.txt'];
const dirs=['css','js','icons'];

fs.rmSync(out,{recursive:true,force:true});
fs.mkdirSync(out,{recursive:true});

for(const file of files){
  const src=path.join(root,file);
  if(!fs.existsSync(src))throw new Error('Asset público ausente: '+file);
  fs.copyFileSync(src,path.join(out,file));
}
for(const dir of dirs){
  const src=path.join(root,dir);
  if(!fs.existsSync(src))throw new Error('Diretório público ausente: '+dir);
  fs.cpSync(src,path.join(out,dir),{recursive:true});
}

for(const forbidden of ['supabase','tests','scripts','.github','.git']){
  if(fs.existsSync(path.join(out,forbidden)))throw new Error('Build público vazou diretório interno: '+forbidden);
}

const required=[
  'index.html','manifest.webmanifest','sw.js','robots.txt',
  'js/runtime-config.js','js/backend.js','js/core.js','js/acquisition.js','js/legal.js',
  'css/base.css','css/components.css','icons/icon.svg'
];
for(const item of required){
  if(!fs.existsSync(path.join(out,item)))throw new Error('Build público incompleto: '+item);
}

console.log('Build público TAMÃO pronto em '+path.relative(root,out));
