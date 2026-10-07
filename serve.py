# Windows WSGI runner (waitress) สำหรับ NITED ai-voiceclone — localhost-only แบบ ai-tts
import os
from waitress import serve
from app import app

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5460"))
    print(f"ai-voiceclone (waitress) serving on 127.0.0.1:{port}", flush=True)
    serve(app, host="127.0.0.1", port=port, threads=8)
