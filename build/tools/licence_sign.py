#!/usr/bin/env python3
"""Offline Ed25519 licence signer/verifier for SafeBrowsing+ premium (§8.2).

A licence is a small JSON claim signed with the project's Ed25519 private key.
No network, no store account. The extension verifies the signature locally
before unlocking premium (summary, advanced rules).

  sign:   licence_sign.py sign --key priv.pem --user <id> --days <n> [--out licence.json]
  verify: licence_sign.py verify --key pub.pem --licence licence.json

Key generation (one-time, keep priv.pem secret):
  openssl genpkey -algorithm ed25519 -out priv.pem
  openssl pkey -in priv.pem -pubout -out pub.pem
"""
import sys, json, base64, argparse, time, hashlib

try:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
    from cryptography.hazmat.primitives import serialization
    HAVE = True
except ImportError:
    HAVE = False


def _b64(b): return base64.urlsafe_b64encode(b).rstrip(b"=")


def _load_priv(path):
    return serialization.load_pem_private_key(open(path, "rb").read(), password=None)


def _load_pub(path):
    return serialization.load_pem_public_key(open(path, "rb").read())


def sign(priv_key, user, days, meta=None):
    issued = int(time.time())
    expires = issued + int(days) * 86400
    claim = {
        "v": 1,
        "user": user,
        "issued": issued,
        "expires": expires,
        "meta": meta or {},
    }
    payload = json.dumps(claim, separators=(",", ":")).encode()
    sig = priv_key.sign(payload)
    return {
        "alg": "Ed25519",
        "claim": claim,
        "sig": _b64(sig).decode(),
    }


def verify(pub_key, licence):
    claim = licence.get("claim", {})
    sig = base64.urlsafe_b64decode(licence["sig"] + "===")
    payload = json.dumps(claim, separators=(",", ":")).encode()
    try:
        pub_key.verify(sig, payload)
    except Exception:
        return False, "signature invalid"
    if claim.get("expires", 0) < int(time.time()):
        return False, "licence expired"
    return True, "valid"


def main():
    if not HAVE:
        print("cryptography not available"); return 2
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("sign"); s.add_argument("--key", required=True); s.add_argument("--user", required=True); s.add_argument("--days", type=int, default=365); s.add_argument("--meta", default="{}"); s.add_argument("--out")
    v = sub.add_parser("verify"); v.add_argument("--key", required=True); v.add_argument("--licence", required=True)
    args = ap.parse_args()
    if args.cmd == "sign":
        lic = sign(_load_priv(args.key), args.user, args.days, json.loads(args.meta))
        out = args.out or "licence.json"
        open(out, "w").write(json.dumps(lic, indent=2))
        print(f"wrote {out} (expires in {args.days}d)")
        return 0
    else:
        lic = json.load(open(args.licence))
        ok, msg = verify(_load_pub(args.key), lic)
        print(("OK " if ok else "FAIL ") + msg)
        return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
