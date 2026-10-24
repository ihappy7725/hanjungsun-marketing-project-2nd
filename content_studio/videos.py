"""영상 프롬프트 초안 만들기·고치기. [유진]

흐름: Higgsfield 프롬프트 초안 → 사용자 검토·승인 → 생성 (README 3장)

지금은 단어 규칙으로 만듭니다. 나중에 AI(GPT)를 연결해도 같은 문서 형식(README 8장)을 돌려줍니다.
- 영상에는 글자를 그리지 않고(prompt에 no text), 베트남어 자막(caption)은 장면마다 따로 저장해 영상 위에 얹습니다.
- 자막 문구는 시연용이며 원어민 검수 전입니다(demo=True).
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


def _retime(scenes, duration):
    """장면 수를 길이에 맞추고(첫·마지막 장면 유지) 시간을 고르게 다시 나눕니다."""
    count = scene_count(duration)
    scenes = [dict(scene) for scene in scenes]
    while len(scenes) < count:
        used = {scene["ko"] for scene in scenes}
        extra = next((s for s in (TEXTURE_SCENE, *EXTRA_SCENES) if s["ko"] not in used), TEXTURE_SCENE)
        scenes.insert(-1, dict(extra))
    while len(scenes) > count:
        scenes.pop(-2)
    _apply_ends(scenes, _even_ends(duration, count))
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


def build_prompt(doc):
    """Higgsfield로 보낼 영어 프롬프트 한 줄. 사용자가 직접 고친 문장(custom)이 있으면 그대로 씁니다."""
    if doc.get("custom"):
        return doc["custom"]
    shots = "; ".join(f"{scene['time']}: {scene['en']}" for scene in doc["scenes"])
    parts = [
        f"{doc['duration']}-second {doc['ratio']} promotional food video",
        shots,
        f"setting: {doc['background']}",
        f"camera: {doc['camera']}",
        f"lighting: {doc['lighting']}",
        f"mood: {doc['mood']}",
        *doc["extras"],
        "soft background music and natural sounds" if doc["sound"] else "silent",
        "photorealistic, appetizing close-up detail",
        "no text, no letters, no subtitles, no logos",
    ]
    return ". ".join(parts) + "."


def build_prompt_ko(doc):
    """영어 프롬프트와 같은 내용을 한국어로 조립합니다. 직접 고친 영어(custom)는 번역하지 않고 None을 돌려줍니다 (AI 연결 후)."""
    if doc.get("custom"):
        return None
    def ko(table, value):
        return table.get(value, value)  # 대응표에 없으면 영어 그대로

    shots = "; ".join(f"{scene['time']}: {scene['ko']}" for scene in doc["scenes"])
    parts = [
        f"{doc['duration']}초 {doc['ratio']} 홍보용 음식 영상",
        shots,
        f"배경: {ko(BACKGROUND_KO, doc['background'])}",
        f"카메라: {ko(CAMERA_KO, doc['camera'])}",
        f"조명: {ko(LIGHTING_KO, doc['lighting'])}",
        f"분위기: {ko(MOOD_KO, doc['mood'])}",
        *doc["extras"],
        "잔잔한 배경음악과 자연스러운 소리" if doc["sound"] else "소리 없음",
        "사실적이고 먹음직스러운 클로즈업",
        "화면에 글자·자막·로고 없음",
    ]
    return ". ".join(parts) + "."


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

    doc = {
        "kind": "video",
        "ratio": ratio,
        "duration": duration,
        "sound": bool(sound),
        "summary": " · ".join(filter(None, [f"{duration}초 {ratio}", product, event])),
        "scenes": _retime(scenes, duration),
        "camera": CAMERAS[2] if re.search(r"빠르|역동", text) else CAMERAS[1],
        "lighting": LIGHTINGS[1],
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
        new["scenes"] = _retime(new["scenes"], duration)
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
    if re.search(r"자막\s*(빼|없애|지워)", text) and any(scene.get("caption") for scene in new["scenes"]):
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
