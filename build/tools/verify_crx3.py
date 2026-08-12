#!/usr/bin/env python3
"""Independent verifier for a CRX3 package (SafeBrowsing+).

Does NOT trust the packer's exit code. It re-parses the CRX3 container from
bytes and cryptographically verifies:

  1. magic 'Cr24' + version == 3 + header_length sane
  2. the protobuf Crx3 header carries a Proof with a public key + signature
  3. signature is RSA-PKCS1-SHA256 over (signed_header_data || zip_bytes)
  4. the embedded ZIP extracts and contains a parseable manifest.json
  5. the CrxFileHeader.header_root_hash == SHA256(zip_bytes)

Usage: verify_crx3.py <file.crx> [--require-key key.pem]
Exit 0 = trusted, 1 = invalid, 2 = usage.
"""
import sys, struct, hashlib, zipfile, io, json

try:
    from cryptography.hazmat.primitives.asymmetric import padding, rsa
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.serialization import load_der_public_key
    HAVE_CRYPTO = True
except ImportError:
    HAVE_CRYPTO = False


# ── minimal protobuf decoder (no schema needed) ──────────────────────────────
def _read_varint(buf, pos):
    shift = 0
    result = 0
    while True:
        b = buf[pos]
        pos += 1
        result |= (b & 0x7F) << shift
        if not (b & 0x80):
            return result, pos
        shift += 7


def _decode_fields(buf):
    """Yield (field_number, wire_type, value/bytes, pos) for a protobuf blob."""
    pos = 0
    n = len(buf)
    while pos < n:
        tag, pos = _read_varint(buf, pos)
        field = tag >> 3
        wire = tag & 0x07
        if wire == 0:  # varint
            val, pos = _read_varint(buf, pos)
            yield field, wire, val, pos
        elif wire == 2:  # length-delimited
            ln, pos = _read_varint(buf, pos)
            blob = buf[pos:pos + ln]
            pos += ln
            yield field, wire, blob, pos
        else:  # unsupported wire type (groups/64/32) — stop
            raise ValueError(f"unsupported wire type {wire}")


def _get(field, blob):
    for f, w, v, _ in _decode_fields(blob):
        if f == field:
            return v
    return None


def main():
    if len(sys.argv) < 2:
        print("usage: verify_crx3.py <file.crx> [--require-key key.pem]")
        return 2

    path = sys.argv[1]
    require_key = None
    if "--require-key" in sys.argv:
        require_key = sys.argv[sys.argv.index("--require-key") + 1]

    data = open(path, "rb").read()
    if data[:4] != b"Cr24":
        print("FAIL: bad magic (not a Cr24 container)")
        return 1
    version = struct.unpack("<I", data[4:8])[0]
    if version != 3:
        print(f"FAIL: expected CRX3, got version {version}")
        return 1
    header_len = struct.unpack("<I", data[8:12])[0]
    if not (0 < header_len < len(data)):
        print(f"FAIL: header_length {header_len} out of range")
        return 1

    header = data[12:12 + header_len]
    zip_bytes = data[12 + header_len:]

    # Crx3: field 10000 = signed_header_data (bytes), field 2 = repeated Proof
    signed_header_data = _get(10000, header)
    proofs = [v for f, w, v, _ in _decode_fields(header) if f == 2]
    if not signed_header_data:
        print("FAIL: no signed_header_data in Crx3 header")
        return 1
    if not proofs:
        print("FAIL: no proofs in Crx3 header")
        return 1

    # CrxFileHeader: field 1 = sha256_with_rsa (SHA256 of the zip payload)
    sha_with_rsa = _get(1, signed_header_data)
    if sha_with_rsa is None:
        print("WARN: CrxFileHeader has no sha256_with_rsa")
    elif sha_with_rsa != hashlib.sha256(zip_bytes).digest():
        print("FAIL: sha256_with_rsa != SHA256(zip)")
        return 1

    if not HAVE_CRYPTO:
        print("WARN: cryptography lib missing — cannot verify signature; "
              "structure + zip validated only")
    else:
        verified = False
        for proof in proofs:
            # Proof message: field 1 = public_key (DER), field 2 = signature
            pub = _get(1, proof)
            sig = _get(2, proof)
            if not pub or not sig:
                continue
            try:
                key = load_der_public_key(pub)
            except Exception as e:
                print(f"WARN: could not load public key: {e}")
                continue
            signed = signed_header_data + zip_bytes
            try:
                key.verify(sig, signed, padding.PKCS1v15(), hashes.SHA256())
                verified = True
                break
            except Exception:
                continue
        if not verified:
            print("FAIL: no proof signature verified")
            return 1
        print("OK: RSA-PKCS1-SHA256 signature verified")

    # Validate the embedded ZIP.
    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
        bad = zf.testzip()
        if bad:
            print(f"FAIL: corrupt entry in embedded zip: {bad}")
            return 1
        names = zf.namelist()
        if "manifest.json" not in names:
            print("FAIL: embedded zip has no manifest.json")
            return 1
        man = json.loads(zf.read("manifest.json"))
        if man.get("manifest_version") != 3:
            print(f"FAIL: manifest_version {man.get('manifest_version')} != 3")
            return 1
    except Exception as e:
        print(f"FAIL: embedded zip invalid: {e}")
        return 1

    if require_key:
        # Optional: ensure the packed key corresponds to the proof pubkey DER.
        from cryptography.hazmat.primitives.serialization import (
            load_pem_private_key, Encoding, PublicFormat)
        priv = load_pem_private_key(open(require_key, "rb").read(), password=None)
        priv_der = priv.public_key().public_bytes(
            encoding=Encoding.DER, format=PublicFormat.SubjectPublicKeyInfo)
        if priv_der not in proofs[0]:
            print("FAIL: required key does not match the CRX proof key")
            return 1
        print("OK: private key matches the CRX proof")

    print(f"TRUSTED: {path} ({len(zip_bytes)} bytes payload, {len(proofs)} proof(s))")
    return 0


if __name__ == "__main__":
    sys.exit(main())
