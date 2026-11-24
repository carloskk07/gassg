#!/usr/bin/env bash
# Package a previously verified private dump for offline encrypted storage.
# No database connections, uploads, secrets on argv or deletion of source data.
set -Eeuo pipefail
umask 077
[[ "$#" -eq 2 ]] || { echo 'Usage: TAMAO_BACKUP_RECIPIENT_FPR=<verified encryption key fingerprint> bash scripts/release-db-encrypt-checkpoint.sh <private.dump> <private-output.tar.gpg>' >&2; exit 2; }
: "${TAMAO_BACKUP_RECIPIENT_FPR:?Provide independently verified encryption-key fingerprint}"
fpr="${TAMAO_BACKUP_RECIPIENT_FPR^^}"
[[ "$fpr" =~ ^[A-F0-9]{40}$ ]] || { echo 'ENCRYPT_BLOCKED: exact GPG fingerprint required' >&2; exit 3; }
archive="$1"
output="$2"
[[ -f "$archive" && -s "$archive" && ! -L "$archive" && -f "$archive.sha256" && ! -L "$archive.sha256" ]] || { echo 'ENCRYPT_BLOCKED: missing archive or checksum, or symlink' >&2; exit 3; }
[[ "$archive" == *.dump && "$output" == *.tar.gpg ]] || { echo 'ENCRYPT_BLOCKED: unexpected extensions' >&2; exit 3; }
for bin in gpg tar sha256sum stat mktemp; do command -v "$bin" >/dev/null || { echo "MISSING_TOOL: $bin" >&2; exit 2; }; done
src="$(cd "$(dirname "$archive")" && pwd -P)"
dst="$(cd "$(dirname "$output")" && pwd -P)"
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
for dir in "$src" "$dst"; do
  case "$dir/" in "$repo/"*) echo 'ENCRYPT_BLOCKED: use directories outside repository' >&2; exit 3;; esac
  mode="$(stat -c %a "$dir")"
  (( (8#$mode & 8#77) == 0 )) || { echo 'ENCRYPT_BLOCKED: private directories required (chmod 700)' >&2; exit 3; }
done
name="$(basename "$archive")"
[[ "$name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*\.dump$ ]] || { echo 'ENCRYPT_BLOCKED: invalid archive filename' >&2; exit 3; }
target="$dst/$(basename "$output")"
[[ ! -e "$target" && ! -L "$target" ]] || { echo 'ENCRYPT_BLOCKED: target exists' >&2; exit 3; }
expected="$(awk 'NR==1{print $1}' "$archive.sha256")"
actual="$(sha256sum "$archive" | awk '{print $1}')"
[[ "$expected" =~ ^[a-fA-F0-9]{64}$ && "${expected,,}" == "$actual" ]] || { echo 'ENCRYPT_BLOCKED: source checksum mismatch' >&2; exit 3; }
# Verify operator-selected key out of band before use. Exact fingerprint (!)
# disables GPG's automatic selection of a different encryption subkey.
tmp="$(mktemp "$dst/.tamao-encrypted-XXXXXXXX")"
trap 'rm -f -- "$tmp"' EXIT
tar -C "$src" -cf - -- "$name" "$name.sha256" |
  gpg --no-options --batch --yes --no-tty --trust-model always --no-encrypt-to --recipient "$fpr!" --output "$tmp" --encrypt
[[ -s "$tmp" ]] || { echo 'ENCRYPT_FAILED: empty encrypted package' >&2; exit 4; }
chmod 600 "$tmp"
ln "$tmp" "$target" || { echo 'ENCRYPT_BLOCKED: cannot publish without overwriting' >&2; exit 3; }
echo 'ENCRYPTED_PACKAGE_CREATED: private local output only; source retained.'
echo 'RECOVERY_REQUIRED: verify decryption on an independent trusted machine before copying or retiring plaintext.'
