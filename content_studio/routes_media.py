"""사진 업로드, 배경 제거(rembg), 숏폼 콘티, 광고 표현 검수, 카드뉴스 프롬프트 만들기. [희주]

API는 /content_studio/media/api/... 아래에 둡니다. 예: @bp.route("/media/api/remove-bg", methods=["POST"])
업로드·결과 파일은 instance/uploads/content_studio/, instance/exports/content_studio/ 에 저장합니다.
"""
import base64
import copy
import io
import os
import re
import threading
import uuid
import json
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen

from flask import current_app, jsonify, request, send_from_directory
from PIL import Image, ImageOps, UnidentifiedImageError
from werkzeug.exceptions import NotFound

from platform_core.extensions import db

from . import bp
from .designs import (RULE_RETRY_NOTE, SIZES, CopyRuleError, background_element, background_photos, background_prompt,
                      build_cardnews_prompt, build_design_brief, change_ratio, design_texts, finish_image_proposals,
                      image_proposal_schema, validate_proposals)
from .models_sns import SnsChat, SnsCreditLog
from .products import get_product

REVIEW_DISCLAIMER = "광고 표현·문화 참고 안내입니다. 법적 판단이 아닙니다."
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}
EXTENSIONS = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp"}
MAX_SIDE = 4096
REMBG_MODEL = "birefnet-general"  # 사람·물건·동물 모두 처리하는 범용 모델 (처음 실행 때 약 1GB 내려받음)
FILE_ID_RE = re.compile(r"^[0-9a-f]{32}$")
UPLOAD_NAME_RE = re.compile(r"^[0-9a-f]{32}\.(jpg|png|webp)$")

_session = None  # rembg 모델은 처음 배경 제거를 할 때 한 번만 불러옵니다.


def _error(message, status=400):
    return jsonify({"ok": False, "error": message}), status


def _module_dir(root_key):
    path = os.path.join(current_app.config[root_key], "content_studio")
    os.makedirs(path, exist_ok=True)
    return path


def _upload_dir():
    return _module_dir("UPLOAD_ROOT")


def _export_dir():
    return _module_dir("EXPORT_ROOT")


def _get_session():
    global _session
    if _session is None:
        from rembg import new_session  # 앱을 켤 때 모델을 불러오지 않도록 여기서 import
        _session = new_session(REMBG_MODEL)
    return _session


def _open_image(stream):
    """실제 이미지인지, 형식·크기가 맞는지 확인합니다. 문제가 있으면 (None, 안내 문구)."""
    try:
        img = Image.open(stream)
        img.load()
    except (UnidentifiedImageError, OSError):
        return None, "JPEG·PNG·WEBP 이미지만 올릴 수 있습니다."
    if img.format not in ALLOWED_FORMATS:
        return None, "JPEG·PNG·WEBP 이미지만 올릴 수 있습니다."
    if img.width > MAX_SIDE or img.height > MAX_SIDE:
        return None, f"가로·세로가 각각 {MAX_SIDE}px 이하인 사진만 올릴 수 있습니다."
    return img, None


def _remove_background(img, alpha_matting):
    from rembg import remove
    img = ImageOps.exif_transpose(img).convert("RGB")  # 사진 방향 바로잡기
    return remove(img, session=_get_session(), alpha_matting=alpha_matting)


# ---------- 배경 제거 (README 5-5) ----------
@bp.route("/media/api/remove-bg", methods=["POST"])
def remove_bg():
    # 개인 Vercel 배포에서는 모델·추론 패키지를 설치하지 않습니다.
    return _error("개인 배포에서는 배경 제거 기능을 지원하지 않습니다.", 501)


@bp.route("/media/remove-bg/result/<file_id>.png")
def remove_bg_result(file_id):
    if not FILE_ID_RE.match(file_id):
        return _error("결과를 찾을 수 없습니다.", 404)
    name = f"{file_id}_nobg.png"
    # 예전 결과는 uploads에 저장돼 있어 그쪽도 찾아봅니다.
    folder = _export_dir() if os.path.exists(os.path.join(_export_dir(), name)) else _upload_dir()
    return send_from_directory(folder, name, mimetype="image/png", download_name=f"nobg_{file_id[:8]}.png")


