"""Vercel Python function: generate a short audio clip for the teacher editor.

Provider order (first configured wins):
  GEMINI_API_KEY   Gemini TTS via the Interactions API
  OPENAI_API_KEY   OpenAI speech API
  Edge TTS         free fallback; works locally, but Microsoft often blocks
                   datacenter IPs such as Vercel's. Cloud deployments should
                   set GEMINI_API_KEY or OPENAI_API_KEY.

Required for every request:
  SUPABASE_URL, SUPABASE_ANON_KEY  (used only to verify the teacher JWT)
"""
from http.server import BaseHTTPRequestHandler
import asyncio
import base64
import json
import os
import re
import urllib.error
import urllib.request

try:
    import edge_tts
except Exception:
    edge_tts = None

ALLOWED_VOICES = {
    "en-US-AvaMultilingualNeural",
    "en-US-AnaNeural",
    "en-US-EmmaMultilingualNeural",
    "en-US-JennyNeural",
}
MAX_TEXT = 1500

GEMINI_VOICE = {
    "en-US-AvaMultilingualNeural": "Kore",
    "en-US-AnaNeural": "Leda",
    "en-US-EmmaMultilingualNeural": "Aoede",
    "en-US-JennyNeural": "Kore",
}


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
        headers={"apikey": anon, "Authorization": "Bearer " + token},
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


def _post_json(url, headers, payload, timeout=45):
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read(), response.headers.get("Content-Type", "")


def gemini_tts(text, voice, rate):
    key = os.environ.get("GEMINI_API_KEY", "")
    if not key:
        raise RuntimeError("GEMINI_API_KEY is not configured.")
    model = os.environ.get("GEMINI_TTS_MODEL", "gemini-3.8-flash-tts")
    slow = str(rate).startswith(("-2", "-3", "-4"))
    style = "slowly, clearly, warmly, for a five-year-old" if slow else "warm, friendly, cheerful, for a five-year-old"
    payload = {
        "model": model,
        "input": [{
            "type": "user_input",
            "content": [{
                "type": "text",
                "text": text,
                "annotations": [{"type": "speech_metadata", "style": style}],
            }],
        }],
        "response_format": {"type": "audio"},
        "generation_config": {
            "speech_config": [{"voice": GEMINI_VOICE.get(voice, "Kore")}]
        },
    }
    raw, _ = _post_json(
        "https://generativelanguage.googleapis.com/v1beta/interactions",
        {"Content-Type": "application/json", "x-goog-api-key": key},
        payload,
    )
    data = json.loads(raw.decode("utf-8"))
    blocks = []
    for step in data.get("steps", []):
        if step.get("type") != "model_output":
            continue
        for content in step.get("content", []):
            if content.get("type") == "audio" and content.get("data"):
                blocks.append(content)
    if not blocks:
        raise RuntimeError("Gemini TTS returned no audio. Check model access and quota.")
    block = blocks[-1]
    audio = base64.b64decode(block["data"])
    mime = block.get("mime_type") or "audio/wav"
    return audio, mime


def openai_tts(text, voice, rate):
    key = os.environ.get("OPENAI_API_KEY", "")
    if not key:
        raise RuntimeError("OPENAI_API_KEY is not configured.")
    model = os.environ.get("OPENAI_TTS_MODEL", "gpt-4o-mini-tts")
    voice_name = os.environ.get("OPENAI_TTS_VOICE", "coral")
    instructions = "Speak warmly and clearly for a five-year-old child."
    if str(rate).startswith(("-2", "-3", "-4")):
        instructions += " Speak slowly and clearly."
    payload = {
        "model": model,
        "voice": voice_name,
        "input": text,
        "instructions": instructions,
        "response_format": "mp3",
    }
    audio, _ = _post_json(
        "https://api.openai.com/v1/audio/speech",
        {"Content-Type": "application/json", "Authorization": "Bearer " + key},
        payload,
        timeout=45,
    )
    if not audio:
        raise RuntimeError("OpenAI TTS returned no audio.")
    return audio, "audio/mpeg"


async def _edge_synthesize(text, voice, rate):
    if edge_tts is None:
        raise RuntimeError("edge-tts is not installed.")
    communicate = edge_tts.Communicate(text, voice, rate=rate)
    chunks = []
    async for chunk in communicate.stream():
        if chunk.get("type") == "audio":
            chunks.append(chunk.get("data", b""))
    audio = b"".join(chunks)
    if not audio:
        raise RuntimeError("Edge TTS returned no audio.")
    return audio


def edge_tts_sync(text, voice, rate):
    audio = asyncio.run(asyncio.wait_for(_edge_synthesize(text, voice, rate), timeout=35))
    return audio, "audio/mpeg"


def synthesize(text, voice, rate):
    errors = []
    forced = os.environ.get("TTS_PROVIDER", "").strip().lower()
    if forced == "gemini":
        providers = [gemini_tts]
    elif forced == "openai":
        providers = [openai_tts]
    elif forced == "edge":
        providers = [edge_tts_sync]
    else:
        providers = []
        if os.environ.get("GEMINI_API_KEY"):
            providers.append(gemini_tts)
        if os.environ.get("OPENAI_API_KEY"):
            providers.append(openai_tts)
        providers.append(edge_tts_sync)

    for provider in providers:
        try:
            return provider(text, voice, rate)
        except Exception as error:
            errors.append(f"{provider.__name__}: {error}")
    raise RuntimeError(
        "All TTS providers failed. " + " | ".join(errors) +
        " Cloud hosts should configure GEMINI_API_KEY or OPENAI_API_KEY; "
        "Edge TTS is often blocked on Vercel."
    )


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
            status = 401 if "token" in error.lower() else 500
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
            audio, mime = synthesize(text, voice, rate)
        except Exception as exc:
            return send_json(self, 502, {"error": "TTS service failed: " + str(exc)[:500]})
        if not audio:
            return send_json(self, 502, {"error": "TTS returned no audio."})

        self.send_response(200)
        self.send_header("Content-Type", mime or "audio/mpeg")
        self.send_header("Content-Length", str(len(audio)))
        self.send_header("Cache-Control", "no-store")
        cors_headers(self)
        self.end_headers()
        self.wfile.write(audio)
