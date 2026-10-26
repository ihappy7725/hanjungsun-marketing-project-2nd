"""Higgsfield 연동 — 서버 PC에 로그인된 Higgsfield CLI(@higgsfield/cli)를 실행합니다. [유진]

키·환경변수는 쓰지 않습니다. 로그인은 서버 PC에서 `higgsfield auth login`으로 한 번 합니다(유진 Ultra 계정).
크레딧이 나가는 것은 create()뿐이고, 비용·잔액·상태 확인은 무료입니다.
오래 걸리는 작업은 작업 ID와 상태를 저장하고 화면에서 상태를 조회합니다. (README 6·7장)
"""
import json
import os
import re
import shutil
import subprocess

from .videos import COMMON_AVOID, FOOD_AVOID, PRODUCT_EN, PRODUCT_LOOK, STYLES, _action, _shot, scene_kind

# 결정 사항 (README 10장, 2026-10-24 유진)
VIDEO_MODEL = "kling4_0"            # Kling 4.0
VIDEO_RESOLUTION = "720p"
IMAGE_MODEL = "nano_banana_flash"   # Nano Banana 2 (미리보기 이미지)
# 포스터·카드뉴스 시안 그림 (2026-10-27 유진 결정): 그림 속 베트남어 글자가 깨지지 않게 GPT Image 2 high 2k,
# 장당 6.5크레딧(generate cost 확인). 처음엔 Nano Banana Pro(2크레딧)였으나 긴 제목 글자가 겹치고 틀려서 바꿈.
DESIGN_IMAGE_MODEL = "gpt_image_2"
DESIGN_IMAGE_LABEL = "GPT Image 2"
DESIGN_IMAGE_RESOLUTION = "2k"
DESIGN_IMAGE_QUALITY = "high"
DAILY_LIMIT = 200                   # 대시보드에서 쓰는 크레딧, 하루(한국 시간) 한도

DONE, FAILED = "completed", ("failed", "nsfw", "canceled", "cancelled")
KLING_IMAGES = 10                   # Kling 4.0: 첫·끝 장면 포함 이미지 10장까지
IMAGE_REFS = 10                     # 미리보기 이미지 참고 사진 (Nano Banana 2, 넉넉히 같은 수로)
# 영상 미리보기는 9:16·16:9·1:1, 포스터·카드뉴스 시안 그림은 4:5·3:4·4:3까지 (generate cost로 확인, 2026-10-26)
IMAGE_RATIOS = {"9:16": "9:16", "16:9": "16:9", "1:1": "1:1", "4:5": "4:5", "3:4": "3:4", "4:3": "4:3"}


class HiggsfieldError(Exception):
    """code: missing(CLI 없음) · login(로그인 필요) · failed(요청 실패)"""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def _binary():
    """npm의 higgsfield.cmd는 줄바꿈 있는 프롬프트를 깨뜨리므로, 같이 설치된 hf.exe를 바로 실행합니다."""
    launcher = shutil.which("higgsfield")
    if launcher:
        exe = "hf.exe" if os.name == "nt" else "hf"
        vendor = os.path.join(os.path.dirname(launcher), "node_modules", "@higgsfield", "cli", "vendor", exe)
        if os.path.exists(vendor):
            return vendor
    return shutil.which("hf")


def _run(args, timeout=90, raw=False):
    """CLI 실행 → JSON. raw=True면 읽기 전 글자 그대로 돌려줍니다(생성 응답 모양이 달라도 작업 ID를 찾으려고)."""
    binary = _binary()
    if not binary:
        raise HiggsfieldError("missing", "이 PC에 Higgsfield CLI가 없습니다. (README 6장 설치 안내)")
    try:
        done = subprocess.run([binary, *args, "--json", "--no-color"], capture_output=True, text=True,
                              encoding="utf-8", timeout=timeout)
    except subprocess.TimeoutExpired:
        raise HiggsfieldError("failed", "Higgsfield 응답이 늦습니다. 잠시 후 다시 확인해 주세요.")
    output = (done.stdout or "").strip()
    message = (done.stderr or output).strip()
    if done.returncode != 0:
        if re.search(r"auth login|session expired|not (logged|signed) in|unauthori[sz]ed|workspace", message, re.I):
            raise HiggsfieldError("login", "Higgsfield 로그인이 필요합니다. 서버 PC에서 `higgsfield auth login`을 실행해 주세요.")
        # 토큰이 섞여 나오지 않도록 첫 줄만, 짧게 돌려줍니다.
        raise HiggsfieldError("failed", f"Higgsfield 요청 실패: {message.splitlines()[0][:200] if message else '알 수 없는 오류'}")
    if raw:
        return output
    try:
        return json.loads(output)
    except ValueError:
        raise HiggsfieldError("failed", "Higgsfield 응답을 읽지 못했습니다.")


