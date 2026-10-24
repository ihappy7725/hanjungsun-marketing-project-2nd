"""영상 프롬프트 초안 만들기·고치기. [유진]

흐름: Higgsfield 프롬프트 초안 → 사용자 검토·승인 → 생성 (README 3장)

지금은 단어 규칙으로 만듭니다. 나중에 AI(GPT)를 연결해도 같은 문서 형식(README 8장)을 돌려줍니다.
- 영상에는 글자를 그리지 않고(prompt에 no text), 베트남어 자막(caption)은 장면마다 따로 저장해 영상 위에 얹습니다.
- 자막 문구는 시연용이며 원어민 검수 전입니다(demo=True).
- 분위기(style) 5가지에 따라 장르·스타일 키워드·컷별 카메라·조명·소리·금지 문장을 조립합니다 (STYLES).
- 길이는 5~30초. 한 번에 만들 수 있는 길이는 생성 모델마다 다르므로 5단계(Higgsfield 연동)에서 맞춥니다.
"""
import copy
import math
import re

RATIOS = ("9:16", "16:9", "1:1")
MIN_DURATION, MAX_DURATION = 5, 30
MAX_SCENES = 8        # 길이로 자동으로 정하는 컷 수의 최대
MAX_MANUAL_SCENES = 12  # 컷 추가로 늘릴 수 있는 최대 (컷마다 1초 이상)

CAMERAS = ("slow smooth dolly-in", "steady medium push-in", "dynamic quick cuts")
LIGHTINGS = ("dim warm low-key lighting", "soft warm natural lighting", "bright airy high-key lighting")

PRODUCT_EN = {"찹쌀떡": "Korean chapssal-tteok mochi", "망고스틴 찹쌀떡": "mangosteen mochi"}
PRODUCT_VI = {"찹쌀떡": "Bánh mochi Hàn Quốc", "망고스틴 찹쌀떡": "Bánh mochi măng cụt"}
EVENT_VI = {
    "베트남 스승의 날": "Ngày Nhà giáo Việt Nam",
    "베트남 여성의 날": "Ngày Phụ nữ Việt Nam",
    "크리스마스": "Giáng sinh",
    "설날": "Tết",
}
BRAND_CAPTION = "Hanjungsun – Hương vị Hàn Quốc"

TEXTURE_SCENE = {
    "ko": "반으로 갈라 쫀득한 속 보여주기",
    "en": "the rice cake pulled apart, showing a soft chewy filling",
    "caption": "Mềm dẻo trong từng miếng",
}
BITE_SCENE = {
    "ko": "한입 베어 무는 장면",
    "en": "a person taking a happy first bite",
    "caption": "Ngọt ngào trong từng miếng",
}
# 길이가 길어 장면이 늘어날 때 가운데에 차례로 넣는 장면
EXTRA_SCENES = (
    {"ko": "접시를 천천히 돌리며 보여주기", "en": "a slowly rotating plate of rice cakes", "caption": ""},
    {"ko": "손으로 집어 드는 장면", "en": "a hand gently picking up a rice cake", "caption": ""},
    {"ko": "차 한 잔과 함께 놓인 찹쌀떡", "en": "rice cakes served beside a cup of tea", "caption": ""},
    {"ko": "친구와 나눠 먹는 장면", "en": "friends sharing rice cakes and smiling", "caption": ""},
    {"ko": "선물 상자에 담는 장면", "en": "rice cakes being placed into a gift box", "caption": ""},
)
ORDINALS = {"첫": 1, "두": 2, "세": 3, "네": 4, "다섯": 5, "여섯": 6, "일곱": 7, "여덟": 8}

# 한국어 프롬프트 보기(prompt_ko)용 대응표. 번역기가 아니라 같은 조합을 한국어로 조립합니다.
CAMERA_KO = {
    CAMERAS[0]: "천천히 부드럽게 다가가는 카메라",
    CAMERAS[1]: "안정적으로 조금씩 다가가는 카메라",
    CAMERAS[2]: "빠르고 역동적인 컷 전환",
}
LIGHTING_KO = {
    LIGHTINGS[0]: "어둡고 따뜻한 저조도 조명",
    LIGHTINGS[1]: "부드럽고 따뜻한 자연광",
    LIGHTINGS[2]: "밝고 화사한 조명",
}
MOOD_KO = {
    "cozy, welcoming": "아늑하고 반가운",
    "warm, festive, heartfelt": "따뜻하고 축제 같은, 진심 어린",
    "fresh, delicious, premium": "신선하고 맛있는, 고급스러운",
}
BACKGROUND_KO = {
    "a cozy Korean dessert shop in Da Nang": "다낭의 아늑한 한국 디저트 가게",
    "a gift table with ribbon and wrapping paper": "리본과 포장지가 놓인 선물 테이블",
    "a clean light wooden table": "깔끔하고 밝은 나무 테이블",
}

