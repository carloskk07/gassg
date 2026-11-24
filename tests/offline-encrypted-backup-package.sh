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
