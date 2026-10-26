"""Higgsfield 구독 계정의 OAuth·MCP 연결. [유진]

로그인은 브라우저별로 분리하고 토큰은 서버 메모리에만 둡니다. 서버를 재시작하면 다시 연결해야 합니다.
shortcut: 단일 서버 프로세스 전용입니다. 여러 프로세스로 배포할 때 PM1과 암호화된 세션 저장소를 정합니다.
"""
import base64
import hashlib
import ipaddress
import json
import mimetypes
import os
import re
import secrets
import socket
import threading
import time
import uuid
from decimal import Decimal, InvalidOperation
from functools import wraps
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from flask import has_request_context, request

from .videos import COMMON_AVOID, FOOD_AVOID, PRODUCT_EN, PRODUCT_LOOK, STYLES, _action, _shot, scene_kind

# 결정 사항 (README 10장, 2026-10-24 유진)
VIDEO_MODEL = "Kling 4.0"            # MCP 카탈로그의 표시 이름으로 실제 ID를 조회합니다.
VIDEO_RESOLUTION = "720p"
IMAGE_MODEL = "Nano Banana 2"
# 예산이 확정될 때까지, 프런트 설정과 관계없이 서버에서도 유료 제출을 막습니다.
GENERATION_ENABLED = False
DAILY_LIMIT = None
LOCK_REASON = "생성 예산을 정하기 전까지 실제 만들기는 잠겨 있어요. 연결과 편집은 할 수 있어요."
PROVIDER = "higgsfield_mcp"
COOKIE_NAME = "studio_hf_session"
MCP_URL = "https://mcp.higgsfield.ai/mcp"
ISSUER = "https://clerk.higgsfield.ai"
SESSION_TTL = 24 * 60 * 60
LOGIN_TTL = 10 * 60
_sessions = {}
_sessions_lock = threading.RLock()
DESIGN_LOCK = threading.RLock()


def serialized_design(function):
    @wraps(function)
    def wrapped(*args, **kwargs):
        with DESIGN_LOCK:
            return function(*args, **kwargs)
    return wrapped

DONE, FAILED = "completed", ("failed", "nsfw", "canceled", "cancelled")
KLING_IMAGES = 10                   # Kling 4.0: 첫·끝 장면 포함 이미지 10장까지
IMAGE_REFS = 10                     # 미리보기 이미지 참고 사진 (Nano Banana 2, 넉넉히 같은 수로)
IMAGE_RATIOS = {ratio: ratio for ratio in ("9:16", "16:9", "1:1", "4:5")}