# 제품 겉모습 고정 문장. 매 컷 같은 모양·색이 나오게 합니다. (시연용 추정 — 실제 제품 사진으로 확인 필요)
PRODUCT_LOOK = {
    "찹쌀떡": ("round, soft white rice cakes dusted with fine rice flour, with a sweet red bean filling",
              "고운 쌀가루를 묻힌 둥글고 하얀 찹쌀떡, 속은 달콤한 팥소"),
    "망고스틴 찹쌀떡": ("round, soft rice cakes with a pale purple tint and a juicy white mangosteen filling",
                  "연보라빛이 도는 둥근 찹쌀떡, 속은 하얀 망고스틴 과육"),
}
COMMON_AVOID = ("no text, no letters, no subtitles, no logos, no watermarks, no distorted hands or extra fingers, "
                "no warping or morphing of the product",
                "글자·자막·로고·워터마크 없음, 손 모양 왜곡·손가락 추가 없음, 제품 모양이 변하거나 일그러지지 않게")

# 분위기 5가지. 요청 문장의 단어로 고르고, 입력줄에서 "브이로그 느낌으로"처럼 바꿀 수 있습니다.
# 구조는 영상 프롬프트 모음(youmind) 분석: 장르 줄 → 스타일 키워드 → 대상 고정 → 초 단위 컷 → 카메라 → 조명·색감 → 소리 → 금지.
# shots: (첫 컷, 가운데 컷들(차례로 반복), 마지막 컷) 화면·카메라 지시 / sfx: 같은 자리의 효과음 / weights: 컷 길이 비율
STYLES = {
    "premium": {
        "label": "프리미엄 광고",
        "pattern": r"고급|프리미엄|럭셔리",
        "genre": ("Premium food commercial", "프리미엄 음식 광고"),
        "keywords": ("photorealistic, macro cinematography, shallow depth of field, glossy dark surface, "
                     "fine rice flour drifting in the air, warm golden rim light, high-end commercial color grading",
                     "사실적, 매크로 촬영, 얕은 심도, 광택 있는 어두운 바닥, 공기 중에 흩날리는 고운 쌀가루, "
                     "따뜻한 금빛 윤곽광, 고급 광고 색보정"),
        "camera": ("smooth, slow cinematic moves; the product stays still and only the camera moves; "
                   "no spinning or orbiting around the product",
                   "부드럽고 느린 시네마틱 움직임, 제품은 고정하고 카메라만 움직임, 제품 주위를 돌지 않음"),
        "grade": ("rich contrast, warm golden highlights, deep soft shadows", "풍부한 대비, 따뜻한 금빛 하이라이트, 깊고 부드러운 그림자"),
        "lighting": 0,
        "music": ("elegant minimal piano with soft ambient pads", "우아하고 간결한 피아노와 잔잔한 앰비언트"),
        "avoid": ("no cluttered background, no kitchen tools", "어수선한 배경·주방 도구 없음"),
        "shots": (("extreme macro close-up, slow dolly-in", "초접사 클로즈업, 천천히 다가가기"),
                  (("macro slow motion, shallow depth of field", "매크로 슬로모션, 얕은 심도"),
                   ("smooth lateral tracking shot", "부드러운 옆 방향 트래킹"),
                   ("top-down overhead shot", "위에서 내려다보는 샷")),
                  ("slow pull-back to a centered hero shot, product perfectly still", "천천히 빠지며 가운데 제품 히어로 샷, 제품은 고정")),
        "sfx": (("soft whoosh", "부드러운 바람 소리"), ("gentle squish of soft mochi", "말랑한 떡이 눌리는 소리"),
                ("subtle shimmer chime", "은은한 반짝임 소리")),
        "weights": (1, 1, 1.6),
    },
    "warm": {
        "label": "따뜻한 감성",
        "pattern": r"감성|가족|따뜻한\s*(느낌|분위기)|선물|기념일|축하",
        "switch": r"감성|가족|따뜻한\s*(느낌|분위기)",  # 고칠 때는 '선물 상자 장면' 같은 말로 바뀌지 않게
        "genre": ("Heartwarming lifestyle short film", "따뜻한 일상 단편 영상"),
        "keywords": ("photorealistic, natural skin texture, soft warm window light, gentle film grain, cozy and tender atmosphere",
                     "사실적, 자연스러운 피부 결, 부드럽고 따뜻한 창가 빛, 은은한 필름 그레인, 아늑하고 다정한 분위기"),
        "camera": ("gentle, steady camera at a natural conversational pace", "자연스러운 대화 속도의 차분하고 안정적인 카메라"),
        "grade": ("soft warm tones, creamy highlights", "부드럽고 따뜻한 색감, 크림색 하이라이트"),
        "lighting": 1,
        "music": ("calm acoustic guitar and soft piano", "잔잔한 어쿠스틱 기타와 부드러운 피아노"),
        "avoid": ("no exaggerated expressions", "과장된 표정 없음"),
        "shots": (("soft medium shot, gentle push-in", "부드러운 미디엄 샷, 살짝 다가가기"),
                  (("close-up on hands and smiling faces", "손과 웃는 얼굴 클로즈업"),
                   ("over-the-shoulder shot", "어깨 너머 샷"),
                   ("slow handheld follow", "천천히 따라가는 핸드헬드")),
                  ("warm wide shot, slow pull-back", "따뜻한 와이드 샷, 천천히 빠지기")),
        "sfx": (("quiet room tone", "조용한 실내 소리"), ("soft laughter", "작은 웃음소리"), ("gentle sigh of delight", "기분 좋은 감탄")),
        "weights": (1, 1.1, 1.4),
    },
    "vlog": {
        "label": "브이로그·리뷰",
        "pattern": r"브이로그|일상|셀카|리뷰|후기",
        "genre": ("Handheld social media vlog", "핸드헬드 SNS 브이로그"),
        "keywords": ("realistic smartphone footage, natural daylight, authentic and unpolished, real-time speed",
                     "사실적인 휴대폰 촬영, 자연광, 꾸미지 않은 진짜 같은 느낌, 실제 속도"),
        "camera": ("handheld phone camera with natural micro shake, real-time speed, no slow motion",
                   "자연스럽게 흔들리는 휴대폰 핸드헬드, 실제 속도, 슬로모션 없음"),
        "grade": ("natural phone colors, slightly bright highlights", "자연스러운 휴대폰 색감, 살짝 밝은 하이라이트"),
        "lighting": 1,
        "music": ("real ambient sound of a cafe, no background music", "카페의 실제 현장 소리, 배경음악 없음"),
        "avoid": ("no studio lighting, no cinematic color grading", "스튜디오 조명·영화 같은 색보정 없음"),
        "shots": (("handheld selfie-style shot, natural micro shake", "셀카처럼 든 핸드헬드, 자연스러운 흔들림"),
                  (("POV close-up as if filmed on a phone", "휴대폰으로 찍은 듯한 1인칭 클로즈업"),
                   ("quick handheld pan", "빠른 핸드헬드 패닝"),
                   ("casual medium shot at eye level", "눈높이의 편한 미디엄 샷")),
                  ("selfie reaction shot, holding the product up to the camera", "제품을 카메라에 들어 보이는 셀카 리액션")),
        "sfx": (("cafe chatter", "카페 웅성거림"), ("crinkle of a paper wrapper", "포장지 바스락 소리"), ("a happy 'mmm'", "맛있다는 '음~'")),
        "weights": (1, 1, 1),
    },
    "energetic": {
        "label": "역동적 숏폼",
        "pattern": r"신나|트렌디|틱톡|숏폼|릴스|역동적인\s*(느낌|분위기)",
        "genre": ("High-energy short-form ad", "역동적인 숏폼 광고"),
        "keywords": ("photorealistic, bold contrast, vivid saturated colors, fast rhythmic editing, dynamic motion blur",
                     "사실적, 강한 대비, 선명한 색, 빠르고 리듬감 있는 편집, 역동적인 모션 블러"),
        "camera": ("fast cuts timed to the beat, about one cut every 1-2 seconds", "비트에 맞춘 빠른 컷, 1~2초마다 한 번씩 전환"),
        "grade": ("punchy saturated colors, crisp highlights", "쨍한 색감, 또렷한 하이라이트"),
        "lighting": 2,
        "music": ("upbeat electronic beat with bass drops and whoosh transitions", "신나는 전자음 비트, 베이스 드롭과 휙 전환음"),
        "avoid": ("no slow drifting shots", "느리게 흘러가는 샷 없음"),
        "shots": (("fast snap zoom-in", "빠른 스냅 줌인"),
                  (("whip pan transition on the beat", "비트에 맞춘 휩 팬 전환"),
                   ("speed ramp from slow to fast", "느렸다 빨라지는 스피드 램프"),
                   ("quick dutch-angle close-up", "빠른 사선 앵글 클로즈업")),
                  ("punchy push-in hero shot ending on a freeze frame", "강하게 다가가 멈추는 히어로 샷")),
        "sfx": (("bass hit", "묵직한 베이스 타격음"), ("whoosh", "휙 소리"), ("final beat drop", "마지막 비트 드롭")),
        "weights": (0.7, 0.8, 1.3),
    },
    "retro": {
        "label": "레트로",
        "pattern": r"레트로|옛날|캠코더|빈티지|추억",
        "genre": ("Early-2000s home video", "2000년대 초 홈비디오"),
        "keywords": ("consumer MiniDV camcorder look, slight color fading, soft focus, light video noise",
                     "MiniDV 캠코더 느낌, 살짝 바랜 색, 부드러운 초점, 약한 영상 노이즈"),
        "camera": ("handheld camcorder, autofocus hunting, small exposure shifts, no polished cinematography",
                   "캠코더 핸드헬드, 초점이 살짝 헤맴, 노출이 조금씩 변함, 매끈한 영화 촬영 없음"),
        "grade": ("faded warm colors, slightly crushed blacks", "바랜 따뜻한 색, 살짝 뭉개진 검정"),
        "lighting": 1,
        "music": ("natural camcorder microphone sound with light hiss", "캠코더 마이크로 담은 자연음, 약한 잡음"),
        "avoid": ("no modern ultra-sharp look", "요즘 같은 초고화질 느낌 없음"),
        "shots": (("handheld camcorder shot, autofocus hunting", "캠코더 핸드헬드, 초점이 살짝 헤맴"),
                  (("casual zoom with the camcorder zoom rocker", "캠코더 줌 버튼으로 당기는 줌"),
                   ("slightly shaky medium shot", "살짝 흔들리는 미디엄 샷")),
                  ("close-up as the exposure slowly settles", "노출이 천천히 맞춰지는 클로즈업")),
        "sfx": (("camcorder click", "캠코더 녹화 버튼 소리"), ("muffled room sound", "먹먹한 실내 소리"),
                ("someone laughing behind the camera", "카메라 뒤 웃음소리")),
        "weights": (1, 1, 1),
    },
}
DEFAULT_STYLE = "premium"


