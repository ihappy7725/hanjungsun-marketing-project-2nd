"""사진 업로드, 배경 제거(rembg), 숏폼 콘티, 광고 표현 검수. [희주]

API는 /content_studio/media/api/... 아래에 둡니다. 예: @bp.route("/media/api/remove-bg", methods=["POST"])
업로드·결과 파일은 instance/uploads/content_studio/, instance/exports/content_studio/ 에 저장합니다.
"""
import os
import re
import uuid

from flask import current_app, jsonify, request, send_from_directory
from PIL import Image, ImageOps, UnidentifiedImageError

from . import bp

ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}
MAX_SIDE = 4096
REMBG_MODEL = "birefnet-general"  # 사람·물건·동물 모두 처리하는 범용 모델 (처음 실행 때 약 1GB 내려받음)
FILE_ID_RE = re.compile(r"^[0-9a-f]{32}$")

_session = None  # rembg 모델은 처음 배경 제거를 할 때 한 번만 불러옵니다.


def _error(message, status=400):
    return jsonify({"ok": False, "error": message}), status


def _upload_dir():
    path = os.path.join(current_app.config["UPLOAD_ROOT"], "content_studio")
    os.makedirs(path, exist_ok=True)
    return path


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

    result.save(os.path.join(folder, f"{file_id}_nobg.png"), "PNG")
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
    return send_from_directory(_upload_dir(), f"{file_id}_nobg.png", mimetype="image/png",
                               download_name=f"nobg_{file_id[:8]}.png")
