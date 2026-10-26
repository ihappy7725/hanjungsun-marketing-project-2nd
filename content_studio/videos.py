"""영상 프롬프트 초안 만들기·고치기. [유진]

흐름: Higgsfield 프롬프트 초안 → 사용자 검토·승인 → 생성 (README 3장)

지금은 단어 규칙으로 만듭니다. 나중에 AI(GPT)를 연결해도 같은 문서 형식(README 8장)을 돌려줍니다.
- 영상에는 글자를 그리지 않고(prompt에 no text), 베트남어 자막(caption)은 장면마다 따로 저장해 영상 위에 얹습니다.
- 자막 문구는 시연용이며 원어민 검수 전입니다(demo=True).
- 분위기(style) 5가지에 따라 장르·스타일 키워드·컷별 카메라·조명·소리·금지 문장을 조립합니다 (STYLES).
- 길이는 5~30초. 한 번에 만들 수 있는 길이는 생성 모델마다 다르므로 5단계(Higgsfield 연동)에서 맞춥니다.
"""
import copy
import difflib
import json
import math
import re

from .products import PRODUCTS

RATIOS = ("9:16", "16:9", "1:1")
MIN_DURATION, MAX_DURATION = 5, 30
MAX_SCENES = 8        # 길이로 자동으로 정하는 컷 수의 최대
MAX_MANUAL_SCENES = 12  # 컷 추가로 늘릴 수 있는 최대 (컷마다 1초 이상)

CAMERAS = ("slow smooth dolly-in", "steady medium push-in", "dynamic quick cuts")
LIGHTINGS = ("dim warm low-key lighting", "soft warm natural lighting", "bright airy high-key lighting")

# 제품 영어 이름(프롬프트용, mochi 대신 chapssal-tteok)·베트남어 이름(포장 태그 그대로). 맨 아래 두 줄은 예전 제품(기존 작업용).
PRODUCT_EN = {
    "망고 요거트 찹쌀떡": "mango yogurt chapssal-tteok",
    "꿀 레드용과 찹쌀떡": "honey red dragon fruit chapssal-tteok",
    "망고스틴 요거트 찹쌀떡": "mangosteen yogurt chapssal-tteok",
    "두리안 찹쌀떡": "durian chapssal-tteok",
    "찹쌀떡": "Korean chapssal-tteok", "망고스틴 찹쌀떡": "mangosteen chapssal-tteok",
}
PRODUCT_VI = {
    "망고 요거트 찹쌀떡": "Chapssal-tteok Xoài",
    "꿀 레드용과 찹쌀떡": "Chapssal-tteok Thanh Long Mật Ong",
    "망고스틴 요거트 찹쌀떡": "Chapssal-tteok Măng Cụt",
    "두리안 찹쌀떡": "Chapssal-tteok Sầu Riêng",
    "찹쌀떡": "Bánh mochi Hàn Quốc", "망고스틴 찹쌀떡": "Bánh mochi măng cụt",
}
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

# 제품 겉모습 고정 문장. 매 컷 같은 모양·색이 나오게 합니다. (static/images/sns/ 단면 사진을 보고 씀, 2026-10-25)
PRODUCT_LOOK = {
    "망고 요거트 찹쌀떡": ("a round, soft white chapssal-tteok with a light rice-flour dusting; inside, white yogurt cream "
                     "around a glossy golden mango chunk",
                     "고운 쌀가루를 묻힌 둥글고 하얀 찹쌀떡, 속은 하얀 요거트 크림이 감싼 윤기 나는 노란 망고 과육"),
    "꿀 레드용과 찹쌀떡": ("a round, soft white chapssal-tteok with a light rice-flour dusting; inside, magenta red dragon fruit "
                     "with tiny black seeds in golden honey",
                     "고운 쌀가루를 묻힌 둥글고 하얀 찹쌀떡, 속은 황금빛 꿀을 머금은 선명한 자홍색 레드용과 과육과 작은 검은 씨"),
    "망고스틴 요거트 찹쌀떡": ("a round, soft white chapssal-tteok with a light rice-flour dusting; inside, pearly white mangosteen "
                       "segments in white yogurt cream",
                       "고운 쌀가루를 묻힌 둥글고 하얀 찹쌀떡, 속은 하얀 요거트 크림이 감싼 뽀얀 망고스틴 과육 조각"),
    "두리안 찹쌀떡": ("a round, soft white chapssal-tteok with a light rice-flour dusting; inside, creamy pale-yellow durian filling",
                "고운 쌀가루를 묻힌 둥글고 하얀 찹쌀떡, 속은 진하고 부드러운 연노랑 두리안 크림"),
    # 예전 제품(기존 작업용)
    "찹쌀떡": ("round, soft white rice cakes dusted with fine rice flour, with a sweet red bean filling",
              "고운 쌀가루를 묻힌 둥글고 하얀 찹쌀떡, 속은 달콤한 팥소"),
    "망고스틴 찹쌀떡": ("round, soft rice cakes with a pale purple tint and a juicy white mangosteen filling",
                  "연보라빛이 도는 둥근 찹쌀떡, 속은 하얀 망고스틴 과육"),
}
COMMON_AVOID = ("no text, no letters, no subtitles, no logos, no watermarks, no distorted hands or extra fingers, "
                "no warping or morphing of the product",
                "글자·자막·로고·워터마크 없음, 손 모양 왜곡·손가락 추가 없음, 제품 모양이 변하거나 일그러지지 않게")
# 싸 보이는 결과를 막는 금지 (예시 프롬프트 분석)
REALISM_AVOID = ("no artificial CGI look, no fake physics, no over-saturated plastic colors",
                 "인공적인 CGI 느낌·가짜 물리 효과·과하게 쨍한 플라스틱 같은 색 없음")
# 먹음직스럽게: 떡이 이질적으로 길게 늘어나거나 식욕이 떨어지는 모습 금지 (길 때는 AVOID_SHORT 안의 짧은 구절)
FOOD_AVOID = ("no rubbery over-long stretching, nothing unappetizing (slimy, melting, sagging or dull-colored)",
              "고무처럼 길게 늘어나는 떡·미끈거림·녹아내림·처짐·칙칙한 색 등 식욕 떨어지는 모습 없음")

# 제품이 갑자기 나타나거나 바뀌지 않게 (예시 프롬프트 분석)
CONTINUITY = ("Continuity: everything changes gradually and naturally, nothing appears suddenly, "
              "and the rice cakes keep the same shape, color, size and filling in every shot",
              "연속성: 모든 변화는 단계적이고 자연스럽게, 갑자기 나타나는 것 없이, 모든 컷에서 찹쌀떡의 모양·색·크기·속 유지")
# 제품 사진은 컷 종류별로 보냅니다(routes_sns.py _photo_set): 겉모습 공통 사진 · 맛별 단면 · 선물세트
PHOTO_MATCH = ("outside = the round white rice cake photo, filling = the cross-section photos",
               "겉은 동그란 하얀 찹쌀떡 사진, 속은 단면 사진대로")
PHOTO_GIFT = ("gift = the gift set photos", "선물은 선물세트 사진대로")
# 속 컷(가르기·한입): 동그란 하얀 찹쌀떡에서 시작해 갈라지며 단면이 드러나게. 길이를 줄일 때(compact)는 뺍니다.
START_WHOLE = ("starting from a whole round white rice cake", "동그란 하얀 찹쌀떡 그대로에서 시작")

# 장면 글(영어)로 컷 종류를 정합니다: gift(선물·포장) → inside(가르기·단면·한입) → outside(겉모습)
GIFT_WORDS = re.compile(r"\bgift|\bbox(es)?\b|wrap|bojagi|present\b|packag", re.I)
INSIDE_WORDS = re.compile(r"\bhalf\b|halves|halved|apart|cross[- ]section|filling|inside|\bbit(e|es|ing|ten)\b|split|"
                          r"\bcut (open|in half)|cream", re.I)


def scene_kind(text):
    """장면 글 → "gift" | "inside" | "outside". 어떤 제품 사진을 보낼지 정할 때 씁니다."""
    if GIFT_WORDS.search(text or ""):
        return "gift"
    return "inside" if INSIDE_WORDS.search(text or "") else "outside"
MUSIC_AVOID = ("no vocals, no lyrics, no familiar melodies", "보컬·가사·익숙한 멜로디 없음")
# 프롬프트가 길면(PROMPT_LIMIT 초과) 금지 줄을 이 짧은 문장으로 씁니다.
AVOID_SHORT = ("no text, logos, watermarks, distorted hands, morphing, CGI look, fake physics, "
               "over-stretched or unappetizing rice cake",
               "글자·로고·워터마크·손 왜곡·제품 변형·CGI 느낌·가짜 물리·과하게 늘어나거나 식욕 떨어지는 떡 없음")
