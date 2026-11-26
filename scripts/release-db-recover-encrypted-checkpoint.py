#!/usr/bin/env python3
"""Offline recovery of a TAMÃO encrypted checkpoint; never connects to PostgreSQL."""
import argparse
import hashlib
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tarfile
import tempfile

REPO = Path(__file__).resolve().parent.parent
DIGEST = re.compile(r"[a-fA-F0-9]{64}")
DUMP = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*\.dump")


def require_private_dir(path):
    if path.is_symlink():
        raise ValueError("symlink directory")
    resolved = path.resolve(strict=True)
    if resolved == REPO or REPO in resolved.parents:
        raise ValueError("directory inside repository")
    if not resolved.is_dir() or resolved.stat().st_mode & 0o077:
        raise ValueError("private directory required (0700)")
    return resolved


def digest_file(file):
    digest = hashlib.sha256()
    for block in iter(lambda: file.read(1024 * 1024), b""):
        digest.update(block)
    return digest.hexdigest()


def recover(package, destination, expected):
    if not DIGEST.fullmatch(expected):
        raise ValueError("expected external SHA-256 required")
    if not package.name.endswith(".tar.gpg") or package.is_symlink():
        raise ValueError("expected regular encrypted package")
    source = require_private_dir(package.parent) / package.name
    parent = require_private_dir(destination.parent)
    target = parent / destination.name
    if target.exists() or target.is_symlink():
        raise ValueError("destination already exists")
    with tempfile.TemporaryDirectory(prefix=".tamao-recovery-", dir=parent) as staging:
        work = Path(staging)
        tar_path = work / "verified.tar"
        # No plaintext extraction before the entire ciphertext digest and GPG
        # integrity checks pass. Read the same opened file for both operations.
        with source.open("rb") as encrypted:
            if not stat.S_ISREG(os.fstat(encrypted.fileno()).st_mode):
                raise ValueError("package is not a regular file")
            if digest_file(encrypted) != expected.lower():
                raise ValueError("encrypted package checksum mismatch")
            encrypted.seek(0)
            result = subprocess.run(
                ["gpg", "--no-options", "--batch", "--no-tty", "--output",
                 str(tar_path), "--decrypt"],
                stdin=encrypted, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                check=False)
            if result.returncode != 0:
                raise ValueError("decryption or GPG integrity check failed")
        with tarfile.open(tar_path, "r:") as archive:
            members = []
            for member in archive:
                if (len(members) >= 2 or not member.isfile() or
                    member.type not in (tarfile.REGTYPE, tarfile.AREGTYPE) or
                    member.name != Path(member.name).name or member.size <= 0):
                    raise ValueError("unexpected archive entry")
                members.append(member)
            names = {m.name: m for m in members}
            dumps = [m for m in members if DUMP.fullmatch(m.name)]
            if len(members) != 2 or len(names) != 2 or len(dumps) != 1:
                raise ValueError("expected one dump and its checksum")
            dump = dumps[0]
            checksum = names.get(dump.name + ".sha256")
            if checksum is None or checksum.size > 4096:
                raise ValueError("missing or invalid checksum")
            with archive.extractfile(checksum) as handle:
                raw = handle.read(4097)
            words = raw.split()
            if not words or not DIGEST.fullmatch(words[0].decode("ascii")):
                raise ValueError("invalid dump checksum")
            with archive.extractfile(dump) as inp, (work / dump.name).open("xb") as out:
                shutil.copyfileobj(inp, out, length=1024 * 1024)
            with (work / dump.name).open("rb") as inp:
                actual = digest_file(inp)
            if actual != words[0].decode("ascii").lower():
                raise ValueError("recovered dump checksum mismatch")
            # Normalize the filename rather than trusting the archived path.
            (work / checksum.name).write_text(actual + "  " + dump.name + "\n", encoding="ascii")
        # Publish only after verification; no overwrite and no extraction of
        # archive-controlled paths or permissions.
        target.mkdir(mode=0o700)
        try:
            for name in (dump.name, checksum.name):
                os.link(work / name, target / name)
        except BaseException:
            for name in (dump.name, checksum.name):
                (target / name).unlink(missing_ok=True)
            target.rmdir()
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", type=Path)
    parser.add_argument("new_private_directory", type=Path)
    parser.add_argument("--expected-sha256", required=True,
                        help="ciphertext SHA-256 from a separately trusted record")
    args = parser.parse_args()
    os.umask(0o077)
    try:
        recover(args.package, args.new_private_directory, args.expected_sha256)
    except (ValueError, OSError, UnicodeError, tarfile.TarError) as exc:
        # Never log archive names, plaintext or provider credentials.
        print("RECOVERY_BLOCKED: package, key, private destination or integrity verification failed.")
        return 3
    print("RECOVERED_CHECKPOINT_INTEGRITY_OK: local files only; no database restored.")
    print("NEXT: verify isolated database restoration and application invariants.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