def _pick(value, allowed, default):
    return value if value in allowed else default


def _duration(value, default=MIN_DURATION):
    try:
        value = int(value)
    except (TypeError, ValueError):
        return default
    return value if MIN_DURATION <= value <= MAX_DURATION else default


def scene_count(duration):
    """5초 3컷, 10초 4컷, 15초 5컷 … 30초 8컷."""
    return min(MAX_SCENES, 2 + math.ceil(duration / 5))


def _even_ends(duration, count):
    return [math.ceil(duration * (i + 1) / count) for i in range(count)]


def _apply_ends(scenes, ends):
    start = 0
    for scene, end in zip(scenes, ends):
        scene["time"] = f"{start}-{end}s"
        start = end


def _parse_end(time):
    match = re.fullmatch(r"\s*(\d+)\s*-\s*(\d+)\s*s?\s*", str(time or ""))
    return int(match.group(2)) if match else None


def _setting(text):
    """요청 단어로 배경·분위기·첫 장면을 고릅니다."""
    if re.search(r"매장|가게|카페", text):
        return {
            "background": "a cozy Korean dessert shop in Da Nang",
            "mood": "cozy, welcoming",
            "opening": {"ko": "매장 외관과 진열대", "en": "a warm storefront and a display of rice cakes"},
        }
    if re.search(r"선물|기념일|축하", text):
        return {
            "background": "a gift table with ribbon and wrapping paper",
            "mood": "warm, festive, heartfelt",
            "opening": {"ko": "리본 묶인 선물 상자", "en": "a gift box tied with ribbon being opened"},
        }
    return {
        "background": "a clean light wooden table",
        "mood": "fresh, delicious, premium",
        "opening": {"ko": "테이블 위 찹쌀떡 전체 모습", "en": "rice cakes neatly arranged on a table"},
    }