class HiggsfieldError(Exception):
    """외부 응답·인증 값은 메시지에 포함하지 않습니다."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # 인증 헤더가 다른 서버로 전달되거나 파일 주소가 내부망으로 바뀌지 않게 합니다.
        return None


def _http(url, payload=None, headers=None, form=False):
    headers = {"User-Agent": "Hanjeongseon-Content-Studio/1.0", **(headers or {})}
    data = None
    if payload is not None:
        data = urlencode(payload).encode() if form else json.dumps(payload).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded" if form else "application/json"
    try:
        with build_opener(_NoRedirect()).open(Request(url, data=data, headers=headers), timeout=30) as response:
            raw = response.read(2_000_001)
            if len(raw) > 2_000_000:
                raise ValueError("response size")
            return raw.decode("utf-8"), dict(response.headers)
    except HTTPError as error:
        code = "login" if error.code in (401, 403) else "failed"
        raise HiggsfieldError(code, "Higgsfield 연결을 다시 확인해 주세요." if code == "login"
                             else "Higgsfield 요청을 처리하지 못했어요. 잠시 후 다시 확인해 주세요.") from None
    except (URLError, TimeoutError, OSError, ValueError, UnicodeError):
        raise HiggsfieldError("failed", "Higgsfield 응답을 확인하지 못했어요. 자동으로 다시 요청하지 않았어요.") from None


def _json_http(url, payload=None, form=False):
    raw, _ = _http(url, payload, form=form)
    try:
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise ValueError()
        return value
    except (ValueError, TypeError):
        raise HiggsfieldError("failed", "Higgsfield 연결 응답 형식이 올바르지 않아요.") from None


def _session(session_id=None):
    session_id = session_id or (request.cookies.get(COOKIE_NAME) if has_request_context() else None)
    with _sessions_lock:
        item = _sessions.get(session_id)
        if not item or time.time() - item["created"] > SESSION_TTL:
            _sessions.pop(session_id, None)
            raise HiggsfieldError("login", "먼저 내 Higgsfield 계정을 연결해 주세요.")
        return item


def connection_status():
    login_required = False
    connection_error = None
    try:
        item = _session()
        with item["lock"]:
            # 만료된 접근 토큰은 기존 갱신 토큰으로 복구하고, 재로그인은 필요한 경우에만 요청합니다.
            connected = bool(_token(item))
    except HiggsfieldError as error:
        connected = False
        login_required = error.code == "login"
        connection_error = None if login_required else str(error)
    return {"connected": connected, "generation_enabled": GENERATION_ENABLED and DAILY_LIMIT is not None,
            "reason": LOCK_REASON, "billing": "credits", "session_only": True, "provider": PROVIDER,
            "login_required": login_required, "connection_error": connection_error}


def start_login(callback_url):
    """사용자가 연결 버튼을 누른 뒤에만 클라이언트를 등록합니다."""
    parsed = urlsplit(callback_url)
    if (parsed.username or parsed.password or parsed.fragment or parsed.query or
            parsed.scheme not in ("http", "https") or
            (parsed.scheme == "http" and parsed.hostname not in ("127.0.0.1", "localhost", "::1"))):
        raise HiggsfieldError("configuration", "외부 서버에서는 HTTPS 주소로 접속한 뒤 연결해 주세요.")
    meta = _json_http(ISSUER + "/.well-known/oauth-authorization-server")
    for key, suffix in (("authorization_endpoint", "/oauth/authorize"),
                        ("token_endpoint", "/oauth/token"), ("registration_endpoint", "/oauth/register")):
        if meta.get(key) != ISSUER + suffix:
            raise HiggsfieldError("configuration", "Higgsfield의 공식 로그인 경로를 확인하지 못했어요.")
    if meta.get("issuer") != ISSUER or "S256" not in meta.get("code_challenge_methods_supported", []):
        raise HiggsfieldError("configuration", "Higgsfield의 안전한 로그인 방식을 확인하지 못했어요.")
    client = _json_http(meta["registration_endpoint"], {
        "client_name": "Hanjeongseon Content Studio", "redirect_uris": [callback_url],
        "grant_types": ["authorization_code", "refresh_token"], "response_types": ["code"],
        "token_endpoint_auth_method": "none"})
    if not isinstance(client.get("client_id"), str) or not client["client_id"]:
        raise HiggsfieldError("configuration", "Higgsfield에 이 화면을 연결하지 못했어요.")
    if client.get("token_endpoint_auth_method", "none") != "none":
        raise HiggsfieldError("configuration", "Higgsfield가 지원하지 않는 인증 방식을 돌려줬어요.")
    verifier, state, session_id = secrets.token_urlsafe(48), secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    now = time.time()
    with _sessions_lock:
        for key in list(_sessions):
            if now - _sessions[key]["created"] > SESSION_TTL:
                del _sessions[key]
        if len(_sessions) >= 128:
            raise HiggsfieldError("busy", "연결 요청이 많아요. 잠시 뒤 다시 시도해 주세요.")
        _sessions[session_id] = {"created": now, "state": state, "verifier": verifier,
                                 "redirect_uri": callback_url, "client_id": client["client_id"],
                                 "lock": threading.RLock(), "uploads": {}, "models": {}}
    query = {"response_type": "code", "client_id": client["client_id"], "redirect_uri": callback_url,
             "scope": "openid email offline_access", "state": state,
             "code_challenge": challenge, "code_challenge_method": "S256", "resource": MCP_URL}
    return session_id, meta["authorization_endpoint"] + "?" + urlencode(query)


def _accept_tokens(item, tokens):
    token = tokens.get("access_token")
    if not isinstance(token, str) or not token or tokens.get("token_type", "Bearer").lower() != "bearer":
        raise HiggsfieldError("login", "Higgsfield 로그인을 완료하지 못했어요. 다시 연결해 주세요.")
    try:
        expires = int(tokens.get("expires_in", 3600))
        if not 0 < expires <= 31 * 86400:
            raise ValueError()
    except (TypeError, ValueError, OverflowError):
        raise HiggsfieldError("login", "Higgsfield 로그인 만료 시간을 확인하지 못했어요.") from None
    item["access_token"], item["expires_at"] = token, time.time() + expires
    if isinstance(tokens.get("refresh_token"), str):
        item["refresh_token"] = tokens["refresh_token"]


def finish_login(code, state, issuer=None):
    item = _session()
    with item["lock"]:
        expected = item.pop("state", "")
        if (not isinstance(state, str) or not expected or not secrets.compare_digest(expected, state) or
                time.time() - item["created"] > LOGIN_TTL or (issuer is not None and issuer != ISSUER) or
                not isinstance(code, str) or not 0 < len(code) <= 4096):
            raise HiggsfieldError("login", "로그인 확인 시간이 지났거나 다른 창의 요청이에요. 다시 연결해 주세요.")
        tokens = _json_http(ISSUER + "/oauth/token", {"grant_type": "authorization_code", "code": code,
                            "redirect_uri": item["redirect_uri"], "client_id": item["client_id"],
                            "code_verifier": item.pop("verifier"), "resource": MCP_URL}, form=True)
        _accept_tokens(item, tokens)


def disconnect(session_id=None):
    session_id = session_id or (request.cookies.get(COOKIE_NAME) if has_request_context() else None)
    with _sessions_lock:
        _sessions.pop(session_id, None)


def _token(item):
    if item.get("expires_at", 0) <= time.time() + 30:
        if not item.get("refresh_token"):
            raise HiggsfieldError("login", "Higgsfield 로그인이 만료됐어요. 다시 연결해 주세요.")
        try:
            tokens = _json_http(ISSUER + "/oauth/token", {"grant_type": "refresh_token",
                                "refresh_token": item["refresh_token"], "client_id": item["client_id"]}, form=True)
            _accept_tokens(item, tokens)
        except HiggsfieldError as error:
            # 일시적인 네트워크 장애로 유효한 인증까지 버리지 않습니다.
            if error.code == "login":
                item.pop("access_token", None)
                item.pop("refresh_token", None)
            raise
    if not item.get("access_token"):
        raise HiggsfieldError("login", "먼저 내 Higgsfield 계정을 연결해 주세요.")
    return item["access_token"]


def _rpc(item, method, params, notification=False):
    payload = {"jsonrpc": "2.0", "method": method, "params": params}
    if not notification:
        payload["id"] = uuid.uuid4().hex
    headers = {"Authorization": "Bearer " + _token(item), "Accept": "application/json, text/event-stream"}
    if item.get("mcp_session"):
        headers["Mcp-Session-Id"] = item["mcp_session"]
    if item.get("protocol"):
        headers["MCP-Protocol-Version"] = item["protocol"]
    raw, response_headers = _http(MCP_URL, payload, headers)
    for key, value in response_headers.items():
        if key.lower() == "mcp-session-id":
            item["mcp_session"] = value
    if notification:
        return {}
    try:
        if raw.lstrip().startswith("{"):
            messages = [json.loads(raw)]
        else:
            messages = [json.loads("\n".join(line[5:].lstrip() for line in event.splitlines()
                                             if line.startswith("data:")))
                        for event in raw.replace("\r\n", "\n").split("\n\n") if "data:" in event]
        response = next(value for value in messages if value.get("id") == payload.get("id"))
        if response.get("error") or not isinstance(response.get("result"), dict):
            raise ValueError()
        return response["result"]
    except (ValueError, TypeError, KeyError, StopIteration, AttributeError):
        raise HiggsfieldError("failed", "Higgsfield 연결 응답을 확인하지 못했어요.") from None


def _tools(item):
    if "tools" not in item:
        initialized = _rpc(item, "initialize", {"protocolVersion": "2025-03-26", "capabilities": {},
                            "clientInfo": {"name": "hanjeongseon-content-studio", "version": "1.0"}})
        item["protocol"] = initialized.get("protocolVersion", "2025-03-26")
        _rpc(item, "notifications/initialized", {}, notification=True)
        found, cursor = [], None
        for _ in range(20):
            result = _rpc(item, "tools/list", {"cursor": cursor} if cursor else {})
            found.extend(result.get("tools", []))
            cursor = result.get("nextCursor")
            if not cursor:
                break
        item["tools"] = {tool["name"]: tool for tool in found if isinstance(tool, dict) and "name" in tool}
    return item["tools"]


def _check_arguments(value, schema):
    """실제 tools/list의 필수 키·자료형·enum을 확인합니다. 모르는 도구 형태는 실행하지 않습니다."""
    kind = schema.get("type")
    if kind == "object":
        if not isinstance(value, dict) or any(key not in value for key in schema.get("required", [])):
            raise ValueError()
        props = schema.get("properties", {})
        for key, part in value.items():
            if key not in props and schema.get("additionalProperties") is False:
                raise ValueError()
            if key in props:
                _check_arguments(part, props[key])
    elif kind == "array":
        if not isinstance(value, list):
            raise ValueError()
        for part in value:
            _check_arguments(part, schema.get("items", {}))
    elif kind == "string" and not isinstance(value, str):
        raise ValueError()
    elif kind == "boolean" and not isinstance(value, bool):
        raise ValueError()
    elif kind in ("number", "integer") and (isinstance(value, bool) or not isinstance(value, (int, float))):
        raise ValueError()
    if "enum" in schema and value not in schema["enum"]:
        raise ValueError()


def _tool(name, arguments):
    item = _session()
    with item["lock"]:
        definitions = _tools(item)
        candidates = [tool for key, tool in definitions.items() if key == name or key.endswith("__" + name)]
        if len(candidates) != 1:
            raise HiggsfieldError("configuration", "Higgsfield 연결에서 필요한 도구를 찾지 못했어요. 다시 연결해 주세요.")
        definition = candidates[0]
        try:
            _check_arguments(arguments, definition["inputSchema"])
        except (ValueError, TypeError, KeyError):
            raise HiggsfieldError("configuration", "Higgsfield 도구 형식이 바뀌었어요. 연동 확인이 필요해요.") from None
        result = _rpc(item, "tools/call", {"name": definition["name"], "arguments": arguments})
        data = result.get("structuredContent")
        if not isinstance(data, dict):
            for part in result.get("content", []):
                if part.get("type") == "text":
                    try:
                        data = json.loads(part.get("text", ""))
                    except (ValueError, TypeError):
                        continue
                    if isinstance(data, dict):
                        break
        if result.get("isError") or not isinstance(data, dict) or data.get("error"):
            raise HiggsfieldError("failed", "Higgsfield가 요청을 완료하지 못했어요. 연결과 이용 권한을 확인해 주세요.")
        return data


def number(value):
    if isinstance(value, bool):
        raise ValueError("number")
    try:
        result = Decimal(str(value))
        if not result.is_finite() or result < 0:
            raise ValueError("number")
        return result
    except InvalidOperation:
        raise ValueError("number") from None


def _model(kind):
    item = _session()
    name = IMAGE_MODEL if kind == "image" else VIDEO_MODEL
    with item["lock"]:
        if kind not in item["models"]:
            candidates = _tool("models_search", {"query": name, "type": kind, "limit": 20}).get("items", [])
            matched = [model for model in candidates if model.get("name", "").casefold() == name.casefold()]
            if len(matched) != 1 or not isinstance(matched[0].get("id"), str):
                raise HiggsfieldError("configuration", f"연결한 계정에서 {name} 모델을 확인하지 못했어요.")
            item["models"][kind] = _tool("models_get", {"model_id": matched[0]["id"]})
        return item["models"][kind]


def safe_media_url(url):
    """Higgsfield가 돌려준 공개 저장소 주소만 사용하며 내부망·리다이렉트는 허용하지 않습니다."""
    try:
        parsed = urlsplit(url)
        host = (parsed.hostname or "").lower()
        allowed = ("higgsfield.ai", "higgs.ai", "cloudfront.net", "amazonaws.com", "storage.googleapis.com")
        if (parsed.scheme != "https" or parsed.username or parsed.password or parsed.port not in (None, 443) or
                not any(host == name or host.endswith("." + name) for name in allowed)):
            raise ValueError()
        addresses = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(item[4][0]).is_global for item in addresses):
            raise ValueError()
        return url
    except (ValueError, TypeError, OSError):
        raise HiggsfieldError("media", "결과 파일의 안전한 저장 주소를 확인하지 못했어요.") from None


def _upload(path):
    item = _session()
    stat = os.stat(path)
    if not 0 < stat.st_size <= 50 * 1024 * 1024:
        raise HiggsfieldError("media", "참고 파일은 50MB 이하만 사용할 수 있어요.")
    key = (path, stat.st_mtime_ns, stat.st_size)
    if key in item["uploads"]:
        return item["uploads"][key]
    content_type = mimetypes.guess_type(path)[0]
    if content_type not in ("image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime", "video/webm"):
        raise HiggsfieldError("media", "지원하는 이미지·영상 파일을 골라 주세요.")
    result = _tool("media_upload", {"filename": "reference" + os.path.splitext(path)[1],
                                  "content_type": content_type, "method": "upload_url"})
    uploads = result.get("uploads") or []
    if len(uploads) != 1 or not UUID.fullmatch(str(uploads[0].get("media_id", ""))):
        raise HiggsfieldError("media", "Higgsfield 참고 파일 준비에 실패했어요.")
    upload = uploads[0]
    safe_media_url(upload.get("upload_url"))
    if upload.get("method", "PUT").upper() != "PUT":
        raise HiggsfieldError("media", "Higgsfield 파일 업로드 방식이 바뀌었어요.")
    try:
        with open(path, "rb") as source:
            data = source.read(50 * 1024 * 1024 + 1)
        if len(data) > 50 * 1024 * 1024:
            raise ValueError()
        req = Request(upload["upload_url"], data=data, method="PUT", headers={"Content-Type": content_type})
        with build_opener(_NoRedirect()).open(req, timeout=60) as response:
            if response.status not in (200, 201, 204):
                raise ValueError()
    except (OSError, ValueError, URLError):
        raise HiggsfieldError("media", "참고 파일을 보내지 못했어요. 생성 요청은 보내지 않았어요.") from None
    kind = "image" if content_type.startswith("image/") else "video"
    confirmed = _tool("media_confirm", {"media_id": upload["media_id"], "type": kind})
    if not any(part.get("media_id") == upload["media_id"] and part.get("status") in ("confirmed", "completed", "ready", "success")
               for part in confirmed.get("results", [])):
        raise HiggsfieldError("media", "참고 파일의 업로드 완료를 확인하지 못했어요.")
    item["uploads"][key] = upload["media_id"]
    return upload["media_id"]


def _params(spec, upload=False):
    model = _model(spec["kind"])
    params = {"model": model["id"], "count": 1, "use_unlim": False, **spec["params"]}
    ratios = model.get("aspect_ratios", [])
    if not ratios or params.get("aspect_ratio") not in ratios:
        raise HiggsfieldError("configuration", "고른 규격을 지원하는지 확인하지 못했어요. 다른 규격을 골라 주세요.")
    definitions = {part["name"]: part for part in model.get("parameters", []) if isinstance(part, dict) and "name" in part}
    for key in ("mode", "resolution"):
        if key in params and (key not in definitions or (definitions[key].get("options") and params[key] not in definitions[key]["options"])):
            raise HiggsfieldError("configuration", "요청한 생성 설정을 모델에서 확인하지 못했어요.")
    if spec["kind"] == "video":
        duration = params["duration"]
        limits, options = model.get("duration_range"), model.get("durations")
        if not ((options and duration in options) or (limits and limits["min"] <= duration <= limits["max"])):
            raise HiggsfieldError("configuration", "이 영상 길이는 연결한 모델에서 지원하지 않아요.")
    if upload:
        params["medias"] = [{"role": part["role"], "value": part["value"] if UUID.fullmatch(part["value"])
                              else _upload(part["value"])} for part in spec.get("medias", [])]
    return params


# ---------- 요청 내용 ----------
def video_args(doc, start_image=None, photos=(), videos=(), end_image=None):
    """영상 문서 → MCP 요청. 파일은 생성 잠금이 풀린 뒤 서버에서만 업로드합니다."""
    if end_image and not start_image:  # 첫 장면 없이 끝 장면만 있으면 참고 사진으로
        photos, end_image = [end_image, *photos], None
    room = KLING_IMAGES - bool(start_image) - bool(end_image)
    medias = [{"role": "image", "value": path} for path in list(photos)[:room]]
    if start_image:
        medias.insert(0, {"role": "start_image", "value": start_image})
    if end_image:
        medias.append({"role": "end_image", "value": end_image})
    medias += [{"role": "video", "value": path} for path in videos]
    mode = "reference-to-video" if videos or (photos and not start_image) else "image-to-video" if start_image else "text-to-video"
    return {"kind": "video", "params": {"prompt": doc.get("custom") or doc["prompt"],
            "duration": doc["duration"], "resolution": VIDEO_RESOLUTION, "aspect_ratio": doc["ratio"], "mode": mode},
            "medias": medias}


def image_prompt(doc, roles=(), index=0):
    """미리보기 이미지(컷 하나의 그림) 프롬프트: 그 컷 장면·카메라·움직임 + 제품 고정 문장 + 분위기·조명.
    roles: 첨부 사진마다 무엇인지(영어, 순서대로). 사진마다 역할을 적어 겉모습 컷에 단면이 나오지 않게 합니다.
    컷마다 따로 만들어도 한 영상처럼 보이게 같은 배경·조명을 지키라고 적습니다. 글자는 넣지 않습니다."""
    style = STYLES.get(doc.get("style")) or STYLES["premium"]
    look = PRODUCT_LOOK.get(doc.get("product"), (None,))[0]
    names = doc.get("products") or [doc.get("product")]
    if len(names) > 1:  # 여러 제품(라인업)
        look = f"Hanjungsun chapssal-tteok in {len(names)} flavors ({', '.join(PRODUCT_EN.get(n, n) for n in names)})"
    scenes = doc.get("scenes") or []
    count = len(scenes)
    index = index if 0 <= index < count else 0
    scene = scenes[index]["en"] if scenes else "product hero shot"
    if index == 0:
        place = "the opening shot"
    elif index == count - 1:
        place = "the final shot"
    else:
        place = f"shot {index + 1} of {count}"
    parts = [
        f"Photorealistic still frame, {place} of a {style['genre'][0]}: {scene}.",
        f"Camera: {_shot(style, index, count)[0]}; {_action(style, index, count)[0]}." if count else "",
        f"The product: {look}." if look else "",
        ("Attached photos: " + "; ".join(f"{i + 1}) {role}" for i, role in enumerate(roles))
         + ". The product must match the photos that fit this shot exactly; reference images guide only mood, "
           "composition and color.") if roles else "",
        # 속 컷: 단면만 덩그러니 나오지 않게 동그란 찹쌀떡을 가르는 순간으로
        ("The rice cake starts as the round white one in the outside photo and is caught at the moment it is split "
         "open, revealing the filling from the cross-section photo.") if scene_kind(scene) == "inside" else "",
        f"Style: {style['keywords'][0]}.",
        f"Setting: {doc.get('background', '')}, {doc.get('mood', '')} mood, {doc.get('lighting', '')}.",
        "Keep the same setting, lighting and product look as the other shots of this video." if count > 1 else "",
        f"{COMMON_AVOID[0]}, {FOOD_AVOID[0]}.",
    ]
    return " ".join(part for part in parts if part)


def image_args(doc, photos=(), index=0):
    """컷 하나의 미리보기 이미지 요청. photos: [(사진 경로, 역할 영어)] — 참고 사진으로 보내고 역할은 프롬프트에 적습니다."""
    photos = list(photos)[:IMAGE_REFS]
    return design_args(image_prompt(doc, [role for _, role in photos], index), doc["ratio"],
                       [path for path, _ in photos])


def design_args(prompt, ratio, photos=()):
    if ratio not in IMAGE_RATIOS or not isinstance(prompt, str) or not 1 <= len(prompt) <= 16000:
        raise HiggsfieldError("input", "만들 내용과 이미지 규격을 확인해 주세요.")
    return {"kind": "image", "params": {"prompt": prompt, "aspect_ratio": ratio, "resolution": "1k"},
            "medias": [{"role": "image", "value": path} for path in list(photos)[:IMAGE_REFS]]}


# ---------- 무료 확인 ----------
def balance():
    """계정 전체 남은 크레딧 (웹에서 쓴 것도 반영)."""
    try:
        return float(number(_tool("balance", {}).get("credits")))
    except ValueError:
        raise HiggsfieldError("failed", "남은 크레딧을 확인하지 못했어요.") from None


def cost(args):
    result = _tool("estimate_" + args["kind"] + "_cost", {"params": _params(args)})
    if result.get("adjustments"):
        raise HiggsfieldError("configuration", "요청한 규격이나 길이가 바뀌었어요. 설정을 다시 확인해 주세요.")
    try:
        return float(number(result["cost"].get("credits_exact", result["cost"].get("credits"))))
    except (ValueError, KeyError, TypeError):
        raise HiggsfieldError("failed", "예상 크레딧을 확인하지 못했어요.") from None


UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


def _job(data):
    """MCP 작업 응답 → 저장 문서에서 쓰는 최소 필드."""
    if isinstance(data, list):
        data = data[0] if data else {}
    if isinstance(data, dict) and isinstance(data.get("jobs"), list) and data["jobs"]:
        data = data["jobs"][0]
    elif isinstance(data, dict) and isinstance(data.get("results"), list) and data["results"]:
        data = data["results"][0]
    if isinstance(data, str):
        return {"request_id": data if UUID.fullmatch(data) else None, "status": "queued", "url": None}
    if not isinstance(data, dict):
        data = {}
    url = data.get("result_url") or data.get("url")
    results = data.get("results")
    if not url and isinstance(results, list) and results:
        first = results[0]
        url = first.get("url") if isinstance(first, dict) else first
    if not url and isinstance(results, dict):
        url = results.get("rawUrl") or results.get("url") or (results.get("raw") or {}).get("url")
    return {
        "request_id": data.get("job_id") or data.get("id") or data.get("request_id"),
        "status": data.get("status") or data.get("job_status") or "queued",
        "url": url,
    }


def get_job(request_id):
    if not isinstance(request_id, str) or not UUID.fullmatch(request_id):
        raise HiggsfieldError("input", "작업 번호가 올바르지 않아요.")
    data = _tool("jobs_wait", {"jobs": [{"index": 0, "job_id": request_id}], "timeout_seconds": 0})
    jobs = data.get("jobs") or []
    if len(jobs) != 1 or jobs[0].get("job_id") != request_id:
        raise HiggsfieldError("failed", "이 계정에서 요청한 작업을 확인하지 못했어요.")
    if jobs[0].get("status") == "lookup_failed":
        raise HiggsfieldError("failed", "이 계정에서 작업 상태를 확인하지 못했어요. 다시 만들지 말고 연결을 확인해 주세요.")
    return _job(jobs[0])


# ---------- 크레딧이 나가는 요청 ----------
class Submitted(Exception):
    """생성 요청은 Higgsfield에 들어갔는데(크레딧이 나갔을 수 있음) 작업 ID를 알 수 없을 때."""


def create(args):
    """유료 요청 경계. 잠금 확인은 업로드·모델 조회보다 먼저 합니다."""
    if not GENERATION_ENABLED or DAILY_LIMIT is None:
        raise HiggsfieldError("locked", LOCK_REASON)
    params = _params(args, upload=True)
    try:
        job = _job(_tool("generate_" + args["kind"], {"params": params}))
    except HiggsfieldError:
        # 전송 뒤 오류는 접수 여부를 알 수 없습니다. 최근 다른 작업을 추측해 붙이지 않습니다.
        raise Submitted("요청 접수 여부를 확인하지 못했어요.") from None
    if not isinstance(job["request_id"], str) or not UUID.fullmatch(job["request_id"]):
        raise Submitted("생성 요청의 작업 번호를 확인하지 못했어요.")
    job["model"] = params["model"]
    return job
