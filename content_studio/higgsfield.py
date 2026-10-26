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


def design_image_args(prompt, ratio, photos=(), exact_product=False):
    """포스터·카드뉴스 시안 한 장 그림 요청. prompt: 장 프롬프트(영어, 넣을 베트남어 문구 포함).
    photos: [(사진 경로, 역할 영어)] — 참고 사진으로 보내고 역할과 쓰는 법을 프롬프트 끝에 붙입니다.
    exact_product=False(카드뉴스·예전 방식): 사진은 생김새 참고일 뿐 새로 그리게("정확히 같게"라고 쓰면 오려 붙여서).
    exact_product=True(포스터 베이스 템플릿): 제품은 사진과 똑같이, 사진의 배경·소품·글자만 가져오지 않게."""
    photos = list(photos)[:IMAGE_REFS]
    text = prompt.strip()
    if photos and exact_product:
        text += (" Attached photos: " + "; ".join(f"{i + 1}) {role}" for i, (_, role) in enumerate(photos))
                 + ". Reproduce the product itself exactly as in these photos (shape, size, surface and filling), "
                   "but place it naturally in this poster's scene and lighting. Do not copy the photos' backgrounds, "
                   "wrapping, tags, plates or props, and never draw any text, letters or labels seen in the photos.")
    elif photos:
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


# ---------- 포스터 장면 프롬프트 뒤에 붙이는 것 (2026-10-27 유진 결정) ----------
# 장면(구도·바탕·색·조명·분위기)은 희주 도우미가 자유롭게 쓰고(B 시험 그림 방식), 여기서는 로고 자리와 금지 규칙만 붙입니다.
# 참고 사진은 design_image_args(exact_product=False)로 "생김새만 참고, 장면에 맞게 새로 그리기".
POSTER_SUFFIX = (
    " [BRAND LOGO AREA] Keep a clean empty area at the bottom center (the lowest tenth of the image) for a brand logo "
    "added later. Do not draw any logo, emblem, seal or brand name anywhere."
    " [RULES] No people, no faces, no hands or fingers. No artificial CGI look and no oversaturated plastic-like "
    "colors. No messy or cluttered background. No watermarks.")


def poster_scene_prompt(prompt):
    """희주 도우미가 쓴 포스터 장면 프롬프트 + 로고 자리·금지 규칙."""
    return prompt.strip() + POSTER_SUFFIX


# ---------- 포스터 디자인 베이스 템플릿 (희주 님이 장면 프롬프트 방식으로 되돌리면 삭제 예정) ----------
# 유진이 받은 지시서(프롬프트 빌더)를 우리 제품(products.py)·Higgsfield 흐름에 맞춘 것. 포스터만 쓰고 카드뉴스는 예전 방식.
# 희주 design-assistant는 짧은 베트남어 문구만 만들고, 레이아웃·톤·규칙은 여기서 조립합니다.
# 로고는 그림 모델이 그리지 않고 아래 가운데 자리만 비워 둡니다(희주 편집기가 brand_logo.png를 얹음).
POSTER_BASE = """Use the provided reference photos as the exact product.
Keep the product's shape, proportions, size, color, surface texture and filling
exactly identical to the reference. Do not redesign, reshape or stylize the product.

[PRODUCT]
{product_line}

[TYPE]
{orientation} premium dessert advertising poster, {ratio} {frame}, high-end print quality.
Luxury confectionery campaign aesthetic: minimal, refined, editorial.

[BACKGROUND]
Single-tone {bg_color} background with a subtle fine-grain paper texture.
No gradients, no scenery, no table edges.

[LAYOUT]
{layout_block}

[LIGHTING]
Soft diffused studio light from the upper left, one gentle natural soft shadow
under the product. Crisp product focus, fine detail on the mochi surface.
Photorealistic commercial food photography shot with a real camera.

[COLOR]
Background stays muted. Accent colors come only from the props ({accent_color}).
Natural, fresh, appetizing food colors. Maximum 3 colors in total plus dark brown text.

{text_block}

[BRAND LOGO AREA]
Keep a clean empty area at the bottom center (the lowest tenth of the image) for a brand logo added later.
Do not draw any logo, emblem, seal or brand name there or anywhere else.

[MOOD]
Quiet luxury, elegant and calm, like a premium department-store dessert boutique
campaign. Generous negative space around every element.{style_line}

[STRICT RULES]
- The product must look exactly like the reference photos: no warping, melting,
  bending, stretching or distortion of its shape.
- Rice cake texture must look soft, fresh and plump: never rubbery, stretched,
  slimy, glossy-wet, melting, sagging, collapsed or dull-colored.
- No artificial CGI look, no fake physics, no oversaturated plastic-like colors.
- No people, no faces, no hands, no fingers.
- No watermarks and no logos.
- Clean composition, no clutter, no busy background."""

