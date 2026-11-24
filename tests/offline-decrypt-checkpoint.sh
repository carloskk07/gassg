#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
work="$(mktemp -d)"
trap 'gpgconf --kill all >/dev/null 2>&1 || true; rm -rf "$work"' EXIT
export GNUPGHOME="$work/gnupg"
mkdir -m 700 "$GNUPGHOME" "$work/src" "$work/out"
gpg --no-options --batch --pinentry-mode loopback --passphrase '' --quick-generate-key 'TAMAO recovery fixture <fixture@example.org>' ed25519 cert 1d
primary="$(gpg --no-options --batch --with-colons --list-keys | awk -F: '$1=="fpr"{print $10;exit}')"
gpg --no-options --batch --pinentry-mode loopback --passphrase '' --quick-add-key "$primary" cv25519 encr 1d
encrypt(){ gpg --no-options --batch --yes --trust-model always --recipient "$primary" --output "$2" --encrypt "$1"; }
printf 'synthetic fixture only\n' > "$work/src/fixture.dump"
(cd "$work/src"; sha256sum fixture.dump > fixture.dump.sha256; tar -cf "$work/src/payload.tar" fixture.dump fixture.dump.sha256)
encrypt "$work/src/payload.tar" "$work/src/valid.tar.gpg"
helper=scripts/release-db-decrypt-checkpoint.py
python3 "$helper" "$work/src/valid.tar.gpg" "$work/out/verified"
cmp "$work/src/fixture.dump" "$work/out/verified/fixture.dump"
(cd "$work/out/verified"; sha256sum -c fixture.dump.sha256)
[[ "$(stat -c %a "$work/out/verified")" == 700 && "$(stat -c %a "$work/out/verified/fixture.dump")" == 600 ]]
if python3 "$helper" "$work/src/valid.tar.gpg" "$work/out/verified"; then exit 1; fi
cmp "$work/src/fixture.dump" "$work/out/verified/fixture.dump"
printf 'tampered fixture\n' >> "$work/src/fixture.dump"
(cd "$work/src"; tar -cf "$work/src/bad.tar" fixture.dump fixture.dump.sha256)
encrypt "$work/src/bad.tar" "$work/src/bad.tar.gpg"
if python3 "$helper" "$work/src/bad.tar.gpg" "$work/out/bad"; then exit 1; fi
[[ ! -e "$work/out/bad" ]]
python3 - "$work/src/unsafe.tar" <<'PY'
import io, sys, tarfile
with tarfile.open(sys.argv[1], "w") as tar:
    member = tarfile.TarInfo("../escape.dump")
    member.size = 3
    tar.addfile(member, io.BytesIO(b"bad"))
PY
encrypt "$work/src/unsafe.tar" "$work/src/unsafe.tar.gpg"
if python3 "$helper" "$work/src/unsafe.tar.gpg" "$work/out/unsafe"; then exit 1; fi
[[ ! -e "$work/out/unsafe" && ! -e "$work/out/escape.dump" ]]
head -c 32 "$work/src/valid.tar.gpg" > "$work/src/truncated.tar.gpg"
if python3 "$helper" "$work/src/truncated.tar.gpg" "$work/out/truncated"; then exit 1; fi
[[ ! -e "$work/out/truncated" ]]
echo 'PASS: safe decryption, checksum, restricted permissions, no overwrite, unsafe path and corrupt packages rejected.'
