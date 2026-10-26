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
import json
import math
import re
from pathlib import Path

from flask import url_for

from .products import COMMON_IMAGES, get_product

SIZES = {"1:1": (1080, 1080), "4:5": (1080, 1350), "9:16": (1080, 1920), "16:9": (1920, 1080),
         "3:4": (1080, 1440), "4:3": (1440, 1080)}  # 3:4·4:3은 Higgsfield 그림 시안 비율 (2026-10-26 유진 요청)
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
PHOTO_W = {"4:5": 62, "1:1": 46, "9:16": 76, "3:4": 64}


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

    if width > height:  # 가로 규격(16:9 · 4:3): 사진 오른쪽 · 글 왼쪽
        layout = "side"
        photo_h = min(76, 43 * width / height)  # 정사각형 사진이 오른쪽 칸(너비 43% 이하)을 넘지 않게
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
CARDNEWS_RATIOS = ("4:5", "1:1", "3:4")
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
    points = [item.get("text", "") for item in page.get("elements", [])
              if item.get("type") == "text" and item.get("role") == "point"]
    if points:  # 스타일 틀의 번호 목록은 항목마다 글 요소가 따로 있습니다.
        content["body"], content["checks"] = "\n".join(points), points
    for item in page.get("elements", []):
        role = item.get("role")
        if item.get("type") == "text" and role in ("title", "subtitle", "body", "quote", "badge", "label"):
            content[role] = item.get("text", "")
        elif item.get("type") == "text" and role == "checks":
            content["checks"] = [line.strip().lstrip("✓").strip() for line in item.get("text", "").split("\n")
                                 if line.strip()]
        elif item.get("type") == "image" and item.get("src") and role != BG_ROLE:  # AI 배경 그림은 제품 사진이 아닙니다.
            content["photo"] = item["src"]
    return content


def _doc_palette(doc):
    palette = {**PALETTES["gold"], **(doc.get("palette") or {})}
    first = doc["pages"][0]
    palette.update(bg=first.get("bg", palette["bg"]), accent=first.get("accent", palette["accent"]))
    title = next((item for item in first.get("elements", []) if item.get("role") == "title"), None)
    if title and title.get("color") and "paint" not in title:  # 스타일 틀 글은 바탕에 맞춰 칠해 글자색 기준이 아닙니다.
        palette["text"] = title["color"]
    return palette


def _switch_template(doc, template):
    def build(contents, palette):
        doc["template"] = template
        for key in ("style", "fonts"):
            doc.pop(key, None)
        return _build_pages(template, doc.get("ratio", DEFAULT_RATIO), contents, palette)
    _rebuild(doc, build)


def _rebuild(doc, build):
    """글·사진·색은 남기고 틀만 새로 짭니다. build(contents, palette) → 새 pages. 한국어 뜻도 같은 글에 다시 붙입니다."""
    translations = [{item.get("text"): (item["text_ko"], item.get("translation_source"))
                     for item in page.get("elements", []) if item.get("text_ko")}
                    for page in doc["pages"]]
    contents = [_page_content(page) for page in doc["pages"]]
    backgrounds = [_backgrounds(page) for page in doc["pages"]]
    palette = _doc_palette(doc)
    doc["palette"] = palette
    doc["pages"] = build(contents, palette)
    for page, saved in zip(doc["pages"], translations):
        for item in page["elements"]:
            if item.get("text") in saved:
                item["text_ko"], item["translation_source"] = saved[item["text"]]
    _keep_backgrounds(doc, backgrounds)


