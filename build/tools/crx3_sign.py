#!/usr/bin/env python3
"""Standards-compliant CRX3 signer for SafeBrowsing+ (Chromium spec).

Produces a CRX3 a Chromium/Brave browser will load, and that verify_crx3.py
can independently verify. We do NOT rely on the browser's own packer for the
trust anchor — the key is ours and the signature math is the published CRX3
scheme:

    signed_header_data = CrxFileHeader{ sha256_with_rsa = SHA256(zip) }
    signature          = RSA-PKCS1v15(SHA256( signed_header_data || zip ))
    Crx3 { signed_header_data = ..., proofs = [ Proof{ pubkey, signature } ] }

Usage:
    crx3_sign.py --key priv.pem --dir dist/mv3 --out dist/mv3.crx
"""
import sys, os, struct, hashlib, zipfile, io, argparse

from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives import hashes, serialization


# ── protobuf encoding (no schema needed) ─────────────────────────────────────
def _varint(n):
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


def _field(field, wire, value):
    # wire: 0=varint, 2=length-delimited
    tag = (field << 3) | wire
    if wire == 0:
        return _varint(tag) + _varint(value)
    return _varint(tag) + _varint(len(value)) + value


def _message(fields):
    return b"".join(fields)


def build_zip(directory):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _dirs, files in os.walk(directory):
            for fn in sorted(files):
                full = os.path.join(root, fn)
                rel = os.path.relpath(full, directory)
                with open(full, "rb") as f:
                    zf.writestr(rel, f.read())
    return buf.getvalue()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--key", required=True, help="RSA private key (PEM, PKCS8)")
    ap.add_argument("--dir", required=True, help="extension directory to zip")
    ap.add_argument("--out", required=True, help="output .crx path")
    args = ap.parse_args()

    priv = serialization.load_pem_private_key(open(args.key, "rb").read(), password=None)
    if not isinstance(priv, rsa.RSAPrivateKey):
        print("FAIL: key is not RSA"); return 2
    pub_der = priv.public_key().public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo)

    zip_bytes = build_zip(args.dir)
    zip_sha = hashlib.sha256(zip_bytes).digest()

    # CrxFileHeader: field 1 = sha256_with_rsa
    crx_file_header = _field(1, 2, zip_sha)
    # Crx3.signed_header_data (field 10000)
    signed_header_data = _field(10000, 2, crx_file_header)

    # Sign  crx_file_header || zip  (the bytes field 10000 *contains*)
    to_sign = crx_file_header + zip_bytes
    signature = priv.sign(to_sign, padding.PKCS1v15(), hashes.SHA256())

    # Proof: field 1 = pubkey, field 2 = signature
    proof = _field(1, 2, pub_der) + _field(2, 2, signature)
    # Crx3: field 10000 = signed_header_data, field 2 = proof
    crx3 = signed_header_data + _field(2, 2, proof)

    out = b"Cr24" + struct.pack("<I", 3) + struct.pack("<I", len(crx3)) + crx3 + zip_bytes
    open(args.out, "wb").write(out)
    print(f"wrote {args.out} ({len(out)} bytes, zip {len(zip_bytes)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