POSTER_NO_TEXT = """[TEXT]
No text, no letters, no captions, no logos, no watermarks anywhere in the image.
Keep the top third as clean empty space for text added later."""

POSTER_LAYOUTS = {
    "A": {"label": "A 재료 프레이밍", "block": (
        "One hero product placed in the exact center, slightly below the middle. "
        "{Props} and delicate flower petals scattered around the outer edges of the "
        "frame, forming a loose oval border that frames the product. "
        "The area around the product stays clean and empty.")},
    "B": {"label": "B 플로팅", "block": (
        "Four to five pieces of the product floating diagonally from upper right to "
        "lower left at different angles, one cut open to show the filling. "
        "A few small pieces of {props} suspended around them, still and elegant. "
        "Two pieces resting on the ground plane above the logo area. "
        "The top area stays clear.")},
    "C": {"label": "C 페이퍼컷 윈도우", "block": (
        "Three pieces of the product arranged in a tight cluster in the center, one cut open to show the filling. "
        "Around them, 3 teardrop-shaped cut-out windows in the paper background, "
        "with real paper-cut depth and soft inner shadows. Inside each window, "
        "a close-up photo of {props}. A few small paper confetti shapes in "
        "{accent_color} tones scattered loosely from two corners.")},
}
POSTER_LAYOUT_KEYS = tuple(POSTER_LAYOUTS)

# 새로 만들기 스타일 버튼(희주 designs.py STYLE_HINTS key)별 한 줄. [MOOD] 끝에 붙입니다. ""(AI 추천)은 붙이지 않음.
POSTER_STYLE_LINES = {
    "bold": "Style: very large, heavy headline with strong contrast between text and background.",
    "editorial": "Style: magazine editorial look with a refined serif headline, thin lines and wide margins.",
    "menu": "Style: neat cafe-menu look, tidy and organized, with small divider lines.",
    "pop": "Style: cheerful social-media pop look with brighter accents and a few small sticker shapes; "
           "the product stays realistic.",
    "minimal": "Style: ultra-minimal, very wide empty space, small headline and very few props.",
}
POSTER_STYLE_KEYS = ("", *POSTER_STYLE_LINES)

# 제품별 톤 (products.py id). 제품을 고르면 자동으로 정해집니다. 여러 제품이면 "lineup".
POSTER_TONES = {
    "mango_yogurt": {"bg_color": "pale peach ivory", "accent_color": "warm mango orange and creamy white",
                     "props": "fresh ripe mango slices and cubes with a small dollop of white yogurt"},
    "honey_red_dragonfruit": {"bg_color": "warm cream ivory", "accent_color": "magenta and golden honey",
                              "props": "fresh sliced red dragon fruit with vivid magenta flesh and tiny black seeds, "
                                       "with a thin drizzle of golden honey"},
    "mangosteen_yogurt": {"bg_color": "soft lavender ivory", "accent_color": "deep purple and white",
                          "props": "fresh halved mangosteen showing pearly white segments"},
    "durian": {"bg_color": "soft butter ivory", "accent_color": "creamy yellow and soft green",
               "props": "fresh durian pods with creamy pale-yellow flesh"},
    "lineup": {"bg_color": "warm cream ivory", "accent_color": "warm gold with soft fruit colors",
               "props": "small fresh pieces of mango, red dragon fruit, mangosteen and durian"},
}
POSTER_TEXT_KEYS = ("badge_vi", "eyebrow_vi", "headline_vi", "sub_vi")
POSTER_TEXT_MAX = 60  # 칸마다 글자 수 (그림 속 글자는 짧을수록 정확)