# Kling 쪽 문서에 흔한 프롬프트 한도. Higgsfield에서 실제 한도는 확인 전입니다(2026-10-24).
PROMPT_LIMIT = 2500

# 찹쌀떡 질감 단어 모음. 디테일 컷(가운데 컷)에 차례로 붙입니다.
TEXTURES = (
    ("the soft rice cake stretching just slightly, soft and chewy", "살짝 쫀득하게 늘어나는 떡"),
    ("fine rice flour drifting slowly through the light", "빛 사이로 천천히 흩날리는 고운 쌀가루"),
    ("the pillowy surface gently pressed and springing back", "말랑하게 눌렸다가 다시 돌아오는 표면"),
    ("the cut cross-section revealing the filling inside", "갈라진 단면 속으로 드러나는 소"),
    ("a moist, delicate sheen on the surface", "표면의 촉촉하고 은은한 광택"),
)

# 분위기 8가지. 요청 문장의 단어로 고르고, 입력줄에서 "브이로그 느낌으로"처럼 바꿀 수 있습니다.
# 구조는 영상 프롬프트 예시 분석: 콘셉트 줄 → 스타일 → 편집 리듬 → 대상 고정 → 배경·분위기 → 구간별 컷 → 카메라 → 조명·색감 → 연속성 → 소리 → 금지.
# 컷 자리 4가지: 소개(첫 컷) · 디테일(가운데 컷들) · 클라이맥스(끝에서 두 번째) · 히어로(마지막). 컷이 2개 이하면 클라이맥스가 없습니다.
# beats: 자리별 구간 이름 / actions: 자리별 움직임·물리·공기 중 요소(디테일은 TEXTURES) / shots: (소개, 디테일들, 클라이맥스, 히어로) 카메라 지시
# sfx: 자리별 효과음(ASMR) / weights: 자리별 컷 길이 비율
STYLES = {
    "premium": {
        "label": "프리미엄 광고",
        "pattern": r"고급|프리미엄|럭셔리",
        "concept": ("The First Chewy Bite", "첫 쫀득한 한입"),
        "genre": ("Premium food commercial", "프리미엄 음식 광고"),
        "quality": ("4K photorealistic", "4K 실사"),
        "keywords": ("macro cinematography, shallow depth of field, real food textures, glossy dark surface, "
                     "warm golden rim light, high-end commercial color grading",
                     "매크로 촬영, 얕은 심도, 실제 같은 음식 질감, 광택 있는 어두운 바닥, 따뜻한 금빛 윤곽광, 고급 광고 색보정"),
        "pace": ("smooth seamless transitions, elegant pacing that builds to one dramatic moment",
                 "매끄러운 트랜지션, 한 번의 극적인 순간으로 쌓아 가는 우아한 리듬"),
        "camera": ("smooth, slow cinematic moves; the product stays still and only the camera moves; "
                   "no spinning or orbiting around the product",
                   "부드럽고 느린 시네마틱 움직임, 제품은 고정하고 카메라만 움직임, 제품 주위를 돌지 않음"),
        "grade": ("rich contrast, warm golden highlights, deep soft shadows", "풍부한 대비, 따뜻한 금빛 하이라이트, 깊고 부드러운 그림자"),
        "lighting": 0,
        "music": ("elegant minimal piano with soft ambient pads", "우아하고 간결한 피아노와 잔잔한 앰비언트"),
        "avoid": ("no cluttered background, no kitchen tools", "어수선한 배경·주방 도구 없음"),
        "beats": (("Introduction", "소개"), ("Texture detail", "질감 디테일"), ("Climax", "클라이맥스"), ("Hero shot", "히어로 샷")),
        "actions": (("the rice cake lands softly in slow motion, fine flour puffing up into the golden light",
                     "찹쌀떡이 슬로모션으로 살며시 내려앉고, 고운 가루가 금빛 빛 속으로 피어오름"),
                    ("the rice cake is pulled apart in slow motion with a short chewy stretch as flour swirls around it",
                     "찹쌀떡이 슬로모션으로 갈라지며 짧고 쫀득하게 늘어나고, 주위로 쌀가루가 소용돌이침"),
                    ("the flour settles and the rice cakes rest perfectly still on the glossy surface",
                     "가루가 가라앉고 찹쌀떡이 광택 있는 바닥 위에 완벽하게 멈춰 있음")),
        "shots": (("extreme macro close-up, slow dolly-in", "초접사 클로즈업, 천천히 다가가기"),
                  (("macro slow motion, shallow depth of field", "매크로 슬로모션, 얕은 심도"),
                   ("smooth lateral tracking shot", "부드러운 옆 방향 트래킹"),
                   ("top-down overhead shot", "위에서 내려다보는 샷")),
                  ("slow-motion macro, the camera gliding through drifting flour", "슬로모션 매크로, 흩날리는 가루 사이로 미끄러지는 카메라"),
                  ("slow pull-back to a centered hero shot", "천천히 빠지며 가운데 히어로 샷")),
        "sfx": (("soft whoosh", "부드러운 바람 소리"), ("gentle squish of soft rice cake", "말랑한 떡이 눌리는 소리"),
                ("soft sticky stretch", "쫀득하게 늘어나는 소리"), ("subtle shimmer chime", "은은한 반짝임 소리")),
        "weights": (1, 1, 1.2, 1.6),
    },
    "warm": {
        "label": "따뜻한 감성",
        "pattern": r"감성|가족|따뜻한\s*(느낌|분위기)|선물|기념일|축하",
        "switch": r"감성|가족|따뜻한\s*(느낌|분위기)",  # 고칠 때는 '선물 상자 장면' 같은 말로 바뀌지 않게
        "concept": ("Sweetness to Share", "나누는 달콤함"),
        "genre": ("Heartwarming lifestyle short film", "따뜻한 일상 단편 영상"),
        "quality": ("4K photorealistic", "4K 실사"),
        "keywords": ("natural skin texture, soft warm window light, gentle film grain, cozy and tender atmosphere",
                     "자연스러운 피부 결, 부드럽고 따뜻한 창가 빛, 은은한 필름 그레인, 아늑하고 다정한 분위기"),
        "pace": ("gentle unhurried pacing with soft dissolves", "서두르지 않는 잔잔한 리듬, 부드러운 디졸브"),
        "camera": ("gentle, steady camera at a natural conversational pace", "자연스러운 대화 속도의 차분하고 안정적인 카메라"),
        "grade": ("soft warm tones, creamy highlights", "부드럽고 따뜻한 색감, 크림색 하이라이트"),
        "lighting": 1,
        "music": ("calm acoustic guitar and soft piano", "잔잔한 어쿠스틱 기타와 부드러운 피아노"),
        "avoid": ("no exaggerated expressions", "과장된 표정 없음"),
        "beats": (("Everyday moment", "일상의 순간"), ("Preparing the gift", "마음 준비"), ("Sharing", "나누는 순간"),
                  ("Warm ending", "따뜻한 마무리")),
        "actions": (("soft daylight drifts across the table, a little steam rising from a cup of tea",
                     "부드러운 햇살이 식탁 위로 번지고, 찻잔에서 김이 조금 피어오름"),
                    ("hands offer the rice cake and a smile spreads as it is shared",
                     "손으로 찹쌀떡을 건네고, 나누며 미소가 번짐"),
                    ("the rice cakes rest beside the gift box in warm light", "찹쌀떡이 따뜻한 빛 속 선물 상자 옆에 놓여 있음")),
        "shots": (("soft medium shot, gentle push-in", "부드러운 미디엄 샷, 살짝 다가가기"),
                  (("over-the-shoulder shot", "어깨 너머 샷"),
                   ("slow handheld follow", "천천히 따라가는 핸드헬드")),
                  ("close-up on hands and smiling faces", "손과 웃는 얼굴 클로즈업"),
                  ("warm wide shot, slow pull-back", "따뜻한 와이드 샷, 천천히 빠지기")),
        "sfx": (("quiet room tone", "조용한 실내 소리"), ("soft rustle of wrapping paper", "포장지가 부드럽게 바스락거리는 소리"),
                ("soft laughter", "작은 웃음소리"), ("gentle sigh of delight", "기분 좋은 감탄")),
        "weights": (1, 1.1, 1.2, 1.4),
    },
    "vlog": {
        "label": "브이로그·리뷰",
        "pattern": r"브이로그|일상|셀카|리뷰|후기",
        "concept": ("Trying Hanjungsun Chapssal-tteok", "한정선 찹쌀떡 먹어 보기"),
        "genre": ("Handheld social media vlog", "핸드헬드 SNS 브이로그"),
        "quality": ("realistic smartphone footage", "사실적인 휴대폰 영상"),
        "keywords": ("natural daylight, authentic and unpolished, real-time speed",
                     "자연광, 꾸미지 않은 진짜 같은 느낌, 실제 속도"),
        "pace": ("casual jump cuts at real-time speed", "실제 속도의 편한 점프컷"),
        "camera": ("handheld phone camera with natural micro shake, real-time speed, no slow motion",
                   "자연스럽게 흔들리는 휴대폰 핸드헬드, 실제 속도, 슬로모션 없음"),
        "grade": ("natural phone colors, slightly bright highlights", "자연스러운 휴대폰 색감, 살짝 밝은 하이라이트"),
        "lighting": 1,
        "music": ("real ambient sound of a cafe, no background music", "카페의 실제 현장 소리, 배경음악 없음"),
        "avoid": ("no studio lighting, no cinematic color grading", "스튜디오 조명·영화 같은 색보정 없음"),
        "beats": (("Hook", "첫 마디"), ("Unboxing", "열어 보기"), ("First bite", "첫입"), ("Reaction", "리액션")),
        "actions": (("holding the box up to the camera in natural daylight", "자연광 아래 상자를 카메라에 들어 보임"),
                    ("taking a big first bite, the rice cake stretching slightly", "크게 한입 베어 물고 떡이 살짝 늘어남"),
                    ("a genuine happy reaction while holding the rice cake up", "찹쌀떡을 들어 보이며 진심으로 기뻐하는 리액션")),
        "shots": (("handheld selfie-style shot, natural micro shake", "셀카처럼 든 핸드헬드, 자연스러운 흔들림"),
                  (("quick handheld pan", "빠른 핸드헬드 패닝"),
                   ("casual medium shot at eye level", "눈높이의 편한 미디엄 샷")),
                  ("POV close-up as if filmed on a phone", "휴대폰으로 찍은 듯한 1인칭 클로즈업"),
                  ("selfie reaction shot, holding the product up to the camera", "제품을 카메라에 들어 보이는 셀카 리액션")),
        "sfx": (("cafe chatter", "카페 웅성거림"), ("crinkle of a paper wrapper", "포장지 바스락 소리"),
                ("a soft chewy bite", "쫀득하게 씹는 소리"), ("a happy 'mmm'", "맛있다는 '음~'")),
        "weights": (1, 1, 1, 1),
    },
    "energetic": {
        "label": "역동적 숏폼",
        "pattern": r"신나|트렌디|틱톡|숏폼|릴스|역동적인\s*(느낌|분위기)",
        "concept": ("Chewy in a Snap", "순식간에 쫀득"),
        "genre": ("High-energy short-form ad", "역동적인 숏폼 광고"),
        "quality": ("4K photorealistic", "4K 실사"),
        "keywords": ("bold contrast, vivid colors, dynamic motion blur, real food physics",
                     "강한 대비, 선명한 색, 역동적인 모션 블러, 실제 같은 음식 물리"),
        "pace": ("fast rhythmic cuts on the beat, whip transitions, speed ramps", "비트에 맞춘 빠른 컷, 휩 전환, 스피드 램프"),
        "camera": ("fast cuts timed to the beat, about one cut every 1-2 seconds", "비트에 맞춘 빠른 컷, 1~2초마다 한 번씩 전환"),
        "grade": ("punchy saturated colors, crisp highlights", "쨍한 색감, 또렷한 하이라이트"),
        "lighting": 2,
        "music": ("upbeat electronic beat with bass drops and whoosh transitions", "신나는 전자음 비트, 베이스 드롭과 휙 전환음"),
        "avoid": ("no slow drifting shots", "느리게 흘러가는 샷 없음"),
        "beats": (("Hook", "훅"), ("Build-up", "빌드업"), ("Drop", "드롭"), ("Payoff", "마무리 한 방")),
        "actions": (("a rice cake drops into frame and bounces, flour bursting outward", "찹쌀떡이 화면에 떨어져 통통 튀고, 가루가 사방으로 터짐"),
                    ("rice cakes and flour burst upward in slow motion and swirl around the camera",
                     "찹쌀떡과 쌀가루가 슬로모션으로 위로 터져 오르며 카메라 주위를 소용돌이침"),
                    ("everything snaps into place and the rice cakes land perfectly still", "모든 것이 제자리를 찾고 찹쌀떡이 완벽하게 멈춰 내려앉음")),
        "shots": (("fast snap zoom-in", "빠른 스냅 줌인"),
                  (("whip pan transition on the beat", "비트에 맞춘 휩 팬 전환"),
                   ("quick dutch-angle close-up", "빠른 사선 앵글 클로즈업")),
                  ("speed ramp from slow to fast", "느렸다 빨라지는 스피드 램프"),
                  ("punchy push-in hero shot ending on a freeze frame", "강하게 다가가 멈추는 히어로 샷")),
        "sfx": (("bass hit", "묵직한 베이스 타격음"), ("whoosh", "휙 소리"), ("bass drop with a burst of flour", "가루가 터지는 베이스 드롭"),
                ("final beat drop", "마지막 비트 드롭")),
        "weights": (0.7, 0.8, 1, 1.3),
    },
    "retro": {
        "label": "레트로",
        "pattern": r"레트로|옛날|캠코더|빈티지|추억",
        "concept": ("A Sweet Memory", "달콤한 추억"),
        "genre": ("Early-2000s home video", "2000년대 초 홈비디오"),
        "quality": ("authentic early-2000s camcorder footage", "2000년대 초 캠코더 실제 영상 느낌"),
        "keywords": ("consumer MiniDV camcorder look, slight color fading, soft focus, light video noise",
                     "MiniDV 캠코더 느낌, 살짝 바랜 색, 부드러운 초점, 약한 영상 노이즈"),
        "pace": ("simple in-camera cuts, slightly abrupt like a home video", "홈비디오처럼 살짝 툭툭 끊기는 단순한 컷"),
        "camera": ("handheld camcorder, autofocus hunting, small exposure shifts, no polished cinematography",
                   "캠코더 핸드헬드, 초점이 살짝 헤맴, 노출이 조금씩 변함, 매끈한 영화 촬영 없음"),
        "grade": ("faded warm colors, slightly crushed blacks", "바랜 따뜻한 색, 살짝 뭉개진 검정"),
        "lighting": 1,
        "music": ("natural camcorder microphone sound with light hiss", "캠코더 마이크로 담은 자연음, 약한 잡음"),
        "avoid": ("no modern ultra-sharp look", "요즘 같은 초고화질 느낌 없음"),
        "beats": (("Recording starts", "녹화 시작"), ("Around the table", "식탁 풍경"), ("Shared bite", "함께 한입"),
                  ("Last frame", "마지막 장면")),
        "actions": (("the camcorder powers on and the frame wobbles as it finds focus", "캠코더가 켜지고 초점을 찾으며 화면이 살짝 흔들림"),
                    ("someone takes a bite and laughs, the rice cake stretching slightly", "누군가 한입 먹고 웃으며 떡이 살짝 늘어남"),
                    ("the rice cakes on a plate as the exposure settles", "노출이 맞춰지며 접시 위 찹쌀떡이 보임")),
        "shots": (("handheld camcorder shot, autofocus hunting", "캠코더 핸드헬드, 초점이 살짝 헤맴"),
                  (("casual zoom with the camcorder zoom rocker", "캠코더 줌 버튼으로 당기는 줌"),),
                  ("slightly shaky medium shot", "살짝 흔들리는 미디엄 샷"),
                  ("close-up as the exposure slowly settles", "노출이 천천히 맞춰지는 클로즈업")),
        "sfx": (("camcorder click", "캠코더 녹화 버튼 소리"), ("muffled room sound", "먹먹한 실내 소리"),
                ("someone laughing behind the camera", "카메라 뒤 웃음소리"), ("tape stopping click", "녹화가 끝나는 딸깍 소리")),
        "weights": (1, 1, 1, 1),
    },
    "fantasy": {
        "label": "판타지 변신",
        "pattern": r"판타지|변신|마법|환상",
        "concept": ("A Bite of Fantasy", "한입의 판타지"),
        "genre": ("Surreal fantasy food film", "초현실 판타지 푸드 영상"),
        "quality": ("4K hyper-cinematic", "4K 하이퍼 시네마틱"),
        "keywords": ("photorealistic food textures blended with a dreamlike world, volumetric light, soft bloom, "
                     "pastel pink and lavender glow",
                     "꿈같은 세계와 어우러진 실사 음식 질감, 볼류메트릭 라이트, 부드러운 블룸, 파스텔 핑크·라벤더 빛"),
        "pace": ("begins calm and real, then flows into seamless magical transitions", "차분하고 현실적으로 시작해 매끄러운 마법 같은 전환으로 흐름"),
        "camera": ("starts grounded and real, then glides forward like a cinematic drone", "현실적으로 시작해 시네마틱 드론처럼 앞으로 미끄러지는 카메라"),
        "grade": ("dreamy pastel tones with warm magical highlights", "꿈결 같은 파스텔 색감, 따뜻하고 신비로운 하이라이트"),
        "lighting": 2,
        "music": ("dreamy orchestral swell with soft chimes", "꿈결 같은 오케스트라 고조와 부드러운 차임"),
        "avoid": ("no dark or scary imagery", "어둡거나 무서운 이미지 없음"),
        "beats": (("Reality", "현실"), ("Into the dream", "꿈으로"), ("Reality breaks", "현실이 깨지는 순간"),
                  ("Fantasy hero", "판타지 히어로")),
        "actions": (("crumbs of rice flour fall in slow motion, everything still grounded and real",
                     "쌀가루 부스러기가 슬로모션으로 떨어지고, 아직은 모든 것이 현실적임"),
                    ("at the first bite the room melts into a world of rice-flour clouds and rivers of sweet red bean",
                     "첫입을 무는 순간 방이 녹아내리며 쌀가루 구름과 달콤한 팥 강이 흐르는 세계로 변함"),
                    ("the rice cake glows softly at the center of the endless sweet landscape",
                     "끝없이 펼쳐진 달콤한 풍경 한가운데에서 찹쌀떡이 은은하게 빛남")),
        "shots": (("macro cinematic close-up, shallow depth of field", "매크로 시네마틱 클로즈업, 얕은 심도"),
                  (("slow push-in as the light begins to refract", "빛이 굴절되기 시작하며 천천히 다가가기"),),
                  ("drone-like forward glide through the fantasy world", "판타지 세계를 드론처럼 앞으로 미끄러지는 샷"),
                  ("slow pull-back revealing the endless dessert landscape", "끝없는 디저트 풍경을 보여 주며 천천히 빠지기")),
        "sfx": (("soft room tone and a gentle squish", "조용한 실내 소리와 말랑한 소리"), ("rising magical shimmer", "점점 커지는 신비로운 반짝임"),
                ("a soft whoosh as reality turns into chimes", "현실이 차임 소리로 바뀌는 부드러운 휙 소리"),
                ("warm twinkling chime", "따뜻하게 반짝이는 차임")),
        "weights": (1, 1, 1.3, 1.4),
    },
    "miniature": {
        "label": "미니어처 월드",
        "pattern": r"미니어처|디오라마|작은\s*사람|소인",
        "concept": ("The Little Chapssal-tteok Workshop", "작은 찹쌀떡 공방"),
        "genre": ("Cinematic miniature world film", "시네마틱 미니어처 월드 영상"),
        "quality": ("4K ultra-detailed", "4K 초정밀"),
        "keywords": ("tilt-shift miniature diorama, tiny people around giant rice cakes, intricate tiny props, cozy and whimsical realism",
                     "틸트시프트 미니어처 디오라마, 거대한 찹쌀떡 주변의 작은 사람들, 정교한 작은 소품, 아늑하고 기발한 사실감"),
        "pace": ("calm flowing pacing with gentle tracking transitions", "차분하게 흐르는 리듬, 부드러운 트래킹 전환"),
        "camera": ("slow cinematic dolly and gentle tracking at miniature scale, shallow depth of field",
                   "미니어처 눈높이의 느린 시네마틱 돌리와 부드러운 트래킹, 얕은 심도"),
        "grade": ("soft pastel pink, cream and peach tones", "부드러운 파스텔 핑크·크림·피치 색감"),
        "lighting": 1,
        "music": ("cozy lo-fi cafe music with soft piano", "아늑한 로파이 카페 음악과 부드러운 피아노"),
        "avoid": ("no giant human hands in frame, no chaotic crowds", "화면 속 거대한 사람 손·북적이는 군중 없음"),
        "beats": (("Arrival", "도착"), ("Tiny makers", "작은 장인들"), ("The finishing touch", "마무리 손길"),
                  ("The finished world", "완성된 세계")),
        "actions": (("tiny people walk toward a giant rice cake as warm little lights glow", "작은 사람들이 거대한 찹쌀떡 쪽으로 걸어가고 작은 불빛이 따뜻하게 빛남"),
                    ("a tiny crane lowers the last rice cake into place as flour drifts down like snow",
                     "작은 크레인이 마지막 찹쌀떡을 내려놓고 쌀가루가 눈처럼 내림"),
                    ("the tiny crowd cheers around the finished rice cakes", "완성된 찹쌀떡 주위에서 작은 사람들이 환호함")),
        "shots": (("wide establishing shot of the miniature world, slow dolly-in", "미니어처 세계를 보여 주는 와이드 샷, 천천히 다가가기"),
                  (("cozy tracking shot between tiny workers", "작은 일꾼들 사이를 지나는 아늑한 트래킹"),
                   ("macro close-up on tiny hands and textures", "작은 손과 질감을 담은 매크로 클로즈업")),
                  ("slow crane-up shot", "천천히 올라가는 크레인 샷"),
                  ("slow pull-back wide shot of the whole miniature world", "미니어처 세계 전체를 보여 주며 천천히 빠지는 와이드 샷")),
        "sfx": (("tiny footsteps and soft chatter", "작은 발소리와 말소리"), ("little tools tapping", "작은 도구 두드리는 소리"),
                ("crane whirr and a soft thud", "크레인 소리와 부드럽게 내려놓는 소리"), ("tiny cheering and a warm chime", "작은 환호와 따뜻한 차임")),
        "weights": (1, 1, 1.1, 1.3),
    },
    "asmr": {
        "label": "ASMR 클로즈업",
        "pattern": r"ASMR|asmr|소리\s*(위주|중심)|먹방",
        "concept": ("The Sound of Chewy", "쫀득함의 소리"),
        "genre": ("Food ASMR close-up film", "음식 ASMR 클로즈업 영상"),
        "quality": ("4K photorealistic", "4K 실사"),
        "keywords": ("extreme macro, real food physics, crisp textures, dark matte background, soft directional light",
                     "초접사, 실제 같은 음식 물리, 또렷한 질감, 어두운 무광 배경, 부드러운 방향성 조명"),
        "pace": ("slow patient pacing that lets every sound breathe", "소리 하나하나가 살아나도록 느긋한 리듬"),
        "camera": ("locked-off or ultra-slow macro moves, the product fills the frame", "고정 또는 아주 느린 매크로 움직임, 제품이 화면을 채움"),
        "grade": ("natural rich tones, gentle contrast", "자연스럽고 풍부한 색, 은은한 대비"),
        "lighting": 0,
        "music": ("no music; only crisp close-miked real food sounds", "음악 없음, 가까이서 녹음한 실제 음식 소리만"),
        "avoid": ("no background music, no fast cuts", "배경음악·빠른 컷 없음"),
        "beats": (("First touch", "첫 닿음"), ("Texture", "질감"), ("The pull", "늘어나는 순간"), ("Final bite", "마지막 한입")),
        "actions": (("a fingertip gently presses the soft surface, which slowly springs back", "손끝이 말랑한 표면을 살짝 누르고 천천히 돌아옴"),
                    ("the rice cake is slowly pulled apart with a short chewy stretch and the filling revealed",
                     "찹쌀떡을 천천히 갈라 짧고 쫀득하게 늘어나며 속이 드러남"),
                    ("a clean bite mark shows the soft cross-section as the flour settles", "깔끔한 한입 자국에 부드러운 단면이 보이고 가루가 가라앉음")),
        "shots": (("locked-off extreme macro", "고정된 초접사"),
                  (("ultra-slow macro slide", "아주 느린 매크로 슬라이드"),),
                  ("slow-motion extreme macro", "슬로모션 초접사"),
                  ("static macro hero shot", "고정된 매크로 히어로 샷")),
        "sfx": (("soft powdery tap", "가루가 톡 닿는 소리"), ("gentle squish and sticky stretch", "말랑하게 눌리고 쫀득하게 늘어나는 소리"),
                ("slow sticky pull and soft tear", "천천히 늘어나다 부드럽게 끊어지는 소리"), ("a soft chewy bite", "쫀득하게 씹는 소리")),
        "weights": (1, 1, 1.3, 1.3),
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


STYLE_ORDER = ("retro", "vlog", "asmr", "miniature", "fantasy", "energetic", "premium", "warm")  # 단어가 겹치면 앞의 분위기를 고릅니다.


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
    parts = [weights[_slot(i, count)] for i in range(count)]
    total, acc, ends = sum(parts), 0, []
    for part in parts:
        acc += part
        ends.append(round(duration * acc / total))
    ends[-1] = duration
    for i in range(count):
        low = (ends[i - 1] if i else 0) + 1
        ends[i] = min(max(ends[i], low), duration - (count - 1 - i))
    return ends


INTRO, DETAIL, CLIMAX, HERO = range(4)  # 컷 자리


def _slot(index, count):
    """컷 자리: 첫 컷은 소개, 마지막은 히어로, 끝에서 두 번째는 클라이맥스(3컷 이상), 나머지는 디테일."""
    if index == count - 1:
        return HERO
    if index == 0:
        return INTRO
    return CLIMAX if index == count - 2 else DETAIL


def _shot(style, index, count):
    """컷 자리에 맞는 화면·카메라 지시 (영어, 한국어). 디테일 컷은 차례로 돌아가며 씁니다."""
    intro, details, climax, hero = style["shots"]
    return (intro, details[(index - 1) % len(details)], climax, hero)[_slot(index, count)]


def _action(style, index, count):
    """컷 자리에 맞는 움직임·물리·공기 중 요소. 디테일 컷은 찹쌀떡 질감 단어 모음(TEXTURES)에서 차례로."""
    slot = _slot(index, count)
    if slot == DETAIL:
        return TEXTURES[(index - 1) % len(TEXTURES)]
    return style["actions"][(INTRO, CLIMAX, HERO).index(slot)]


def _sfx(style, index, count):
    return style["sfx"][_slot(index, count)]


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
    """프롬프트 줄들. lang 0=영어(Higgsfield용), 1=한국어 보기. 두 언어는 줄 수가 같고 한 줄씩 짝입니다.
    순서: 콘셉트 → 스타일 → 편집 리듬 → 제품 고정 → 배경·분위기 → 구간별 컷 → 카메라 → 조명·색감 → 연속성 → 소리 → 금지.
    컷마다 구간 이름·카메라·움직임·효과음은 저장하지 않고, 분위기와 컷 자리(소개·디테일·클라이맥스·히어로)로 매번 만듭니다.
    영어가 PROMPT_LIMIT을 넘으면(긴 영상) 디테일 컷의 구간 이름·카메라·질감 문장·효과음을 빼고 금지 줄을 짧게 씁니다.
    여러 제품이면 제품 줄의 맛별 속 문장도 뺍니다. 한국어도 똑같이 줄입니다."""
    compact = len(_with_breaks(_lines(doc, 0, False), 0)) > PROMPT_LIMIT
    return _lines(doc, lang, compact)


# 읽기 쉽게 묶음 사이에 빈 줄: 제목 / 스타일·편집·제품·배경 / 컷 구성 / 카메라·조명·연속성·소리 / 금지.
# 빈 줄은 줄 짝·저장·번역에서 무시합니다(줄 목록 _prompt_lines에는 넣지 않고 합칠 때만).
GROUP_STARTS = (("Style:", "Shots:", "Camera:", "Avoid:"), ("스타일:", "컷 구성:", "카메라:", "금지:"))


def _with_breaks(lines, lang):
    out = []
    for i, line in enumerate(lines):
        if i and line.startswith(GROUP_STARTS[lang]):
            out.append("")
        out.append(line)
    return "\n".join(out)


def _auto_prompt(doc, lang):
    """자동 프롬프트 글. 빈 줄 때문에 영어가 한도를 넘는 아주 긴 영상은 두 언어 모두 빈 줄 없이 합칩니다(줄 짝 유지)."""
    lines = _prompt_lines(doc, lang)
    breaks = len(_with_breaks(_prompt_lines(doc, 0), 0)) <= PROMPT_LIMIT
    return _with_breaks(lines, lang) if breaks else "\n".join(lines)


def _lines(doc, lang, compact):
    style = _style_of(doc)
    product = doc.get("product") or "찹쌀떡"
    look = PRODUCT_LOOK.get(product, PRODUCT_LOOK["찹쌀떡"])[lang]  # 모르는 제품이면 기본 찹쌀떡 문장
    names = doc.get("products") or [product]  # 여러 제품이면 라인업 문장
    ratio = RATIO_WORDS.get(doc["ratio"], (doc["ratio"], doc["ratio"]))[lang]
    count = len(doc["scenes"])
    has_photo = bool(doc.get("image"))
    has_gift = any(scene_kind(scene.get("en")) == "gift" for scene in doc["scenes"])

    def ko(table, value):
        return table.get(value, value) if lang else value  # 대응표에 없으면 영어 그대로

    shots = []
    for i, scene in enumerate(doc["scenes"]):
        shot, what = _shot(style, i, count)[lang], scene["ko" if lang else "en"]
        if compact and _slot(i, count) == DETAIL:
            shots.append(f"{scene['time']} — {what}.")  # 긴 영상: 디테일 컷은 장면만 (카메라는 아래 카메라 줄을 따름)
            continue
        beat = style["beats"][_slot(i, count)][lang]
        if not compact and scene_kind(scene.get("en")) == "inside":
            what = f"{what}, {START_WHOLE[lang]}"
        line = f"{scene['time']} — {beat}: {shot}; {what}; {_action(style, i, count)[lang]}."
        if doc["sound"] and (i == 0 or _sfx(style, i, count) != _sfx(style, i - 1, count)):  # 앞 컷과 같은 효과음은 생략
            line += f" {'효과음' if lang else 'SFX'}: {_sfx(style, i, count)[lang]}."
        shots.append(line)

    photo = PHOTO_MATCH[lang] + (f", {PHOTO_GIFT[lang]}" if has_gift else "")
    continuity = CONTINUITY[lang] + (f"; {photo}." if has_photo else ".")
    if lang:
        head = f"'{style['concept'][1]}' — 한정선 {style['genre'][1]}, {doc['duration']}초, {ratio}, {style['quality'][1]}."
        lock = f"제품: 한정선 {product} — {look}." if len(names) == 1 else (
            f"제품: 한정선 찹쌀떡 {len(names)}가지 맛 — {_lineup(names, 1, compact)}. {LINEUP_SHELL[1]}.")
        sound = (f"소리: {style['music'][1]}, 컷마다 적은 효과음, {MUSIC_AVOID[1]}." if doc["sound"]
                 else "소리: 무음, 음악·효과음 없음.")
        labels = ("스타일", "편집", "배경", "분위기", "컷 구성:", "카메라", "조명·색감", "금지")
    else:
        head = (f"'{style['concept'][0]}' — Hanjungsun {style['genre'][0]}, {doc['duration']} seconds, {ratio}, "
                f"{style['quality'][0]}.")
        name = PRODUCT_EN.get(product, "Korean chapssal-tteok")
        lock = f"Product: {name} by Hanjungsun — {look}." if len(names) == 1 else (
            f"Product: Hanjungsun chapssal-tteok in {len(names)} flavors — "
            f"{_lineup(names, 0, compact)}. {LINEUP_SHELL[0]}.")
        sound = (f"Sound: {style['music'][0]}, plus the sound effects noted per shot, {MUSIC_AVOID[0]}." if doc["sound"]
                 else "Sound: silent, no music, no sound effects.")
        labels = ("Style", "Editing", "Setting", "Mood", "Shots:", "Camera", "Lighting and color", "Avoid")
    style_l, edit_l, setting_l, mood_l, shots_l, camera_l, light_l, avoid_l = labels
    return [
        head,
        f"{style_l}: {style['keywords'][lang]}.",
        f"{edit_l}: {style['pace'][lang]}.",
        lock,
        f"{setting_l}: {doc.get('background_ko') if lang and doc.get('background_ko') else ko(BACKGROUND_KO, doc['background'])}. "
        f"{mood_l}: {doc.get('mood_ko') if lang and doc.get('mood_ko') else ko(MOOD_KO, doc['mood'])}.",
        shots_l,
        *shots,
        f"{camera_l}: {ko(CAMERA_KO, doc['camera'])}; {style['camera'][lang]}.",
        f"{light_l}: {ko(LIGHTING_KO, doc['lighting'])}; {style['grade'][lang]}.",
        continuity,
        *([f"{(REFERENCE_SHORT if compact else REFERENCE_NOTE)[lang]}."] if doc.get("user_refs") or doc.get("ref_video") else []),
        *[f"{_extra(doc, i, lang)}." for i in range(len(doc["extras"]))],
        sound,
        f"{avoid_l}: {AVOID_SHORT[lang] if compact else f'{COMMON_AVOID[lang]}, {REALISM_AVOID[lang]}, {FOOD_AVOID[lang]}'}, {style['avoid'][lang]}.",
    ]


def _short(name, lang):
    """제품 짧은 이름: '망고 요거트 찹쌀떡' → '망고 요거트' / 'mango yogurt'."""
    return name.replace(" 찹쌀떡", "") if lang else PRODUCT_EN.get(name, name).replace(" chapssal-tteok", "")


def _lineup(names, lang, compact):
    """여러 제품 줄의 맛 목록. 프롬프트가 길면(compact) 맛 이름만, 아니면 맛별 속 문장까지."""
    if compact:
        return ", ".join(_short(n, lang) for n in names)
    return "; ".join(f"{_short(n, lang)}: {_filling(n, lang)}" for n in names)


def _filling(name, lang):
    """제품 겉모습 문장에서 속 부분만: 'inside, …' / '속은 …'."""
    look = PRODUCT_LOOK.get(name, PRODUCT_LOOK["찹쌀떡"])[lang]
    return look.split("속은 ", 1)[-1] if lang else look.split("inside, ", 1)[-1]


def _extra(doc, index, lang):
    """추가 문장(extras)은 영어로 저장하고, AI가 함께 준 한국어(extras_ko)가 있으면 한국어 보기에 씁니다."""
    extras_ko = doc.get("extras_ko") or []
    return extras_ko[index] if lang and index < len(extras_ko) and extras_ko[index] else doc["extras"][index]


def build_prompt(doc):
    """Higgsfield로 보낼 영어 프롬프트 (여러 줄). 사용자가 직접 고친 문장(custom)이 있으면 그대로 씁니다."""
    if doc.get("custom"):
        return doc["custom"]
    return _auto_prompt(doc, 0)


def build_prompt_ko(doc):
    """영어 프롬프트와 같은 내용을 한국어로 조립합니다. 직접 고친 한국어(custom_ko)가 있으면 그대로 씁니다.
    예전 방식으로 영어만 직접 고친 문서(custom만 있음)는 번역하지 않고 None을 돌려줍니다."""
    if doc.get("custom_ko"):
        return doc["custom_ko"]
    if doc.get("custom"):
        return None
    return _auto_prompt(doc, 1)


# ---------- 직접 고친 한국어 → 영어 (단어 규칙, AI 연결 전) ----------
# 영어·한국어 프롬프트는 한 줄씩 짝입니다. 고친 줄만 아는 표현을 영어로 바꾸고,
# 모르는 한국어가 남으면 영어를 바꾸지 않고 untranslated에 적습니다(영상 모델에 한국어를 보내지 않음).
# 사용자가 올린 레퍼런스 이미지·참고 영상이 있을 때 넣는 줄 (분위기 참고용, 제품은 제품 사진 기준)
REFERENCE_NOTE = ("References: use the attached reference images and video only for mood, composition, camera movement "
                  "and color; the product must match the product photo exactly",
                  "레퍼런스: 첨부한 레퍼런스 이미지·영상은 분위기·구도·카메라 움직임·색감만 참고, 제품은 제품 사진과 똑같이")
REFERENCE_SHORT = ("References: mood, composition and color only", "레퍼런스: 분위기·구도·색감만 참고")  # 프롬프트가 길 때
# 여러 제품(라인업) 영상의 제품 줄 끝 문장
LINEUP_SHELL = ("Each is a round, soft white rice cake with a light rice-flour dusting",
                "모두 고운 쌀가루를 묻힌 둥글고 하얀 찹쌀떡")
KO_LABELS = (("조명·색감:", "Lighting and color:"), ("컷 구성:", "Shots:"), ("스타일:", "Style:"), ("배경:", "Setting:"),
             ("분위기:", "Mood:"), ("카메라:", "Camera:"), ("금지:", "Avoid:"), ("효과음:", "SFX:"), ("소리:", "Sound:"),
             ("제품:", "Product:"), ("편집:", "Editing:"))
KO_FIXED = (
    ("모든 컷에서 제품 모양·색·크기·속을 똑같이 유지", "Keep the product's shape, color, size and filling identical in every shot"),
    ("첨부한 제품 사진과 똑같이", "exactly matching the attached product photo"),
    ("컷마다 적은 효과음", "plus the sound effects noted per shot"),
    ("무음, 음악·효과음 없음", "silent, no music, no sound effects"),
    CONTINUITY[::-1], PHOTO_MATCH[::-1], PHOTO_GIFT[::-1], START_WHOLE[::-1], MUSIC_AVOID[::-1], REALISM_AVOID[::-1], AVOID_SHORT[::-1], FOOD_AVOID[::-1], *[t[::-1] for t in TEXTURES],
    ("한정선", "Hanjungsun"),
    LINEUP_SHELL[::-1], REFERENCE_NOTE[::-1], REFERENCE_SHORT[::-1],
)
HANGUL = re.compile(r"[가-힣ㄱ-ㆎ]")


def _ko_phrases(doc):
    """(한국어, 영어) 표현 목록. 긴 표현부터 바꿔야 짧은 표현이 긴 표현 속을 먼저 바꾸지 않습니다."""
    pairs = list(KO_FIXED)
    for table in (CAMERA_KO, LIGHTING_KO, MOOD_KO, BACKGROUND_KO):
        pairs += [(ko, en) for en, ko in table.items()]
    for style in STYLES.values():
        for key in ("concept", "genre", "quality", "keywords", "pace", "camera", "grade", "music", "avoid"):
            pairs.append(style[key][::-1])
        intro, details, climax, hero = style["shots"]
        pairs += [shot[::-1] for shot in (intro, *details, climax, hero)]
        pairs += [pair[::-1] for key in ("sfx", "beats", "actions") for pair in style[key]]
    pairs += [(ko, en) for en, ko in RATIO_WORDS.values()]
    pairs.append(COMMON_AVOID[::-1])
    for name, en in PRODUCT_EN.items():
        pairs.append((_short(name, 1), _short(name, 0)))
        pairs.append((_filling(name, 1), _filling(name, 0)))
        pairs.append((f"한정선 {name}", f"{en} by Hanjungsun"))
        pairs.append(PRODUCT_LOOK.get(name, ("", ""))[::-1])
    pairs += [(doc.get("background_ko") or "", doc.get("background") or ""), (doc.get("mood_ko") or "", doc.get("mood") or "")]
    pairs += [(_extra(doc, i, 1), doc["extras"][i]) for i in range(len(doc.get("extras") or []))]
    scenes = [TEXTURE_SCENE, BITE_SCENE, *EXTRA_SCENES, *doc.get("scenes", [])]
    pairs += [(scene["ko"], scene["en"]) for scene in scenes if scene.get("ko") and scene.get("en")]
    # 긴 표현 먼저, 길이가 같으면 글자 순(실행할 때마다 순서가 바뀌지 않게)
    return sorted({pair for pair in pairs if pair[0]}, key=lambda pair: (-len(pair[0]), pair))


def phrase_pairs(doc):
    """화면 강조용 (한국어, 영어) 표현: 지금 한국어·영어 프롬프트에 둘 다 들어 있는 것만. 한국어 칸에서 누른 표현을 영어 칸에서 찾습니다.
    DB에는 저장하지 않고 화면에 보낼 때만 붙입니다(routes_sns.py _design_state)."""
    ko, en = doc.get("prompt_ko") or "", doc.get("prompt") or ""
    pairs = [*_ko_phrases(doc), *KO_LABELS]
    # 쉼표 목록(스타일 키워드 등)은 한국어·영어 항목 수가 같으면 항목끼리도 짝지어 단어 단위로 강조합니다.
    for k, e in list(pairs):
        ks, es = k.split(", "), e.split(", ")
        if 1 < len(ks) == len(es):
            pairs += list(zip(ks, es))
    return [[k, e] for k, e in dict.fromkeys(pairs) if k and e and k in ko and e in en]


def _ko_line_to_en(line, phrases):
    """한국어 한 줄 → 영어. 한국어가 남으면 None."""
    # 여러 제품 줄의 머리("한정선 찹쌀떡 4가지 맛")는 한 덩어리로 먼저 바꿉니다(제품 이름 짝과 겹치지 않게).
    line = re.sub(r"한정선 찹쌀떡 (\d+)가지 맛", r"Hanjungsun chapssal-tteok in \1 flavors", line)
    for ko, en in phrases:
        line = line.replace(ko, en)
    for ko, en in KO_LABELS:
        line = line.replace(ko, en)
    line = re.sub(r"(\d+)초", r"\1 seconds", line)
    return None if HANGUL.search(line) else line


def korean_to_english(doc, translate=None):
    """직접 고친 한국어(custom_ko) → (영어 프롬프트, 반영 못 한 한국어 줄들).
    자동 한국어와 줄마다 비교해, 같은 줄은 자동 영어 그대로 · 지운 줄은 영어도 지움 · 고친 줄은 아는 표현만 바꿉니다.
    아는 표현만으로 못 바꾼 줄(새로 쓴 줄 포함)은 translate(한국어 줄들, 지금 영어 줄들) → 영어 줄들(AI 번역)로 한 번에 옮깁니다.
    번역한 줄은 doc["ai_lines"]{한국어: 영어}에 남겨, 다시 저장할 때 같은 줄은 번역하지 않고 씁니다.
    그래도 못 바꾼 고친 줄은 원래 영어를 남기고, 새로 쓴 줄은 영어에 넣지 않습니다."""
    ko_auto, en_auto = _prompt_lines(doc, 1), _prompt_lines(doc, 0)
    edited = [line.strip() for line in doc["custom_ko"].splitlines() if line.strip()]
    phrases = _ko_phrases(doc)
    out, pending = [], []  # out: 영어 줄(글) 또는 [못 바꾼 한국어, 원래 영어 또는 None]
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, ko_auto, edited, autojunk=False).get_opcodes():
        if tag == "equal":
            out += en_auto[i1:i2]
            continue
        olds, news = en_auto[i1:i2], edited[j1:j2]
        for k in range(max(len(olds), len(news))):
            if k >= len(news):
                continue  # 지운 줄
            english = _ko_line_to_en(news[k], phrases)
            if english:
                out.append(english)
            else:
                item = [news[k], olds[k] if k < len(olds) else None]
                out.append(item)
                pending.append(item)

    # 전에 번역한 줄은 그대로 쓰고, 나머지만 AI로 번역합니다(줄 수가 맞고 한글이 없을 때만).
    cache = {ko: en for ko, en in (doc.get("ai_lines") or {}).items()
             if isinstance(ko, str) and isinstance(en, str) and en.strip() and not HANGUL.search(en)}
    asked = list(dict.fromkeys(item[0] for item in pending if item[0] not in cache))
    if asked and translate:
        answers = translate(asked, en_auto)
        if answers:
            cache.update((ko, en) for ko, en in zip(asked, answers) if en)
    lines, untranslated = [], []
    for item in out:
        if isinstance(item, str):
            lines.append(item)
        elif item[0] in cache:
            lines.append(cache[item[0]])
        else:
            untranslated.append(item[0])
            if item[1] is not None:
                lines.append(item[1])
    used = {item[0] for item in pending}
    doc["ai_lines"] = {ko: en for ko, en in cache.items() if ko in used}
    english = _with_breaks(lines, 0)
    return (english if len(english) <= PROMPT_LIMIT else "\n".join(lines)), untranslated


def refresh_prompts(doc, translate=None):
    """영어 프롬프트와 한국어 보기를 함께 다시 만듭니다. 직접 고친 한국어가 있으면 영어(custom)를 거기서 만듭니다.
    translate: 아는 표현으로 못 바꾼 줄의 AI 번역 함수(korean_to_english 참고). 없으면 규칙만."""
    doc["untranslated"] = []
    if not doc.get("custom_ko"):
        doc.pop("ai_lines", None)
    if doc.get("custom_ko"):
        if [line.strip() for line in doc["custom_ko"].splitlines() if line.strip()] == _prompt_lines(doc, 1):
            doc["custom_ko"] = doc["custom"] = ""  # 자동과 같으면 직접 고친 것이 아닙니다.
            doc.pop("ai_lines", None)
        else:
            english, doc["untranslated"] = korean_to_english(doc, translate)
            doc["custom"] = "" if english == _auto_prompt(doc, 0) else english
    doc["prompt"] = build_prompt(doc)
    doc["prompt_ko"] = build_prompt_ko(doc)
    return doc


def make_draft(text, ratio="9:16", duration=5, sound=False, product="찹쌀떡", event=None, products=None):
    """요청 문장 → 영상 문서 (README 8장 형식 + caption·demo·reviewed).
    products: 여러 제품 이름(라인업 영상). 주면 product는 그 첫 제품입니다."""
    names = list(products or [product])
    product = names[0]
    text = text or ""
    ratio = _pick(ratio, RATIOS, "9:16")
    duration = _duration(duration)
    setting = _setting(text)
    product_en = PRODUCT_EN.get(product, "Korean chapssal-tteok")
    product_vi = PRODUCT_VI.get(product, "Chapssal-tteok Hanjungsun")
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
    if len(names) > 1:
        # 라인업: 첫 컷은 맛들이 나란히, 다음은 맛을 하나씩 클로즈업. 컷 수가 모자라면 뒤쪽 클로즈업부터 빠집니다(_retime).
        lineup = {"ko": f"{len(names)}가지 맛 찹쌀떡이 나란히 놓인 모습",
                  "en": f"{len(names)} flavors of Hanjungsun chapssal-tteok lined up side by side",
                  "caption": f"Mừng {event_vi}" if event_vi else f"Chapssal-tteok {len(names)} vị"}
        closeups = [{"ko": f"{name} 클로즈업", "en": f"extreme close-up of {PRODUCT_EN.get(name, 'Korean chapssal-tteok')}",
                     "caption": PRODUCT_VI.get(name, "")} for name in names]
        scenes = [lineup, *closeups, dict(middle), scenes[-1]]
    elif scene_count(duration) >= 4:
        scenes.insert(0, {**setting["opening"], "caption": ""})

    # 분위기: 요청 단어 → 없으면 기념일 영상은 따뜻한 감성, 그 밖에는 프리미엄 광고
    style = _find_style(text) or ("warm" if event else DEFAULT_STYLE)
    doc = {
        "kind": "video",
        "ratio": ratio,
        "duration": duration,
        "sound": bool(sound),
        "summary": " · ".join(filter(None, [f"{duration}초 {ratio}", product if len(names) == 1 else f"{len(names)}가지 맛",
                                            event, STYLES[style]["label"]])),
        "scenes": _retime(scenes, duration, style),
        "style": style,
        "product": product,
        "products": names,
        "event": event,
        "camera": CAMERAS[2] if re.search(r"빠르|역동", text) else CAMERAS[1],
        "lighting": LIGHTINGS[STYLES[style]["lighting"]],
        "mood": setting["mood"],
        "background": setting["background"],
        "extras": [],
        "prompt": "",
        "prompt_ko": "",
        "custom": "",
        "custom_ko": "",
        "untranslated": [],
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
        new["scenes"][0]["caption"] = PRODUCT_VI.get(new.get("product"), BRAND_CAPTION)
        new["scenes"][-1]["caption"] = BRAND_CAPTION
        caption_changes.append("자막 넣기")

    if video_changes:
        if new["custom"] or new.get("custom_ko"):
            new["custom"] = new["custom_ko"] = ""  # 말로 고치면 직접 고친 프롬프트 대신 새로 만듭니다.
            video_changes.append("직접 고친 프롬프트를 새로 만들기")
        new["summary"] = re.sub(r"^\d+초 [\d:]+", f"{new['duration']}초 {new['ratio']}", new["summary"])
        new["reviewed"] = False
        refresh_prompts(new)
    return new, video_changes + caption_changes


# ---------- AI(OpenAI)로 요청 이해하기 ----------
# 단어 규칙(revise_draft)이 못 알아듣는 자유로운 요청("발렌타인 느낌으로, 장미꽃과 스위트하게")을 AI가 영상 문서의 칸으로 바꿉니다.
# AI는 칸만 고치고, 프롬프트 문장은 지금처럼 _prompt_lines가 만듭니다(구조·길이 한도 유지). 호출은 routes_sns.py _call_ai.
AI_TEXT_LIMIT = 200  # 칸 하나의 최대 글자 수
TITLE_LIMIT = 30     # 작업 제목(화면에서 직접 입력) 최대 글자 수


def video_title(doc, event=None):
    """작업 목록에 보일 짧은 주제. 화면에서 직접 입력한 title이 있으면 그것, 없으면 "기념일 - 제품" / "제품 · 분위기".
    (AI는 제목을 정하지 않습니다. 예전에 AI가 정해 둔 title은 그대로 보입니다.)
    event: 문서에 기념일이 없을 때 쓸 작업의 기념일(SnsChat.event_id, 추천 카드로 만든 예전 작업)."""
    if doc.get("title"):
        return _no_tteok(doc["title"])
    names = doc.get("products") or [doc.get("product") or ""]
    if len(names) > 1:
        product = "전체 제품" if set(names) >= {item["name_ko"] for item in PRODUCTS} else "·".join(_no_tteok(n) for n in names)
    else:
        product = _no_tteok(names[0])
    event = doc.get("event") or event
    if event:
        return f"{event} - {product}" if product else event
    return f"{product} · {_style_of(doc)['label']}" if product else _style_of(doc)["label"]


def _no_tteok(text):
    """제품이 모두 찹쌀떡이라 제목에서는 '찹쌀떡'을 뺍니다. ('발렌타인데이 - 망고스틴 찹쌀떡' → '발렌타인데이 - 망고스틴')"""
    return re.sub(r"\s+", " ", re.sub(r"찹쌀떡", " ", text)).strip(" -·")

AI_INSTRUCTIONS = """당신은 베트남에 진출한 한국 찹쌀떡 브랜드 '한정선'의 숏폼 광고 영상 기획자입니다.
사용자의 요청을 읽고 아래 영상 문서(JSON)를 고쳐 주세요. 요청에 없는 칸은 그대로 두세요.

규칙
- style은 다음 중 하나: {styles}
- duration은 5~30 정수, ratio는 "9:16" | "16:9" | "1:1", sound는 true/false
- camera는 다음 중 하나: {cameras}
- lighting은 다음 중 하나: {lightings}
- background·mood는 영어, background_ko·mood_ko는 같은 뜻의 한국어
- scenes는 1~{max_scenes}개. 각 장면은 ko(한국어 장면 설명), en(같은 뜻의 영어 화면 묘사, 20단어 이내), caption(베트남어 자막, 40자 이내, 없으면 "")
- 장면 수는 영상 길이(초)보다 많을 수 없습니다. 첫 장면은 시작, 마지막 장면은 제품이 돋보이는 마무리로 둡니다.
- extras는 추가로 지킬 영어 문장 0~3개, extras_ko는 같은 순서의 한국어
- 화면에 글자·로고를 그리라는 묘사는 넣지 마세요. 글은 caption(자막)으로만 넣습니다.
- 제품({product})과 그 모양은 바꾸지 마세요. 과장된 효능·건강 표현은 쓰지 마세요.
- event는 관련 기념일 이름(한국어, 없으면 기존 값 그대로)
- changes는 바꾼 내용을 한국어 짧은 구절로 나열합니다(예: "배경을 장미 꽃잎 테이블로"). 요청을 이해하지 못했거나 바꿀 것이 없으면 []

다음 JSON 형식으로만 답하세요:
{{"changes": ["..."], "doc": {{"style": "...", "duration": 10, "ratio": "9:16", "sound": false, "camera": "...", "lighting": "...",
  "background": "...", "background_ko": "...", "mood": "...", "mood_ko": "...", "event": "...",
  "extras": ["..."], "extras_ko": ["..."], "scenes": [{{"ko": "...", "en": "...", "caption": "..."}}]}}}}
"""

AI_FIELDS = ("style", "duration", "ratio", "sound", "camera", "lighting", "background", "background_ko", "mood", "mood_ko",
             "event", "extras", "extras_ko", "scenes")


def ai_messages(doc, text):
    """AI에 보낼 메시지. 지금 문서에서 AI가 고칠 수 있는 칸만 보냅니다."""
    current = {key: doc.get(key) for key in AI_FIELDS}
    current["scenes"] = [{k: scene.get(k, "") for k in ("ko", "en", "caption")} for scene in doc["scenes"]]
    instructions = AI_INSTRUCTIONS.format(
        styles=", ".join(f"{key}({style['label']})" for key, style in STYLES.items()),
        cameras=" | ".join(CAMERAS), lightings=" | ".join(LIGHTINGS),
        max_scenes=MAX_MANUAL_SCENES, product=", ".join(doc.get("products") or [doc.get("product") or "찹쌀떡"]),
    )
    return [
        {"role": "system", "content": instructions},
        {"role": "user", "content": f"지금 영상 문서:\n{json.dumps(current, ensure_ascii=False)}\n\n요청: {text}"},
    ]


# [저장] 때 아는 표현으로 못 바꾼 한국어 줄의 번역 (routes_sns.py _ai_translate)
TRANSLATE_INSTRUCTIONS = """한국 찹쌀떡 브랜드 '한정선'의 숏폼 광고 영상 프롬프트(영상 생성 AI Kling용)를 영어로 옮깁니다.
받은 한국어 줄(lines)을 줄마다 영어 한 줄로 옮겨 {{"lines": ["...", ...]}} JSON으로만 답하세요.
- 줄 수와 순서를 그대로 지키고, 줄을 합치거나 나누지 마세요.
- 줄 맨 앞 머리는 영어 머리로 바꿉니다({labels}). "0-1s —" 같은 시간 표시는 그대로 둡니다.
- 찹쌀떡은 chapssal-tteok(mochi라고 쓰지 않음), 한정선은 Hanjungsun.
- english_prompt(같은 영상의 지금 영어 프롬프트)의 말투·용어에 맞춰 짧고 구체적인 영어로 쓰고, 한글은 남기지 마세요."""


def translate_messages(lines, context):
    """AI 번역 메시지. context: 지금 영어 프롬프트 줄들(머리 모양·용어 참고)."""
    labels = ", ".join(f"{ko} → {en}" for ko, en in KO_LABELS)
    return [
        {"role": "system", "content": TRANSLATE_INSTRUCTIONS.format(labels=labels)},
        {"role": "user", "content": json.dumps({"english_prompt": context, "lines": lines}, ensure_ascii=False)},
    ]


TRANSLATE_LIMIT = 800  # 번역한 줄 하나의 최대 글자 수 (컷 줄은 200자를 넘기 쉬움)


def apply_translation(data, lines):
    """AI 번역 결과 검사: 줄 수가 같을 때만 영어 줄 목록, 아니면 None.
    줄마다 따로 검사해, 비었거나 너무 길거나 한글이 남은 줄만 None(그 줄은 "반영하지 못한 줄"로 남음)."""
    got = data.get("lines") if isinstance(data, dict) else None
    if not isinstance(got, list) or len(got) != len(lines):
        return None
    ok = lambda line: isinstance(line, str) and line.strip() and len(line) <= TRANSLATE_LIMIT and not HANGUL.search(line)
    return [line.strip() if ok(line) else None for line in got]


def _ai_text(value, english=False):
    """AI가 준 글 한 칸 검사. 문자열이 아니거나 너무 길거나, 영어 칸에 한글이 있으면 None."""
    if not isinstance(value, str) or not value.strip() or len(value) > AI_TEXT_LIMIT:
        return None
    return None if english and HANGUL.search(value) else value.strip()


def apply_ai(doc, data):
    """AI 응답 → (새 문서, 바꾼 것 목록). 형식이 틀리면 None을 돌려주고, 부른 쪽은 단어 규칙(revise_draft)을 씁니다.
    영상(자막 외)이 바뀌면 다시 검토가 필요합니다(reviewed=False). AI가 고친 문서는 시연(demo)이 아닙니다.
    줄여도 프롬프트가 PROMPT_LIMIT을 넘으면(장면 묘사가 너무 긺) 쓰지 않습니다."""
    if not isinstance(data, dict) or not isinstance(data.get("doc"), dict) or not isinstance(data.get("changes"), list):
        return None
    got, new = data["doc"], copy.deepcopy(doc)
    changes = [str(item)[:60] for item in data["changes"] if isinstance(item, str) and item.strip()][:8]
    if not changes:
        return doc, []

    new["style"] = got.get("style") if got.get("style") in STYLES else doc.get("style", DEFAULT_STYLE)
    new["duration"] = _duration(got.get("duration"), doc["duration"])
    new["ratio"] = _pick(got.get("ratio"), RATIOS, doc["ratio"])
    new["sound"] = got["sound"] if isinstance(got.get("sound"), bool) else doc["sound"]
    new["camera"] = _pick(got.get("camera"), CAMERAS, doc["camera"])
    new["lighting"] = _pick(got.get("lighting"), LIGHTINGS, doc["lighting"])
    for key in ("background", "mood"):
        english, korean = _ai_text(got.get(key), english=True), _ai_text(got.get(f"{key}_ko"))
        if english and korean:
            new[key], new[f"{key}_ko"] = english, korean
    if isinstance(got.get("event"), str) and len(got["event"]) <= 30:
        new["event"] = got["event"].strip() or None

    extras, extras_ko = got.get("extras"), got.get("extras_ko")
    if isinstance(extras, list) and isinstance(extras_ko, list) and len(extras) == len(extras_ko) <= 3:
        pairs = [(_ai_text(en, english=True), _ai_text(ko)) for en, ko in zip(extras, extras_ko)]
        if all(en and ko for en, ko in pairs):
            new["extras"], new["extras_ko"] = [en for en, _ in pairs], [ko for _, ko in pairs]

    scenes = got.get("scenes")
    if not isinstance(scenes, list) or not 1 <= len(scenes) <= min(new["duration"], MAX_MANUAL_SCENES):
        return None
    clean = []
    for scene in scenes:
        if not isinstance(scene, dict):
            return None
        ko, en, caption = _ai_text(scene.get("ko")), _ai_text(scene.get("en"), english=True), scene.get("caption") or ""
        if not ko or not en or not isinstance(caption, str) or len(caption) > 80:
            return None
        clean.append({"ko": ko, "en": en, "caption": caption.strip()})
    _apply_ends(clean, _weighted_ends(new["duration"], len(clean), new["style"]))
    new["scenes"] = clean

    # 자막만 바뀌었는지 보려고 자막을 뺀 영상 칸끼리 비교합니다.
    def video_part(item):
        part = {key: item.get(key) for key in AI_FIELDS if key != "scenes"}
        part["scenes"] = [(s["ko"], s["en"], s["time"]) for s in item["scenes"]]
        return part

    if video_part(new) != video_part(doc):
        new["custom"] = new["custom_ko"] = ""
        new["reviewed"] = False
    new["demo"] = False
    new["summary"] = " · ".join(filter(None, [f"{new['duration']}초 {new['ratio']}", new.get("product"), new.get("event"),
                                              STYLES[new["style"]]["label"]]))
    refresh_prompts(new)
    return (new, changes) if len(new["prompt"]) <= PROMPT_LIMIT else None
