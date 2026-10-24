"""포스터·카드뉴스 문서 만들기·고치기, 템플릿. [희주]

대화로 디자인을 고치는 규칙도 여기에 둡니다. routes_sns.py(유진)는 이 파일의 함수를 부르기만 합니다.
콘텐츠 색은 제품 색과 현지 문화 기준(현지 시장 분석 "국가·문화")을 따릅니다. (README 6.3)

포스터 문서 형식 (README 8장): {kind, ratio, demo, pages: [{layout, bg, accent, elements: [...]}]}
카드뉴스는 여기에 template(TEMPLATES의 key)·palette가 붙고, 장마다 content(템플릿을 바꿀 때 쓰는 원래 문구)가 붙습니다.
- x·y·w·h: 페이지 크기 대비 %(0~100). 규격을 바꿔도 같은 자리에 남습니다.
- size: 원본 크기(SIZES) 기준 글자 크기(px). z: 위아래 순서(클수록 위).
- 색은 #rrggbb 6자리로 씁니다. (편집기 색 고르기 칸과 맞춤)
- type: text | image | shape | sticker(이모지 한 글자, emoji 칸). font는 sns_fonts.js 목록의 key입니다.
포스터 속 글은 베트남어(제목)·영어(부제)입니다. 베트남어는 원어민 검수 전 시연 문구입니다.
AI 연결 전에는 정해진 틀로 만들고 demo=True로 표시합니다.
"""
import copy
import math
import re

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