def poster_frame(ratio):
    w, h = (int(x) for x in ratio.split(":"))
    if w == h:
        return "Square", "square format"
    return ("Vertical", "portrait") if h > w else ("Horizontal", "landscape")


def _poster_text_block(texts, accent_color):
    """문구 블록. 헤드라인이 없으면 None(글자 없는 포스터). 배지·윗줄·아랫줄은 있을 때만."""
    texts = {key: " ".join(str((texts or {}).get(key) or "").split()).replace('"', "'")[:POSTER_TEXT_MAX]
             for key in POSTER_TEXT_KEYS}
    if not texts["headline_vi"]:
        return None
    lines = ["[TEXT ELEMENTS - render exactly as written, Vietnamese]"]
    if texts["badge_vi"]:
        lines.append(f'Small circular seal badge near a top corner, dark brown with ivory text: "{texts["badge_vi"]}"')
    if texts["eyebrow_vi"]:
        lines.append(f'Lower area, small widely letter-spaced uppercase sans-serif: "{texts["eyebrow_vi"]}"')
    lines.append(f'Large high-contrast elegant serif headline with a soft {accent_color} gradient, '
                 f'at most two lines: "{texts["headline_vi"]}"')
    if texts["sub_vi"]:
        lines.append(f'One short line in thin sans-serif just above the logo area: "{texts["sub_vi"]}"')
    lines.append("No other text anywhere. Spell every word exactly, keep all Vietnamese diacritics.")
    return "\n".join(lines)


def design_poster_prompt(products, layout, ratio, texts=None, style=""):
    """포스터 베이스 템플릿 조립. products: products.py 제품 목록(1개 이상), layout: "A"|"B"|"C",
    ratio: IMAGE_RATIOS 키, texts: {badge_vi, eyebrow_vi, headline_vi, sub_vi} (headline이 없으면 글자 없는 포스터),
    style: 스타일 버튼 값(POSTER_STYLE_LINES key, ""은 AI 추천)."""
    tone = POSTER_TONES["lineup" if len(products) > 1 else products[0]["id"]]
    if len(products) > 1:
        product_line = ("Hanjungsun chapssal-tteok in " + str(len(products)) + " flavors, one of each: "
                        + "; ".join(PRODUCT_LOOK.get(item["name_ko"], (item["name_ko"],))[0] for item in products) + ".")
    else:
        look = PRODUCT_LOOK.get(products[0]["name_ko"], (products[0]["name_ko"],))[0]
        product_line = f"Hanjungsun {PRODUCT_EN.get(products[0]['name_ko'], 'chapssal-tteok')}: {look}."
    orientation, frame = poster_frame(ratio)
    layout_block = POSTER_LAYOUTS[layout]["block"].format(props=tone["props"], Props=tone["props"][:1].upper() + tone["props"][1:],
                                                         accent_color=tone["accent_color"])
    text_block = _poster_text_block(texts, tone["accent_color"]) or POSTER_NO_TEXT
    style_line = f"\n{POSTER_STYLE_LINES[style]}" if style in POSTER_STYLE_LINES else ""
    return POSTER_BASE.format(product_line=product_line, orientation=orientation, ratio=ratio, frame=frame,
                              bg_color=tone["bg_color"], layout_block=layout_block,
                              accent_color=tone["accent_color"], text_block=text_block, style_line=style_line)


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
