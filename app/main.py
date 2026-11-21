"""Aceify server. The HAC password is used once to log in to HAC and is NEVER stored or logged.
Only HAC session cookies are held in memory (30 min idle timeout). Nothing is written to disk."""
import hashlib
import os
import secrets
import time
from pathlib import Path

from fastapi import Cookie, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .hac import DISTRICTS, HacClient, HacError

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
IDLE_TTL = 30 * 60
MAX_SESSIONS = 300
MAX_ACCOUNTS = 4
SESSIONS = {}        # token -> {"accounts": {aid: {"client","label"}}, "active": aid, "seen": ts}
FAILS = {}           # throttle key -> [timestamps]
COOKIE = "aceify_session"

app = FastAPI(title="Aceify", docs_url=None, redoc_url=None)


def _purge():
    now = time.time()
    for t in [t for t, s in SESSIONS.items() if now - s["seen"] > IDLE_TTL]:
        for a in SESSIONS.pop(t)["accounts"].values():
            a["client"].close()


def _session(token):
    _purge()
    s = SESSIONS.get(token or "")
    if not s or not s["accounts"]:
        raise HTTPException(401, "Not signed in")
    s["seen"] = time.time()
    return s


def _client(token):
    s = _session(token)
    acct = s["accounts"].get(s["active"]) or next(iter(s["accounts"].values()))
    return acct["client"]


class LoginBody(BaseModel):
    district: str = "frisco"
    username: str
    password: str


class IdBody(BaseModel):
    id: str


@app.middleware("http")
async def guard(request: Request, call_next):
    if request.method == "POST" and request.headers.get("x-aceify") != "1":
        return Response("Forbidden", status_code=403)
    resp = await call_next(request)
    resp.headers["Cache-Control"] = "no-store" if request.url.path.startswith("/api") else "no-cache"
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "no-referrer"
    resp.headers["Content-Security-Policy"] = (
        "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'")
    return resp


def _is_https(request):
    """True when this request reached us over HTTPS - directly, or via a reverse proxy (Render, etc.)
    that terminates TLS and forwards the original scheme in X-Forwarded-Proto."""
    return request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https" or os.environ.get("ACEIFY_HTTPS") == "1"


def _throttled(key):
    now = time.time()
    FAILS[key] = [t for t in FAILS.get(key, []) if now - t < 600]
    return len(FAILS[key]) >= 5


def _info(s):
    return {"active": s["active"],
            "accounts": [{"id": k, "name": v["label"], "district": v["district"]} for k, v in s["accounts"].items()]}


@app.get("/api/districts")
def districts():
    return [{"id": k, "name": v["name"]} for k, v in DISTRICTS.items()]


@app.post("/api/login")
def login(body: LoginBody, request: Request, response: Response, aceify_session: str = Cookie(None)):
    ip = request.client.host if request.client else "?"
    ukey = "u:" + hashlib.sha256(body.username.strip().lower().encode()).hexdigest()
    if _throttled("ip:" + ip) or _throttled(ukey):
        raise HTTPException(429, "Too many failed attempts. Wait 10 minutes (this keeps your HAC account from being locked).")
    if len(SESSIONS) >= MAX_SESSIONS and aceify_session not in SESSIONS:
        raise HTTPException(503, "Server is busy, try again soon.")
    client = None
    try:
        client = HacClient(body.district)
        client.login(body.username.strip(), body.password)
    except HacError as e:
        for k in ("ip:" + ip, ukey):
            FAILS.setdefault(k, []).append(time.time())
        if client:
            client.close()
        raise HTTPException(401, str(e))
    except Exception:
        if client:
            client.close()
        raise HTTPException(502, "Could not reach HAC right now.")
    s = SESSIONS.get(aceify_session or "")
    if not s:
        token = secrets.token_urlsafe(32)
        s = SESSIONS[token] = {"accounts": {}, "active": None, "seen": time.time()}
        response.set_cookie(COOKIE, token, httponly=True, samesite="strict", max_age=IDLE_TTL,
                            secure=_is_https(request))
    if len(s["accounts"]) >= MAX_ACCOUNTS:
        client.close()
        raise HTTPException(400, f"You can have up to {MAX_ACCOUNTS} accounts signed in.")
    aid = secrets.token_hex(4)
    s["accounts"][aid] = {"client": client, "label": client.name or "Student", "district": body.district}
    s["active"] = aid
    s["seen"] = time.time()
    return _info(s)


@app.get("/api/me")
def me(aceify_session: str = Cookie(None)):
    return _info(_session(aceify_session))


@app.post("/api/switch")
def switch(body: IdBody, aceify_session: str = Cookie(None)):
    s = _session(aceify_session)
    if body.id not in s["accounts"]:
        raise HTTPException(404, "No such account")
    s["active"] = body.id
    return _info(s)


@app.post("/api/remove")
def remove(body: IdBody, response: Response, aceify_session: str = Cookie(None)):
    s = _session(aceify_session)
    a = s["accounts"].pop(body.id, None)
    if a:
        a["client"].close()
    if not s["accounts"]:
        SESSIONS.pop(aceify_session, None)
        response.delete_cookie(COOKIE)
        return {"accounts": [], "active": None}
    if s["active"] not in s["accounts"]:
        s["active"] = next(iter(s["accounts"]))
    return _info(s)


@app.post("/api/logout")
def logout(response: Response, aceify_session: str = Cookie(None)):
    s = SESSIONS.pop(aceify_session or "", None)
    for a in (s["accounts"].values() if s else []):
        a["client"].close()
    response.delete_cookie(COOKIE)
    return {"ok": True}


@app.post("/api/refresh")
def refresh(aceify_session: str = Cookie(None)):
    _client(aceify_session).refresh()
    return {"ok": True}


def _guard(fn):
    try:
        return fn()
    except HacError as e:
        raise HTTPException(401, str(e))
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(502, "HAC returned something unexpected. Try Refresh in a moment.")


def _route(path, name):
    def handler(aceify_session: str = Cookie(None)):
        c = _client(aceify_session)
        return _guard(lambda: getattr(c, name)())
    handler.__name__ = "api_" + name
    app.get(path)(handler)


for _p, _n in (("/api/all", "all_quarters"), ("/api/classes", "classes"), ("/api/reportcard", "report_card"),
               ("/api/ipr", "ipr"), ("/api/transcript", "transcript"), ("/api/registration", "registration"),
               ("/api/careerplan", "career_plan"), ("/api/requests", "course_requests")):
    _route(_p, _n)


@app.get("/")
def index():
    return FileResponse(FRONTEND / "index.html")


@app.get("/sw.js")
def sw():
    return FileResponse(FRONTEND / "sw.js", media_type="application/javascript")


@app.get("/manifest.webmanifest")
def manifest():
    return FileResponse(FRONTEND / "manifest.webmanifest", media_type="application/manifest+json")


app.mount("/static", StaticFiles(directory=FRONTEND), name="static")
