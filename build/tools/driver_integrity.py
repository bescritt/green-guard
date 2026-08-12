#!/usr/bin/env python3
"""driver_integrity.py — prove the read-only production analytics_driver is untouched.

Tenet 9 (content-hash) applied as a project control: baseline once, verify forever.

  baseline : write .recon/driver_baseline.sha256 (refuses to overwrite)
  verify   : recompute and diff against the baseline; exit 1 on ANY drift
"""
from __future__ import annotations

import hashlib
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # green-guard/
DRIVER = ROOT / "analytics_driver"
BASELINE = ROOT / ".recon" / "driver_baseline.sha256"


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def scan() -> dict[str, str]:
    out: dict[str, str] = {}
    for dirpath, dirnames, filenames in os.walk(DRIVER):
        dirnames.sort()
        for name in sorted(filenames):
            p = Path(dirpath) / name
            if p.is_symlink() or not p.is_file():
                continue
            out[str(p.relative_to(DRIVER))] = sha256_file(p)
    return out


def fmt(d: dict[str, str]) -> str:
    return "".join(f"{h}  {rel}\n" for rel, h in sorted(d.items()))


def load(path: Path) -> dict[str, str]:
    d: dict[str, str] = {}
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        h, rel = line.split("  ", 1)
        d[rel] = h
    return d


def main(argv: list[str]) -> int:
    cmd = argv[1] if len(argv) > 1 else "verify"

    if not DRIVER.is_dir():
        print(f"FAIL driver dir missing: {DRIVER}")
        return 1

    if cmd == "baseline":
        if BASELINE.exists():
            print(f"REFUSE baseline already exists: {BASELINE}")
            print("       (a baseline is written once, before any work)")
            return 1
        cur = scan()
        BASELINE.parent.mkdir(parents=True, exist_ok=True)
        BASELINE.write_text(fmt(cur))
        digest = hashlib.sha256(fmt(cur).encode()).hexdigest()
        print(f"baseline written: {BASELINE}")
        print(f"files={len(cur)} manifest_sha256={digest}")
        return 0

    if cmd == "verify":
        if not BASELINE.exists():
            print(f"FAIL no baseline at {BASELINE} — run: driver_integrity.py baseline")
            return 1
        want, got = load(BASELINE), scan()
        added = sorted(set(got) - set(want))
        removed = sorted(set(want) - set(got))
        changed = sorted(r for r in set(want) & set(got) if want[r] != got[r])
        for r in added:
            print(f"ADDED    {r}")
        for r in removed:
            print(f"REMOVED  {r}")
        for r in changed:
            print(f"CHANGED  {r}")
        if added or removed or changed:
            print(f"FAIL driver drift: +{len(added)} -{len(removed)} ~{len(changed)}")
            return 1
        digest = hashlib.sha256(fmt(got).encode()).hexdigest()
        print(f"OK analytics_driver untouched: {len(got)} files, manifest_sha256={digest}")
        return 0

    print(f"usage: {argv[0]} [baseline|verify]")
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
