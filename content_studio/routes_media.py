"""사진 업로드, 배경 제거(rembg), 숏폼 콘티, 광고 표현 검수, 카드뉴스 프롬프트 만들기. [희주]

API는 /content_studio/media/api/... 아래에 둡니다. 예: @bp.route("/media/api/remove-bg", methods=["POST"])
업로드·결과 파일은 instance/uploads/content_studio/, instance/exports/content_studio/ 에 저장합니다.
"""
import copy
import os
import re
import uuid
import json
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen

from flask import current_app, jsonify, request, send_from_directory
from PIL import Image, ImageOps, UnidentifiedImageError
from werkzeug.exceptions import NotFound

from platform_core.extensions import db

from . import bp
from .designs import (SIZES, build_cardnews_prompt, build_design_brief, design_proposal_schema,
                      design_texts, proposal_design, validate_proposals)
from .models_sns import SnsChat

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
    alpha_matting = request.form.get("alpha_matting") in ("1", "true", "on")
    folder = _upload_dir()
    upload = request.files.get("image")

    if upload:
        img, message = _open_image(upload.stream)
        if message:
            return _error(message)
        file_id = uuid.uuid4().hex
        # 원본은 방향만 바로잡아 PNG로 보관합니다. 다듬기만 바꿔 다시 처리할 때 씁니다.
        ImageOps.exif_transpose(img).save(os.path.join(folder, f"{file_id}_src.png"), "PNG")
    else:
        file_id = request.form.get("file_id", "")
        src = os.path.join(folder, f"{file_id}_src.png")
        if not FILE_ID_RE.match(file_id) or not os.path.exists(src):
            return _error("사진을 먼저 골라 주세요.")
        img = Image.open(src)

    try:
        result = _remove_background(img, alpha_matting)
    except ImportError:
        current_app.logger.exception("rembg를 불러오지 못했습니다.")
        return _error("배경 제거 기능이 아직 설치되지 않았습니다. (pip install -r requirements.txt)", 500)
    except Exception:  # noqa: BLE001  모델 처리 실패는 종류와 관계없이 같은 안내를 보여줍니다.
        current_app.logger.exception("배경 제거 실패")
        return _error("배경을 제거하지 못했습니다. 다른 사진으로 다시 시도해 주세요.", 500)

    result.save(os.path.join(_export_dir(), f"{file_id}_nobg.png"), "PNG")  # 결과는 exports에 둡니다. (README 5-6)
    return jsonify({
        "ok": True,
        "file_id": file_id,
        "result_url": f"{bp.url_prefix}/media/remove-bg/result/{file_id}.png",
        "width": result.width,
        "height": result.height,
    })


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


@bp.route("/media/api/design-brief", methods=["POST"])
def design_brief():
    try:
        doc, options = _design_request(_media_body())
        persona, brief, ready = build_design_brief(doc, options)
    except (ValueError, TypeError, KeyError):
        return _error("제품·요청·규격·장수를 확인해 주세요.")
    return jsonify({"ok": True, "prompt": persona + "\n\n[제작 요청]\n" + json.dumps(brief, ensure_ascii=False, indent=2),
                    "rules_ready": ready,
                    "ai_ready": bool(current_app.config.get("OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY"))})


@bp.route("/media/api/design-assistant", methods=["POST"])
def design_assistant():
    try:
        body = _media_body()
        doc, options = _design_request(body)
        persona, brief, ready = build_design_brief(doc, options)
    except (ValueError, TypeError, KeyError):
        return _error("제품·요청·규격·장수를 확인해 주세요.")
    if body.get("confirm_paid") is not True:
        return _error("유료 AI 제안 생성 버튼으로 실행해 주세요.")
    key = current_app.config.get("OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if not key:
        return _error("OpenAI 연결이 필요합니다. PM1에게 서버 API 키 설정을 요청해 주세요.", 503)
    schema = design_proposal_schema(brief["pages"])
    try:
        response = _api_json("https://api.openai.com/v1/responses",
                             {"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                             {"model": "gpt-4o-mini", "store": False, "instructions": persona,
                              "input": json.dumps(brief, ensure_ascii=False), "max_output_tokens": 6500,
                              "text": {"format": {"type": "json_schema", "name": "design_proposals",
                                                   "strict": True, "schema": schema}}})
        if response.get("status") != "completed":
            return _error("AI가 결과를 끝내지 못했습니다. 요청을 줄인 뒤 직접 다시 실행해 주세요.", 502)
        output = "".join(part.get("text", "") for item in response.get("output", [])
                         for part in item.get("content", []) if part.get("type") == "output_text")
        result = json.loads(output)
        validate_proposals(result, schema)
        proposals = [{**item, "design": proposal_design(doc, item, options)} for item in result["proposals"]]
        return jsonify({"ok": True, "proposals": proposals, "rules_ready": ready,
                        "usage": response.get("usage", {}), "model": "gpt-4o-mini"})
    except HTTPError as error:
        message = "API 키 또는 사용 권한을 확인해 주세요." if error.code in (401, 403) else "OpenAI 요청이 실패했습니다. 한도·잔액·모델 접근 권한을 확인해 주세요."
        return _error(message, 502)
    except (URLError, TimeoutError, OSError):
        return _error("AI 응답을 받지 못했습니다. 사용 내역 확인 후 다시 실행해 주세요. 자동 재시도하지 않았습니다.", 502)
    except (ValueError, KeyError, TypeError, AttributeError):
        return _error("AI 결과 형식이 올바르지 않아 적용하지 않았습니다. 기존 작업은 유지됩니다.", 502)


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
        else:
            return _plugin_error("가져올 수 없는 사진 주소입니다.")
    except NotFound:
        return _plugin_error("사진 파일을 찾을 수 없습니다.", 404)
    if isinstance(response, tuple):  # 파일이 없을 때 _error가 (응답, 상태) 를 돌려줍니다.
        return _for_plugin(*response)
    return _for_plugin(response)
