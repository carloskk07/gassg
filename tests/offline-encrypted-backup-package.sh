#!/usr/bin/env bash
# Synthetic, offline-only. Ephemeral keyring and archive; never production data.
set -Eeuo pipefail
umask 077
work="$(mktemp -d)"
trap 'gpgconf --kill all >/dev/null 2>&1 || true; rm -rf "$work"' EXIT
export GNUPGHOME="$work/gnupg"
mkdir -m 700 "$GNUPGHOME" "$work/src" "$work/dst" "$work/recovered"
gpg --no-options --batch --pinentry-mode loopback --passphrase '' --quick-generate-key 'TAMAO offline CI fixture <fixture@example.org>' ed25519 cert 1d
primary="$(gpg --no-options --batch --with-colons --list-keys | awk -F: '$1=="fpr"{print $10;exit}')"
gpg --no-options --batch --pinentry-mode loopback --passphrase '' --quick-add-key "$primary" cv25519 encr 1d
export TAMAO_BACKUP_RECIPIENT_FPR="$(gpg --no-options --batch --with-colons --list-keys "$primary" | awk -F: '$1=="sub"{subkey=1;next} subkey&&$1=="fpr"{print $10;exit}')"
printf 'synthetic ledger fixture only\n' > "$work/src/fixture.dump"
sha256sum "$work/src/fixture.dump" > "$work/src/fixture.dump.sha256"
helper=scripts/release-db-encrypt-checkpoint.sh
bash "$helper" "$work/src/fixture.dump" "$work/dst/fixture.tar.gpg"
[[ "$(stat -c %a "$work/dst/fixture.tar.gpg")" == 600 ]]
gpg --no-options --batch --decrypt "$work/dst/fixture.tar.gpg" | tar -xf - -C "$work/recovered"
cmp "$work/src/fixture.dump" "$work/recovered/fixture.dump"
cmp "$work/src/fixture.dump.sha256" "$work/recovered/fixture.dump.sha256"
original="$(sha256sum "$work/dst/fixture.tar.gpg")"
if bash "$helper" "$work/src/fixture.dump" "$work/dst/fixture.tar.gpg"; then exit 1; fi
[[ "$(sha256sum "$work/dst/fixture.tar.gpg")" == "$original" ]]
printf 'tampered\n' >> "$work/src/fixture.dump"
if bash "$helper" "$work/src/fixture.dump" "$work/dst/bad.tar.gpg"; then exit 1; fi
[[ ! -e "$work/dst/bad.tar.gpg" ]]
echo 'PASS: offline encryption, exact-key decryption, byte equality, private permissions, no overwrite, corrupt source rejected.'

# Recovery uses a separately recorded ciphertext hash and validates both
# archive members without extracting untrusted paths or permissions.
recover=scripts/release-db-recover-encrypted-checkpoint.py
encrypted="$work/dst/fixture.tar.gpg"
digest="$(sha256sum "$encrypted" | awk '{print $1}')"
python3 "$recover" "$encrypted" "$work/verified" --expected-sha256 "$digest"
cmp "$work/recovered/fixture.dump" "$work/verified/fixture.dump"
(cd "$work/verified" && sha256sum -c fixture.dump.sha256)
[[ "$(stat -c %a "$work/verified")" == 700 ]]
[[ "$(stat -c %a "$work/verified/fixture.dump")" == 600 ]]
if python3 "$recover" "$encrypted" "$work/verified" --expected-sha256 "$digest"; then exit 1; fi
if python3 "$recover" "$encrypted" "$work/wrong-hash" --expected-sha256 "$(printf '%064d' 0)"; then exit 1; fi
[[ ! -e "$work/wrong-hash" ]]
cp "$encrypted" "$work/dst/corrupt.tar.gpg"
truncate -s 100 "$work/dst/corrupt.tar.gpg"
bad_digest="$(sha256sum "$work/dst/corrupt.tar.gpg" | awk '{print $1}')"
if python3 "$recover" "$work/dst/corrupt.tar.gpg" "$work/corrupt" --expected-sha256 "$bad_digest"; then exit 1; fi
[[ ! -e "$work/corrupt" ]]
# Deliberately malicious synthetic tar, encrypted to the valid fixture key.
python3 - "$work/malicious.tar" <<'PY'
import io, sys, tarfile
with tarfile.open(sys.argv[1], "w") as t:
    data = b"synthetic only"
    m = tarfile.TarInfo("../escaped.dump")
    m.size = len(data)
    t.addfile(m, io.BytesIO(data))
PY
gpg --no-options --batch --yes --trust-model always --recipient "$TAMAO_BACKUP_RECIPIENT_FPR!" --output "$work/dst/malicious.tar.gpg" --encrypt "$work/malicious.tar"
bad_digest="$(sha256sum "$work/dst/malicious.tar.gpg" | awk '{print $1}')"
if python3 "$recover" "$work/dst/malicious.tar.gpg" "$work/malicious" --expected-sha256 "$bad_digest"; then exit 1; fi
[[ ! -e "$work/malicious" && ! -e "$work/escaped.dump" ]]
echo 'PASS: safe offline recovery, external digest, byte equality, permissions, no overwrite, corrupted ciphertext and path traversal rejected.'
