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

from .videos import COMMON_AVOID, PRODUCT_LOOK, STYLES

# 결정 사항 (README 10장, 2026-10-24 유진)
VIDEO_MODEL = "kling4_0"            # Kling 4.0
VIDEO_RESOLUTION = "720p"
IMAGE_MODEL = "nano_banana_flash"   # Nano Banana 2 (미리보기 이미지)
DAILY_LIMIT = 200                   # 대시보드에서 쓰는 크레딧, 하루(한국 시간) 한도

DONE, FAILED = "completed", ("failed", "nsfw", "canceled", "cancelled")
IMAGE_RATIOS = {"9:16": "9:16", "16:9": "16:9", "1:1": "1:1"}


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


def _run(args, timeout=90):
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
    try:
        return json.loads(output)
    except ValueError:
        raise HiggsfieldError("failed", "Higgsfield 응답을 읽지 못했습니다.")


# ---------- 요청 내용 ----------
def video_args(doc, start_image=None, photo=None):
    """영상 문서 → Kling 4.0 요청. photo: 서버에 올린 제품 사진 경로(CLI가 직접 올림)를 참고 사진으로 보냅니다.
    미리보기 이미지가 있으면 첫 장면으로(image-to-video), 없으면 제품 사진 참고(reference-to-video).
    Kling 4.0에는 소리 옵션이 없어, 소리는 프롬프트 문장으로만 전달됩니다."""
    args = [VIDEO_MODEL, "--prompt", doc.get("custom") or doc["prompt"], "--duration", str(doc["duration"]),
            "--resolution", VIDEO_RESOLUTION]
    refs = ["--image-references", photo] if photo else []
    if start_image:
        return args + ["--mode", "image-to-video", "--start-image", start_image, *refs]
    if photo:
        return args + ["--mode", "reference-to-video", "--aspect_ratio", doc["ratio"], *refs]
    return args + ["--mode", "text-to-video", "--aspect_ratio", doc["ratio"]]


def image_prompt(doc, photo=False):
    """미리보기 이미지(영상 첫 장면) 프롬프트: 첫 컷 + 제품 고정 문장 + 분위기·조명. 글자는 넣지 않습니다."""
    style = STYLES.get(doc.get("style")) or STYLES["premium"]
    look = PRODUCT_LOOK.get(doc.get("product"), (None,))[0]
    first = doc["scenes"][0]["en"] if doc.get("scenes") else "product hero shot"
    parts = [
        f"Photorealistic still frame, the opening shot of a {style['genre'][0]}: {first}.",
        f"The product: {look}." if look else "",
        "The product must look exactly like the attached product photo." if photo else "",
        f"Style: {style['keywords'][0]}.",
        f"Setting: {doc.get('background', '')}, {doc.get('mood', '')} mood, {doc.get('lighting', '')}.",
        COMMON_AVOID[0] + ".",
    ]
    return " ".join(part for part in parts if part)


def image_args(doc, photo=None):
    """미리보기 이미지 요청. photo(제품 사진 경로)가 있으면 참고 사진으로 보냅니다."""
    args = [IMAGE_MODEL, "--prompt", image_prompt(doc, bool(photo)), "--aspect_ratio", IMAGE_RATIOS.get(doc["ratio"], "9:16")]
    return args + ["--image-references", photo] if photo else args


# ---------- 무료 확인 ----------
def balance():
    """계정 전체 남은 크레딧 (웹에서 쓴 것도 반영)."""
    return float(_run(["account", "status"])["credits"])


def cost(args):
    return float(_run(["generate", "cost", *args])["credits"])


def _job(data):
    """CLI 작업 응답 → {request_id, status, url}. 목록으로 오면 첫 작업을 씁니다."""
    if isinstance(data, list):
        data = data[0] if data else {}
    if isinstance(data.get("jobs"), list) and data["jobs"]:
        data = data["jobs"][0]
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
def create(args):
    """생성 요청만 보내고 바로 돌아옵니다(기다리지 않음). 이 함수만 크레딧을 씁니다."""
    job = _job(_run(["generate", "create", *args], timeout=180))
    if not job["request_id"]:
        raise HiggsfieldError("failed", "Higgsfield가 작업 ID를 주지 않았습니다. 중복 결제를 막으려고 다시 요청하지 않습니다.")
    return job
