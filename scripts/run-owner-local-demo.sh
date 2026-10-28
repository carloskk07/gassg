#!/usr/bin/env bash
# TAMÃO demo privada local: execute no Linux ou no WSL2 do Windows.
# Nunca aponta para Supabase comercial, não instala serviços pagos.
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

fail(){ printf '\nTAMÃO: %s\n' "$*" >&2; exit 1; }
for tool in docker supabase psql python3 node git; do
  command -v "$tool" >/dev/null 2>&1 || fail "Falta $tool no Linux/WSL. Veja docs/DEMO_LOCAL_PROPRIETARIO.md."
done
[[ -f "supabase/schema.sql" && -f "supabase/config.toml" ]] || fail "Abra o projeto completo carloskk07/gassg."
[[ -z "${SUPABASE_ACCESS_TOKEN:-}" && -z "${SUPABASE_DB_PASSWORD:-}" ]] ||
  fail "Remova SUPABASE_ACCESS_TOKEN e SUPABASE_DB_PASSWORD do terminal; esta demo usa somente localhost."
[[ "$(node -p 'Number(process.versions.node.split(".")[0])>=20')" == "true" ]] ||
  fail "Node.js 20 ou superior é obrigatório."
[[ -d supabase/migrations && ! -L supabase/migrations ]] || fail "Diretório de migrations inválido."
[[ -z "$(git status --porcelain --untracked-files=all -- supabase/migrations)" ]] ||
  fail "Existem migrations locais modificadas. Salve-as antes para evitar alterações no checkout."
if supabase status >/dev/null 2>&1; then
  fail "Já existe Supabase local em execução. Encerre-o antes de usar esta demo para não afetar seus dados locais."
fi
docker info >/dev/null 2>&1 || fail "Docker não está iniciado/visível no WSL."
tmp="$(mktemp -d)"
started=0
prepared=0
cleanup(){
  code=$?
  trap - EXIT INT TERM
  if [[ "$started" == 1 ]]; then
    supabase stop --no-backup >/dev/null 2>&1 || true
  fi
  if [[ "$prepared" == 1 && -d "$tmp/migrations" ]]; then
    rm -rf -- supabase/migrations
    cp -a "$tmp/migrations" supabase/migrations
  fi
  rm -rf -- "$tmp"
  if [[ "$code" -ne 0 ]]; then
    printf '\nDemonstração interrompida com erro (%s). Produção não foi acessada.\n' "$code" >&2
  fi
  exit "$code"
}
trap cleanup EXIT INT TERM
cp -a supabase/migrations "$tmp/migrations"
prepared=1
cp supabase/schema.sql supabase/migrations/20261001065000_local_baseline_from_schema.sql
python3 - <<'PY'
from pathlib import Path
from tempfile import TemporaryDirectory
from shutil import move
import re
folder=Path('supabase/migrations')
files=sorted(folder.glob('*.sql'))
assert len(files)>=200,'Cadeia de migrations incompleta'
previous=None
with TemporaryDirectory() as temp:
  staging=[]
  for file in files:
    match=re.fullmatch(r'(\d{14})_(.+)\.sql',file.name)
    if not match: raise RuntimeError('Nome inesperado: '+file.name)
    original=int(match.group(1))
    effective=original if previous is None or original>previous else previous+1
    previous=effective
    dest=folder/(f'{effective:014d}'+'_'+match.group(2)+'.sql')
    staged=Path(temp)/file.name
    move(file,staged)
    staging.append((staged,dest))
  for old,new in staging:move(old,new)
assert len({p.name[:14] for p in folder.glob('*.sql')})==len(files)
print('Schema e migrations preparados SOMENTE neste checkout local.')
PY
export CI=true TAMAO_OWNER_LOCAL_DEMO=1
export SUPABASE_ACCESS_TOKEN='' SUPABASE_DB_PASSWORD=''
unset SUPABASE_INTERNAL_IMAGE_REGISTRY || true
printf '\nIniciando Auth, Edge e Postgres locais (sem projeto na nuvem)...\n'
started=1
supabase start -x realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,logflare,vector,supavisor
printf '\nValidando pedidos e abrindo demonstração das três perspectivas...\n'
node tests/isolated-supabase-positive-checkout.mjs