STYLE_ORDER = ("retro", "vlog", "energetic", "premium", "warm")  # 단어가 겹치면 앞의 분위기를 고릅니다.


def _find_style(text, revise=False):
    def pattern(key):
        return STYLES[key].get("switch", STYLES[key]["pattern"]) if revise else STYLES[key]["pattern"]
    return next((key for key in STYLE_ORDER if re.search(pattern(key), text or "")), None)


def _style_of(doc):
    return STYLES.get(doc.get("style"), STYLES[DEFAULT_STYLE])


def _weighted_ends(duration, count, style=None):
    """분위기별 비율로 컷 시간을 나눕니다. (예: 프리미엄은 마지막 히어로 컷이 가장 김) 컷마다 1초 이상, 끝은 영상 길이."""
    weights = STYLES.get(style, {}).get("weights")
    if not weights or count < 2:
        return _even_ends(duration, count)
    first, middle, last = weights
    parts = [first, *[middle] * (count - 2), last]
    total, acc, ends = sum(parts), 0, []
    for part in parts:
        acc += part
        ends.append(round(duration * acc / total))
    ends[-1] = duration
    for i in range(count):
        low = (ends[i - 1] if i else 0) + 1
        ends[i] = min(max(ends[i], low), duration - (count - 1 - i))
    return ends


