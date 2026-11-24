#!/usr/bin/env python3
"""Offline unpacking of a TAMÃO encrypted checkpoint; no database access."""
import hashlib
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile

def require(ok, message):
    if not ok:
        raise ValueError(message)

def private_dir(path, repo):
    require(not path.is_symlink(), "symlink directory refused")
    path = path.resolve(strict=True)
    require(path.is_dir() and not path.is_relative_to(repo), "private directory outside repository required")
    require(stat.S_IMODE(path.stat().st_mode) & 0o077 == 0, "directory must deny group/other access")
    return path

def recover(package, output):
    os.umask(0o077)
    repo = Path(__file__).resolve().parent.parent
    require(package.is_file() and not package.is_symlink(), "regular encrypted package required")
    require(package.name.endswith(".tar.gpg"), "invalid package extension")
    private_dir(package.parent, repo)
    parent = private_dir(output.parent, repo)
    require(output.name not in ("", ".", ".."), "new destination name required")
    target = parent / output.name
    require(not os.path.lexists(target), "destination already exists")
    with tempfile.TemporaryDirectory(prefix=".tamao-recovery-", dir=parent) as temp:
        work = Path(temp)
        archive = work / "payload.tar"
        result = subprocess.run(
            ["gpg", "--no-options", "--batch", "--no-tty", "--no-auto-key-retrieve",
             "--output", str(archive), "--decrypt", str(package.resolve())],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False
        )
        require(result.returncode == 0 and archive.is_file(), "decryption or integrity verification failed")
        # Never extract arbitrary tar paths, symlinks, hardlinks or metadata.
        with tarfile.open(archive, mode="r:") as bundle:
            members = []
            for member in bundle:
                require(len(members) < 2, "unexpected extra member")
                require(member.isfile() and not member.issparse(), "nonregular archive member")
                require(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*\.dump(?:\.sha256)?", member.name),
                        "unsafe archive member name")
                members.append(member)
            require(len(members) == 2, "exactly two archive members required")
            by_name = {member.name: member for member in members}
            dump_names = [name for name in by_name if name.endswith(".dump")]
            require(len(dump_names) == 1, "exactly one dump required")
            name = dump_names[0]
            require(set(by_name) == {name, name + ".sha256"}, "checksum member missing or mismatched")
            require(by_name[name].size > 0 and 0 < by_name[name + ".sha256"].size <= 4096, "invalid member size")
            with bundle.extractfile(by_name[name + ".sha256"]) as handle:
                fields = handle.read().split()
            require(bool(fields) and re.fullmatch(rb"[a-fA-F0-9]{64}", fields[0]), "invalid checksum")
            digest = hashlib.sha256()
            staged = work / name
            with bundle.extractfile(by_name[name]) as source, staged.open("xb") as dest:
                while chunk := source.read(1024 * 1024):
                    digest.update(chunk)
                    dest.write(chunk)
            require(digest.hexdigest().encode() == fields[0].lower(), "dump checksum mismatch")
            sidecar = work / (name + ".sha256")
            sidecar.write_text(digest.hexdigest() + "  " + name + "\n", encoding="ascii")
        # Create fresh destination exclusively, only after all checks pass.
        target.mkdir(mode=0o700)
        try:
            os.link(staged, target / name)
            os.link(sidecar, target / sidecar.name)
        except BaseException:
            shutil.rmtree(target)
            raise
    print("RECOVERY_PACKAGE_VERIFIED: decrypted dump and SHA-256 in new private directory")
    print("NEXT: validate archive with pg_restore and restore only to a fresh isolated database.")
    print("BOUNDARY: successful decryption is not proof of source identity or production recovery.")

if __name__ == "__main__":
    try:
        require(len(sys.argv) == 3, "usage: python3 script <private.tar.gpg> <new-private-directory>")
        recover(Path(sys.argv[1]), Path(sys.argv[2]))
    except (ValueError, OSError, tarfile.TarError, subprocess.SubprocessError) as exc:
        print("RECOVERY_BLOCKED:", str(exc), file=sys.stderr)
        sys.exit(3)