# ---------- 사진 올리기 (편집기 사진 추가·바꾸기) ----------
@bp.route("/media/api/upload", methods=["POST"])
def upload_photo():
    upload = request.files.get("image")
    if not upload:
        return _error("사진을 먼저 골라 주세요.")
    img, message = _open_image(upload.stream)
    if message:
        return _error(message)
    # 사진 방향을 바로잡아 같은 형식으로 다시 저장합니다. (사진 속 위치 정보 등은 남기지 않음)
    ext = EXTENSIONS[img.format]
    fixed = ImageOps.exif_transpose(img)
    if ext == "jpg" and fixed.mode not in ("RGB", "L"):
        fixed = fixed.convert("RGB")
    name = f"{uuid.uuid4().hex}.{ext}"
    fixed.save(os.path.join(_upload_dir(), name), img.format)
    return jsonify({
        "ok": True,
        "file_id": name.split(".")[0],
        "url": f"{bp.url_prefix}/media/uploads/{name}",
        "width": fixed.width,
        "height": fixed.height,
    })


@bp.route("/media/uploads/<name>")
def uploaded_photo(name):
    if not UPLOAD_NAME_RE.match(name):
        return _error("사진을 찾을 수 없습니다.", 404)
    # Windows는 webp 종류를 몰라 직접 지정합니다.
    mimetype = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}[name.rsplit(".", 1)[1]]
    return send_from_directory(_upload_dir(), name, mimetype=mimetype)


# ---------- 광고 표현 검수 (README 6장) ----------
# 기준은 현지 시장 분석 탭(market_analysis/public.py)의 check_ad_copy를 그대로 씁니다.
@bp.route("/media/api/review", methods=["POST"])
def review_copy():
    body = request.get_json(silent=True) or {}
    texts = design_texts(body["design"]) if isinstance(body.get("design"), dict) else []
    if isinstance(body.get("text"), str) and body["text"].strip():
        texts.append(body["text"].strip())
    if not texts:
        return _error("검수할 글이 없습니다.")

    try:
        from market_analysis.public import check_ad_copy, get_content_guidelines
        guidelines = get_content_guidelines("VN") or {}
        findings = []
        for text in texts:  # 어느 문구에서 걸렸는지 보여주려고 글마다 따로 검사합니다.
            for finding in check_ad_copy(text, "VN"):
                findings.append({**finding, "text": text})
    except Exception:  # noqa: BLE001  다른 탭 오류로 내 화면이 멈추지 않게 합니다.
        current_app.logger.exception("광고 표현 검수 실패")
        return _error("광고 표현 검수를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", 500)

    return jsonify({
        "ok": True,
        "ready": bool(guidelines.get("avoid_expressions")),  # 기준이 비어 있으면 "문제 없음"이 아닙니다.
        "guidelines": {key: guidelines.get(key) for key in
                       ("status", "reviewed_at", "visual_cautions", "required_notices", "prompt_rules", "sources")},
        "disclaimer": guidelines.get("disclaimer") or REVIEW_DISCLAIMER,
        "checked": len(texts),
        "findings": findings,
    })


# ---------- 카드뉴스 프롬프트 만들기 ----------
@bp.route("/media/api/cardnews-prompt", methods=["POST"])
def cardnews_prompt():
    body = request.get_json(silent=True) or {}
    wish = (body.get("request") or "").strip() if isinstance(body.get("request"), str) else ""
    if not wish:
        return _error("원하는 내용을 입력해 주세요.")
    prompt, rules_ready = build_cardnews_prompt(wish, body.get("design"), body.get("language"))
    return jsonify({"ok": True, "prompt": prompt, "rules_ready": rules_ready})


def _media_body():
    if request.content_length and request.content_length > 160000:
        raise ValueError("요청이 너무 큽니다. 문구와 장수를 줄여 주세요.")
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise ValueError("요청 형식이 올바르지 않습니다.")
    return body


def _design_request(body):
    doc, options = body.get("design"), body.get("options")
    if not isinstance(doc, dict) or not isinstance(options, dict):
        raise ValueError("편집 중인 초안과 요청 항목이 필요합니다.")
    pages = doc.get("pages")
    if not isinstance(pages, list) or not 1 <= len(pages) <= 6:
        raise ValueError("초안의 장수가 올바르지 않습니다.")
    for page in pages:
        if not isinstance(page, dict) or not isinstance(page.get("elements"), list):
            raise ValueError("초안의 요소 형식이 올바르지 않습니다.")
        if len(page["elements"]) > 100 or any(not isinstance(i, dict) for i in page["elements"]):
            raise ValueError("초안의 요소가 너무 많거나 올바르지 않습니다.")
    return doc, options


