# api/rota.py
import json
import hashlib

def _read_bytes_from_request(request):
    """
    Prefer raw bytes (application/octet-stream). Fallback to multipart 'file'.
    Works across Vercel Python runtimes.
    """
    x = None
    if hasattr(request, "get_data"):
        x = request.get_data()
    if not x and hasattr(request, "body"):
        x = request.body
    if (not x) and hasattr(request, "files"):
        f = request.files.get("file")
        if f:
            x = f.read()
    return x

def handler(request):
    try:
        data = _read_bytes_from_request(request)
        if not data:
            return {
                "statusCode": 400,
                "headers": {"Content-Type": "application/json"},
                "body": json.dumps({
                    "ok": False,
                    "error": "No bytes received. Send the file as application/octet-stream or multipart under 'file'."
                })
            }

        size = len(data)
        md5 = hashlib.md5(data).hexdigest()

        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"ok": True, "bytes": size, "md5": md5})
        }
    except Exception as e:
        return {
            "statusCode": 500,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"ok": False, "error": str(e)})
        }

