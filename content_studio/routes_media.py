"""사진 업로드, 배경 제거(rembg), 숏폼 콘티, 광고 표현 검수, 카드뉴스 프롬프트 만들기. [희주]

API는 /content_studio/media/api/... 아래에 둡니다. 예: @bp.route("/media/api/remove-bg", methods=["POST"])
업로드·결과 파일은 instance/uploads/content_studio/, instance/exports/content_studio/ 에 저장합니다.
"""
import os
import re
import uuid

from flask import current_app, jsonify, request, send_from_directory
from PIL import Image, ImageOps, UnidentifiedImageError

from . import bp
from .designs import build_cardnews_prompt, design_texts

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