def _api_json(url, headers, payload=None):
    # 자동 재시도는 중복 과금 방지를 위해 하지 않습니다. 비밀 값·외부 오류 본문은 출력하지 않습니다.
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    req = Request(url, data=data, headers=headers)
    with urlopen(req, timeout=90) as response:
        raw = response.read(1500001)
    if len(raw) > 1500000:
        raise ValueError("외부 서비스 응답이 너무 큽니다.")
    return json.loads(raw)


# OpenAI 공개 단가(1M 토큰당 $). 바뀌면 여기만 고칩니다. 실제 청구액은 OpenAI 사용 내역이 기준입니다.
ASSISTANT_MODEL = "gpt-4o-mini"
PRICES = {"gpt-4o-mini": {"input": 0.15, "cached": 0.075, "output": 0.60}}
PRICE_CHECKED = "2026-10-26"


def _usage_cost(model, usage):
    """응답의 usage로 토큰 수와 예상 비용($)을 계산합니다."""
    usage = usage if isinstance(usage, dict) else {}
    price = PRICES[model]
    input_tokens = int(usage.get("input_tokens") or 0)
    cached = min(input_tokens, int((usage.get("input_tokens_details") or {}).get("cached_tokens") or 0))
    output_tokens = int(usage.get("output_tokens") or 0)
    usd = ((input_tokens - cached) * price["input"] + cached * price["cached"]
           + output_tokens * price["output"]) / 1_000_000
    return {"input_tokens": input_tokens, "cached_tokens": cached, "output_tokens": output_tokens,
            "total_tokens": input_tokens + output_tokens, "usd": round(usd, 6), "price_checked": PRICE_CHECKED}


def _cost_note(cost):
    return f" (이번 요청 {cost['total_tokens']:,} 토큰 · 예상 ${cost['usd']:.4f})" if cost else ""


def _sum_cost(first, second):
    """두 번 요청했을 때 토큰 수·예상 비용을 합칩니다."""
    if not first:
        return second
    total = {key: first[key] + second[key] for key in ("input_tokens", "cached_tokens", "output_tokens", "total_tokens")}
    return {**total, "usd": round(first["usd"] + second["usd"], 6), "price_checked": PRICE_CHECKED}


