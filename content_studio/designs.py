"""포스터·카드뉴스 문서 만들기·고치기, 템플릿. [희주]

대화로 디자인을 고치는 규칙도 여기에 둡니다. routes_sns.py(유진)는 이 파일의 함수를 부르기만 합니다.
콘텐츠 색은 제품 색과 현지 문화 기준(현지 시장 분석 "국가·문화")을 따릅니다. (README 6.3)

포스터 문서 형식 (README 8장): {kind, ratio, demo, pages: [{layout, bg, accent, elements: [...]}]}
- x·y·w·h: 페이지 크기 대비 %(0~100). 규격을 바꿔도 같은 자리에 남습니다.
- size: 원본 크기(SIZES) 기준 글자 크기(px). z: 위아래 순서(클수록 위).
- 색은 #rrggbb 6자리로 씁니다. (편집기 색 고르기 칸과 맞춤)
포스터 속 글은 베트남어(제목)·영어(부제)입니다. 베트남어는 원어민 검수 전 시연 문구입니다.
AI 연결 전에는 정해진 틀로 만들고 demo=True로 표시합니다.
"""
from flask import url_for

SIZES = {"1:1": (1080, 1080), "4:5": (1080, 1350), "9:16": (1080, 1920), "16:9": (1920, 1080)}
DEFAULT_RATIO = "4:5"
BRAND = "HANJUNGSUN"

# 제품 color(products.py)별 포스터 색. 빨강·금색 권장, 흰색·검정 위주는 주의 (README 6.3)
PALETTES = {
    "hero": {"bg": "#8e1b2e", "accent": "#f2c14e", "text": "#fff7e8", "soft": "#a8323f"},
    "gold": {"bg": "#f6e7c8", "accent": "#c8102e", "text": "#3b2314", "soft": "#efd9a8"},
}
PRODUCT_EN = {"chapssaltteok": "Korean Mochi", "mangosteen_chapssaltteok": "Mangosteen Mochi"}
# 기념일 이름(sns.js 추천·대화에서 오는 한국어 이름) → (베트남어, 영어)
EVENT_TEXT = {
    "베트남 스승의 날": ("Ngày Nhà giáo Việt Nam", "Happy Teachers' Day"),
    "베트남 여성의 날": ("Ngày Phụ nữ Việt Nam", "Happy Women's Day"),
    "크리스마스": ("Giáng Sinh an lành", "Merry Christmas"),
}
# 규격별 제품 사진 너비(%). 사진은 정사각형으로 둡니다.
PHOTO_W = {"4:5": 62, "1:1": 46, "9:16": 76}


def _line_h(size, height, lines=1):
    """글자 크기(px) 한 줄이 차지하는 높이를 페이지 높이 대비 %로 바꿉니다."""
    return round(size * 1.3 * lines / height * 100, 2)


def _text(id_, text, box, size, color, weight=400, align="center", bg=None, z=3):
    x, y, w, h = box
    item = {"id": id_, "role": id_, "type": "text", "x": round(x, 2), "y": round(y, 2), "w": round(w, 2),
            "h": round(h, 2), "z": z, "text": text, "font": "sans", "size": size, "weight": weight,
            "color": color, "align": align}
    if bg:
        item["bg"] = bg
    return item


def _box(id_, type_, box, z, **extra):
    x, y, w, h = box
    return {"id": id_, "role": id_ if type_ == "image" else "shape", "type": type_, "x": round(x, 2),
            "y": round(y, 2), "w": round(w, 2), "h": round(h, 2), "z": z, **extra}


def _image_src(product):
    """products.py의 image(static/images/sns/ 안 파일 이름)를 주소로 바꿉니다. 없으면 None."""
    name = product.get("image")
    if not name:
        return None
    try:
        return url_for("content_studio.static", filename=f"images/sns/{name}")
    except RuntimeError:  # 요청 밖(시험 등)에서 부를 때
        return None


def make_poster(text, ratio=DEFAULT_RATIO, product=None, event=None):
    """정해진 틀로 포스터 문서를 만듭니다.

    product: products.py의 제품 dict, event: 기념일 한국어 이름(없으면 None).
    text(요청 문장)는 AI 연결 후 문구·배치에 씁니다. 지금은 쓰지 않습니다.
    """
    if ratio not in SIZES:
        ratio = DEFAULT_RATIO
    product = product or {}
    width, height = SIZES[ratio]
    palette = PALETTES.get(product.get("color"), PALETTES["gold"])
    title = product.get("name_vi") or BRAND
    subtitle = PRODUCT_EN.get(product.get("id"), "Korean Dessert")
    badge = "NEW · MÓN MỚI" if product.get("new_menu") else "K-DESSERT"
    event_line = " · ".join(EVENT_TEXT[event]) if event in EVENT_TEXT else None

    if ratio == "16:9":
        layout = "side"
        photo_h = 76
        photo_w = photo_h * height / width
        photo = (52, 12, photo_w, photo_h)
        text_x, text_w, align = 5, 44, "left"
        brand_box = (text_x, 8, 40, _line_h(34, height))
        badge_box = (text_x, 17, 18, round(30 * 2 / height * 100, 2))
        title_y = 34
    else:
        layout = "stack"
        photo_w = PHOTO_W[ratio]
        photo_h = photo_w * width / height
        photo_y = 14 if ratio == "1:1" else 15
        photo = ((100 - photo_w) / 2, photo_y, photo_w, photo_h)
        text_x, text_w, align = 6, 88, "center"
        brand_box = (6, 5, 45, _line_h(34, height))
        badge_box = (64, 4, 30, round(30 * 2 / height * 100, 2))
        title_y = photo_y + photo_h + 3

    # 사진 뒤 둥근 장식: 사진보다 조금 크게, 같은 가운데
    circle_w = photo[2] + 8
    circle_h = circle_w * width / height
    circle = (photo[0] + photo[2] / 2 - circle_w / 2, photo[1] + photo[3] / 2 - circle_h / 2, circle_w, circle_h)

    title_size = 96 if layout == "side" else 88
    title_h = _line_h(title_size, height)
    sub_y = title_y + title_h + 0.5
    sub_size = 48 if layout == "side" else 44
    sub_h = _line_h(sub_size, height)

    elements = [
        _box("deco", "shape", circle, 1, shape="circle", fill=palette["soft"]),
        _box("photo", "image", photo, 2, src=_image_src(product), radius=24),
        _text("brand", BRAND, brand_box, 34, palette["text"], weight=800, align="left"),
        _text("badge", badge, badge_box, 30, palette["bg"], weight=700, bg=palette["accent"]),
        _text("title", title, (text_x, title_y, text_w, title_h), title_size, palette["text"], weight=800, align=align),
        _text("subtitle", subtitle, (text_x, sub_y, text_w, sub_h), sub_size, palette["accent"], weight=600, align=align),
    ]
    if event_line:
        body_y = sub_y + sub_h + 1
        elements.append(_text("body", event_line, (text_x, body_y, text_w, _line_h(34, height)), 34,
                              palette["text"], align=align))

    return {
        "kind": "poster",
        "ratio": ratio,
        "demo": True,
        "pages": [{"layout": layout, "bg": palette["bg"], "accent": palette["accent"], "elements": elements}],
    }
