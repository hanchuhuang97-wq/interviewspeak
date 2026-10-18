"""Vercel Python function: generate a short MP3 with Edge neural TTS.

Environment variables (server-side only):
  SUPABASE_URL       e.g. https://xxxx.supabase.co
  SUPABASE_ANON_KEY  public anon key, used only to validate the caller

The caller must send a teacher Supabase access token. Edge TTS is a free,
unofficial client for Microsoft's read-aloud service; see the README.
"""
from http.server import BaseHTTPRequestHandler
import asyncio
import json
import os
import re
import urllib.error
import urllib.request

import edge_tts

ALLOWED_VOICES = {
    "en-US-AvaMultilingualNeural",
    "en-US-AnaNeural",
    "en-US-EmmaMultilingualNeural",
    "en-US-JennyNeural",
}
MAX_TEXT = 1500


def cors_headers(handler):
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")


def send_json(handler, status, payload):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    cors_headers(handler)
    handler.end_headers()
    handler.wfile.write(body)


def verified_teacher(token):
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    anon = os.environ.get("SUPABASE_ANON_KEY", "")
    if not base or not anon:
        return None, "SUPABASE_URL / SUPABASE_ANON_KEY are not configured on Vercel."
    if not token:
        return None, "Missing teacher login token."
    request = urllib.request.Request(
        base + "/auth/v1/user",
        headers={
            "apikey": anon,
            "Authorization": "Bearer " + token,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            user = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        if error.code in (401, 403):
            return None, "Login token is invalid or expired."
        return None, "Could not verify the teacher login."
    except Exception:
        return None, "Could not reach Supabase to verify the teacher login."
    role = (user.get("app_metadata") or {}).get("role")
    if role != "teacher":
        return None, "This account is not a teacher."
    return user, None


async def _synthesize(text, voice, rate):
    communicate = edge_tts.Communicate(text, voice, rate=rate)
    chunks = []
    async for chunk in communicate.stream():
        if chunk.get("type") == "audio":
            chunks.append(chunk.get("data", b""))
    return b"".join(chunks)


class handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def do_OPTIONS(self):
        self.send_response(204)
        cors_headers(self)
        self.end_headers()

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except Exception:
            return send_json(self, 400, {"error": "Invalid JSON body."})

        token = (self.headers.get("Authorization", "") or "").removeprefix("Bearer ").strip()
        user, error = verified_teacher(token)
        if error:
            status = 401 if "token" in error.lower() or "teacher" in error.lower() else 500
            if "not a teacher" in error:
                status = 403
            return send_json(self, status, {"error": error})

        text = str(body.get("text", "")).strip()
        voice = str(body.get("voice", "")).strip()
        rate = str(body.get("rate", "-8%")).strip()
        if not text or len(text) > MAX_TEXT:
            return send_json(self, 400, {"error": "Text must be 1-1500 characters."})
        if voice not in ALLOWED_VOICES:
            return send_json(self, 400, {"error": "Voice is not allowed."})
        if not re.fullmatch(r"-?\d{1,2}%", rate):
            return send_json(self, 400, {"error": "Rate must look like -8%."})

        try:
            audio = asyncio.run(asyncio.wait_for(_synthesize(text, voice, rate), timeout=45))
        except Exception as exc:
            return send_json(self, 502, {"error": "TTS service failed: " + str(exc)[:200]})
        if not audio:
            return send_json(self, 502, {"error": "TTS returned no audio."})

        self.send_response(200)
        self.send_header("Content-Type", "audio/mpeg")
        self.send_header("Content-Length", str(len(audio)))
        self.send_header("Cache-Control", "no-store")
        cors_headers(self)
        self.end_headers()
        self.wfile.write(audio)