# 새로 만들기 시안 3개 (sns_editor.js renderChoices). 그림은 유진 쪽 Higgsfield API가 만듭니다.
# 포스터·카드뉴스 모두 장면 프롬프트 — proposals: [{name, concept_ko, style, style_label, pages: [{prompt_en, texts: [{vi, ko}]}]}] × 3
# (포스터 템플릿 방식은 2026-10-27 유진 결정으로 되돌림. 포스터는 1장)
# 그림 글자 규칙(베트남어만 · 포스터 제목 7음절)에 걸리면 규칙을 덧붙여 한 번만 다시 요청합니다(글 단계라 그림 크레딧 없음).
@bp.route("/media/api/design-assistant", methods=["POST"])
def design_assistant():
    try:
        body = _media_body()
        doc, options = _design_request(body)
        persona, brief, ready = build_design_brief(doc, options)
    except ValueError as error:
        return _error(str(error))
    except (TypeError, KeyError):
        return _error("제품·요청·규격·장수를 확인해 주세요.")
    if body.get("confirm_paid") is not True:
        return _error("유료 AI 제안 생성 버튼으로 실행해 주세요.")
    key = current_app.config.get("OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if not key:
        return _error("OpenAI 연결이 필요합니다. PM1에게 서버 API 키 설정을 요청해 주세요.", 503)
    schema = image_proposal_schema(brief["pages"])
    instructions = persona
    cost = None  # 응답을 받은 뒤 실패해도 쓴 토큰·비용을 알려 줍니다. (두 번 요청하면 합계)
    try:
        for attempt in range(2):
            response = _api_json("https://api.openai.com/v1/responses",
                                 {"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                                 {"model": ASSISTANT_MODEL, "store": False, "instructions": instructions,
                                  "input": json.dumps(brief, ensure_ascii=False), "max_output_tokens": 12000,
                                  "text": {"format": {"type": "json_schema", "name": "design_image_proposals",
                                                       "strict": True, "schema": schema}}})
            cost = _sum_cost(cost, _usage_cost(ASSISTANT_MODEL, response.get("usage")))
            if response.get("status") != "completed":
                return _error("AI가 결과를 끝내지 못했습니다. 요청을 줄인 뒤 직접 다시 실행해 주세요." + _cost_note(cost), 502)
            output = "".join(part.get("text", "") for item in response.get("output", [])
                             for part in item.get("content", []) if part.get("type") == "output_text")
            try:
                result = json.loads(output)
            except ValueError:  # JSON이 깨짐: 보여 줄 이유 문장이 없어 일반 안내
                return _error("AI 결과 형식이 올바르지 않아 적용하지 않았습니다. 기존 작업은 유지됩니다." + _cost_note(cost), 502)
            validate_proposals(result, schema)
            try:
                proposals = finish_image_proposals(result["proposals"], brief["kind"])
            except CopyRuleError as error:
                if attempt == 0:  # 규칙을 덧붙여 한 번만 다시 요청
                    instructions = persona + RULE_RETRY_NOTE
                    continue
                return _error(f"{error} 규칙을 덧붙여 한 번 더 요청했지만 또 걸렸어요." + _cost_note(cost), 502)
            return jsonify({"ok": True, "proposals": proposals, "rules_ready": ready, "retried": attempt > 0,
                            "usage": response.get("usage", {}), "cost": cost, "model": ASSISTANT_MODEL})
    except HTTPError as error:
        message = "API 키 또는 사용 권한을 확인해 주세요." if error.code in (401, 403) else "OpenAI 요청이 실패했습니다. 한도·잔액·모델 접근 권한을 확인해 주세요."
        return _error(message, 502)
    except (URLError, TimeoutError, OSError):
        return _error("AI 응답을 받지 못했습니다. 사용 내역 확인 후 다시 실행해 주세요. 자동 재시도하지 않았습니다.", 502)
    except ValueError as error:  # 형식 검사(validate_proposals)에 걸림: 그 이유 문장을 그대로 보여 줍니다
        return _error(f"{error} 적용하지 않았습니다. 기존 작업은 유지됩니다." + _cost_note(cost), 502)
    except (KeyError, TypeError, AttributeError):
        return _error("AI 결과 형식이 올바르지 않아 적용하지 않았습니다. 기존 작업은 유지됩니다." + _cost_note(cost), 502)


def _figma_selection(value):
    if not isinstance(value, str) or len(value) > 2000:
        raise ValueError("Figma 선택 영역 링크를 넣어 주세요.")
    url = urlparse(value)
    match = re.fullmatch(r"/(?:design|file)/([A-Za-z0-9]+)(?:/[^/]*)?/?", url.path)
    node = parse_qs(url.query).get("node-id", [""])[0]
    if (url.scheme != "https" or url.netloc not in ("www.figma.com", "figma.com")
            or not match or not re.fullmatch(r"\d+[-:]\d+", node)):
        raise ValueError("Figma에서 프레임을 선택하고 ‘선택 항목 링크 복사’로 얻은 주소를 넣어 주세요.")
    return match[1], node.replace("-", ":")


@bp.route("/media/api/figma-preview", methods=["POST"])
def figma_preview():
    try:
        body = _media_body()
        file_key, node_id = _figma_selection(body.get("url"))
    except ValueError as error:
        return _error(str(error))
    token = current_app.config.get("FIGMA_ACCESS_TOKEN") or os.environ.get("FIGMA_ACCESS_TOKEN")
    if not token:
        return _error("Figma 연결이 필요합니다. PM1에게 서버 FIGMA_ACCESS_TOKEN 설정을 요청해 주세요. 편집 링크는 저장할 수 있습니다.", 503)
    try:
        data = _api_json(f"https://api.figma.com/v1/images/{file_key}?" + urlencode({"ids": node_id, "format": "png", "scale": "1"}),
                         {"X-Figma-Token": token})
        src = (data.get("images") or {}).get(node_id)
        if not isinstance(src, str) or urlparse(src).scheme != "https":
            return _error("선택 영역 이미지를 받지 못했습니다. 프레임과 접근 권한을 확인해 주세요.", 502)
        return jsonify({"ok": True, "preview_url": src, "refreshed_at": datetime.now(timezone.utc).isoformat()})
    except (HTTPError, URLError, TimeoutError, OSError, ValueError, TypeError, AttributeError):
        return _error("Figma 미리보기를 받지 못했습니다. 인증·파일 권한·사용 한도를 확인해 주세요.", 502)


# ---------- Figma 플러그인 창구 (README 3-4) ----------
# 플러그인 화면은 출처(origin)가 "null"로 와서, 이 창구 응답에만 허락 헤더를 붙입니다.
# 쓰기는 가져온 Figma 주소(external_figma)를 남기는 /link 하나뿐이고, 지우기는 없습니다.
FIGMA_KINDS = ("poster", "cardnews")
STATIC_IMAGE_RE = re.compile(r"^/content_studio/static/images/sns/([A-Za-z0-9_.-]+\.(?:png|jpe?g|webp))$")
UPLOAD_SRC_RE = re.compile(r"^/content_studio/media/uploads/([0-9a-f]{32}\.(?:jpg|png|webp))$")
NOBG_SRC_RE = re.compile(r"^/content_studio/media/remove-bg/result/([0-9a-f]{32})\.png$")


def _for_plugin(response, status=None):
    if status:
        response.status_code = status
    response.headers["Access-Control-Allow-Origin"] = "null"
    response.headers["Cache-Control"] = "no-store"
    return response


def _plugin_error(message, status=400):
    return _for_plugin(jsonify({"ok": False, "error": message}), status)


@bp.route("/media/api/figma/designs")
def figma_designs():
    items = []
    for chat in SnsChat.query.filter(SnsChat.kind.in_(FIGMA_KINDS)).order_by(SnsChat.updated_at.desc()):
        doc = chat.design.doc if chat.design else None
        if doc:
            items.append({"id": chat.id, "kind": chat.kind, "title": chat.title, "ratio": doc.get("ratio"),
                          "pages": len(doc.get("pages") or []), "demo": bool(doc.get("demo")),
                          "updated_at": chat.updated_at.isoformat()})
    return _for_plugin(jsonify({"ok": True, "items": items}))


@bp.route("/media/api/figma/designs/<int:chat_id>")
def figma_design(chat_id):
    chat = db.session.get(SnsChat, chat_id)
    doc = chat.design.doc if chat and chat.kind in FIGMA_KINDS and chat.design else None
    if not doc:
        return _plugin_error("포스터·카드뉴스를 찾을 수 없습니다.", 404)
    width, height = SIZES.get(doc.get("ratio"), (None, None))
    if not width:
        return _plugin_error("규격(ratio)이 올바르지 않습니다.", 422)
    # x·y·w·h는 %이고 size는 원본 크기 기준 px이라, 플러그인은 width·height로 픽셀을 계산합니다.
    return _for_plugin(jsonify({"ok": True, "id": chat.id, "title": chat.title,
                                "width": width, "height": height, "design": doc}))


@bp.route("/media/api/figma/designs/<int:chat_id>/link", methods=["POST"])
def figma_design_link(chat_id):
    """플러그인이 가져온 Figma 프레임 주소를 디자인 문서의 external_figma에 새 버전으로 남깁니다.
    미리 묻기(preflight)를 피하려고 플러그인은 text/plain으로 JSON을 보냅니다."""
    chat = db.session.get(SnsChat, chat_id)
    doc = chat.design.doc if chat and chat.kind in FIGMA_KINDS and chat.design else None
    if not doc:
        return _plugin_error("포스터·카드뉴스를 찾을 수 없습니다.", 404)
    body = request.get_json(force=True, silent=True) if (request.content_length or 0) <= 4000 else None
    url = body.get("url") if isinstance(body, dict) else None
    try:
        _figma_selection(url)
    except ValueError as error:
        return _plugin_error(str(error))
    if (doc.get("external_figma") or {}).get("url") != url:
        next_doc = copy.deepcopy(doc)
        next_doc["external_figma"] = {"url": url}
        chat.design.push(next_doc)
        db.session.commit()
    return _for_plugin(jsonify({"ok": True, "url": url}))


@bp.route("/media/api/figma/image")
def figma_image():
    """문서 속 사진 주소(제품 사진·올린 사진·배경 제거 결과)만 파일로 돌려줍니다."""
    src = request.args.get("src", "")
    try:
        if match := STATIC_IMAGE_RE.match(src):
            response = send_from_directory(os.path.join(bp.static_folder, "images", "sns"), match[1])
        elif match := UPLOAD_SRC_RE.match(src):
            response = uploaded_photo(match[1])
        elif match := NOBG_SRC_RE.match(src):
            response = remove_bg_result(match[1])
        elif match := BG_SRC_RE.match(src):
            response = design_bg_image(match[1])
        else:
            return _plugin_error("가져올 수 없는 사진 주소입니다.")
    except NotFound:
        return _plugin_error("사진 파일을 찾을 수 없습니다.", 404)
    if isinstance(response, tuple):  # 파일이 없을 때 _error가 (응답, 상태) 를 돌려줍니다.
        return _for_plugin(*response)
    return _for_plugin(response)


# ---------- 배경 그림 만들기 (OpenAI 이미지 모델) ----------
# 글자 없는 배경 그림을 만들어 장 맨 아래에 깝니다. 베트남어 문구는 지금처럼 글 요소로 얹습니다(성조 부호 때문).
# 비용이 나가는 API는 design-bg 하나뿐입니다. 화면에서 확인한 견적(usd)과 지금 견적이 같고 confirm_paid일 때만 보냅니다.
# 자동 재시도는 하지 않습니다. 보낸 뒤 응답을 못 읽으면 사용 기록만 남기고(하루 한도에 포함) 다시 누르지 말라고 알립니다.
IMAGE_API = "https://api.openai.com/v1/images/edits"  # 제품 사진을 참고 이미지로 넣는 방식
IMAGE_MODEL = "gpt-image-2.5-sunburst"
IMAGE_QUALITY = "medium"
# 규격마다 잘리지 않는 크기 (가로·세로 16의 배수)
IMAGE_SIZES = {"4:5": "1088x1360", "1:1": "1024x1024", "9:16": "1088x1936", "16:9": "1536x864"}
IMAGE_DAILY_LIMIT = 20  # 하루(한국 시간 0시부터) 장수. KPI와 같은 키를 쓰므로 따로 둡니다.
IMAGE_JOB_KIND = "design_bg"  # SnsCreditLog.job_kind. credits 칸에는 이 장의 비용($, 실제 usage 없으면 견적)을 적습니다.
# 공개 단가(1M 토큰당 $). 실제 청구액은 OpenAI 사용 내역이 기준입니다.
IMAGE_PRICES = {"text_input": 5.00, "image_input": 8.00, "image_output": 30.00}
# 견적(추정): medium 1024×1024 한 장 약 $0.013(비교 사이트 기준)을 넓이로 늘리고, 참고 사진 1장당 약 $0.01을 더합니다.
# 시험 호출의 실제 usage를 보고 고칩니다.
IMAGE_BASE_USD = 0.013
IMAGE_REF_USD = 0.01
IMAGE_MAX_BYTES = 30 * 1024 * 1024
BG_ID_RE = re.compile(r"^[0-9a-f]{32}$")
BG_SRC_RE = re.compile(r"^/content_studio/media/design-bg/([0-9a-f]{32})\.jpg$")
KST = timezone(timedelta(hours=9))
_image_lock = threading.Lock()  # 한 번에 한 장만 (두 번 눌러 두 번 결제되지 않게)


def _openai_key():
    return current_app.config.get("OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")


def _bg_target(body):
    """(작업, 문서, 장 번호, 제품, 요청 문장). 틀리면 ValueError."""
    chat_id, page, wish = body.get("chat_id"), body.get("page", 0), body.get("request", "")
    chat = db.session.get(SnsChat, chat_id) if isinstance(chat_id, int) and not isinstance(chat_id, bool) else None
    doc = chat.design.doc if chat and chat.kind in FIGMA_KINDS and chat.design else None
    if not doc or not doc.get("pages"):
        raise ValueError("포스터·카드뉴스 작업을 찾을 수 없습니다.")
    if isinstance(page, bool) or not isinstance(page, int) or not 0 <= page < len(doc["pages"]):
        raise ValueError("장 번호가 올바르지 않습니다.")
    if not isinstance(wish, str) or len(wish) > 500:
        raise ValueError("원하는 장면은 500자 이하로 적어 주세요.")
    if doc.get("ratio") not in IMAGE_SIZES:
        raise ValueError("규격(ratio)이 올바르지 않습니다.")
    return chat, doc, page, get_product(chat.product_id) if chat.product_id else None, wish.strip()


def _image_today():
    """오늘(한국 시간 0시부터) 만든 배경 그림 (장수, 비용 $)."""
    start = datetime.now(KST).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
    rows = SnsCreditLog.query.filter(SnsCreditLog.job_kind == IMAGE_JOB_KIND, SnsCreditLog.created_at >= start).all()
    return len(rows), round(sum(row.credits for row in rows), 4)


def _bg_quote(doc, product, wish):
    """무료 견적. 실행할 수 없으면 reason에 이유."""
    width, height = map(int, IMAGE_SIZES[doc["ratio"]].split("x"))
    photos = background_photos(product, wish)
    usd = round(IMAGE_BASE_USD * width * height / (1024 * 1024) + IMAGE_REF_USD * len(photos), 3)
    count, spent = _image_today()
    reason = None
    if not _openai_key():
        reason = "OpenAI 연결이 필요합니다. PM1에게 서버 API 키 설정을 요청해 주세요."
    elif count >= IMAGE_DAILY_LIMIT:
        reason = f"오늘 배경 그림 한도({IMAGE_DAILY_LIMIT}장)를 다 썼습니다."
    return {"model": IMAGE_MODEL, "quality": IMAGE_QUALITY, "size": IMAGE_SIZES[doc["ratio"]], "count": 1,
            "photos": len(photos), "usd": usd, "today_count": count, "today_usd": spent,
            "daily_limit": IMAGE_DAILY_LIMIT, "price_checked": PRICE_CHECKED, "allowed": reason is None, "reason": reason}


def _multipart(fields, files):
    """multipart/form-data 본문. files: [(칸 이름, 파일 이름, 내용 bytes, 종류)]"""
    boundary = uuid.uuid4().hex
    parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode("utf-8")
             for name, value in fields.items()]
    for name, filename, data, mimetype in files:
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'
                     f"Content-Type: {mimetype}\r\n\r\n".encode("utf-8") + data + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode("utf-8"))
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def _image_cost(usage):
    """응답 usage로 실제 비용($). 읽을 수 없으면 None."""
    try:
        details = usage.get("input_tokens_details") or {}
        text_in, image_in = int(details.get("text_tokens") or 0), int(details.get("image_tokens") or 0)
        if not (text_in or image_in):  # 나눠 주지 않으면 비싼 이미지 단가로 셉니다.
            image_in = int(usage.get("input_tokens") or 0)
        output = int(usage.get("output_tokens") or 0)
    except (AttributeError, TypeError, ValueError):
        return None
    if not (text_in or image_in or output):
        return None
    return round((text_in * IMAGE_PRICES["text_input"] + image_in * IMAGE_PRICES["image_input"]
                  + output * IMAGE_PRICES["image_output"]) / 1_000_000, 4)


