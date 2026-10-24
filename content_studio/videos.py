"""영상 프롬프트 초안 만들기·고치기. [유진]

흐름: Higgsfield 프롬프트 초안 → 사용자 검토·승인 → 생성 (README 3장)

지금은 단어 규칙으로 만듭니다. 나중에 AI(GPT)를 연결해도 같은 문서 형식(README 8장)을 돌려줍니다.
- 영상에는 글자를 그리지 않고(prompt에 no text), 베트남어 자막(caption)은 장면마다 따로 저장해 영상 위에 얹습니다.
- 자막 문구는 시연용이며 원어민 검수 전입니다(demo=True).
"""
import copy
import re

RATIOS = ("9:16", "16:9", "1:1")
DURATIONS = (5, 10)
SCENE_TIMES = {5: ("0-2s", "2-4s", "4-5s"), 10: ("0-3s", "3-6s", "6-8s", "8-10s")}

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


def _pick(value, allowed, default):
    return value if value in allowed else default


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
    """장면 수를 길이에 맞추고(첫·마지막 장면 유지) 시간을 다시 매깁니다."""
    times = SCENE_TIMES[duration]
    scenes = [dict(scene) for scene in scenes]
    while len(scenes) < len(times):
        scenes.insert(-1, dict(TEXTURE_SCENE))
    while len(scenes) > len(times):
        scenes.pop(-2)
    for scene, time in zip(scenes, times):
        scene["time"] = time
    return scenes


def _has_bite(scenes):
    return any("bite" in scene["en"] for scene in scenes)


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


def make_draft(text, ratio="9:16", duration=5, sound=False, product="찹쌀떡", event=None):
    """요청 문장 → 영상 문서 (README 8장 형식 + caption·demo·reviewed)."""
    text = text or ""
    ratio = _pick(ratio, RATIOS, "9:16")
    duration = _pick(duration, DURATIONS, 5)
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
    if duration == 10:
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
        "custom": "",
        "image": None,
        "job": {"request_id": None, "status": None, "video_url": None},
        "demo": True,
        "reviewed": False,
    }
    doc["prompt"] = build_prompt(doc)
    return doc


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

    if re.search(r"한입|먹는 장면|베어", text) and not _has_bite(new["scenes"]):
        new["scenes"][-2] = {**BITE_SCENE, "time": new["scenes"][-2]["time"]}
        video_changes.append("한입 먹는 장면 넣기")

    duration = 10 if re.search(r"(?<!\d)10\s*초", text) else 5 if re.search(r"(?<!\d)5\s*초", text) else None
    if duration and duration != new["duration"]:
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
        new["prompt"] = build_prompt(new)
    return new, video_changes + caption_changes