def _shot(style, index, count):
    """컷 자리(첫·가운데·마지막)에 맞는 화면·카메라 지시 (영어, 한국어)."""
    first, middles, last = style["shots"]
    if index == 0:
        return first
    if index == count - 1:
        return last
    return middles[(index - 1) % len(middles)]


def _sfx(style, index, count):
    first, middle, last = style["sfx"]
    return first if index == 0 else last if index == count - 1 else middle


def _retime(scenes, duration, style=None):
    """장면 수를 길이에 맞추고(첫·마지막 장면 유지) 분위기 비율로 시간을 다시 나눕니다."""
    count = scene_count(duration)
    scenes = [dict(scene) for scene in scenes]
    while len(scenes) < count:
        used = {scene["ko"] for scene in scenes}
        extra = next((s for s in (TEXTURE_SCENE, *EXTRA_SCENES) if s["ko"] not in used), TEXTURE_SCENE)
        scenes.insert(-1, dict(extra))
    while len(scenes) > count:
        scenes.pop(-2)
    _apply_ends(scenes, _weighted_ends(duration, count, style))
    return scenes


def normalize_scenes(doc):
    """직접 고친 장면 시간을 검사합니다. 0초부터 이어지고 길이에서 끝나야 하며, 아니면 고르게 다시 나눕니다."""
    doc = copy.deepcopy(doc)
    doc["duration"] = _duration(doc.get("duration"))
    scenes = doc["scenes"]
    ends = [_parse_end(scene.get("time")) for scene in scenes]
    valid = (
        bool(ends)
        and all(end is not None for end in ends)
        and all(a < b for a, b in zip([0, *ends], ends))
        and ends[-1] == doc["duration"]
    )
    _apply_ends(scenes, ends if valid else _even_ends(doc["duration"], len(scenes)))
    return doc


def _ends_of(scenes, duration):
    ends = [_parse_end(scene.get("time")) for scene in scenes]
    if any(end is None for end in ends):
        return _even_ends(duration, len(scenes))
    return ends


def remove_scene(doc, index):
    """컷 하나 삭제. 지운 컷의 시간은 앞 컷이 이어받습니다(첫 컷이면 다음 컷이 0초부터). 1컷 아래로는 지우지 않습니다."""
    scenes = doc["scenes"]
    if len(scenes) <= 1 or not 0 <= index < len(scenes):
        return False
    ends = _ends_of(scenes, doc["duration"])
    del ends[index - 1 if index > 0 else 0]
    scenes.pop(index)
    _apply_ends(scenes, ends)
    return True


def max_scenes(duration):
    return min(duration, MAX_MANUAL_SCENES)