def _bg_log(chat_id, usd, file_id=None):
    try:
        db.session.add(SnsCreditLog(chat_id=chat_id, job_kind=IMAGE_JOB_KIND, model=IMAGE_MODEL, credits=usd,
                                    request_id=file_id))
        db.session.commit()
    except Exception:  # noqa: BLE001  기록 실패로 결과를 잃지 않게 합니다.
        current_app.logger.exception("배경 그림 사용 기록 실패")
        db.session.rollback()


def _bg_unknown(chat_id, usd):
    """보낸 뒤 결과를 받지 못함 → 비용이 나갔을 수 있어 기록하고, 다시 누르지 말라고 알립니다."""
    _bg_log(chat_id, usd)
    return jsonify({"ok": False, "submitted": True,
                    "error": "요청은 OpenAI에 들어갔을 수 있어요(비용이 나갔을 수 있음). 다시 누르지 말고 OpenAI 사용 내역을 "
                             "확인해 주세요. 배경은 그대로 두었어요."}), 202


def _bg_http_message(error):
    """OpenAI가 거절한 이유를 쉬운 말로. 외부 오류 본문은 화면·로그에 그대로 내보내지 않습니다."""
    try:
        detail = error.read(4000).decode("utf-8", "ignore").lower()
    except Exception:  # noqa: BLE001
        detail = ""
    if "verif" in detail:
        return "OpenAI 조직 인증(Organization Verification)이 필요합니다. OpenAI 설정에서 인증을 마친 뒤 다시 시도해 주세요."
    if error.code in (401, 403):
        return "API 키 또는 이미지 모델 사용 권한을 확인해 주세요."
    if error.code == 429:
        return "OpenAI 사용 한도·잔액을 확인해 주세요."
    if "safety" in detail or "moderation" in detail:
        return "요청 내용이 OpenAI 안전 기준에 걸렸습니다. 원하는 장면 문장을 바꿔 다시 시도해 주세요."
    return f"OpenAI가 요청을 거절했습니다. (HTTP {error.code}) 배경은 그대로 두었어요."


