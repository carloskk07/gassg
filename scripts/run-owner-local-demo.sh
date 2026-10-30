#!/usr/bin/env bash
# TAMÃO — demo privada em workspace DESCARTÁVEL, sem tocar no checkout.
# Ubuntu/WSL2 + Docker Desktop; sem tokens remotos nem PSP.
set -Eeuo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
fail(){ printf '\nTAMÃO: %s\n' "$*" >&2; exit 1; }

for tool in git tar docker supabase psql python3 node; do
  command -v "$tool" >/dev/null 2>&1 ||
    fail "Falta $tool no Linux/WSL. Consulte docs/DEMO_LOCAL_PROPRIETARIO.md."
done
[[ -f "$repo/supabase/schema.sql" && -f "$repo/supabase/config.toml" ]] ||
  fail "Abra o projeto completo carloskk07/gassg."
[[ "$(git -C "$repo" rev-parse --is-inside-work-tree 2>/dev/null)" == true ]] ||
  fail "A demo precisa de um clone Git do TAMÃO. Baixar só um arquivo .cmd não é suficiente."
[[ -z "${SUPABASE_ACCESS_TOKEN:-}" && -z "${SUPABASE_DB_PASSWORD:-}" ]] ||
  fail "Abra um terminal sem credenciais do Supabase hospedado."
for variable in MERCADOPAGO_ACCESS_TOKEN WOOVI_APP_ID WOOVI_API_KEY BILLING_PIX_PROVIDER STRIPE_SECRET_KEY SUPABASE_SERVICE_ROLE_KEY; do
  [[ -z "${!variable:-}" ]] ||
    fail "Há tokens de pagamento ou chaves privilegiadas no ambiente; use um terminal limpo."
done
if find "$repo/supabase" -type f \( -name '.env' -o -name '.env.local' -o -name '.env.production' \) -print -quit | grep -q .; then
  fail "O checkout contém arquivo .env do Supabase. Não execute a demo com credenciais presentes."
fi
[[ "$(node -p 'Number(process.versions.node.split(".")[0])>=20')" == true ]] ||
  fail "É obrigatório Node.js 20+."
docker info >/dev/null 2>&1 ||
  fail "Docker Desktop não está iniciado ou não está integrado ao WSL."
# Não encerrar ou sobrescrever uma instância de Supabase já existente.
if (cd "$repo" && supabase status >/dev/null 2>&1); then
  fail "Supabase local já está em execução neste projeto; não vamos alterar seus dados."
fi
for port in 4179 4180 4181 54321 54322; do
  if command -v ss >/dev/null 2>&1 && ss -ltnH "( sport = :$port )" 2>/dev/null | grep -q .; then
    fail "Porta $port já utilizada; feche o serviço existente sem interferência da demo."
  fi
done

# Arquivos originais NUNCA são renomeados, editados ou apagados: o
# Git HEAD é exportado a uma cópia limpa fora do checkout no filesystem Linux.
sandbox="$(mktemp -d "${TMPDIR:-/tmp}/tamao-owner-demo.XXXXXXXX")"
workspace="$sandbox/project"
network="tamao-demo-local-$$"
network_created=0
stack_started=0
cleanup(){
  code=$?
  trap - EXIT INT TERM
  if [[ "$stack_started" == 1 ]]; then
    (cd "$workspace" && supabase stop --no-backup >/dev/null 2>&1) || true
  fi
  if [[ "$network_created" == 1 ]]; then
    docker network rm "$network" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$sandbox"
  if [[ "$code" -ne 0 ]]; then
    printf '\nTAMÃO: ambiente descartável encerrado. Código original preservado (código de saída %s).\n' "$code" >&2
  fi
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p "$workspace"
git -C "$repo" archive --format=tar HEAD | tar -xf - -C "$workspace"
cd "$workspace"
[[ -f "supabase/schema.sql" && -f "tests/isolated-supabase-positive-checkout.mjs" ]] ||
  fail "O commit Git atual não contém os arquivos necessários."
# Under pipefail, head can close the pipe while sort still writes and cause SIGPIPE (141).
# sed reads the entire sorted stream, retaining the same canonical first filename.
first="$(find supabase/migrations -maxdepth 1 -name '*.sql' -type f | LC_ALL=C sort | sed -n '1p')"
[[ "$first" == "supabase/migrations/20261001070000_reconcile_runtime_v1_4.sql" ]] ||
  fail "A versão das migrations não é a cadeia canônica homologada."
cp supabase/schema.sql supabase/migrations/20261001065000_local_baseline_from_schema.sql
python3 - <<'PY'
from pathlib import Path
from tempfile import TemporaryDirectory
from shutil import move
import re
root=Path('supabase/migrations')
files=sorted(root.glob('*.sql'))
if len(files)<200:raise RuntimeError('Cadeia de migrations incompleta.')
previous=None
with TemporaryDirectory() as staging:
  copies=[]
  for f in files:
    m=re.fullmatch(r'(\d{14})_(.+)\.sql',f.name)
    if not m:raise RuntimeError('Migration com nome inesperado: '+f.name)
    value=int(m.group(1))
    version=value if previous is None or value>previous else previous+1
    previous=version
    renamed=root/(f'{version:014d}'+'_'+m.group(2)+'.sql')
    part=Path(staging)/f.name
    move(f,part)
    copies.append((part,renamed))
  for source,target in copies:move(source,target)
assert len({p.name[:14] for p in root.glob('*.sql')})==len(files)
print('Banco local preparado em cópia descartável; checkout original intacto.')
PY

# A rede dedicada vincula as portas publicadas dos contêineres SOMENTE
# ao loopback, conforme recomendação oficial do Supabase para redes não confiáveis.
docker network create --driver bridge \
  --opt com.docker.network.bridge.host_binding_ipv4=127.0.0.1 \
  "$network" >/dev/null
network_created=1
export CI=true TAMAO_OWNER_LOCAL_DEMO=1 SUPABASE_ACCESS_TOKEN='' SUPABASE_DB_PASSWORD=''
unset SUPABASE_INTERNAL_IMAGE_REGISTRY || true
printf '\nTAMÃO: iniciando Supabase descartável SOMENTE neste computador...\n'
stack_started=1
supabase start --network-id "$network" \
  -x realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,logflare,vector,supavisor
# O CLI e o Docker podem mudar padrões de bind. Bloqueie a demo
# se algum serviço Supabase ficar acessível pela rede local (0.0.0.0 ou IPv6).
if docker ps --format '{{.Ports}}' | grep -Eq '(^|, )((0\.0\.0\.0:|\[::\]:)(5432[0-9]|54330)->)'; then
  fail "Porta de Supabase exposta à rede; acesso negado. Verifique Docker Desktop."
fi
printf '\nValidando autenticação, cotação, pedidos e os três portais reais...\n'
node tests/isolated-supabase-positive-checkout.mjs