# ---------- 대화로 고치기 (단어 규칙, AI 연결 전) ----------
# routes_sns.py(유진)가 부릅니다: doc, changes = revise_design(현재 문서, 요청 문장, page=지금 보는 장 번호(0부터))
DESIGN_REVISE_HINT = ('예: "배경 파랗게", "제목 크게", "제목 \'Xin chào\'로 바꿔", "명조로", "하트 이모지 추가", '
                      '"배지 빼줘", "사진 오른쪽으로", "색 조합 바꿔", "2장 배경 금색", "매거진형으로 바꿔"')

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
TEXT_ROLES = ("title", "subtitle", "body", "checks", "quote", "brand", "page_no", "label", "point", "number")
ROLE_WORDS = [  # (단어, role들, 이름) 앞쪽이 먼저
    (("부제",), ("subtitle",), "부제"),
    (("본문", "내용"), ("body", "checks", "quote", "point"), "본문"),
    (("배지", "뱃지", "머리말"), ("badge", "label"), "배지"),
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
            if item.get("paint"):  # 스타일 틀 요소는 처음 칠한 자리 그대로 다시 칠합니다.
                _apply_paint(item, palette)
                continue
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

    # 1) 스타일 틀 바꾸기 (포스터·카드뉴스) · 템플릿 바꾸기 (카드뉴스)
    style = next((key for key, words in STYLE_WORDS.items() if _has(clause, words)), None)
    if style and style != doc.get("style"):
        _switch_style(doc, style)
        changes.append(f"스타일 {STYLES[style]}")
        return
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
                for item in _items(doc, [index], ("photo", "deco", "blob", "ring", "photo_back")):
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
    if not new_doc or not new_doc.get("pages") or new_doc.get("mode") == IMAGE_MODE:
        return new_doc, []  # 그림 시안은 "그림 다시 그리기"(2단계)로 고칩니다.
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
    """모든 장의 글 요소를 순서대로 모읍니다. 빈 글은 뺍니다.
    그림 시안 장(mode "image")은 그림에 넣은 문구 원문(page.texts의 vi)도 함께 모읍니다."""
    texts = []
    for page in (doc or {}).get("pages") or []:
        for item in page.get("texts") or []:
            text = str(item.get("vi") or "").strip() if isinstance(item, dict) else ""
            if text:
                texts.append(text)
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


def _option_product(options):
    """첫 화면에서 고른 제품(options.product_id). 고르지 않았으면 None, 목록에 없는 id면 ValueError."""
    product_id = options.get("product_id")
    if product_id in (None, ""):
        return None
    product = get_product(product_id) if isinstance(product_id, str) else None
    if not product:
        raise ValueError("고른 제품을 찾을 수 없습니다.")
    return product


def _option_products(options):
    """고른 제품들: product_ids(여러 개, 라인업) → product_id(하나) 순서. 없으면 [], 목록에 없는 id면 ValueError."""
    ids = options.get("product_ids")
    if ids in (None, "", []):
        product = _option_product(options)
        return [product] if product else []
    if not isinstance(ids, list) or len(ids) > 10 or not all(isinstance(value, str) for value in ids):
        raise ValueError("고른 제품 형식이 올바르지 않습니다.")
    products = [get_product(value) for value in dict.fromkeys(ids)]
    if not all(products):
        raise ValueError("고른 제품을 찾을 수 없습니다.")
    return products


# ---------- 시안 그림 프롬프트 (새로 만들기 → 시안 3개, 2026-10-26 유진 결정) ----------
# design-assistant(gpt-4o-mini)가 시안 3안 × 장마다 그림 프롬프트(영어)와 그림에 넣을 베트남어 문구(검수용 원문)를 씁니다.
# 그림은 유진 쪽 Higgsfield API가 만들고, 제품 참고 사진 문장도 그쪽에서 프롬프트 끝에 붙입니다.
# 브랜드 색: 크림·브라운·골드 (값은 이 파일의 기존 색과 같음)
BRAND_COLORS = {"cream": "#f6e7c8", "brown": "#6b4226", "gold": "#f2c14e"}
IMAGE_PROMPT_MAX = 1200  # 장 프롬프트 글자 수 (유진 API 한도 2000자 안에서 참고 사진 문장 자리를 남김)
IMAGE_TEXTS_MAX = 4      # 장마다 그림에 넣을 문구 수
# 확정한 그림 시안 문서 (sns_editor.js renderChoices가 만듦):
#   {kind, ratio, demo, mode: "image", style, assistant: {name, prompt, notice},
#    pages: [{layout: "image", bg, prompt, texts: [{vi, ko}], elements: [그림 요소 1개]}]}
#   그림 요소: {id: "p1-artwork", role: "artwork", type: "image", x: 0, y: 0, w: 100, h: 100, z: 0, src: 우리 서버 주소}
#   글·배치를 따로 고치지 않으므로 단어 규칙·AI 말로 고치기·비율 바꾸기는 하지 않습니다. (그림 다시 그리기는 2단계)
IMAGE_MODE = "image"
ARTWORK_ROLE = "artwork"


def build_design_brief(doc, options):
    """시안 그림 프롬프트용 (지시문, 브리프, 현지 기준이 있는지). doc: 규격·장수 기준이 되는 빈 초안."""
    kind = doc.get("kind")
    if kind not in ("poster", "cardnews") or doc.get("ratio") not in SIZES:
        raise ValueError("포스터·카드뉴스와 지원 규격을 선택해 주세요.")
    if kind == "cardnews" and doc["ratio"] not in CARDNEWS_RATIOS:
        raise ValueError(f"카드뉴스는 {' · '.join(CARDNEWS_RATIOS)} 규격을 사용해 주세요.")
    wish = options.get("request", "")
    if not isinstance(wish, str) or len(wish) > 1500:
        raise ValueError("요청이 너무 길거나 형식이 올바르지 않습니다.")
    if not wish.strip():
        raise ValueError("만들 내용을 입력해 주세요.")
    products = _option_products(options)
    count = options.get("pages", DEFAULT_PAGES) if kind == "cardnews" else 1
    if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= MAX_PAGES:
        raise ValueError("장수가 올바르지 않습니다.")
    if kind == "cardnews" and count < MIN_PAGES:
        raise ValueError(f"카드뉴스는 {MIN_PAGES}~{MAX_PAGES}장입니다.")
    persona = (Path(__file__).parent / "prompts" / f"{kind}_base.md").read_text(encoding="utf-8")
    # 새로 만들기 화면의 스타일 버튼: 고른 느낌을 참고로만 넣습니다(3개가 서로 다른 style인 것은 그대로).
    style = options.get("style") or None
    if style is not None and style not in STYLE_HINTS:
        raise ValueError("스타일 값이 올바르지 않습니다.")
    if style:
        persona += (f"\n\n[참고 분위기 - 마케터가 고른 느낌: {STYLES[style]}]\n- {STYLE_HINTS[style]}\n"
                    "- 제안 3개 모두 이 느낌을 배치·색·글씨체·문구에 조금씩 반영한다. style은 서로 달라도 된다.")
    rules = _guideline_rules()
    width, height = SIZES[doc["ratio"]]
    brief = {"request": wish.strip(), "kind": kind, "ratio": doc["ratio"],
             "orientation": "landscape" if width > height else "square" if width == height else "portrait",
             "pages": count,
             "products": [{"id": item["id"], "name_ko": item["name_ko"], "name_vi": item.get("name_vi", ""),
                           "flavor_en": item["id"].replace("_", " ")} for item in products],
             "brand": BRAND, "brand_colors": BRAND_COLORS, "style_options": STYLES,
             "prompt_max_chars": IMAGE_PROMPT_MAX, "texts_per_page_max": IMAGE_TEXTS_MAX,
             "local_guidelines": rules,
             "guidelines_notice": "제공된 지침만 참고" if rules else "현지 검수 기준 준비 중"}
    return persona, brief, bool(rules)


def image_proposal_schema(count):
    """시안 3안 × 장 count개: 장마다 그림 프롬프트(영어) + 그림에 넣을 문구(베트남어 원문 · 한국어 뜻).
    API 출력(JSON 스키마)과 서버 검사(validate_proposals)가 같은 제한을 씁니다."""
    def obj(properties):
        return {"type": "object", "properties": properties, "required": list(properties), "additionalProperties": False}

    def string(limit):
        return {"type": "string", "minLength": 1, "maxLength": limit}

    text = obj({"vi": string(80), "ko": string(160)})
    page = obj({"prompt_en": string(IMAGE_PROMPT_MAX),
                "texts": {"type": "array", "minItems": 1, "maxItems": IMAGE_TEXTS_MAX, "items": text}})
    proposal = obj({"name": string(80), "concept_ko": string(300), "style": {"type": "string", "enum": list(STYLES)},
                    "pages": {"type": "array", "minItems": count, "maxItems": count, "items": page}})
    return obj({"proposals": {"type": "array", "minItems": 3, "maxItems": 3, "items": proposal}})


def finish_image_proposals(proposals):
    """검사를 마친 시안에 스타일 이름을 붙이고, 넣을 문구가 프롬프트에 그대로 들어 있게 맞춥니다.
    (검수는 texts 원문으로 하므로, 프롬프트에 빠진 문구는 끝에 정확한 글자로 붙입니다)"""
    finished = []
    for item in proposals:
        pages = []
        for page in item["pages"]:
            prompt = page["prompt_en"].strip()
            missing = [text["vi"] for text in page["texts"] if text["vi"] not in prompt]
            if missing:
                prompt += " Render this exact Vietnamese text with correct tone marks: " + "; ".join(f'"{vi}"' for vi in missing) + "."
            pages.append({"prompt_en": prompt, "texts": page["texts"]})
        finished.append({**item, "pages": pages, "style_label": STYLES[item["style"]]})
    return finished


# ---------- 스타일 틀 (카페·F&B 포스터와 인스타 캐러셀 포트폴리오에서 자주 쓰는 배치) ----------
# AI가 제안마다 스타일·색 조합·글꼴을 고르고, 문구를 이 틀에 넣습니다. 색은 #rrggbb 아무 색이나 쓸 수 있고,
# 글이 바탕에 묻히면 읽히는 색으로만 바꿉니다.
# 요소에 붙는 선택 칸: rotate(도, 시계 방향) · opacity(0~1) · spacing(글자 간격 px) · stroke·stroke_w(도형 테두리, fill이 없으면 속이 빔)
# paint: 색 조합의 어느 색을 칠했는지({"color": "text"} 등). 색 조합을 바꿀 때 이 정보로 다시 칠합니다.
STYLES = {"bold": "큰 글자형", "editorial": "매거진형", "menu": "메뉴판형", "pop": "팝·스티커형", "minimal": "여백 미니멀형"}
# 새로 만들기 화면의 스타일 버튼: 고르면 AI 3안 지시문(build_design_brief)에 "참고 분위기"로만 넣습니다(틀을 강제하지 않음).
STYLE_HINTS = {
    "bold": "한눈에 꽂히는 큰 제목과 강한 대비. 짧고 힘 있는 문구, 제품 사진은 크게, 활기찬 색",
    "editorial": "잡지 화보처럼 정돈되고 고급스러운 느낌. 명조 계열 제목, 차분한 색, 여백과 얇은 선",
    "menu": "카페 메뉴판처럼 깔끔하게 정리된 정보. 메뉴 이름과 짧은 설명 중심, 따뜻하고 단정한 색",
    "pop": "발랄하고 귀여운 SNS 느낌. 밝은 색, 살짝 기울어진 요소와 스티커, 경쾌한 말투",
    "minimal": "넓은 여백과 작은 글씨의 차분하고 감성적인 느낌. 색은 적게, 문구는 짧고 부드럽게",
}
STYLE_WORDS = {"bold": ("큰 글자형", "큰글자형", "볼드"), "editorial": ("매거진",), "menu": ("메뉴판",),
               "pop": ("팝형", "팝 스타일", "스티커형"), "minimal": ("미니멀", "여백형")}
# 카드뉴스 장 역할. 표지는 첫 장, 마지막 장은 저장·팔로우 유도입니다.
PAGE_LAYOUTS = {"cover": "표지", "menu": "메뉴 소개(큰 사진)", "list": "번호 목록(맛·식감 포인트, 즐기는 법)",
                "quote": "감성 문구", "cta": "마지막 장(저장·공유·팔로우 유도)"}
# 베트남어 성조를 지원하는 글꼴만 고릅니다. (sns_fonts.js key)
VI_FONTS = ("be-vietnam-pro", "montserrat", "lexend", "nunito", "quicksand", "oswald", "playfair-display", "lora",
            "noto-serif", "dancing-script", "pacifico", "bungee")
STYLE_FONTS = {"bold": ("oswald", "be-vietnam-pro"), "editorial": ("playfair-display", "be-vietnam-pro"),
               "menu": ("lora", "montserrat"), "pop": ("bungee", "nunito"), "minimal": ("lora", "be-vietnam-pro")}
SINGLE_WEIGHT = ("pacifico", "bungee")  # 굵기가 하나뿐인 글꼴
FONT_WIDTH = {"oswald": 0.46, "bungee": 0.78, "pacifico": 0.62, "dancing-script": 0.48, "playfair-display": 0.56}
CTA_TEXTS = ("Lưu lại để thử nhé", "Chia sẻ cho bạn bè", f"Theo dõi {BRAND}")  # 원어민 검수 전 시연 문구
SWIPE_TEXT = "Vuốt để xem →"
HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def _luminance(value):
    channels = [int(value[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    r, g, b = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _contrast(a, b):
    high, low = sorted((_luminance(a), _luminance(b)), reverse=True)
    return (high + 0.05) / (low + 0.05)


def _readable(color, under, minimum=4.5):
    """under 위에서 읽히지 않는 글자색이면 진한 갈색·흰색 중 더 잘 읽히는 색으로 바꿉니다."""
    if not HEX_RE.match(str(color)) or not HEX_RE.match(str(under)) or _contrast(color, under) >= minimum:
        return color
    return max(("#1f1a17", "#ffffff"), key=lambda value: _contrast(value, under))


def _clean_palette(value, fallback):
    value = value if isinstance(value, dict) else {}
    return {key: (value[key] if HEX_RE.match(str(value.get(key) or "")) else fallback[key]).lower()
            for key in ("bg", "accent", "text", "soft")}


def _apply_paint(item, palette):
    paint = item["paint"]
    for prop, key in paint.items():
        if prop != "on":
            item[prop] = palette[key]
    if "color" in paint:
        under = item["bg"] if "bg" in paint else palette[paint.get("on", "bg")]
        item["color"] = _readable(item["color"], under, 3 if item.get("size", 0) >= 40 else 4.5)


def _kit(W, H, palette, fonts, index, photo):
    """틀 함수들이 같이 쓰는 값: 크기·색·글꼴·요소 id 앞머리·사진"""
    return {"W": W, "H": H, "land": W > H, "P": palette, "F": (fonts["title"], fonts["body"]),
            "p": f"p{index + 1}-", "photo": photo}


def _sq(k, w):
    """너비 w%인 정사각형의 높이(%)"""
    return w * k["W"] / k["H"]


def _est_h(k, text, size, w, font, spacing=0):
    """글자 수로 줄 수를 어림한 글 상자 높이(%). 단어 단위 줄바꿈을 생각해 조금 넉넉하게 잡습니다."""
    width_px = k["W"] * w / 100
    char = (size * FONT_WIDTH.get(font, 0.55) + spacing) * (1.25 if str(text).isupper() else 1.08)  # 대문자는 더 넓음
    lines = sum(max(1, math.ceil(len(part) * char / width_px)) for part in str(text).split("\n"))
    return _line_h(size, k["H"], lines)


def _t(k, name, text, box, size, paint, font=None, weight=None, align="left", z=4, role=None, **extra):
    font = font or k["F"][1]
    weight = 400 if font in SINGLE_WEIGHT else (weight or 700)
    item = _text(k["p"] + name, text, box, size, "#000000", weight=weight, align=align, z=z, role=role or name,
                 font=font)
    item.update({key: value for key, value in extra.items() if value is not None})
    item["paint"] = paint
    _apply_paint(item, k["P"])
    return item


def _fit(k, name, text, x, y, w, max_h, size, paint, font=None, min_size=24, **extra):
    """상자 높이 max_h(%) 안에 들어가도록 글자 크기를 줄입니다."""
    font = font or k["F"][1]
    spacing = extra.get("spacing") or 0
    while size > min_size and _est_h(k, text, size, w, font, spacing) > max_h:
        size -= 4
    return _t(k, name, text, (x, y, w, _est_h(k, text, size, w, font, spacing)), size, paint, font=font, **extra)


def _pill(k, name, text, x, y, size, paint, align="left", **extra):
    """배경이 깔린 짧은 글. align은 x를 기준으로 상자를 놓는 방향입니다."""
    w = min(88, (len(text) * size * 0.62 + size * 1.4) / k["W"] * 100)
    x = x - w if align == "right" else x - w / 2 if align == "center" else x
    return _t(k, name, text, (x, y, w, round(size * 2 / k["H"] * 100, 2)), size, paint, align="center", **extra)


def _s(k, name, box, paint, shape="rect", z=1, role=None, **extra):
    x, y, w, h = box
    item = {"id": k["p"] + name, "role": role or name, "type": "shape", "shape": shape, "x": round(x, 2),
            "y": round(y, 2), "w": round(w, 2), "h": round(h, 2), "z": z, "paint": paint}
    item.update({key: value for key, value in extra.items() if value is not None})
    _apply_paint(item, k["P"])
    return item


def _img(k, box, radius=0, z=2, **extra):
    item = _box(k["p"] + "photo", "image", box, z, src=k["photo"], radius=round(radius, 1), role="photo")
    item.update({key: value for key, value in extra.items() if value is not None})
    return item


def _circle_r(k, w):
    """너비 w%인 사진을 동그랗게 자르는 모서리 값(px)"""
    return w / 100 * k["W"] / 2


def _bottom(item):
    return item["y"] + item["h"]


def _by_ratio(k, square, portrait, tall):
    """세로 규격별 값: 1:1 · 4:5 · 9:16"""
    ratio = k["H"] / k["W"]
    return square if ratio < 1.1 else portrait if ratio < 1.5 else tall


def _tag(k, x, y, d, rotate, text="K-\nDESSERT", z=5):
    """동그란 스티커(도형 + 글). 가격 등 근거 없는 정보는 넣지 않습니다."""
    h = _sq(k, d)
    return [_s(k, "tag", (x, y, d, h), {"fill": "accent"}, shape="circle", z=z, rotate=rotate),
            _t(k, "tag_text", text, (x, y, d, h), max(18, round(d / 100 * k["W"] * 0.16)),
               {"color": "bg", "on": "accent"}, align="center", z=z + 1, rotate=rotate, spacing=1)]


# ---- 포스터(= 카드뉴스 표지) 틀 5종. c: {title, body, label, photo} ----
def _layout_bold(k, c):
    """큰 글자형: 화면 위를 꽉 채운 제목 + 아래 큰 제품 사진과 동그란 스티커"""
    tf, bf = k["F"]
    els = [_t(k, "brand", BRAND, (6, 4, 50, _line_h(26, k["H"])), 26, {"color": "text"}, font=bf, spacing=8,
              role="brand")]
    if c.get("label"):
        els.append(_pill(k, "label", c["label"], 94, 3.4, 26, {"color": "bg", "bg": "accent"}, align="right"))
    tx, tw = (5, 46) if k["land"] else (6, 88)
    title = _fit(k, "title", str(c.get("title", "")).upper(), tx, 15 if k["land"] else 10, tw,
                 50 if k["land"] else 30, 170, {"color": "text"}, font=tf, min_size=48)
    line = _s(k, "line", (tx, _bottom(title) + 1.5, 14, 0.7), {"fill": "accent"}, z=3)
    body = _fit(k, "body", c.get("body", ""), tx, _bottom(line) + 2, tw, 16, 38, {"color": "text"}, weight=400)
    els += [title, line, body]
    if k["land"]:
        pw = 34
        px, py = 58, (100 - _sq(k, pw)) / 2
    else:
        top = _bottom(body) + 3
        pw = min(64, (96 - top) * k["H"] / k["W"])
        px, py = 100 - pw - 4, max(top, 96 - _sq(k, pw))
    d = pw + 14
    els += [_s(k, "blob", (px + pw / 2 - d / 2, py + _sq(k, pw) / 2 - _sq(k, d) / 2, d, _sq(k, d)),
               {"fill": "soft"}, shape="circle"),
            _img(k, (px, py, pw, _sq(k, pw)), radius=40),
            *_tag(k, px - 4, py - 2, 18 if not k["land"] else 11, -12)]
    return els


def _layout_editorial(k, c):
    """매거진형: 얇은 테두리 + 색 면 위 사진 + 큰 번호와 명조 제목"""
    tf, bf = k["F"]
    my = 4 * k["W"] / k["H"]
    els = [_s(k, "frame", (4, my, 92, 100 - 2 * my), {"stroke": "text"}, z=6, stroke_w=2)]
    if k["land"]:
        els += [_s(k, "block", (50, 0, 50, 100), {"fill": "soft"}), _img(k, (56, 14, 36, 72))]
        tx, tw, ty = 9, 38, 14
    else:
        block = _by_ratio(k, 36, 44, 44)
        els += [_s(k, "block", (0, 0, 100, block), {"fill": "soft"}), _img(k, (10, 9, 80, block - 4))]
        tx, tw, ty = 10, 80, block + 7
    num_h = _line_h(110, k["H"])
    els.append(_t(k, "number", c.get("number", "01"), (tx, ty, 22, num_h), 110, {"color": "accent"}, font=tf))
    if c.get("label"):
        els.append(_t(k, "label", str(c["label"]).upper(), (tx + 22, ty + num_h / 2 - _line_h(24, k["H"]) / 2,
                                                             tw - 22, _line_h(24, k["H"])), 24,
                      {"color": "text"}, spacing=6))
    line = _s(k, "line", (tx, ty + num_h + 1, tw, 0.2), {"fill": "text"}, z=3)
    title = _fit(k, "title", c.get("title", ""), tx, _bottom(line) + 2, tw, 18, 90, {"color": "text"}, font=tf)
    brand_y = 100 - my - 5
    body = _fit(k, "body", c.get("body", ""), tx, _bottom(title) + 1.5, tw, max(6, brand_y - _bottom(title) - 3),
                34, {"color": "text"}, weight=400)
    els += [line, title, body,
            _t(k, "brand", BRAND, (tx, brand_y, 40, _line_h(22, k["H"])), 22, {"color": "text"}, spacing=6)]
    return els


def _layout_menu(k, c):
    """메뉴판형: 이중 테두리 + 가운데 동그란 사진 + 메뉴 이름·설명"""
    tf, bf = k["F"]
    my = 4 * k["W"] / k["H"]
    gap = 1.6 * k["W"] / k["H"]
    els = [_s(k, "frame", (4, my, 92, 100 - 2 * my), {"stroke": "accent"}, z=6, stroke_w=6),
           _s(k, "frame_in", (5.6, my + gap, 88.8, 100 - 2 * (my + gap)), {"stroke": "accent"}, z=6, stroke_w=2,
              role="frame"),
           _t(k, "label", str(c.get("label") or "MENU").upper(), (10, my + 4, 80, _line_h(28, k["H"])), 28,
              {"color": "accent"}, align="center", spacing=10),
           _t(k, "brand", BRAND, (10, my + 4 + _line_h(28, k["H"]) + 0.6, 80, _line_h(22, k["H"])), 22,
              {"color": "text"}, align="center", spacing=6)]
    if k["land"]:
        pw = 30
        px, py = 12, (100 - _sq(k, pw)) / 2 + 3
        tx, tw, ty = 50, 40, 34
    else:
        pw = min(60, 40 * k["H"] / k["W"])
        px, py = (100 - pw) / 2, _bottom(els[-1]) + 3
        tx, tw, ty = 8, 84, py + _sq(k, pw) + 3
    ring = pw + 6
    els += [_s(k, "ring", (px - 3, py - _sq(k, 3), ring, _sq(k, ring)), {"stroke": "accent"}, shape="circle",
               stroke_w=3),
            _img(k, (px, py, pw, _sq(k, pw)), radius=_circle_r(k, pw)),
            *_tag(k, px + pw - 10, py - 1, 16 if not k["land"] else 9, 12)]
    title = _fit(k, "title", c.get("title", ""), tx, ty, tw, 14, 76, {"color": "text"}, font=tf, align="center")
    line = _s(k, "line", (tx + tw / 2 - 5, _bottom(title) + 1.2, 10, 0.3), {"fill": "accent"}, z=3)
    body = _fit(k, "body", c.get("body", ""), tx + 4, _bottom(line) + 1.5, tw - 8,
                max(6, 100 - my - gap - 3 - _bottom(line) - 1.5), 32, {"color": "text"}, weight=400, align="center")
    return els + [title, line, body]


def _layout_pop(k, c):
    """팝·스티커형: 기울어진 사진 카드 + 띠 위 제목 + 이모지 스티커"""
    tf, bf = k["F"]
    els = [_t(k, "brand", BRAND, (6, 4, 50, _line_h(26, k["H"])), 26, {"color": "text"}, spacing=4)]
    if k["land"]:
        pw = 34
        px, py = 7, (100 - _sq(k, pw)) / 2
        tx, tw, ty = 48, 46, 30
    else:
        pw = _by_ratio(k, 52, 68, 74)
        px, py = (100 - pw) / 2, 12
        tx, tw, ty = 6, 88, py + _sq(k, pw) + 4
    els += [_s(k, "photo_back", (px, py, pw, _sq(k, pw)), {"fill": "soft"}, radius=40, rotate=4),
            _img(k, (px, py, pw, _sq(k, pw)), radius=40, rotate=-3),
            *_tag(k, px + pw - 14, py - 3, 20 if not k["land"] else 12, 14, text=c.get("label") or "K-\nDESSERT"),
            _sticker(k["p"] + "sticker", "✨", px - 4, py + _sq(k, pw) - 12, 12, k["W"], k["H"], z=6)]
    title = _fit(k, "title", c.get("title", ""), tx + 2, ty + 1.6, tw - 4, 16, 88, {"color": "bg", "on": "accent"},
                 font=tf, align="center", z=5, rotate=-3)
    band = _s(k, "band", (tx - 10, ty, tw + 20, title["h"] + 3.2), {"fill": "accent"}, z=4, rotate=-3)
    end = 89 if c.get("swipe") else 95  # 카드뉴스 표지는 아래 "넘겨 보기" 자리를 남깁니다.
    body = _fit(k, "body", c.get("body", ""), tx + 2, _bottom(band) + 3, tw - 4, max(6, end - _bottom(band) - 3), 36,
                {"color": "text"}, weight=400, align="center")
    return els + [band, title, body]


def _layout_minimal(k, c):
    """여백 미니멀형: 넓은 여백 + 길쭉한 아치 사진 + 작은 명조 제목"""
    tf, bf = k["F"]
    if k["land"]:
        ph = 76
        pw = ph * k["H"] / k["W"] / 1.3
        px, py, tx, tw, align = 12, 12, 50, 40, "left"
    else:
        pw = _by_ratio(k, 32, 40, 50)
        ph = _sq(k, pw) * 1.3
        px, py, tx, tw, align = (100 - pw) / 2, 13, 10, 80, "center"
    els = [_img(k, (px, py, pw, ph), radius=_circle_r(k, pw))]
    ty = 30 if k["land"] else py + ph + 4
    if c.get("label"):
        label = _t(k, "label", str(c["label"]).upper(), (tx, ty if k["land"] else 6.5, tw, _line_h(22, k["H"])), 22,
                   {"color": "accent"}, align=align, spacing=8)
        els.append(label)
        if k["land"]:
            ty = _bottom(label) + 2
    title = _fit(k, "title", c.get("title", ""), tx, ty, tw, 14, 64, {"color": "text"}, font=tf, weight=400,
                 align=align)
    line_x = tx if k["land"] else 47
    line = _s(k, "line", (line_x, _bottom(title) + 1.5, 6, 0.2), {"fill": "text"}, z=3)
    body = _fit(k, "body", c.get("body", ""), tx if k["land"] else 16, _bottom(line) + 2, tw if k["land"] else 68,
                max(6, 90 - _bottom(line) - 2), 28, {"color": "text"}, weight=400, align=align)
    brand_align = "left" if c.get("swipe") else "center"
    els += [title, line, body,
            _t(k, "brand", BRAND, (6 if c.get("swipe") else 10, 94, 80, _line_h(20, k["H"])), 20, {"color": "text"},
               align=brand_align if not k["land"] else "left", spacing=10)]
    return els


LAYOUTS = {"bold": _layout_bold, "editorial": _layout_editorial, "menu": _layout_menu, "pop": _layout_pop,
           "minimal": _layout_minimal}


# ---- 카드뉴스 안쪽 장 (스타일은 글꼴·색·장식으로 이어집니다) ----
def _inner_header(k, style, index, total):
    els = [_t(k, "brand", BRAND, (6, 4, 50, _line_h(24, k["H"])), 24, {"color": "text"}, spacing=6),
           _t(k, "page", f"{index + 1:02d} / {total:02d}", (64, 4, 30, _line_h(24, k["H"])), 24, {"color": "accent"},
              align="right", role="page_no", spacing=2)]
    if style in ("editorial", "menu"):
        my = 3 * k["W"] / k["H"]
        els.append(_s(k, "frame", (3, my, 94, 100 - 2 * my), {"stroke": "accent" if style == "menu" else "text"},
                      z=6, stroke_w=2))
    return els


def _inner_menu(k, style, c):
    """메뉴 소개: 큰 사진 + 제목 + 설명"""
    tf = k["F"][0]
    ph = 40 if k["land"] else (48 if k["H"] > k["W"] else 40)
    radius = {"editorial": 0, "minimal": _circle_r(k, 30)}.get(style, 36)
    if k["land"]:
        els = [_img(k, (6, 14, 42, 72), radius=radius)]
        tx, tw, ty = 54, 40, 22
    else:
        els = [_img(k, (6, 11, 88, ph), radius=radius)]
        tx, tw, ty = 6, 88, 11 + ph + 4
    if style == "pop":
        els.insert(0, _s(k, "photo_back", (els[0]["x"] + 2, els[0]["y"] + 2, els[0]["w"], els[0]["h"]),
                         {"fill": "accent"}, radius=36))
    if c.get("label"):
        label = _pill(k, "label", c["label"], tx, ty, 24, {"color": "bg", "bg": "accent"})
        els.append(label)
        ty = _bottom(label) + 1.5
    title = _fit(k, "title", c.get("title", ""), tx, ty, tw, 14, 72, {"color": "text"}, font=tf)
    body = _fit(k, "body", c.get("body", ""), tx, _bottom(title) + 1.5, tw, max(6, 94 - _bottom(title) - 1.5), 34,
                {"color": "text"}, weight=400)
    return els + [title, body]


def _inner_list(k, style, c):
    """번호 목록: 제목 + 번호 원과 짧은 항목 3~4개 (+ 남는 자리에 작은 사진)"""
    tf = k["F"][0]
    tx, tw = (6, 56) if k["land"] else (6, 88)
    els = []
    y = 11
    if c.get("label"):
        label = _t(k, "label", str(c["label"]).upper(), (tx, y, tw, _line_h(24, k["H"])), 24, {"color": "accent"},
                   spacing=6)
        els.append(label)
        y = _bottom(label) + 1
    title = _fit(k, "title", c.get("title", ""), tx, y, tw, 16, 72, {"color": "text"}, font=tf)
    els.append(title)
    lines = [line.strip().lstrip("✓•-–0123456789.) ").strip() for line in str(c.get("body", "")).split("\n")]
    lines = [line for line in lines if line][:4] or [str(c.get("body", ""))]
    d = 9 if not k["land"] else 6
    y = _bottom(title) + 4
    size = 36
    while size > 24 and sum(max(_sq(k, d), _est_h(k, line, size, tw - d - 4, k["F"][1])) + 3 for line in lines) > 92 - y:
        size -= 2
    for number, line in enumerate(lines, 1):
        text_h = _est_h(k, line, size, tw - d - 4, k["F"][1])
        row_h = max(_sq(k, d), text_h)
        if style == "pop":
            els.append(_s(k, f"card-{number}", (tx - 1.5, y - 1, tw + 3, row_h + 2), {"fill": "soft"}, radius=28,
                          role="card"))
        if style == "minimal":
            els.append(_t(k, f"number-{number}", f"{number:02d}", (tx, y, d, row_h), 34, {"color": "accent"},
                          font=tf, role="number", z=5))
        else:
            els += [_s(k, f"dot-{number}", (tx, y + row_h / 2 - _sq(k, d) / 2, d, _sq(k, d)), {"fill": "accent"},
                       shape="circle", z=4, role="dot"),
                    _t(k, f"number-{number}", str(number), (tx, y + row_h / 2 - _sq(k, d) / 2, d, _sq(k, d)), 36,
                       {"color": "bg", "on": "accent"}, align="center", role="number", z=5)]
        els.append(_t(k, f"point-{number}", line, (tx + d + 3, y, tw - d - 3, row_h), size, {"color": "text"},
                      weight=400, role="point"))
        y += row_h + 3
    if k["land"]:
        els.append(_img(k, (66, 18, 28, _sq(k, 28)), radius=_circle_r(k, 28)))
    elif y < 66:
        pw = min(34, (94 - y) * k["H"] / k["W"])
        els.append(_img(k, (94 - pw, 94 - _sq(k, pw), pw, _sq(k, pw)), radius=_circle_r(k, pw)))
    return els


def _inner_quote(k, style, c):
    """감성 문구: 큰 따옴표 + 가운데 문장 + 작은 제목"""
    tf = k["F"][0]
    quote = c.get("quote") or c.get("body", "")
    els = [_t(k, "quote_mark", "“", (8, 10, 30, _line_h(220, k["H"])), 220, {"color": "accent"}, font="lora",
              opacity=0.8)]
    q = _fit(k, "quote", quote, 10, 28, 80, 36, 64, {"color": "text"}, font=tf, align="center", weight=400)
    title = _fit(k, "title", c.get("title", ""), 10, _bottom(q) + 3, 80, 8, 30, {"color": "accent"}, align="center",
                 spacing=2)
    els += [q, title]
    if not k["land"] and _bottom(title) < 70:
        pw = 24
        els.append(_img(k, ((100 - pw) / 2, 92 - _sq(k, pw), pw, _sq(k, pw)), radius=_circle_r(k, pw)))
    return els


def _inner_cta(k, style, c):
    """마지막 장: 작은 사진 + 제목 + 저장·공유·팔로우 알약"""
    tf = k["F"][0]
    els = []
    y = 12
    if not k["land"]:
        pw = 26
        els.append(_img(k, ((100 - pw) / 2, y, pw, _sq(k, pw)), radius=_circle_r(k, pw)))
        y += _sq(k, pw) + 3
    title = _fit(k, "title", c.get("title", ""), 8, y, 84, 18, 80, {"color": "text"}, font=tf, align="center")
    body = _fit(k, "body", c.get("body", ""), 12, _bottom(title) + 1.5, 76, 12, 32, {"color": "text"}, weight=400,
                align="center")
    els += [title, body]
    y = _bottom(body) + 4
    for number, text in enumerate(CTA_TEXTS, 1):
        paint = {"color": "bg", "bg": "accent"} if number == 1 else {"color": "text", "bg": "soft"}
        pill = _pill(k, f"cta-{number}", text, 50, y, 28, paint, align="center", role="cta")
        els.append(pill)
        y = _bottom(pill) + 1.6
    return els


INNER = {"menu": _inner_menu, "list": _inner_list, "quote": _inner_quote, "cta": _inner_cta}


def _connectors(k, index, total):
    """장 경계에 걸친 반원: 넘겨 볼 때 앞뒤 장이 한 장처럼 이어져 보입니다. (경계마다 위·아래를 번갈아)"""
    d = 28
    els = []
    for boundary, x in ((index - 1, -d / 2), (index, 100 - d / 2)):
        if 0 <= boundary < total - 1:
            cy = 86 if boundary % 2 == 0 else 14
            els.append(_s(k, f"connector-{boundary}", (x, cy - _sq(k, d) / 2, d, _sq(k, d)), {"fill": "soft"},
                          shape="circle", z=0, role="connector", opacity=0.85))
    return els


def _build_styled_pages(style, ratio, contents, palette, fonts):
    W, H = SIZES[ratio]
    total = len(contents)
    pages = []
    for index, content in enumerate(contents):
        k = _kit(W, H, palette, fonts, index, content.get("photo"))
        layout = "cover" if index == 0 or content.get("layout") not in INNER else content["layout"]
        if layout == "cover":
            els = LAYOUTS[style](k, {**content, "swipe": total > 1})
            if total > 1:
                els.append(_pill(k, "swipe", SWIPE_TEXT, 94, 100 - 6.5 * W / H, 22, {"color": "bg", "bg": "accent"},
                                 align="right", z=7))
        else:
            els = _inner_header(k, style, index, total) + INNER[layout](k, style, content)
        if total > 1:
            els += _connectors(k, index, total)
        pages.append({"layout": layout, "bg": palette["bg"], "accent": palette["accent"],
                      "content": {key: value for key, value in content.items() if key != "swipe"}, "elements": els})
    return pages


def _switch_style(doc, style):
    """문구·사진·색은 남기고 스타일 틀만 바꿉니다. 글꼴은 그 스타일의 기본 글꼴로 바꿉니다."""
    def build(contents, palette):
        doc["style"] = style
        doc["fonts"] = dict(zip(("title", "body"), STYLE_FONTS[style]))
        doc.pop("template", None)
        return _build_styled_pages(style, doc.get("ratio", DEFAULT_RATIO), contents, palette, doc["fonts"])
    _rebuild(doc, build)


def design_proposal_schema(count):
    """API 출력과 서버 검증 모두 동일한 제한을 사용합니다."""
    def obj(properties):
        return {"type": "object", "properties": properties, "required": list(properties), "additionalProperties": False}

    def string(limit):
        return {"type": "string", "minLength": 1, "maxLength": limit}

    def enum(values):
        return {"type": "string", "enum": list(values)}

    color = {"type": "string", "pattern": HEX_RE.pattern}
    page = obj({"layout": enum(PAGE_LAYOUTS), "label_vi": string(40), "label_ko": string(80),
                "title_vi": string(90), "title_ko": string(150), "body_vi": string(350), "body_ko": string(600)})
    proposal = obj({"name": string(80), "prompt": string(1500), "style": enum(STYLES),
                    "palette": obj({"bg": color, "accent": color, "text": color, "soft": color}),
                    "title_font": enum(VI_FONTS), "body_font": enum(VI_FONTS),
                    "pages": {"type": "array", "minItems": count, "maxItems": count, "items": page}})
    return obj({"proposals": {"type": "array", "minItems": 3, "maxItems": 3, "items": proposal}})


def validate_proposals(value, schema):
    """외부 AI 응답은 저장·그리기 전에 제한된 JSON 형식으로 검사합니다."""
    type_ = schema["type"]
    if type_ == "object":
        if not isinstance(value, dict) or set(value) != set(schema["properties"]):
            raise ValueError("AI 결과의 항목이 올바르지 않습니다.")
        for key, child in schema["properties"].items():
            validate_proposals(value[key], child)
    elif type_ == "array":
        if not isinstance(value, list) or not schema["minItems"] <= len(value) <= schema["maxItems"]:
            raise ValueError("AI 결과의 제안 수 또는 장수가 올바르지 않습니다.")
        for child in value:
            validate_proposals(child, schema["items"])
    elif not isinstance(value, str) or not value.strip() or len(value) > schema.get("maxLength", 4000):
        raise ValueError("AI 결과의 문구가 비어 있거나 너무 깁니다.")
    elif "enum" in schema and value not in schema["enum"]:
        raise ValueError("AI 결과의 스타일·글꼴·장 구성이 올바르지 않습니다.")
    elif "pattern" in schema and not re.fullmatch(schema["pattern"], value):
        raise ValueError("AI 결과의 색 값이 올바르지 않습니다.")


def proposal_design(source, proposal, options):
    """AI는 문구·스타일·색 조합·글꼴을 제안하고, 사진은 기존 원본을 유지합니다.

    사진은 같은 번호의 장 사진을 그대로 쓰고, 사진이 없는 장·늘어난 장은 표지 사진을 씁니다.
    기존 사진이 하나도 없으면(첫 화면) 고른 제품의 대표 사진을 씁니다.
    카드뉴스는 첫 장을 표지, 마지막 장을 저장·팔로우 유도 장으로 고정합니다.
    """
    product = _option_product(options) or {}
    photos = [next((item.get("src") for item in page.get("elements", [])
                    if item.get("type") == "image" and item.get("src") and item.get("role") != BG_ROLE), None)
              for page in source.get("pages", [])]
    cover_photo = (photos[0] if photos else None) or next((src for src in photos if src), None) or _image_src(product)

    def photo_of(index):
        return (photos[index] if index < len(photos) else None) or cover_photo

    texts = proposal["pages"]
    style = proposal["style"]
    palette = _clean_palette(proposal["palette"], PALETTES.get(product.get("color"), PALETTES["gold"]))
    fonts = {"title": proposal["title_font"], "body": proposal["body_font"]}
    contents = []
    for index, item in enumerate(texts):
        layout = item["layout"] if item["layout"] in INNER else "menu"
        if index == len(texts) - 1 and len(texts) >= MIN_PAGES:
            layout = "cta"
        contents.append({"title": item["title_vi"], "body": item["body_vi"], "label": item["label_vi"],
                         "photo": photo_of(index), "layout": "cover" if index == 0 else layout})
    doc = {"kind": source["kind"], "ratio": source["ratio"], "style": style, "palette": palette, "fonts": fonts,
           "pages": _build_styled_pages(style, source["ratio"], contents, palette, fonts)}
    for page, words in zip(doc["pages"], texts):
        first_point = True
        for item in page["elements"]:
            role = item.get("role")
            key = {"title": "title_ko", "body": "body_ko", "quote": "body_ko", "label": "label_ko"}.get(role)
            if role == "point" and first_point:
                key, first_point = "body_ko", False
            if item["type"] == "text" and key:
                item["text_ko"] = words[key]
                item["translation_source"] = item["text"]
    doc["demo"] = source.get("demo", True)
    doc["assistant"] = {"name": proposal["name"], "prompt": proposal["prompt"], "options": options,
                        "notice": f"AI 초안 · {STYLES[style]} · 제품 정보와 번역은 검토해 주세요."}
    if source.get("external_figma"):
        doc["external_figma"] = copy.deepcopy(source["external_figma"])
    return doc


# ---------- 대화로 고치기 (AI · 텍스트 모델) ----------
# routes_sns.py(유진) _call_ai가 영상과 같은 경로(gpt-4o-mini · JSON 답 · 하루 한도)로 부릅니다:
#   messages = design_ai_messages(지금 문서, 요청, page) → AI 답 → apply_design_ai(지금 문서, 답, page)
# AI는 둘 중 하나로 답합니다.
# - edit: 요소 id마다 바꿀 칸만 → 그 요소만 바뀝니다.
# - redesign: 3안 생성과 같은 스타일·색·글꼴·문구 한 벌 → 배치는 코드(스타일 틀)가 다시 짭니다. 사진·배경 그림은 그대로.
# 형식이 틀리거나 바꿀 것이 없으면 None → 부른 쪽이 단어 규칙(revise_design)을 씁니다.
DESIGN_AI_INSTRUCTIONS = """당신은 베트남에 진출한 한국 찹쌀떡 브랜드 '한정선(HANJUNGSUN)'의 SNS {label} 디자이너입니다.
마케터의 수정 요청(한국어)을 받아 지금 디자인 문서를 고칩니다. JSON으로만 답하세요.

답 형식: {{"mode": "edit" | "redesign" | "none", "changes": ["바꾼 것을 한국어로 짧게", ...], "edits": [...], "proposal": {{...}}}}

1) mode "edit" — 일부만 고치는 요청 (예: "제목 더 크게", "본문 색 진하게", "부제 문구 바꿔")
  edits: [{{"page": 장 번호(1부터), "id": "요소 id", "set": {{바꿀 칸만}}, "remove": false}}]
  - 바꿀 수 있는 칸: text, text_ko(글의 한국어 뜻), size(px), color, bg(글 바탕색), fill(도형 색), weight(400 | 700),
    font, align(left | center | right), x, y, w, h(페이지 대비 %, 0~100)
  - 장 배경색은 "id": "@page", "set": {{"bg": "#rrggbb"}}
  - 요소를 빼려면 "remove": true. 새 요소는 만들지 않습니다.
  - 요청에 장 번호가 없으면 글 수정은 지금 보는 {current}장에, 색·글꼴처럼 전체 느낌은 모든 장에 적용합니다.
  - 요청과 상관없는 요소는 edits에 넣지 않습니다.
2) mode "redesign" — 전체 분위기·스타일을 새로 바꾸는 요청 (예: "크리스마스 느낌으로 확 바꿔", "더 고급스럽게 다시")
  proposal: {{"name": 짧은 이름, "prompt": 디자인 설명(한국어 1~2문장), "style": {styles} 중 하나,
    "palette": {{"bg", "accent", "text", "soft"}}(#rrggbb), "title_font", "body_font": {fonts} 중 하나,
    "pages": [장마다 {{"layout": {layouts} 중 하나, "label_vi", "label_ko", "title_vi", "title_ko", "body_vi", "body_ko"}}]}}
  - pages는 정확히 {count}개이고 첫 장 layout은 "cover"입니다. 배치·사진 위치는 코드가 정합니다.
3) 알아듣지 못했거나 디자인과 상관없는 요청이면 mode "none".

규칙
- 디자인 속 글은 베트남어(성조 부호 정확히)입니다. 글을 바꾸면 text_ko에 한국어 뜻도 함께 적습니다.
- 제품 이름·맛·효능·가격은 지금 문서에 있는 것만 씁니다. 지어내지 않습니다.
- 색은 #rrggbb 6자리. 흰색·검정 위주는 피하고, 글자가 바탕에서 잘 읽히게 합니다.
- 현지 기준(local_guidelines)이 있으면 지킵니다."""
AI_EDIT_KEYS = ("text", "text_ko", "size", "color", "bg", "fill", "weight", "font", "align", "x", "y", "w", "h")
AI_SUMMARY_KEYS = ("id", "role", "type") + AI_EDIT_KEYS + ("z",)
AI_TEXT_MAX = 400
AI_EDITS_MAX = 60
AI_CHANGES_MAX = 8


def design_ai_messages(doc, text, page=None):
    """AI에 보낼 메시지. 사진 주소는 빼고, AI가 고칠 수 있는 칸만 보냅니다. page: 지금 보는 장(0부터)."""
    count = len(doc["pages"])
    current = page + 1 if isinstance(page, int) and 0 <= page < count else 1
    summary = {
        "kind": doc.get("kind"), "ratio": doc.get("ratio"), "style": doc.get("style"), "palette": doc.get("palette"),
        "pages": [{"page": index + 1, "bg": data.get("bg"),
                   "elements": [{key: item[key] for key in AI_SUMMARY_KEYS if key in item} for item in data["elements"]]}
                  for index, data in enumerate(doc["pages"])],
        "local_guidelines": _guideline_rules(),
    }
    instructions = DESIGN_AI_INSTRUCTIONS.format(
        label="포스터" if doc.get("kind") == "poster" else "카드뉴스", current=current, count=count,
        styles=" | ".join(STYLES), fonts=" | ".join(VI_FONTS), layouts=" | ".join(PAGE_LAYOUTS))
    return [
        {"role": "system", "content": instructions},
        {"role": "user", "content": f"지금 디자인 문서:\n{json.dumps(summary, ensure_ascii=False)}\n\n"
                                    f"지금 보는 장: {current}장\n요청: {text}"},
    ]


def apply_design_ai(doc, data, page=None):
    """AI 답 → (새 문서, 바꾼 것 목록). 형식이 틀리거나 바꾼 것이 없으면 None (부른 쪽이 revise_design을 씁니다)."""
    if not isinstance(data, dict) or not doc or not doc.get("pages") or doc.get("mode") == IMAGE_MODE:
        return None
    if data.get("mode") == "redesign":
        new_doc = _ai_redesign(doc, data.get("proposal"))
    elif data.get("mode") == "edit":
        new_doc = _ai_edit(doc, data.get("edits"))
    else:
        return None
    if new_doc is None:
        return None
    raw = data.get("changes") if isinstance(data.get("changes"), list) else []
    changes = [item.strip()[:60] for item in raw if isinstance(item, str) and item.strip()][:AI_CHANGES_MAX]
    return new_doc, changes or ["AI 수정"]


def _clean_proposal(proposal, count):
    """AI 제안 하나를 3안 생성과 같은 형식으로 검사합니다. AI가 덧붙인 모르는 칸은 버리고(빠진 칸은 검사에서 걸림),
    맞으면 정리한 제안, 틀리면 None."""
    schema = design_proposal_schema(count)["properties"]["proposals"]["items"]
    if not isinstance(proposal, dict) or not isinstance(proposal.get("pages"), list):
        return None
    page_keys = schema["properties"]["pages"]["items"]["properties"]
    proposal = {key: proposal.get(key) for key in schema["properties"]}
    proposal["pages"] = [{key: item.get(key) for key in page_keys} if isinstance(item, dict) else item
                         for item in proposal["pages"]]
    if isinstance(proposal["palette"], dict):
        proposal["palette"] = {key: proposal["palette"].get(key) for key in schema["properties"]["palette"]["properties"]}
    try:
        validate_proposals(proposal, schema)
    except ValueError:
        return None
    return proposal


def _ai_redesign(doc, proposal):
    """스타일·색·글꼴·문구를 새로 받아 스타일 틀로 다시 그립니다. 3안 생성과 같은 형식 검사를 씁니다."""
    proposal = _clean_proposal(proposal, len(doc["pages"]))
    if proposal is None:
        return None
    rebuilt = proposal_design(doc, proposal, {})
    rebuilt["assistant"]["notice"] = f"AI 수정 · {STYLES[proposal['style']]} · 제품 정보와 번역은 검토해 주세요."
    # 문서의 다른 칸(제목·기념일 등)은 남기고, 틀과 관련된 칸만 바꿉니다.
    new_doc = {key: copy.deepcopy(value) for key, value in doc.items() if key != "template"}
    new_doc.update(rebuilt)
    _keep_backgrounds(new_doc, [_backgrounds(page) for page in doc["pages"]])
    return new_doc


def _ai_edit(doc, edits):
    """요소 id마다 받은 칸만 검사해서 바꿉니다. 하나도 못 바꾸면 None."""
    if not isinstance(edits, list) or not edits:
        return None
    new_doc = copy.deepcopy(doc)
    pages = new_doc["pages"]
    applied = 0
    for edit in edits[:AI_EDITS_MAX]:
        if not isinstance(edit, dict):
            continue
        number = edit.get("page")
        if isinstance(number, bool) or not isinstance(number, int) or not 1 <= number <= len(pages):
            continue
        page = pages[number - 1]
        values = edit.get("set") if isinstance(edit.get("set"), dict) else {}
        if edit.get("id") == "@page":
            if HEX_RE.match(str(values.get("bg") or "")):
                page["bg"] = values["bg"].lower()
                applied += 1
            continue
        item = next((one for one in page["elements"] if one.get("id") == edit.get("id")), None)
        if item is None:
            continue
        if edit.get("remove") is True:
            page["elements"].remove(item)
            applied += 1
            continue
        for key, value in values.items():
            clean = _ai_value(item, key, value)
            if clean is not None and item.get(key) != clean:
                item[key] = clean
                applied += 1
        ko = _ai_value(item, "text_ko", values.get("text_ko"))
        if ko is not None and item.get("text_ko") == ko:
            item["translation_source"] = item.get("text")  # 한국어 뜻을 같이 받았으면 확인한 글로 둡니다.
        if item.get("font") in SINGLE_WEIGHT:
            item["weight"] = 400
    return new_doc if applied else None


def _ai_value(item, key, value):
    """AI가 준 값 하나를 검사합니다. 쓸 수 없으면 None."""
    kind = item.get("type")
    number = isinstance(value, (int, float)) and not isinstance(value, bool)
    if key in ("text", "text_ko"):
        ok = kind == "text" and isinstance(value, str) and 0 < len(value.strip()) <= AI_TEXT_MAX
        return value.strip() if ok else None
    if key == "size":
        return int(round(value)) if kind == "text" and number and 8 <= value <= 400 else None
    if key in ("color", "bg", "fill"):
        allowed = kind == "shape" if key == "fill" else kind == "text"
        return value.lower() if allowed and HEX_RE.match(str(value)) else None
    if key == "weight":
        return value if kind == "text" and value in (400, 700) and not isinstance(value, bool) else None
    if key == "font":
        return value if kind == "text" and value in VI_FONTS else None
    if key == "align":
        return value if kind == "text" and value in ("left", "center", "right") else None
    if key in ("x", "y"):
        return round(value, 2) if number and -50 <= value <= 100 else None
    if key in ("w", "h"):
        return round(value, 2) if number and 2 <= value <= 100 else None
    return None


# ---------- 배경 그림 (AI · 이미지 모델) ----------
# routes_media.py가 OpenAI 이미지 모델로 글자 없는 배경 그림을 만들고, 장 맨 아래(z=-1)에 이미지 요소로 깝니다.
# 베트남어 글은 지금처럼 글 요소로 얹습니다(이미지 모델은 성조 부호를 자주 틀림). 제품 모양은 등록된 사진을 참고로 보냅니다.
BG_ROLE = "background"


def _backgrounds(page):
    return [copy.deepcopy(item) for item in page.get("elements", []) if item.get("role") == BG_ROLE]


def _keep_backgrounds(doc, backgrounds):
    """틀을 다시 짠 뒤 장마다 원래 배경 그림을 맨 아래에 다시 깝니다."""
    for page, items in zip(doc["pages"], backgrounds):
        page["elements"] = items + [item for item in page["elements"] if item.get("role") != BG_ROLE]


def background_element(page_index, src):
    """장 전체를 덮는 배경 그림 요소. 편집기에서는 고르거나 옮길 수 없고, [배경 그림 빼기]로만 뺍니다."""
    return {"id": f"p{page_index + 1}-{BG_ROLE}", "role": BG_ROLE, "type": "image",
            "x": 0, "y": 0, "w": 100, "h": 100, "z": -1, "src": src, "radius": 0}


def background_photos(product, wish=""):
    """참고로 보낼 제품 사진 [(static/images/sns 안 파일 이름, 사진 설명 영어)]. 영상 탭(_photo_set)과 같은 기준입니다.
    겉모습은 항상, 고른 맛이 있으면 그 맛 단면, 요청에 선물이 있으면 선물세트·포장 사진을 더합니다."""
    photos = [(COMMON_IMAGES["whole"],
               "the outside of the rice cakes: round, soft and white with rice-flour dusting, the same for every flavor")]
    images = (product or {}).get("images") or {}
    flavor = _flavor_en(product)
    if images.get("cut"):
        photos.append((images["cut"], f"the cross-section of the {flavor} rice cake, showing its filling"))
    if _has(wish or "", ("선물", "세트", "gift")):
        photos += [(COMMON_IMAGES["giftset_wrapped"], "the gift set box wrapped in pink bojagi cloth"),
                   (COMMON_IMAGES["giftset_open"], "the opened gift set box with individually wrapped rice cakes")]
        if images.get("pack"):
            photos.append((images["pack"], f"the individual package of the {flavor} rice cake"))
    return photos


def _flavor_en(product):
    return (product or {}).get("id", "").replace("_", " ") or "chapssal-tteok"


def background_prompt(doc, page_index, product, wish, roles):
    """글자 없는 배경 그림 프롬프트(영어). 지금 장의 글 자리는 단순하게 비워 두라고 적습니다.
    roles: 첨부 사진마다 무엇인지(순서대로)."""
    page = doc["pages"][page_index]
    texts = [item for item in page["elements"] if item.get("type") == "text"]
    kind = "Instagram poster" if doc.get("kind") == "poster" else "Instagram card news slide"
    parts = [
        f"Photorealistic advertising photo for an {kind} of Hanjungsun, a Korean chapssal-tteok (soft rice cake) "
        f"dessert brand in Vietnam, featuring the {_flavor_en(product)} rice cake.",
        ("Attached photos: " + "; ".join(f"{index + 1}) {role}" for index, role in enumerate(roles))
         + ". The rice cakes must match these photos exactly in shape, color and filling. Do not invent other products.")
        if roles else "",
        f"Scene and mood requested by the marketer (may be Korean): {wish}." if wish
        else "Scene and mood: warm, appetizing, premium dessert styling with soft natural light.",
        f"Use colors that suit this design: background {page.get('bg', '')}, accent {page.get('accent', '')}.",
    ]
    if texts:
        top = max(0, round(min(item["y"] for item in texts)))
        bottom = min(100, round(max(item["y"] + item["h"] for item in texts)))
        parts.append(f"Keep the area from {top}% to {bottom}% of the image height calm, simple and low-detail, "
                     "because text will be placed there later. Put the product where it does not cover that area.")
    parts.append("Absolutely no text, no letters, no numbers, no logos, no watermarks and no labels anywhere in the image.")
    return " ".join(part for part in parts if part)


# ---------- 비율 바꾸기 (편집기 오른쪽 칸, routes_media.py design-ratio) ----------
DESIGN_RATIOS = {"poster": tuple(SIZES), "cardnews": CARDNEWS_RATIOS}


def change_ratio(doc, ratio):
    """비율을 바꾼 새 문서. 스타일 틀·카드뉴스 템플릿 초안은 새 비율에 맞춰 다시 배치하고(글·사진·색·배경 그림 유지),
    틀이 없는 초안은 요소 자리를 비율에 맞춰 옮깁니다(_fit_ratio). 바꾸기 전 문서는 되돌리기로 돌아갈 수 있습니다."""
    kind = doc.get("kind")
    if doc.get("mode") == IMAGE_MODE:
        raise ValueError("그림 시안은 비율을 바꿀 수 없어요. 원하는 비율로 새로 만들어 주세요.")
    allowed = DESIGN_RATIOS.get(kind, ())
    if ratio not in allowed:
        raise ValueError(f"{'포스터' if kind == 'poster' else '카드뉴스'} 비율은 {' · '.join(allowed)}만 쓸 수 있습니다.")
    new_doc = copy.deepcopy(doc)
    if ratio == doc.get("ratio"):
        return new_doc
    style, template = new_doc.get("style"), new_doc.get("template")
    if style in STYLES:
        fonts = new_doc.get("fonts") or dict(zip(("title", "body"), STYLE_FONTS[style]))
        new_doc["ratio"] = ratio
        _rebuild(new_doc, lambda contents, palette: _build_styled_pages(style, ratio, contents, palette, fonts))
    elif kind == "cardnews" and template in TEMPLATES:
        new_doc["ratio"] = ratio
        _rebuild(new_doc, lambda contents, palette: _build_pages(template, ratio, contents, palette))
    else:
        _fit_ratio(new_doc, ratio)
    return new_doc


def _fit_ratio(doc, ratio):
    """요소마다 가운데 자리(%)는 그대로 두고, 크기는 찌그러지지 않게 같은 배율로 맞춥니다.
    한쪽을 꽉 채운 띠·덮개(99% 이상)와 배경 그림은 새 페이지도 꽉 채웁니다."""
    old_w, old_h = SIZES.get(doc.get("ratio"), SIZES[DEFAULT_RATIO])
    new_w, new_h = SIZES[ratio]
    scale = min(new_w / old_w, new_h / old_h)
    for page in doc["pages"]:
        for item in page["elements"]:
            if item.get("role") == BG_ROLE:
                continue
            for pos, size, old, new in (("x", "w", old_w, new_w), ("y", "h", old_h, new_h)):
                if item[size] >= 99:
                    continue
                center = item[pos] + item[size] / 2
                item[size] = round(item[size] * old * scale / new, 2)
                item[pos] = round(center - item[size] / 2, 2)
            if item.get("type") == "text":
                item["size"] = max(8, round(item["size"] * scale))
    doc["ratio"] = ratio