@bp.route("/media/api/design-bg/quote", methods=["POST"])
def design_bg_quote():
    """무료 확인: 이번에 만들 장수 · 예상 비용 · 오늘 사용량."""
    try:
        _, doc, _, product, wish = _bg_target(_media_body())
    except ValueError as error:
        return _error(str(error))
    quote = _bg_quote(doc, product, wish)
    if quote["allowed"] and _image_lock.locked():
        quote.update(allowed=False, reason="다른 배경 그림을 만드는 중입니다. 끝난 뒤 다시 확인해 주세요.")
    return jsonify({"ok": True, "quote": quote})


@bp.route("/media/api/design-bg", methods=["POST"])
def design_bg():
    """비용이 나가는 유일한 배경 그림 API. 만든 그림은 요소로 돌려주고, 문서 저장은 편집기(기존 저장 경로)가 합니다."""
    try:
        body = _media_body()
        chat, doc, page, product, wish = _bg_target(body)
    except ValueError as error:
        return _error(str(error))
    if body.get("confirm_paid") is not True:
        return _error("비용 확인 창에서 [확인]을 눌러 실행해 주세요.")
    if not _image_lock.acquire(blocking=False):
        return _error("다른 배경 그림을 만드는 중입니다. 끝난 뒤 다시 확인해 주세요.", 409)
    try:
        quote = _bg_quote(doc, product, wish)
        confirmed = body.get("usd")
        if isinstance(confirmed, bool) or not isinstance(confirmed, (int, float)) or abs(confirmed - quote["usd"]) > 1e-9:
            return jsonify({"ok": False, "error": "견적이 바뀌었습니다. 다시 확인해 주세요.", "quote": quote}), 409
        if not quote["allowed"]:
            return jsonify({"ok": False, "error": quote["reason"], "quote": quote}), 409
        photos = background_photos(product, wish)
        folder = os.path.join(bp.static_folder, "images", "sns")
        files = []
        for name, _ in photos:
            with open(os.path.join(folder, name), "rb") as handle:
                files.append(("image[]", name, handle.read(), "image/png" if name.endswith(".png") else "image/jpeg"))
        data, content_type = _multipart(
            {"model": IMAGE_MODEL, "prompt": background_prompt(doc, page, product, wish, [role for _, role in photos]),
             "size": quote["size"], "quality": IMAGE_QUALITY, "n": "1", "output_format": "jpeg"}, files)
        req = Request(IMAGE_API, data=data, headers={"Authorization": f"Bearer {_openai_key()}",
                                                     "Content-Type": content_type})
        try:
            with urlopen(req, timeout=240) as response:
                raw = response.read(IMAGE_MAX_BYTES + 1)
            payload = json.loads(raw) if len(raw) <= IMAGE_MAX_BYTES else None
        except HTTPError as error:  # OpenAI가 받아서 거절함
            return _error(_bg_http_message(error), 502)
        except URLError as error:
            if isinstance(error.reason, TimeoutError):
                return _bg_unknown(chat.id, quote["usd"])
            return _error("OpenAI에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요. 요청은 보내지 않았어요.", 502)
        except (TimeoutError, OSError, ValueError):  # 보낸 뒤 응답을 끝까지 읽지 못함
            return _bg_unknown(chat.id, quote["usd"])
        usage = payload.get("usage") if isinstance(payload, dict) else None
        usd = _image_cost(usage) or quote["usd"]
        try:
            img = Image.open(io.BytesIO(base64.b64decode(payload["data"][0]["b64_json"], validate=True)))
            img.load()
            file_id = uuid.uuid4().hex
            img.convert("RGB").save(os.path.join(_export_dir(), f"{file_id}_bg.jpg"), "JPEG", quality=92)
        except (KeyError, IndexError, TypeError, ValueError, UnidentifiedImageError, OSError):
            return _bg_unknown(chat.id, usd)
        _bg_log(chat.id, usd, file_id)
        count, spent = _image_today()
        return jsonify({"ok": True, "page": page,
                        "element": background_element(page, f"{bp.url_prefix}/media/design-bg/{file_id}.jpg"),
                        "cost": {"usd": usd, "estimated": _image_cost(usage) is None, "price_checked": PRICE_CHECKED},
                        "model": IMAGE_MODEL, "today_count": count, "today_usd": spent,
                        "daily_limit": IMAGE_DAILY_LIMIT})
    finally:
        _image_lock.release()


# ---------- 비율 바꾸기 (무료, AI 아님) ----------
@bp.route("/media/api/design-ratio", methods=["POST"])
def design_ratio():
    """비율을 바꾼 새 문서를 돌려줍니다. 저장은 편집기가 기존 저장 경로(onSave)로 합니다."""
    try:
        body = _media_body()
        doc, _ = _design_request({"design": body.get("design"), "options": {}})
        return jsonify({"ok": True, "design": change_ratio(doc, body.get("ratio"))})
    except ValueError as error:
        return _error(str(error))
    except (TypeError, KeyError, AttributeError):
        return _error("초안 형식이 올바르지 않아 비율을 바꾸지 못했습니다.")


@bp.route("/media/design-bg/<file_id>.jpg")
def design_bg_image(file_id):
    if not BG_ID_RE.match(file_id):
        return _error("그림을 찾을 수 없습니다.", 404)
    return send_from_directory(_export_dir(), f"{file_id}_bg.jpg", mimetype="image/jpeg")