# ---------- 요청 내용 ----------
def video_args(doc, start_image=None, photos=(), videos=(), end_image=None):
    """영상 문서 → Kling 4.0 요청. photos: 참고 사진(파일 경로·작업 ID, 중요한 것부터), videos: 참고 영상 경로(CLI가 직접 올림).
    start_image·end_image: 첫 컷·마지막 컷 미리보기 이미지(작업 ID). 이미지는 첫·끝 포함 10장까지라 뒤쪽 참고 사진을 뺍니다.
    참고 영상이 있으면 reference-to-video(Kling은 image-to-video에 영상을 못 넣음, 첫·끝 장면은 함께),
    없으면 미리보기 이미지가 있을 때 image-to-video, 사진만 있으면 reference-to-video.
    Kling 4.0에는 소리 옵션이 없어, 소리는 프롬프트 문장으로만 전달됩니다."""
    args = [VIDEO_MODEL, "--prompt", doc.get("custom") or doc["prompt"], "--duration", str(doc["duration"]),
            "--resolution", VIDEO_RESOLUTION]
    if end_image and not start_image:  # 첫 장면 없이 끝 장면만 있으면 참고 사진으로
        photos, end_image = [end_image, *photos], None
    room = KLING_IMAGES - bool(start_image) - bool(end_image)
    refs = [part for path in list(photos)[:room] for part in ("--image-references", path)]
    frames = (["--start-image", start_image] if start_image else []) + (["--end-image", end_image] if end_image else [])
    if videos:
        clips = [part for path in videos for part in ("--video-references", path)]
        return args + ["--mode", "reference-to-video", "--aspect_ratio", doc["ratio"], *frames, *refs, *clips]
    if start_image:  # 비율을 꼭 보냅니다(안 보내면 Kling 기본값 16:9)
        return args + ["--mode", "image-to-video", "--aspect_ratio", doc["ratio"], *frames, *refs]
    if photos:
        return args + ["--mode", "reference-to-video", "--aspect_ratio", doc["ratio"], *refs]
    return args + ["--mode", "text-to-video", "--aspect_ratio", doc["ratio"]]


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
    args = [IMAGE_MODEL, "--prompt", image_prompt(doc, [role for _, role in photos], index),
            "--aspect_ratio", IMAGE_RATIOS.get(doc["ratio"], "9:16")]
    return args + [part for path, _ in photos for part in ("--image-references", path)]


def design_image_args(prompt, ratio, photos=()):
    """포스터·카드뉴스 시안 한 장 그림 요청. prompt: 희주 design-assistant가 쓴 장 프롬프트(영어, 넣을 베트남어 문구 포함).
    photos: [(사진 경로, 역할 영어)] — 참고 사진으로 보내고, 사진은 생김새 참고일 뿐 새로 그리라는 문장을 끝에 붙입니다.
    ("사진과 정확히 같게"라고 쓰면 사진을 그대로 오려 붙여서, 2026-10-27 시험 뒤 바꿈)"""
    photos = list(photos)[:IMAGE_REFS]
    text = prompt.strip()
    if photos:
        text += (" Attached photos: " + "; ".join(f"{i + 1}) {role}" for i, (_, role) in enumerate(photos))
                 + ". Use the attached photos only to understand what the product looks like (round shape, soft white "
                   "rice-flour skin, filling color and texture). Do not paste, cut out or collage the photos: draw the "
                   "product fresh so it fits this scene's composition, camera angle and lighting. Do not copy props from "
                   "the photos (wrapping paper, tags, plates or backgrounds) unless the prompt asks for them. "
                   "Never draw any text, letters, labels or tags seen in the photos; the only text in the image is the "
                   "text written in this prompt.")
    args = [DESIGN_IMAGE_MODEL, "--prompt", text, "--aspect_ratio", IMAGE_RATIOS[ratio],
            "--resolution", DESIGN_IMAGE_RESOLUTION, "--quality", DESIGN_IMAGE_QUALITY]
    return args + [part for path, _ in photos for part in ("--image-references", path)]


# ---------- 무료 확인 ----------
def balance():
    """계정 전체 남은 크레딧 (웹에서 쓴 것도 반영)."""
    return float(_run(["account", "status"])["credits"])


def cost(args):
    return float(_run(["generate", "cost", *args])["credits"])


UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


def _job(data):
    """CLI 작업 응답 → {request_id, status, url}. 목록이면 첫 작업, 작업 묶음이면 그 안의 첫 작업,
    작업 ID 글자만 오면 그 ID를 씁니다. 모양을 모르면 request_id가 None입니다."""
    if isinstance(data, list):
        data = data[0] if data else {}
    if isinstance(data, dict) and isinstance(data.get("jobs"), list) and data["jobs"]:
        data = data["jobs"][0]
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
        url = results.get("url") or (results.get("raw") or {}).get("url")
    return {
        "request_id": data.get("id") or data.get("job_id"),
        "status": data.get("status") or data.get("job_status") or "queued",
        "url": url,
    }


def get_job(request_id):
    return _job(_run(["generate", "get", request_id]))


# ---------- 크레딧이 나가는 요청 ----------
class Submitted(Exception):
    """생성 요청은 Higgsfield에 들어갔는데(크레딧이 나갔을 수 있음) 작업 ID를 알 수 없을 때."""


def create(args):
    """생성 요청만 보내고 바로 돌아옵니다(기다리지 않음). 이 함수만 크레딧을 씁니다.
    응답 모양이 예상과 달라도 ① JSON 해석 ② 응답 글자 속 작업 ID ③ 방금 만든 작업(작업 목록, 무료) 순서로 작업 ID를 찾습니다.
    그래도 못 찾으면 Submitted — 부른 쪽은 크레딧을 기록하고 다시 요청하지 않게 합니다."""
    output = _run(["generate", "create", *args], timeout=180, raw=True)
    try:
        job = _job(json.loads(output))
    except ValueError:
        job = {"request_id": None, "status": "queued", "url": None}
    if not job["request_id"]:
        found = UUID.findall(output)
        if found:
            job["request_id"] = found[0]
    if not job["request_id"]:
        job = _latest_job(args[0])
    if not job or not job["request_id"]:
        raise Submitted("생성 요청은 보냈지만 작업 ID를 받지 못했습니다.")
    return job


def _latest_job(job_type):
    """방금 만든 같은 모델의 작업(작업 목록 맨 앞, 무료). 못 찾으면 None."""
    try:
        items = _run(["generate", "list", "--size", "5"])
    except HiggsfieldError:
        return None
    for item in items if isinstance(items, list) else []:
        if isinstance(item, dict) and item.get("job_type") == job_type:
            return _job(item)
    return None
