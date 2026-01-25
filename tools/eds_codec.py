# eds_codec.py
import base64, zlib, json

EDS_HEADER = "EDS0040000"
TXT_HEADER = "TXT0040000"

def eds_to_json(path):
    raw = open(path, "r", encoding="utf-8").read().strip()
    if raw.startswith(EDS_HEADER):
        # Compressed format
        b64 = raw[len(EDS_HEADER):]
        data = base64.b64decode(b64 + "=" * (-len(b64) % 4))
        return json.loads(zlib.decompress(data))
    elif raw.startswith(TXT_HEADER):
        # Uncompressed format
        return json.loads(raw[len(TXT_HEADER):])

def json_to_eds(obj, path):
    payload = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    comp = zlib.compress(payload)
    b64 = base64.b64encode(comp).decode("ascii")
    open(path, "w", encoding="utf-8").write(EDS_HEADER + b64)