def add_scene(doc):
    """마지막 컷 앞에 새 컷을 넣습니다. 앞 컷의 시간을 반으로 나눠 가지고, 나눌 수 없으면 고르게 다시 나눕니다."""
    scenes, duration = doc["scenes"], doc["duration"]
    if len(scenes) >= max_scenes(duration):
        return False
    used = {scene["ko"] for scene in scenes}
    extra = next((s for s in (*EXTRA_SCENES, TEXTURE_SCENE) if s["ko"] not in used), EXTRA_SCENES[0])
    ends = _ends_of(scenes, duration)
    target = len(scenes) - 2 if len(scenes) >= 2 else 0  # 나눌 컷 (새 컷은 그 바로 뒤)
    start = ends[target - 1] if target > 0 else 0
    scenes.insert(target + 1, dict(extra))
    if ends[target] - start >= 2:
        ends.insert(target, start + (ends[target] - start) // 2)
        _apply_ends(scenes, ends)
    else:
        _apply_ends(scenes, _even_ends(duration, len(scenes)))
    return True


def _has_bite(scenes):
    return any("bite" in scene["en"] for scene in scenes)


def _scene_number(text):
    """'첫번째 장면', '2번째', '3번 장면' → 장면 번호. ('2번 자막'은 자막 고치기라 제외)"""
    match = re.search(r"(첫|두|세|네|다섯|여섯|일곱|여덟)\s*번?\s*째", text)
    if match:
        return ORDINALS[match.group(1)]
    match = re.search(r"(\d+)\s*번\s*째|(\d+)\s*번\s*(?:장면|컷|씬)", text)
    if match:
        return int(match.group(1) or match.group(2))
    return None


RATIO_WORDS = {"9:16": ("vertical 9:16", "세로 9:16"), "16:9": ("horizontal 16:9", "가로 16:9"), "1:1": ("square 1:1", "정사각 1:1")}


def _prompt_lines(doc, lang):
    """7단 구조 프롬프트 줄들. lang 0=영어(Higgsfield용), 1=한국어 보기.
    컷마다 화면·카메라 지시와 효과음은 저장하지 않고, 분위기와 컷 자리(첫·가운데·마지막)로 매번 만듭니다."""
    style = _style_of(doc)
    product = doc.get("product") or "찹쌀떡"
    look = PRODUCT_LOOK.get(product, PRODUCT_LOOK["찹쌀떡"])[lang]
    ratio = RATIO_WORDS.get(doc["ratio"], (doc["ratio"], doc["ratio"]))[lang]
    count = len(doc["scenes"])
    has_photo = bool(doc.get("image"))

    def ko(table, value):
        return table.get(value, value) if lang else value  # 대응표에 없으면 영어 그대로

    shots = []
    for i, scene in enumerate(doc["scenes"]):
        line = f"{scene['time']} — {_shot(style, i, count)[lang]}: {scene['ko' if lang else 'en']}."
        if doc["sound"]:
            line += f" {'효과음' if lang else 'SFX'}: {_sfx(style, i, count)[lang]}."
        shots.append(line)

    if lang:
        lock = f"제품: 한정선 {product} — {look}. 모든 컷에서 제품 모양·색·크기·속을 똑같이 유지"
        lock += ", 첨부한 제품 사진과 똑같이." if has_photo else "."
        sound = f"소리: {style['music'][1]}, 컷마다 적은 효과음." if doc["sound"] else "소리: 무음, 음악·효과음 없음."
        labels = ("초", "스타일", "배경", "분위기", "컷 구성:", "카메라", "조명·색감", "금지")
    else:
        name = PRODUCT_EN.get(product, "Korean rice cake mochi")
        lock = f"Product: {name} by Hanjungsun — {look}. Keep the product's shape, color, size and filling identical in every shot"
        lock += ", exactly matching the attached product photo." if has_photo else "."
        sound = (f"Sound: {style['music'][0]}, plus the sound effects noted per shot." if doc["sound"]
                 else "Sound: silent, no music, no sound effects.")
        labels = (" seconds", "Style", "Setting", "Mood", "Shots:", "Camera", "Lighting and color", "Avoid")
    sec, style_l, setting_l, mood_l, shots_l, camera_l, light_l, avoid_l = labels
    return [
        f"{style['genre'][lang]}, {doc['duration']}{sec}, {ratio}.",
        f"{style_l}: {style['keywords'][lang]}.",
        lock,
        f"{setting_l}: {ko(BACKGROUND_KO, doc['background'])}. {mood_l}: {ko(MOOD_KO, doc['mood'])}.",
        shots_l,
        *shots,
        f"{camera_l}: {ko(CAMERA_KO, doc['camera'])}; {style['camera'][lang]}.",
        f"{light_l}: {ko(LIGHTING_KO, doc['lighting'])}; {style['grade'][lang]}.",
        *[f"{extra}." for extra in doc["extras"]],
        sound,
        f"{avoid_l}: {COMMON_AVOID[lang]}, {style['avoid'][lang]}.",
    ]


def build_prompt(doc):
    """Higgsfield로 보낼 영어 프롬프트 (여러 줄). 사용자가 직접 고친 문장(custom)이 있으면 그대로 씁니다."""
    if doc.get("custom"):
        return doc["custom"]
    return "\n".join(_prompt_lines(doc, 0))


def build_prompt_ko(doc):
    """영어 프롬프트와 같은 내용을 한국어로 조립합니다. 직접 고친 영어(custom)는 번역하지 않고 None을 돌려줍니다 (AI 연결 후)."""
    if doc.get("custom"):
        return None
    return "\n".join(_prompt_lines(doc, 1))


def refresh_prompts(doc):
    """영어 프롬프트와 한국어 보기를 함께 다시 만듭니다."""
    doc["prompt"] = build_prompt(doc)
    doc["prompt_ko"] = build_prompt_ko(doc)
    return doc


def make_draft(text, ratio="9:16", duration=5, sound=False, product="찹쌀떡", event=None):
    """요청 문장 → 영상 문서 (README 8장 형식 + caption·demo·reviewed)."""
    text = text or ""
    ratio = _pick(ratio, RATIOS, "9:16")
    duration = _duration(duration)
    setting = _setting(text)
    product_en = PRODUCT_EN.get(product, "Korean rice cake mochi")
    product_vi = PRODUCT_VI.get(product, "Bánh mochi Hanjungsun")
    event_vi = EVENT_VI.get(event)

    middle = BITE_SCENE if re.search(r"한입|먹는|베어", text) else TEXTURE_SCENE
    scenes = [
        {
            "ko": f"{product} 클로즈업",
            "en": f"extreme close-up of {product_en} dusted with rice flour",
            "caption": f"Mừng {event_vi}" if event_vi else product_vi,
        },
        dict(middle),
        {"ko": "브랜드 마무리 컷", "en": "the rice cakes beautifully plated, final hero shot", "caption": BRAND_CAPTION},
    ]
    if scene_count(duration) >= 4:
        scenes.insert(0, {**setting["opening"], "caption": ""})

    # 분위기: 요청 단어 → 없으면 기념일 영상은 따뜻한 감성, 그 밖에는 프리미엄 광고
    style = _find_style(text) or ("warm" if event else DEFAULT_STYLE)
    doc = {
        "kind": "video",
        "ratio": ratio,
        "duration": duration,
        "sound": bool(sound),
        "summary": " · ".join(filter(None, [f"{duration}초 {ratio}", product, event, STYLES[style]["label"]])),
        "scenes": _retime(scenes, duration, style),
        "style": style,
        "product": product,
        "camera": CAMERAS[2] if re.search(r"빠르|역동", text) else CAMERAS[1],
        "lighting": LIGHTINGS[STYLES[style]["lighting"]],
        "mood": setting["mood"],
        "background": setting["background"],
        "extras": [],
        "prompt": "",
        "prompt_ko": "",
        "custom": "",
        "image": None,
        "job": {"request_id": None, "status": None, "video_url": None},
        "demo": True,
        "reviewed": False,
    }
    return refresh_prompts(doc)


def revise_draft(doc, text):
    """말로 고치기 → (새 문서, 바뀐 내용 목록). 원본은 그대로 두고, 알아듣지 못하면 목록이 비어 있습니다.

    영상(프롬프트)이 바뀌면 reviewed를 False로 되돌립니다. 자막만 바뀌면 영상을 다시 만들 필요가 없으므로 그대로 둡니다.
    """
    new = copy.deepcopy(doc)
    text = text or ""
    video_changes, caption_changes = [], []

    # 분위기 바꾸기: "브이로그 느낌으로", "고급스럽게", "레트로로" … (조명 기본값과 컷 길이 비율이 따라 바뀜)
    style = _find_style(text, revise=True)
    if style and style != new.get("style", DEFAULT_STYLE):
        old_label = _style_of(new)["label"]
        new["style"] = style
        new["lighting"] = LIGHTINGS[STYLES[style]["lighting"]]
        _apply_ends(new["scenes"], _weighted_ends(new["duration"], len(new["scenes"]), style))
        label = STYLES[style]["label"]
        summary = new.get("summary", "")
        new["summary"] = summary.replace(old_label, label) if old_label in summary else f"{summary} · {label}"
        video_changes.append(f"분위기를 {label}(으)로")

    level = LIGHTINGS.index(new["lighting"]) if new["lighting"] in LIGHTINGS else 1
    if re.search(r"밝게|밝은|환하게", text) and level < len(LIGHTINGS) - 1:
        new["lighting"] = LIGHTINGS[level + 1]
        video_changes.append("조명을 더 밝게")
    elif re.search(r"어둡게|어두운", text) and level > 0:
        new["lighting"] = LIGHTINGS[level - 1]
        video_changes.append("조명을 더 어둡게")

    if re.search(r"천천히|느리게", text) and new["camera"] != CAMERAS[0]:
        new["camera"] = CAMERAS[0]
        video_changes.append("카메라를 천천히")
    elif re.search(r"빠르게|빠른", text) and new["camera"] != CAMERAS[2]:
        new["camera"] = CAMERAS[2]
        video_changes.append("카메라를 빠르게")

    # 컷 삭제·추가 ('2번 자막 지워'는 자막 고치기라 제외)
    number = _scene_number(text)
    removing = bool(number and "자막" not in text and re.search(r"빼|삭제|지워|없애", text))
    if removing:
        if remove_scene(new, number - 1):
            video_changes.append(f"{number}번 컷 삭제 ({len(new['scenes'])}컷)")
    elif re.search(r"(컷|장면)\s*(하나\s*|한\s*개\s*)?(추가|더\s*넣|늘려)", text):
        if add_scene(new):
            video_changes.append(f"컷 추가 ({len(new['scenes'])}컷)")

    # 한입 장면: 장면 번호를 말하면 그 장면을, 아니면 끝에서 두 번째 장면을 바꿉니다.
    if not removing and re.search(r"한입|먹는|먹어|먹게|베어", text):
        number = _scene_number(text)
        index = number - 1 if number else len(new["scenes"]) - 2
        scene = new["scenes"][index] if 0 <= index < len(new["scenes"]) else None
        if scene and "bite" not in scene["en"] and (number or not _has_bite(new["scenes"])):
            new["scenes"][index] = {**BITE_SCENE, "time": scene["time"], "caption": scene.get("caption") or BITE_SCENE["caption"]}
            video_changes.append(f"{index + 1}번 장면을 한입 먹는 장면으로")

    match = re.search(r"(?<!\d)(\d{1,2})\s*초", text)
    duration = int(match.group(1)) if match else None
    if duration and MIN_DURATION <= duration <= MAX_DURATION and duration != new["duration"]:
        new["duration"] = duration
        new["scenes"] = _retime(new["scenes"], duration, new.get("style"))
        video_changes.append(f"{duration}초로 ({len(new['scenes'])}컷)")

    if re.search(r"소리\s*(켜|넣)|음악", text) and not new["sound"]:
        new["sound"] = True
        video_changes.append("소리 켜기")
    elif re.search(r"소리\s*(꺼|빼)|무음", text) and new["sound"]:
        new["sound"] = False
        video_changes.append("소리 끄기")

    for pattern, ratio, label in ((r"세로", "9:16", "세로 9:16"), (r"가로", "16:9", "가로 16:9"), (r"정사각", "1:1", "정사각 1:1")):
        if re.search(pattern, text) and new["ratio"] != ratio:
            new["ratio"] = ratio
            video_changes.append(label)
            break

    for number, caption in re.findall(r"(\d+)\s*번\s*자막\s*[\"“'‘](.+?)[\"”'’]", text):
        index = int(number) - 1
        if 0 <= index < len(new["scenes"]):
            new["scenes"][index]["caption"] = caption.strip()
            caption_changes.append(f"{number}번 자막 바꾸기")
    # '2번 자막 지워', '두번째 장면 자막 빼줘' → 그 장면 자막만. 번호가 없으면 전체 자막을 뺍니다.
    match = re.search(r"(\d+)\s*번\s*(?:장면\s*|컷\s*|씬\s*)?자막", text)
    number = int(match.group(1)) if match else _scene_number(text)
    if number and re.search(r"자막\s*(빼|없애|지워|삭제)", text):
        index = number - 1
        if 0 <= index < len(new["scenes"]) and new["scenes"][index].get("caption"):
            new["scenes"][index]["caption"] = ""
            caption_changes.append(f"{number}번 자막 빼기")
    elif re.search(r"자막\s*(빼|없애|지워|삭제)", text) and any(scene.get("caption") for scene in new["scenes"]):
        for scene in new["scenes"]:
            scene["caption"] = ""
        caption_changes.append("자막 빼기")
    elif re.search(r"자막\s*(넣|다시|추가)", text) and not any(scene.get("caption") for scene in new["scenes"]):
        new["scenes"][0]["caption"] = PRODUCT_VI["찹쌀떡"]
        new["scenes"][-1]["caption"] = BRAND_CAPTION
        caption_changes.append("자막 넣기")

    if video_changes:
        if new["custom"]:
            new["custom"] = ""  # 말로 고치면 직접 고친 프롬프트 대신 새로 만듭니다.
            video_changes.append("직접 고친 프롬프트를 새로 만들기")
        new["summary"] = re.sub(r"^\d+초 [\d:]+", f"{new['duration']}초 {new['ratio']}", new["summary"])
        new["reviewed"] = False
        refresh_prompts(new)
    return new, video_changes + caption_changes