def _text(id_, text, box, size, color, weight=400, align="center", bg=None, z=3, role=None, font="sans"):
    x, y, w, h = box
    item = {"id": id_, "role": role or id_, "type": "text", "x": round(x, 2), "y": round(y, 2), "w": round(w, 2),
            "h": round(h, 2), "z": z, "text": text, "font": font, "size": size, "weight": weight,
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


# ---------- 카드뉴스 (README 4장) ----------
CARDNEWS_RATIOS = ("4:5", "1:1")
# 임시 템플릿 4종. 마케터가 실제 템플릿을 주면 바꿉니다. (README 4-2)
TEMPLATES = {"clean": "깔끔 정보형", "photo": "사진 강조형", "checklist": "체크리스트형", "quote": "감성 문구형"}
DEFAULT_TEMPLATE = "clean"
DEFAULT_PAGES = 5
MIN_PAGES, MAX_PAGES = 3, 6
# 카드뉴스 글은 베트남어라 성조를 지원하는 글꼴을 씁니다. (sns_fonts.js key)
VI_SANS = "be-vietnam-pro"
VI_SERIF = "lora"

# 안쪽 장 시연 문구 (베트남어, 원어민 검수 전). checks는 체크리스트형, quote는 감성 문구형에서 씁니다.
INNER_PAGES = [
    {"title": "Bánh gạo nếp Hàn Quốc là gì?",
     "body": "Vỏ bánh dẻo mềm làm từ gạo nếp, bên trong là nhân ngọt thanh.",
     "checks": ["Vỏ gạo nếp dẻo mềm", "Nhân ngọt thanh", "Làm mới mỗi ngày"],
     "quote": "Một miếng nhỏ, một niềm vui lớn."},
    {"title": "Cách thưởng thức",
     "body": "Để bánh ở nhiệt độ phòng 10 phút trước khi ăn để bánh dẻo hơn.",
     "checks": ["Để ở nhiệt độ phòng 10 phút", "Cắt đôi để thấy nhân", "Dùng kèm trà nóng"],
     "quote": "Chậm lại một chút, ngọt ngào hơn một chút."},
    {"title": "Bảo quản",
     "body": "Giữ bánh trong ngăn mát và dùng sớm để giữ vị tươi ngon.",
     "checks": ["Giữ trong ngăn mát", "Dùng sớm để giữ vị tươi", "Đậy kín sau khi mở"],
     "quote": "Giữ trọn vị tươi cho người thương."},
    {"title": "Món quà ý nghĩa",
     "body": "Hộp quà bánh gạo nếp dành tặng gia đình, bạn bè và thầy cô.",
     "checks": ["Hộp quà xinh xắn", "Phù hợp nhiều dịp", "Gửi lời chúc yêu thương"],
     "quote": "Trao vị ngọt, gửi yêu thương."},
    {"title": "Theo dõi HANJUNGSUN",
     "body": "Theo dõi trang của chúng tôi để cập nhật món mới và ưu đãi.",
     "checks": ["Món mới mỗi mùa", "Ưu đãi cho người theo dõi", "Chia sẻ cảm nhận của bạn"],
     "quote": "Cảm ơn bạn đã đồng hành cùng chúng tôi."},
]
CHECK = "✓ "


def _text_h(text, size, width_pct, page_w, page_h):
    """글자 수로 줄 수를 어림해 글 상자 높이(%)를 정합니다. (편집기는 상자 안 가운데에 그립니다)"""
    width_px = page_w * width_pct / 100
    lines = sum(max(1, math.ceil(len(part) * size * 0.55 / width_px)) for part in str(text).split("\n"))
    return _line_h(size, page_h, lines)


def _square_h(w, page_w, page_h):
    """너비 w%인 정사각형의 높이(%)"""
    return w * page_w / page_h


def _sticker(id_, emoji, x, y, w, page_w, page_h, z=4):
    return {"id": id_, "role": "sticker", "type": "sticker", "emoji": emoji, "x": round(x, 2), "y": round(y, 2),
            "w": round(w, 2), "h": round(_square_h(w, page_w, page_h), 2), "z": z}


def _checks_text(checks):
    return "\n".join(CHECK + item for item in checks)


def _cover_content(product, event):
    title = product.get("name_vi") or BRAND
    subtitle = PRODUCT_EN.get(product.get("id"), "Korean Dessert")
    if event in EVENT_TEXT:
        title, subtitle = EVENT_TEXT[event][0], f"{EVENT_TEXT[event][1]} · {subtitle}"
    badge = "NEW · MÓN MỚI" if product.get("new_menu") else "K-DESSERT"
    return {"title": title, "subtitle": subtitle, "badge": badge, "photo": _image_src(product)}


def _cardnews_elements(template, index, total, content, palette, page_w, page_h):
    """카드뉴스 한 장의 요소를 템플릿 틀에 맞춰 만듭니다. index 0은 표지입니다."""
    p = f"p{index + 1}-"
    text_c, accent, bg, soft = palette["text"], palette["accent"], palette["bg"], palette["soft"]
    cover = index == 0
    photo = content.get("photo")
    lh = lambda size, lines=1: _line_h(size, page_h, lines)  # noqa: E731
    pill_h = round(30 * 2 / page_h * 100, 2)
    pill = bg if template == "photo" else None  # 사진 위에 얹는 글은 배경을 깔아 읽히게 합니다.
    els = [_text(p + "brand", BRAND, (6, 4, 40, lh(30) if not pill else pill_h), 30, text_c, weight=800,
                 align="left" if not pill else "center", bg=pill, role="brand", font=VI_SANS, z=5)]
    if not cover:
        els.append(_text(p + "page", f"{index + 1}/{total}", (76, 4, 18, lh(30) if not pill else pill_h), 30, accent,
                         weight=700, align="right" if not pill else "center", bg=pill, role="page_no", font=VI_SANS,
                         z=5))

    title, body = content.get("title", ""), content.get("body", "")
    checks = content.get("checks") or [body]
    quote = content.get("quote") or body

    if cover:
        badge = _text(p + "badge", content.get("badge", "K-DESSERT"), (64, 4, 30, pill_h), 30, bg, weight=700,
                      bg=accent, role="badge", font=VI_SANS, z=5)
        sub = content.get("subtitle", "")
        if template == "photo":
            els += [_box(p + "photo", "image", (0, 0, 100, 100), 1, src=photo, radius=0, role="photo"),
                    _box(p + "overlay", "shape", (0, 64, 100, 36), 2, shape="rect", fill=bg, role="overlay"), badge]
            title_y, size, align = 69, 80, "left"
        elif template == "checklist":
            els += [_sticker(p + "sticker", "✅", 42, 12, 16, page_w, page_h), badge]
            title_y, size, align = 12 + _square_h(16, page_w, page_h) + 3, 84, "center"
        elif template == "quote":
            els.append(_sticker(p + "sticker", "🌸", 44, 14, 12, page_w, page_h))
            title_y, size, align = 14 + _square_h(12, page_w, page_h) + 4, 80, "center"
        else:
            els.append(badge)
            title_y, size, align = 16, 84, "left"
        font = VI_SERIF if template == "quote" else VI_SANS
        title_h = _text_h(title, size, 88, page_w, page_h)
        els.append(_text(p + "title", title, (6, title_y, 88, title_h), size, text_c, weight=800, align=align,
                         role="title", font=font))
        sub_y = title_y + title_h + 1
        sub_h = _text_h(sub, 40, 88, page_w, page_h)
        els.append(_text(p + "subtitle", sub, (6, sub_y, 88, sub_h), 40, accent, weight=600, align=align,
                         role="subtitle", font=font))
        if template in ("clean", "checklist"):
            photo_w = 44 if page_h == page_w else 52
            photo_h = _square_h(photo_w, page_w, page_h)
            photo_y = max(sub_y + sub_h + 4, 94 - photo_h)
            photo_x = 100 - photo_w - 6 if template == "clean" else (100 - photo_w) / 2
            circle_w = photo_w + 8
            circle_h = _square_h(circle_w, page_w, page_h)
            els += [_box(p + "deco", "shape", (photo_x - 4, photo_y + photo_h / 2 - circle_h / 2, circle_w, circle_h),
                         1, shape="circle", fill=soft, role="deco"),
                    _box(p + "photo", "image", (photo_x, photo_y, photo_w, photo_h), 2, src=photo, radius=24,
                         role="photo")]
        return els

    # ---- 안쪽 장 ----
    if template == "photo":
        els.append(_box(p + "photo", "image", (0, 0, 100, 52), 1, src=photo, radius=0, role="photo"))
        title_y = 57
    elif template == "clean":
        els.append(_box(p + "bar", "shape", (0, 0, 100, 1.6), 1, shape="rect", fill=accent, role="bar"))
        title_y = 14
    else:
        title_y = 14

    if template == "quote":
        quote_h = _text_h(quote, 60, 80, page_w, page_h)
        quote_y = max(14, (100 - quote_h) / 2 - 4)
        els += [_text(p + "quote", quote, (10, quote_y, 80, quote_h), 60, text_c, weight=700, role="quote",
                      font=VI_SERIF),
                _text(p + "title", title, (10, quote_y + quote_h + 3, 80, lh(34)), 34, accent, weight=600,
                      role="title", font=VI_SANS)]
        return els

    title_h = _text_h(title, 64, 88, page_w, page_h)
    els.append(_text(p + "title", title, (6, title_y, 88, title_h), 64, text_c, weight=800, align="left",
                     role="title", font=VI_SANS))
    body_y = title_y + title_h + 4
    if template == "checklist":
        lines = _checks_text(checks)
        body_h = _line_h(44, page_h, len(checks)) + 2
        els += [_box(p + "card", "shape", (6, body_y, 88, body_h + 8), 1, shape="rect", fill=soft, radius=32,
                     role="card"),
                _text(p + "checks", lines, (11, body_y + 4, 78, body_h), 44, text_c, align="left", role="checks",
                      font=VI_SANS)]
    else:
        body_h = _text_h(body, 40, 88, page_w, page_h)
        els.append(_text(p + "body", body, (6, body_y, 88, body_h), 40, text_c, align="left", role="body",
                         font=VI_SANS))
        if template == "clean":
            photo_w = 30
            photo_h = _square_h(photo_w, page_w, page_h)
            els.append(_box(p + "photo", "image", (100 - photo_w - 6, 94 - photo_h, photo_w, photo_h), 2, src=photo,
                            radius=24, role="photo"))
    return els


def _build_pages(template, ratio, contents, palette):
    page_w, page_h = SIZES[ratio]
    return [{
        "layout": "cover" if index == 0 else "inner",
        "bg": palette["bg"],
        "accent": palette["accent"],
        "content": content,
        "elements": _cardnews_elements(template, index, len(contents), content, palette, page_w, page_h),
    } for index, content in enumerate(contents)]


def _template_from_text(text):
    for key, words in TEMPLATE_WORDS.items():
        if any(word in (text or "") for word in words):
            return key
    return None


def make_cardnews(text, ratio=DEFAULT_RATIO, product=None, event=None, template=None, pages=DEFAULT_PAGES):
    """임시 템플릿으로 카드뉴스 문서(표지 1장 + 안쪽 장)를 만듭니다.

    template이 없으면 요청 문장에서 찾고("체크리스트형으로…"), 그래도 없으면 깔끔 정보형입니다.
    규격은 4:5(기본)·1:1만 씁니다. pages는 3~6장입니다.
    """
    if ratio not in CARDNEWS_RATIOS:
        ratio = DEFAULT_RATIO
    if template not in TEMPLATES:
        template = _template_from_text(text) or DEFAULT_TEMPLATE
    try:
        pages = min(MAX_PAGES, max(MIN_PAGES, int(pages)))
    except (TypeError, ValueError):
        pages = DEFAULT_PAGES
    product = product or {}
    palette = dict(PALETTES.get(product.get("color"), PALETTES["gold"]))
    cover = _cover_content(product, event)
    contents = [cover] + [{**item, "photo": cover["photo"]} for item in INNER_PAGES[:pages - 1]]
    return {
        "kind": "cardnews",
        "template": template,
        "ratio": ratio,
        "demo": True,
        "palette": palette,
        "pages": _build_pages(template, ratio, contents, palette),
    }


def _page_content(page):
    """템플릿을 바꿀 때 남길 글·사진. 편집기에서 고친 글이 원래 문구보다 우선합니다."""
    content = dict(page.get("content") or {})
    for item in page.get("elements", []):
        role = item.get("role")
        if item.get("type") == "text" and role in ("title", "subtitle", "body", "quote", "badge"):
            content[role] = item.get("text", "")
        elif item.get("type") == "text" and role == "checks":
            content["checks"] = [line.strip().lstrip("✓").strip() for line in item.get("text", "").split("\n")
                                 if line.strip()]
        elif item.get("type") == "image" and item.get("src"):
            content["photo"] = item["src"]
    return content


def _doc_palette(doc):
    palette = {**PALETTES["gold"], **(doc.get("palette") or {})}
    first = doc["pages"][0]
    palette.update(bg=first.get("bg", palette["bg"]), accent=first.get("accent", palette["accent"]))
    title = next((item for item in first.get("elements", []) if item.get("role") == "title"), None)
    if title and title.get("color"):
        palette["text"] = title["color"]
    return palette


def _switch_template(doc, template):
    contents = [_page_content(page) for page in doc["pages"]]
    palette = _doc_palette(doc)
    doc["template"] = template
    doc["palette"] = palette
    doc["pages"] = _build_pages(template, doc.get("ratio", DEFAULT_RATIO), contents, palette)


# ---------- 대화로 고치기 (단어 규칙, AI 연결 전) ----------
# routes_sns.py(유진)가 부릅니다: doc, changes = revise_design(현재 문서, 요청 문장, page=지금 보는 장 번호(0부터))
DESIGN_REVISE_HINT = ('예: "배경 파랗게", "제목 크게", "제목 \'Xin chào\'로 바꿔", "명조로", "하트 이모지 추가", '
                      '"배지 빼줘", "사진 오른쪽으로", "색 조합 바꿔", "2장 배경 금색", "체크리스트형으로 바꿔"')

TEMPLATE_WORDS = {
    "clean": ("깔끔", "정보형"),
    "photo": ("사진 강조", "사진강조", "사진형"),
    "checklist": ("체크리스트",),
    "quote": ("감성", "문구형"),
}
# (찾을 단어, 색, 이름). 흰색·검정 위주는 현지 문화 기준으로 주의 색입니다. (README 6.3)
COLOR_WORDS = [
    (("빨강", "빨간", "빨갛", "레드"), "#c8102e", "빨강"),
    (("주황", "오렌지"), "#f28c28", "주황"),
    (("금색", "골드", "황금"), "#f2c14e", "금색"),
    (("노랑", "노란", "노랗", "옐로"), "#f7d84a", "노랑"),
    (("초록", "녹색", "그린", "초록색"), "#2e7d4f", "초록"),
    (("하늘",), "#8ec5ff", "하늘색"),
    (("파랑", "파란", "파랗", "블루"), "#1f5fa8", "파랑"),
    (("남색", "네이비"), "#1b2a4a", "남색"),
    (("보라", "퍼플"), "#7b4fa0", "보라"),
    (("분홍", "핑크"), "#f4a6b8", "분홍"),
    (("베이지", "크림"), "#f6e7c8", "베이지"),
    (("갈색", "브라운", "초코"), "#6b4226", "갈색"),
    (("회색", "그레이"), "#888888", "회색"),
    (("흰", "하얀", "하얗", "화이트", "흰색"), "#ffffff", "흰색"),
    (("검정", "검은", "까만", "까맣", "블랙"), "#111111", "검정"),
]
CAUTION_COLORS = {"흰색", "검정"}
FONT_WORDS = [
    (("베트남",), VI_SANS, "Be Vietnam Pro"),
    (("명조", "세리프"), "noto-serif-kr", "명조"),
    (("손글씨", "필기체", "필기"), "dancing-script", "손글씨"),
    (("고딕",), "noto-sans-kr", "고딕"),
    (("기본 글꼴", "기본 폰트"), "sans", "기본 글꼴"),
]
# 편집기 [추가] 메뉴의 이모지 16종과 같습니다. (sns_editor.js EMOJIS)
EMOJIS = {
    "하트": "❤️", "별": "⭐", "반짝": "✨", "꽃": "🌸", "선물": "🎁", "리본": "🎀", "축하": "🎉", "불꽃": "🔥",
    "웃음": "😊", "엄지": "👍", "떡": "🍡", "케이크": "🍰", "녹차": "🍵", "잎": "🍃", "망고": "🥭", "딸기": "🍓",
}
TEXT_ROLES = ("title", "subtitle", "body", "checks", "quote", "brand", "page_no")
ROLE_WORDS = [  # (단어, role들, 이름) 앞쪽이 먼저
    (("부제",), ("subtitle",), "부제"),
    (("본문", "내용"), ("body", "checks", "quote"), "본문"),
    (("배지", "뱃지"), ("badge",), "배지"),
    (("로고", "브랜드"), ("brand",), "로고"),
    (("제목", "타이틀"), ("title",), "제목"),
    (("글자", "글씨", "텍스트", "문구"), TEXT_ROLES, "글자"),
]
QUOTE_RE = re.compile(r"[\"“”'‘’「」『』]([^\"“”'‘’「」『』]+)[\"“”'‘’「」『』]")
PAGE_RE = re.compile(r"(\d+)\s*(?:번째|번)?\s*(?:장|페이지|쪽)")


def _has(text, words):
    return any(word in text for word in words)


def _find_color(text):
    """문장에서 가장 앞에 나온 색 단어. (색, 이름) 또는 None"""
    found = []
    for words, value, name in COLOR_WORDS:
        positions = [text.find(word) for word in words if word in text]
        if positions:
            found.append((min(positions), value, name))
    return min(found)[1:] if found else None


def _find_roles(text):
    for words, roles, name in ROLE_WORDS:
        if _has(text, words):
            return roles, name
    return None, None


def _items(doc, pages, roles=None, types=None):
    for index in pages:
        for item in doc["pages"][index]["elements"]:
            if roles is not None and item.get("role") not in roles and item.get("id") not in roles:
                continue
            if types is not None and item.get("type") not in types:
                continue
            yield item


def _apply_palette(doc, palette, pages):
    """색 조합을 요소 역할에 맞춰 칠합니다. 글·사진·위치는 그대로입니다."""
    text_color = {"title": "text", "body": "text", "checks": "text", "quote": "text", "brand": "text",
                  "subtitle": "accent", "page_no": "accent"}
    fill = {"deco": "soft", "card": "soft", "overlay": "bg", "bar": "accent"}
    for index in pages:
        page = doc["pages"][index]
        page["bg"], page["accent"] = palette["bg"], palette["accent"]
        for item in page["elements"]:
            role = item.get("role")
            if item.get("type") == "text":
                if role == "badge":
                    item["color"], item["bg"] = palette["bg"], palette["accent"]
                    continue
                if role in ("brand", "page_no") and item.get("bg"):  # 사진 강조형: 사진 위 글 바탕
                    item["bg"] = palette["bg"]
                if role in text_color:
                    item["color"] = palette[text_color[role]]
            elif item.get("type") == "shape":
                key = fill.get(role) or fill.get(item.get("id"))
                if key:
                    item["fill"] = palette[key]
    if doc.get("kind") == "cardnews":
        doc["palette"] = dict(palette)


def _target_pages(doc, clause, page):
    """(장 전체에 바꿀 장들, 글을 바꿀 장들, 앞에 붙일 이름)"""
    count = len(doc["pages"])
    if "표지" in clause and count > 1:
        return [0], [0], "표지 "
    match = PAGE_RE.search(clause)
    if match and 1 <= int(match.group(1)) <= count and count > 1:
        index = int(match.group(1)) - 1
        return [index], [index], f"{index + 1}장 "
    current = page if isinstance(page, int) and 0 <= page < count else 0
    return list(range(count)), [current], ""


def _revise_clause(doc, clause, page, changes):
    all_pages, text_pages, prefix = _target_pages(doc, clause, page)
    clause = PAGE_RE.sub(" ", clause)

    # 1) 템플릿 바꾸기 (카드뉴스)
    template = _template_from_text(clause)
    if doc.get("kind") == "cardnews" and template and template != doc.get("template"):
        _switch_template(doc, template)
        changes.append(f"템플릿 {TEMPLATES[template]}")
        return

    # 2) 따옴표 안 문구로 글 바꾸기
    quoted = QUOTE_RE.search(clause)
    if quoted:
        new_text = quoted.group(1).strip()
        rest = QUOTE_RE.sub(" ", clause)
        roles, name = _find_roles(rest)
        if roles is None or roles == TEXT_ROLES:
            roles, name = ("title",), "제목"
        for index in text_pages:
            item = next(_items(doc, [index], roles, ("text",)), None)
            if item is not None:
                if item.get("role") == "checks":
                    new_value = _checks_text([part.strip() for part in new_text.split("/") if part.strip()])
                else:
                    new_value = new_text
                item["text"] = new_value
                changes.append(f"{prefix}{name} 문구")
        clause = rest

    # 3) 빼기
    if _has(clause, ("빼", "없애", "지워", "삭제", "제거")):
        if _has(clause, ("이모지", "스티커", "일러스트")):
            targets, name = ("sticker",), "이모지"
        else:
            roles, name = _find_roles(clause)
            if roles in (None, TEXT_ROLES):
                targets = ("photo",) if "사진" in clause else None
                name = "사진" if targets else name
            else:
                targets = roles
        if targets:
            removed = False
            for index in all_pages:
                page_data = doc["pages"][index]
                keep = [item for item in page_data["elements"]
                        if item.get("role") not in targets and item.get("id") not in targets]
                removed = removed or len(keep) != len(page_data["elements"])
                page_data["elements"] = keep
            if removed:
                changes.append(f"{prefix}{name} 빼기")
            return

    # 4) 이모지 추가
    emoji = next((value for word, value in EMOJIS.items() if word in clause), None)
    emoji = emoji or next((value for value in EMOJIS.values() if value in clause), None)
    wants_add = emoji and "사진" not in clause and _has(clause, ("추가", "넣어", "붙여", "달아"))  # "찹쌀떡 사진 넣어"는 제외
    if _has(clause, ("이모지", "스티커", "일러스트")) or wants_add:
        emoji = emoji or "✨"
        page_w, page_h = SIZES.get(doc.get("ratio"), SIZES[DEFAULT_RATIO])
        for index in text_pages:
            elements = doc["pages"][index]["elements"]
            z = max((item.get("z", 0) for item in elements), default=0) + 1
            count = sum(1 for item in elements if item.get("type") == "sticker")
            elements.append(_sticker(f"p{index + 1}-sticker-{count + 1}", emoji, 80 - count * 14, 72, 12,
                                     page_w, page_h, z=z))
        changes.append(f"{prefix}이모지 {emoji} 추가")
        return

    # 5) 색 조합
    if _has(clause, ("색 조합", "색조합", "팔레트", "색 구성")):
        if _has(clause, ("빨강", "빨간", "레드", "진하", "진한")):
            key = "hero"
        elif _has(clause, ("금색", "골드", "밝")):
            key = "gold"
        else:
            key = "gold" if doc["pages"][all_pages[0]].get("bg") == PALETTES["hero"]["bg"] else "hero"
        _apply_palette(doc, PALETTES[key], all_pages)
        changes.append(f"{prefix}색 조합 {'빨강·금색' if key == 'hero' else '금색·빨강'}")
        return

    # 6) 글꼴
    font = next(((value, name) for words, value, name in FONT_WORDS if _has(clause, words)), None)
    # "베트남어로 바꿔"는 언어 이야기일 수 있어 "글꼴"을 말할 때만 바꿉니다.
    if font and (_has(clause, ("글꼴", "폰트", "체로", "서체")) or font[1] in ("명조", "고딕", "손글씨")):
        roles, name = _find_roles(clause)
        if roles is None or roles == TEXT_ROLES:
            roles, name = TEXT_ROLES + ("badge",), "글꼴"
        else:
            name = f"{name} 글꼴"
        for item in _items(doc, all_pages, roles, ("text",)):
            item["font"] = font[0]
        changes.append(f"{prefix}{name} {font[1]}")
        return

    # 7) 크기
    bigger = _has(clause, ("크게", "키워", "키우", "크기 키"))
    smaller = _has(clause, ("작게", "줄여", "줄이"))
    if bigger or smaller:
        factor = 1.2 if bigger else 0.85
        roles, name = _find_roles(clause)
        if roles is None and "사진" in clause:
            for item in _items(doc, all_pages, ("photo",), ("image",)):
                cx, cy = item["x"] + item["w"] / 2, item["y"] + item["h"] / 2
                item["w"], item["h"] = round(item["w"] * factor, 2), round(item["h"] * factor, 2)
                item["x"], item["y"] = round(cx - item["w"] / 2, 2), round(cy - item["h"] / 2, 2)
            changes.append(f"{prefix}사진 {'크게' if bigger else '작게'}")
            return
        if roles is None:
            roles, name = ("title",), "제목"
        for item in _items(doc, all_pages, roles, ("text",)):
            item["size"] = max(8, round(item["size"] * factor))
            cy = item["y"] + item["h"] / 2
            item["h"] = round(item["h"] * factor, 2)
            item["y"] = round(cy - item["h"] / 2, 2)
        changes.append(f"{prefix}{name} {'크게' if bigger else '작게'}")
        return

    # 8) 사진 옮기기 (뒤 장식 원도 같이)
    if "사진" in clause:
        moves = {"오른쪽": "right", "왼쪽": "left", "가운데": "center", "위로": "up", "아래로": "down"}
        where = next((value for word, value in moves.items() if word in clause), None)
        if where:
            moved = False
            for index in all_pages:
                photo = next(_items(doc, [index], ("photo",), ("image",)), None)
                if photo is None or (photo["w"] >= 100 and where in ("left", "right", "center")):
                    continue
                dx = dy = 0
                if where == "right":
                    dx = 100 - photo["w"] - 6 - photo["x"]
                elif where == "left":
                    dx = 6 - photo["x"]
                elif where == "center":
                    dx = (100 - photo["w"]) / 2 - photo["x"]
                else:
                    dy = -5 if where == "up" else 5
                for item in _items(doc, [index], ("photo", "deco")):
                    item["x"], item["y"] = round(item["x"] + dx, 2), round(item["y"] + dy, 2)
                moved = True
            if moved:
                names = {"right": "오른쪽", "left": "왼쪽", "center": "가운데", "up": "위", "down": "아래"}
                changes.append(f"{prefix}사진 {names[where]}으로")
            return

    # 9) 색
    color = _find_color(clause)
    if color:
        value, color_name = color
        note = " (흰색·검정 위주는 주의 색)" if color_name in CAUTION_COLORS else ""
        roles, name = _find_roles(clause)
        if "배경" in clause or roles is None:
            for index in all_pages:
                doc["pages"][index]["bg"] = value
            changes.append(f"{prefix}배경색 {color_name}{note}")
        elif roles == ("badge",):
            for item in _items(doc, all_pages, roles, ("text",)):
                item["bg"] = value
            changes.append(f"{prefix}배지 색 {color_name}")
        else:
            for item in _items(doc, all_pages, roles, ("text",)):
                if roles == TEXT_ROLES and item.get("bg"):
                    continue  # 배경이 깔린 글(배지 등)은 그대로 둡니다.
                item["color"] = value
            changes.append(f"{prefix}{name} 색 {color_name}{note}")


def revise_design(doc, text, page=None):
    """대화 한 줄로 포스터·카드뉴스를 고칩니다. (새 문서, 바꾼 것 목록)을 돌려줍니다.

    알아듣지 못하면 바꾼 것이 빈 목록이고 문서는 그대로입니다. ("," 등으로 나눈 요청은 하나씩 처리)
    page: 지금 편집기에서 보는 장(0부터). "3장 …"처럼 말하면 그 장, 색·글꼴은 말하지 않으면 모든 장에 적용합니다.
    """
    new_doc = copy.deepcopy(doc)
    if not new_doc or not new_doc.get("pages"):
        return new_doc, []
    changes = []
    # 따옴표 안 문구는 쉼표·마침표가 있어도 나누지 않도록 잠시 바꿔 둡니다.
    quotes = []

    def hide(match):
        quotes.append(match.group(0))
        return f"\x00{len(quotes) - 1}\x00"

    hidden = QUOTE_RE.sub(hide, text or "")
    for clause in re.split(r"[,.!?\n]|그리고|하고 ", hidden):
        clause = re.sub(r"\x00(\d+)\x00", lambda match: quotes[int(match.group(1))], clause).strip()
        if clause:
            _revise_clause(new_doc, clause, page, changes)
    if not changes:
        return copy.deepcopy(doc), []
    return new_doc, list(dict.fromkeys(changes))


# ---------- 광고 표현 검수용 글 모으기 ----------
def design_texts(doc):
    """모든 장의 글 요소를 순서대로 모읍니다. 빈 글은 뺍니다."""
    texts = []
    for page in (doc or {}).get("pages") or []:
        for item in page.get("elements") or []:
            text = str(item.get("text") or "").strip() if item.get("type") == "text" else ""
            if text:
                texts.append(text)
    return texts


# ---------- 카드뉴스 프롬프트 만들기 (복사해서 ChatGPT·Canva에 붙여 넣는 용도) ----------
# 결과 글 언어는 README 9장 미정 항목이라 만들 때 고릅니다.
LANGUAGES = {
    "vi": "베트남어로 쓴다.",
    "ko": "한국어로 쓴다.",
    "vi_ko": "베트남어로 쓰고, 바로 아래 줄에 한국어 번역을 붙인다.",
}
CARD_STRUCTURE = {
    "clean": "표지(제목·부제·제품 사진) → 안쪽 장마다 제목 1줄 + 설명 1~2문장",
    "photo": "표지(큰 제품 사진 위 제목·부제) → 안쪽 장마다 위쪽 사진 + 제목 1줄 + 설명 1~2문장",
    "checklist": "표지(제목·부제) → 안쪽 장마다 제목 1줄 + 짧은 체크 항목 3개",
    "quote": "표지(감성 제목·부제) → 안쪽 장마다 짧은 감성 문장 1개 + 작은 제목",
}


def _guideline_rules():
    """현지 시장 분석 탭의 생성 프롬프트 규칙(prompt_rules). 읽지 못하면 []"""
    try:
        from market_analysis.public import get_content_guidelines
        return [str(rule) for rule in get_content_guidelines("VN").get("prompt_rules") or [] if str(rule).strip()]
    except Exception:  # noqa: BLE001  다른 탭 오류로 프롬프트 만들기가 멈추지 않게 합니다.
        return []


def _draft_lines(doc):
    lines = []
    for index, page in enumerate(doc.get("pages") or []):
        content = _page_content(page)
        parts = [content.get("title", "")]
        if index == 0:
            parts.append(content.get("subtitle", ""))
        elif doc.get("template") == "checklist" and content.get("checks"):
            parts.append(" / ".join(content["checks"]))
        elif doc.get("template") == "quote":
            parts.append(content.get("quote") or content.get("body", ""))
        else:
            parts.append(content.get("body", ""))
        label = "1장(표지)" if index == 0 else f"{index + 1}장"
        lines.append(f"- {label}: " + " | ".join(part for part in parts if part))
    return lines


def build_cardnews_prompt(request, doc=None, language="vi"):
    """마케터가 원하는 바로 카드뉴스 생성 프롬프트를 만듭니다. (프롬프트, 기본 지침을 받았는지)

    순서는 README 4-3: 기본 지침(현지 시장 분석 prompt_rules) → 템플릿·장 구성 → 지금 초안(참고) → 요청 → 출력 형식.
    기본 지침이 비어 있으면 지어내지 않고 "준비 중"이라고 적습니다.
    """
    language = language if language in LANGUAGES else "vi"
    doc = doc if isinstance(doc, dict) and doc.get("kind") == "cardnews" and doc.get("pages") else None
    template = doc.get("template") if doc and doc.get("template") in TEMPLATES else DEFAULT_TEMPLATE
    ratio = doc.get("ratio") if doc and doc.get("ratio") in CARDNEWS_RATIOS else DEFAULT_RATIO
    pages = len(doc["pages"]) if doc else DEFAULT_PAGES
    rules = _guideline_rules()

    lines = [f"너는 베트남 시장에 진출한 한국 찹쌀떡 브랜드 {BRAND}(한정선)의 인스타그램 카드뉴스 카피라이터야.", "",
             "[기본 지침 - 항상 지킬 것]"]
    if rules:
        lines += [f"- {rule}" for rule in rules]
    else:
        lines.append("- (현지 시장 분석 탭의 기본 지침이 아직 준비 중입니다. 금기 표현·색·차별 표현은 사람이 직접 확인해 주세요.)")
    lines += ["- 아래 요청이 기본 지침과 부딪히면 기본 지침을 따른다.", "",
              "[형식]",
              f"- 인스타그램 카드뉴스 {pages}장, 비율 {ratio}, 템플릿 {TEMPLATES[template]}",
              f"- 구성: {CARD_STRUCTURE[template]}"]
    if doc:
        lines += ["", "[지금 초안 문구 - 참고용, 바꿔도 됨]", *_draft_lines(doc)]
    lines += ["", "[요청]", str(request).strip(), "",
              "[출력 형식]",
              "- 장마다 \"N장 / 제목 / 본문\" 순서로 쓴다." + (" (본문 자리에 체크 항목 3개)" if template == "checklist" else ""),
              "- 제목은 한 줄, 본문은 1~2문장으로 짧게 쓴다.",
              f"- {LANGUAGES[language]}"]
    return "\n".join(lines), bool(rules)
