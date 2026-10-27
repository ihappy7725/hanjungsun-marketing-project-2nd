"""현지 시장 분석 화면·API. [상준]

API는 /market_analysis/api/... 아래에만 추가합니다. 다른 기능 데이터는 그 기능의 public.py로만 읽습니다. (README 8장)

화면은 market_analysis/data/ 의 실제 데이터 파일만 읽습니다. 파일이 없거나 비어 있으면 값을 만들지 않고 "수집 전"으로 둡니다.
    data/trends_<국가>/   Google Trends 화면에서 내려받은 CSV를 그대로 저장 (파일 이름은 아래 TREND_* 표)
        timeline_<카테고리>.csv   시간별 관심도 (최근 90일)
        rising_<카테고리>.csv     관련 검색어 (급상승 포함)
        fruit.csv                과일 5종 비교 시간별 관심도
        seasonality_<분류>.csv    5년 월별 관심도 (fruit 분류는 과일 5종 비교)
        geo_<주제>.csv            지역별 관심도
    data/research_<날짜>/        경쟁 제품 재조사 결과(build_competitor_research.py). 있으면 가장 최근 폴더를 우선 사용
    data/competitors_<국가>.csv  경쟁 제품 수동 조사표 (머리줄 = COMPETITOR_COLUMNS, CSV UTF-8로 저장)
    data/country_<국가>.json     국가 기본 정보 (World Bank)
    data/content_guidelines_<국가>.json  금기·컬러·상징 (public.get_content_guidelines)
"""
import csv
import io
import json
import re
from datetime import date
from pathlib import Path

from flask import jsonify, render_template, request, url_for

from . import bp
from .countries import COUNTRIES, DEFAULT_COUNTRY
from .public import get_content_guidelines

_DATA_DIR = Path(__file__).parent / "data"

TABS = ("culture", "trend", "competitor", "insight")  # 화면 탭 순서, 첫 번째가 기본 탭

# (파일 키, 화면 이름, 판단에 쓰는 곳) — README 3장
TREND_CATEGORIES = [
    ("mochi", "떡·모찌", "직접 경쟁 시장이 커지는지"),
    ("rice_dessert", "현지 쌀 디저트", "쫀득한 쌀 식감이 통하는지 · 대체재"),
    ("kfood", "K-푸드", "\"한국산\"이 강점이 되는지"),
    ("fruit_dessert", "과일 디저트", "어떤 현지 과일 맛이 뜨는지"),
    ("gift", "선물·명절", "선물 시즌 · 구성 판단"),
    ("healthy", "건강·저당", "\"쌀로 만든 담백한 간식\" 메시지 적합성"),
]
TREND_SEASONALITY = [
    ("holiday_gift", "명절 선물 시즌", "선물세트 발주 · 사전 예약 판매 시점"),
    ("anniversary_gift", "기념일 선물 시즌", "기념일 2~3주 전 SNS · 인플루언서 캠페인"),
    ("fruit", "(과일) 한정판 시기", "한정판 맛 출시 시기"),
    ("tourism", "다낭 관광 성수기", "공항 · 관광지 기념품 채널 물량 확대"),
]
TREND_GEO_TOPICS = [
    ("mochi", "찹쌀떡·모찌"),
    ("kdessert", "한국 디저트"),
    ("gift", "디저트 선물"),
]

COMPETITOR_COLUMNS = [
    "brand", "product", "segment", "origin", "pack_count", "unit_weight_g", "price_vnd", "monthly_sales",
    "channels", "is_core", "region", "source_url", "surveyed_at",
    "promotion", "sns_influencer", "seasonal_limited", "packaging", "key_message", "sales_event",
    "review_keywords", "takeaway",
]
COMPETITOR_MARKETING = [
    ("promotion", "프로모션 · 가격"),
    ("sns_influencer", "SNS · 인플루언서"),
    ("seasonal_limited", "시즌 · 한정 전략"),
    ("packaging", "패키징 · 디자인"),
    ("key_message", "핵심 메시지"),
    ("sales_event", "판매 이벤트"),
]

# Google Trends 관련 검색어 CSV의 '급상승' 구간 제목 (화면 언어에 따라 다름)
_RISING_LABELS = {"RISING", "급상승", "ĐANG TĂNG", "TĂNG VỌT"}
_DATE_RE = re.compile(r"^(\d{4})-(\d{2})(?:-(\d{2}))?")
_HEADER_RE = re.compile(r"^(.*?):\s*\((.*)\)\s*$")


@bp.route("/")
def index():
    country = _country_arg()
    tab = request.args.get("tab", TABS[0])
    if tab not in TABS:
        tab = TABS[0]
    return render_template(
        "market_analysis/market_analysis_index.html",
        tab=tab,
        dashboard=build_dashboard(country),
    )


@bp.route("/api/dashboard")
def api_dashboard():
    return jsonify(build_dashboard(_country_arg()))


@bp.route("/api/insight", methods=["GET", "POST"])
def api_insight():
    """AI 인사이트. GET = 입력 선택지, POST = 생성(저장하지 않음). 현재 베트남만 지원합니다."""
    from .repositories.trend_repository import TrendRepository
    from .services import insight_service
    from .services.decision_cards import build_cards
    from .services.trend_service import TrendService

    country = _country_arg()
    if country != "VN":
        return jsonify(error="현재 AI 인사이트는 베트남만 지원합니다."), 404
    repository = TrendRepository()
    config = repository.get_keywords(country)
    trend = TrendService(repository).get_dashboard(country) or {}
    culture = _load_culture(country)
    guidelines = culture["guidelines"] or {}
    competitors = _load_competitors(country)
    # 의사결정 카드(맛 기회·가격 위치·채널 기회): 서버 계산, AI 없이 바로 표시
    cards = build_cards(trend, competitors.get("card_items", competitors["items"]),
                        (guidelines.get("culture_dashboard") or {}).get("ecommerce_facts"), competitors.get("as_of"))
    if request.method == "GET":
        return jsonify({**insight_service.options(config), "cards": cards})
    try:
        payload = insight_service.generate(request.get_json(silent=True), config, trend=trend, guidelines=guidelines,
                                           competitors=competitors["items"], cards=cards, basic=culture.get("basic"),
                                           competitor_meta=competitors)
    except insight_service.InsightError as error:
        return jsonify(error=str(error)), error.status
    return jsonify(payload)


def _country_arg():
    country = (request.args.get("country") or DEFAULT_COUNTRY).upper()
    return country if country in COUNTRIES else DEFAULT_COUNTRY


def build_dashboard(country):
    trend = _load_trend(country)
    # 중량별 카드 계산용 묶음은 AI 인사이트 API에서만 쓰므로 화면 데이터에는 싣지 않습니다
    competitors = {k: v for k, v in _load_competitors(country).items() if k != "card_items"}
    culture = _load_culture(country)
    return {
        "country": country,
        "countries": [{"code": code, **info} for code, info in COUNTRIES.items()],
        "trend": trend,
        "competitors": competitors,
        "culture": culture,
        "readiness": _readiness(country, trend, competitors, culture),
    }


# ---------- 트렌드 (Google Trends CSV) ----------

def _load_trend(country):
    folder = _DATA_DIR / f"trends_{country.lower()}"
    rel = f"market_analysis/data/trends_{country.lower()}"

    def item(name, loader):
        path = folder / name
        return {"file": f"{rel}/{name}", "as_of": _file_date(path), "data": _safe(loader, path)}

    return {
        "folder": rel,
        "source": "Google Trends (CSV 내보내기)",
        "categories": [
            {"key": key, "label": label, "purpose": purpose,
             "timeline": item(f"timeline_{key}.csv", _load_timeline),
             "rising": item(f"rising_{key}.csv", _load_rising)}
            for key, label, purpose in TREND_CATEGORIES
        ],
        "fruit": item("fruit.csv", _load_fruit),
        "seasonality": [
            {"key": key, "label": label, "action": action,
             **item(f"seasonality_{key}.csv", _load_seasonality)}
            for key, label, action in TREND_SEASONALITY
        ],
        "geo": [
            {"key": key, "label": label, **item(f"geo_{key}.csv", _load_geo)}
            for key, label in TREND_GEO_TOPICS
        ],
    }


def _load_timeline(path):
    for label, rows in _trends_sections(path):
        if label or len(rows) < 2:
            continue
        header, body = rows[0], rows[1:]
        dates, series = [], [[] for _ in header[1:]]
        for row in body:
            day = _parse_date(row[0])
            if not day:
                continue
            dates.append(day)
            for i, values in enumerate(series):
                values.append(_parse_value(row[i + 1]) if i + 1 < len(row) else None)
        if dates:
            return {
                "dates": dates,
                "series": [{**_split_header(h), "values": v} for h, v in zip(header[1:], series)],
            }
    return None


def _load_fruit(path):
    timeline = _load_timeline(path)
    if not timeline:
        return None
    ranked = []
    for s in timeline["series"]:
        values = [v for v in s["values"] if isinstance(v, (int, float))]
        ranked.append({"term": s["term"], "region": s["region"],
                       "average": round(sum(values) / len(values), 1) if values else None})
    ranked.sort(key=lambda r: -1 if r["average"] is None else r["average"], reverse=True)
    return {"period": [timeline["dates"][0], timeline["dates"][-1]], "terms": ranked}


def _load_seasonality(path):
    timeline = _load_timeline(path)
    if not timeline:
        return None
    terms = []
    for s in timeline["series"]:
        by_month = [[] for _ in range(12)]
        for day, value in zip(timeline["dates"], s["values"]):
            if isinstance(value, (int, float)):
                by_month[int(day[5:7]) - 1].append(value)
        monthly = [round(sum(v) / len(v), 1) if v else None for v in by_month]
        known = [m for m in monthly if m is not None]
        peak = monthly.index(max(known)) + 1 if known else None
        terms.append({"term": s["term"], "region": s["region"], "monthly": monthly, "peak_month": peak})
    return {"period": [timeline["dates"][0][:7], timeline["dates"][-1][:7]], "terms": terms}


def _load_geo(path):
    for label, rows in _trends_sections(path):
        if label or len(rows) < 2:
            continue
        header, body = rows[0], rows[1:]
        regions = [
            {"region": row[0].strip(), "value": _parse_value(row[1])}
            for row in body if len(row) > 1 and row[0].strip()
        ]
        regions = [r for r in regions if isinstance(r["value"], (int, float))]
        regions.sort(key=lambda r: r["value"], reverse=True)
        if regions:
            return {**_split_header(header[1]), "regions": regions}
    return None


def _load_rising(path):
    labeled = [(label, rows) for label, rows in _trends_sections(path) if label]
    rising = next((rows for label, rows in labeled if label.upper() in _RISING_LABELS), None)
    if rising is None and len(labeled) >= 2:
        rising = labeled[1][1]  # 구간 제목을 못 알아보면 Trends 기본 순서(TOP → RISING)를 따릅니다
    if not rising:
        return None
    return [{"query": r[0].strip(), "value": r[1].strip()} for r in rising if len(r) > 1 and r[0].strip()][:10]


def _trends_sections(path):
    """Trends CSV를 빈 줄 기준 구간으로 나눕니다. 한 칸짜리 첫 줄(TOP·RISING 등)은 구간 제목으로 봅니다."""
    text = _read_text(path)
    if text is None:
        return []
    blocks, block = [], []
    for line in text.splitlines():
        if line.strip():
            block.append(line)
        elif block:
            blocks.append(block)
            block = []
    if block:
        blocks.append(block)
    sections = []
    for block in blocks:
        rows = list(csv.reader(block))
        label = ""
        if len(rows[0]) == 1:
            label, rows = rows[0][0].strip(), rows[1:]
        if rows:
            sections.append((label, rows))
    return sections


def _split_header(header):
    # "bánh mochi: (Vietnam)" → 검색어 + 지역(또는 기간)
    match = _HEADER_RE.match(header.strip())
    if match:
        return {"term": match.group(1).strip(), "region": match.group(2).strip()}
    return {"term": header.strip(), "region": ""}


def _parse_date(text):
    match = _DATE_RE.match(text.strip())
    if not match:
        return None
    year, month, day = match.groups()
    return f"{year}-{month}-{day or '01'}"


def _parse_value(text):
    text = text.strip()
    if not text:
        return None
    if text == "<1":
        return 0  # Trends는 1 미만을 "<1"로 줍니다. 크기 비교에서는 0으로 봅니다.
    try:
        return float(text) if "." in text else int(text)
    except ValueError:
        return text  # 급상승의 "Breakout"·"+250%" 등은 글자 그대로 둡니다


# ---------- 경쟁사 (수동 조사 CSV) ----------

def _load_competitors(country):
    research = _load_competitor_research(country)
    if research is not None:
        return research
    catalog = _load_competitor_catalog(country)
    if catalog is not None:
        return catalog

    path = _DATA_DIR / f"competitors_{country.lower()}.csv"
    result = {
        "file": f"market_analysis/data/competitors_{country.lower()}.csv",
        "columns": COMPETITOR_COLUMNS,
        "marketing_labels": COMPETITOR_MARKETING,
        "as_of": None,
        "items": [],
    }
    text = _read_text(path)
    if not text:
        return result
    grouped = {}
    for raw in csv.DictReader(io.StringIO(text)):
        row = {(k or "").strip(): (v or "").strip() for k, v in raw.items() if k}
        if not row.get("brand") and not row.get("product"):
            continue
        grouped.setdefault((row.get("brand", ""), row.get("product", "")), []).append(row)

    items = []
    for rows in grouped.values():
        # 같은 제품을 여러 달 조사하면 조사일 순으로 쌓아 월별 판매 추이로 씁니다
        rows.sort(key=lambda r: r.get("surveyed_at", ""))
        latest = rows[-1]
        price, pack = _number(latest.get("price_vnd")), _number(latest.get("pack_count"))
        items.append({
            **{col: latest.get(col, "") for col in COMPETITOR_COLUMNS},
            "pack_count": pack,
            "unit_weight_g": _number(latest.get("unit_weight_g")),
            "price_vnd": price,
            "unit_price_vnd": round(price / pack) if price and pack else None,
            "monthly_sales": _number(latest.get("monthly_sales")),
            "is_core": latest.get("is_core", "").upper() in {"Y", "YES", "1", "TRUE", "O", "★"},
            "history": [
                {"surveyed_at": r.get("surveyed_at", ""), "monthly_sales": _number(r.get("monthly_sales"))}
                for r in rows if r.get("surveyed_at")
            ],
        })
    result["items"] = items
    result["as_of"] = max((i["surveyed_at"] for i in items if i["surveyed_at"]), default=None)
    return result


def _load_competitor_catalog(country):
    """제품과 판매처를 분리한 정규화 CSV를 화면 계약으로 변환한다."""
    code = country.lower()
    product_path = _DATA_DIR / f"competitor_products_{code}.csv"
    listing_path = _DATA_DIR / f"competitor_listings_{code}.csv"
    product_text, listing_text = _read_text(product_path), _read_text(listing_path)
    if not product_text or not listing_text:
        return None

    products = [
        {(key or "").strip(): (value or "").strip() for key, value in row.items() if key}
        for row in csv.DictReader(io.StringIO(product_text))
    ]
    listing_rows = [
        {(key or "").strip(): (value or "").strip() for key, value in row.items() if key}
        for row in csv.DictReader(io.StringIO(listing_text))
    ]
    grouped = {}
    for row in listing_rows:
        grouped.setdefault(row.get("product_id", ""), []).append(row)

    def evidence(rows):
        levels = {row.get("verification_level") for row in rows}
        if "direct_product_page" in levels:
            return "개별 상품 확인"
        if "indexed_product_page" in levels:
            return "색인 상품 확인"
        if "platform_search_page" in levels:
            return "검색 결과 확인"
        if "third_party_lazada_index" in levels:
            return "제3자 색인"
        if "historical_indexed_product_page" in levels:
            return "과거 자료"
        return "확인 필요"

    items = []
    for product in products:
        rows = grouped.get(product.get("product_id", ""), [])
        if not rows:
            continue
        prices = [_number(row.get("current_price_vnd")) for row in rows]
        prices = [value for value in prices if isinstance(value, (int, float))]
        maximums = [_number(row.get("price_max_vnd")) for row in rows]
        maximums = [value for value in maximums if isinstance(value, (int, float))]
        weight = _number(product.get("net_weight_g"))
        pack = _number(product.get("piece_count"))
        price_min = min(prices) if prices else None
        price_max = max(maximums or prices) if (maximums or prices) else None
        channels = sorted({row.get("platform") for row in rows if row.get("platform")})
        sellers = sorted({row.get("seller") for row in rows if row.get("seller")})
        checked = [row.get("checked_at") for row in rows if row.get("checked_at")]
        current_rows = [
            row for row in rows
            if row.get("verification_level") != "historical_indexed_product_page"
            and row.get("stock_status") not in {"sold_out", "shop_paused", "historical_listing"}
        ]
        observations = [row.get("marketing_observation") for row in rows if row.get("marketing_observation")]
        discounts = [_number(row.get("discount_percent")) for row in rows]
        discounts = [value for value in discounts if isinstance(value, (int, float))]
        image_path = product.get("image_path", "")
        item = {
            "product_id": product.get("product_id", ""),
            "brand": product.get("brand", ""),
            "product": product.get("product_name", ""),
            "segment": product.get("segment", ""),
            "origin": product.get("origin", ""),
            "pack_count": pack,
            "unit_weight_g": round(weight / pack, 1) if weight and pack else None,
            "net_weight_g": weight,
            "price_vnd": price_min,
            "price_min_vnd": price_min,
            "price_max_vnd": price_max,
            "price_per_100g_min": round(price_min / weight * 100) if price_min and weight else None,
            "price_per_100g_max": round(price_max / weight * 100) if price_max and weight else None,
            "monthly_sales": None,
            "channels": "; ".join(channels),
            "channel_count": len(channels),
            "seller_count": len(sellers),
            "listing_count": len(rows),
            "verified_listing_count": len(current_rows),
            "is_core": False,
            "region": "; ".join(sorted({row.get("seller_location") for row in rows if row.get("seller_location")})),
            "source_url": next((row.get("source_url") for row in current_rows if row.get("source_url")), rows[0].get("source_url", "")),
            "surveyed_at": max(checked, default=""),
            "promotion": f"최대 {round(max(discounts))}% 할인 확인" if discounts else "",
            "sns_influencer": "",
            "seasonal_limited": "",
            "packaging": f"{product.get('piece_count')}개입" if product.get("piece_count") else (f"{product.get('net_weight_g')}g" if product.get("net_weight_g") else ""),
            "key_message": observations[0] if observations else "",
            "sales_event": "",
            "review_keywords": "",
            "takeaway": f"{len(channels)}개 채널·{len(sellers)}개 판매자 확인. 동일 규격 가격과 최신 판매 여부를 함께 비교하세요.",
            "flavors": product.get("flavors", ""),
            "storage": product.get("storage", ""),
            "evidence_status": evidence(rows),
            "image_url": url_for("market_analysis.static", filename=image_path) if image_path else "",
            "image_source_url": product.get("image_source_url", ""),
            "image_status": product.get("image_status", ""),
            "history": [],
            "listings": [
                {
                    **row,
                    "current_price_vnd": _number(row.get("current_price_vnd")),
                    "price_max_vnd": _number(row.get("price_max_vnd")),
                    "regular_price_vnd": _number(row.get("regular_price_vnd")),
                    "discount_percent": _number(row.get("discount_percent")),
                    "product_rating": _number(row.get("product_rating")),
                    "review_count": _number(row.get("review_count")),
                    "sold_count": _number(row.get("sold_count")),
                }
                for row in rows
            ],
        }
        items.append(item)

    items.sort(key=lambda item: (item["brand"].lower(), item["product"].lower()))
    as_of = max((item["surveyed_at"] for item in items if item["surveyed_at"]), default=None)
    return {
        "file": f"market_analysis/data/competitor_products_{code}.csv",
        "listing_file": f"market_analysis/data/competitor_listings_{code}.csv",
        "columns": COMPETITOR_COLUMNS,
        "marketing_labels": COMPETITOR_MARKETING,
        "as_of": as_of,
        "items": items,
        "summary": {
            "product_count": len(items),
            "listing_count": len(listing_rows),
            "channel_count": len({row.get("platform") for row in listing_rows if row.get("platform")}),
            "priced_product_count": sum(item["price_min_vnd"] is not None for item in items),
            "imaged_product_count": sum(bool(item["image_url"]) for item in items),
        },
    }


# 재조사 결과(build_competitor_research.py)는 현재 베트남만 있습니다
_RESEARCH_GLOB = {"VN": "research_*"}
# 우선 검토 경쟁자: 조사 요약(competitor_research_summary.md 5장)의 판단을 화면에 그대로 옮깁니다
_PRIORITY = [
    ("CP051", "다낭 Vincom·호이안에 매장이 확인된 유일한 경쟁자. 낱개부터 18개입 선물상자까지 같은 개당 가격대"),
    ("CP001", "슈퍼마켓·유아용품점·식품점에 가장 넓게 깔린 대만 포장 모찌. 소비자가 떠올리는 기준 가격"),
    ("CP021", "일본산 상온 포장 모찌. '한국 정통 찹쌀떡'으로 차별화할 때의 비교 기준"),
    ("CP048", "일본 선물상자 24개입. 추석·설 대량 선물 수요를 겨냥"),
    ("CP037", "모찌 아이스크림 대표 제품. 냉동·과일 소 제품을 낼 때 직접 비교 대상"),
    ("CP045", "베트남 현지 냉장 '찍어 먹는 모찌'. SNS 유행 형태를 소포장으로 빠르게 제품화"),
]
_SEGMENT_ORDER = ["매장·베이커리 모찌", "일본 포장 모찌", "대만 포장 모찌", "기타 포장 모찌", "냉장·냉동 모찌",
                  "모찌 아이스크림", "선물세트", "대용량 크림 모찌(온라인)", "베트남 전통 찹쌀과자(인접)"]
_KO_FLAVORS = {"딸기": "strawberry", "망고": "mango", "두리안": "durian", "코코넛": "coconut", "바나나": "banana",
               "패션프루트": "passion fruit", "자몽": "pomelo", "잭프루트": "jackfruit", "람부탄": "rambutan", "용과": "dragon fruit"}
# 의사결정 카드(decision_cards.CHANNEL_GROUPS)가 알아보는 판매처 이름으로 맞춥니다
_CARD_PLATFORM = {"Sakuko Store": "Sakuko", "Farmers Market": "Farmers Market"}


def _research_folder(country):
    pattern = _RESEARCH_GLOB.get(country)
    folders = sorted(path for path in _DATA_DIR.glob(pattern) if path.is_dir()) if pattern else []
    return folders[-1] if folders else None


def _csv_rows(path):
    text = _read_text(path)
    if not text:
        return []
    return [{(k or "").strip(): (v or "").strip() for k, v in row.items() if k} for row in csv.DictReader(io.StringIO(text))]


def _research_segment(product):
    kind, origin, pid = product.get("product_type", ""), product.get("origin_country", ""), product.get("product_id", "")
    if "아이스크림" in kind:
        return "모찌 아이스크림"
    if pid in ("CP051", "CP052"):
        return "매장·베이커리 모찌"
    if "선물" in kind:
        return "선물세트"
    if product.get("competition_level") == "인접 경쟁":
        return "베트남 전통 찹쌀과자(인접)"
    if "대용량" in kind or pid.startswith("CS"):
        return "대용량 크림 모찌(온라인)"
    if "냉장" in kind or "냉동" in kind:
        return "냉장·냉동 모찌"
    if origin.startswith("대만"):
        return "대만 포장 모찌"
    if origin.startswith("일본"):
        return "일본 포장 모찌"
    return "기타 포장 모찌"


def _research_flavors(product):
    """의사결정 카드의 과일 이름(영어·베트남어) 표기로 바꿉니다."""
    from .services.decision_cards import FLAVOR_ALIASES

    text = f"{product.get('product_name_local', '')} {product.get('flavor_filling', '')}".lower()
    found = {_KO_FLAVORS[ko] for ko in _KO_FLAVORS if ko in text}
    for fruit, aliases in FLAVOR_ALIASES.items():
        if any(re.search(rf"(?<!\w){re.escape(alias)}(?!\w)", text) for alias in aliases[1:]):
            found.add(aliases[0])
    return ", ".join(sorted(found))


def _spread(values):
    values = [v for v in values if isinstance(v, (int, float))]
    if not values:
        return None
    return {"min": min(values), "median": round(_median(values)), "max": max(values), "count": len(values)}


def _median(values):
    ordered = sorted(values)
    middle = len(ordered) // 2
    return ordered[middle] if len(ordered) % 2 else (ordered[middle - 1] + ordered[middle]) / 2


def _load_competitor_research(country):
    """재조사 결과 폴더를 경쟁사 탭 화면 데이터로 바꿉니다. 사진은 사용권 미확보로 넘기지 않습니다."""
    folder = _research_folder(country)
    if folder is None:
        return None
    products = _csv_rows(folder / "competitor_products.csv")
    listing_rows = _csv_rows(folder / "competitor_listings.csv")
    if not products or not listing_rows:
        return None
    marketing_rows = _csv_rows(folder / "competitor_marketing_evidence.csv")
    review_rows = _csv_rows(folder / "competitor_review_queue.csv")
    exclusion_rows = _csv_rows(folder / "competitor_exclusions.csv")
    priority = dict(_PRIORITY)
    rel = folder.relative_to(_DATA_DIR.parent.parent).as_posix()

    grouped = {}
    for row in listing_rows:
        grouped.setdefault(row.get("product_id", ""), []).append({
            "listing_id": row.get("listing_id", ""), "seller": row.get("seller", ""), "channel": row.get("sales_channel", ""),
            "region": row.get("sales_region", ""), "sku": row.get("sku_option", ""), "option": row.get("option_name", ""),
            "current_price_vnd": _number(row.get("current_price")), "regular_price_vnd": _number(row.get("regular_price")),
            "price_per_100g": _number(row.get("price_per_100g")), "price_per_piece": _number(row.get("price_per_piece")),
            "pack_count": _number(row.get("pack_count_used")), "net_weight_g": _number(row.get("net_weight_g_used")),
            "price_condition": row.get("price_condition", ""), "shipping_fee": row.get("shipping_fee", ""),
            "stock_status": row.get("stock_status", ""), "status_evidence": row.get("status_evidence", ""),
            "source_url": row.get("product_url", ""), "checked_at": row.get("checked_at", ""), "notes": row.get("notes", ""),
            "platform": next((v for k, v in _CARD_PLATFORM.items() if k == row.get("seller")),
                             "TikTok Shop" if "TikTok" in row.get("seller", "") else row.get("seller", "")),
        })
    evidence_by_product = {}
    for row in marketing_rows:
        evidence_by_product.setdefault(row.get("product_id", ""), []).append(row)

    items = []
    for product in products:
        pid = product.get("product_id", "")
        listings = grouped.get(pid, [])
        if not listings:
            continue
        prices = [l["current_price_vnd"] for l in listings if l["current_price_vnd"]]
        per100 = [l["price_per_100g"] for l in listings if l["price_per_100g"]]
        per_piece = [l["price_per_piece"] for l in listings if l["price_per_piece"]]
        packs = {l["pack_count"] for l in listings if l["pack_count"]}
        weights = {l["net_weight_g"] for l in listings if l["net_weight_g"]}
        storage_text = product.get("storage", "")
        evidence = evidence_by_product.get(pid, [])
        items.append({
            "product_id": pid, "brand": product.get("brand", ""), "product": product.get("product_name_local", ""),
            "product_ko": product.get("product_name_ko", ""), "segment": _research_segment(product),
            "competition_level": product.get("competition_level", ""), "reason": product.get("inclusion_reason", ""),
            "product_type": product.get("product_type", ""), "flavor_ko": product.get("flavor_filling", ""),
            "flavors": _research_flavors(product), "origin": product.get("origin_country", ""),
            "maker": product.get("maker_importer", ""), "sku_options": product.get("sku_options", ""),
            "storage_label": storage_text,
            "storage": "frozen" if ("냉동" in storage_text or "냉장" in storage_text) else ("dry" if "상온" in storage_text else ""),
            "pack_count": packs.pop() if len(packs) == 1 else None,
            "net_weight_g": weights.pop() if len(weights) == 1 else None,
            "price_vnd": min(prices) if prices else None, "price_min_vnd": min(prices) if prices else None,
            "price_max_vnd": max(prices) if prices else None,
            "price_per_100g_min": min(per100) if per100 else None, "price_per_100g_max": max(per100) if per100 else None,
            "price_per_piece_min": min(per_piece) if per_piece else None, "price_per_piece_max": max(per_piece) if per_piece else None,
            "seller_count": len({l["seller"] for l in listings}), "channel_count": len({l["seller"] for l in listings}),
            "listing_count": len(listings), "channels": "; ".join(sorted({l["seller"] for l in listings})),
            "surveyed_at": max(l["checked_at"] for l in listings)[:10],
            "is_core": pid in priority, "takeaway": priority.get(pid, ""),
            "key_message": evidence[0]["observation"] if evidence else "",
            "classification_note": product.get("classification_note", ""),
            "monthly_sales": None, "history": [], "listings": listings,
            "marketing": [{k: row.get(k, "") for k in ("evidence_type", "observation", "interpretation", "unverified",
                                                       "source_url", "posted_at", "seller")} for row in evidence],
        })
    items.sort(key=lambda i: (_SEGMENT_ORDER.index(i["segment"]), i["brand"].lower(), i["product"].lower()))
    as_of = max((i["surveyed_at"] for i in items), default=None)

    # 의사결정 카드는 '제품 하나 = 중량 하나'를 전제로 100g당 가격을 계산하므로 중량별로 나눕니다.
    # 맛 개수가 부풀지 않도록 맛은 첫 묶음에만 둡니다.
    card_items = []
    for item in items:
        by_weight = {}
        for listing in item["listings"]:
            by_weight.setdefault(listing["net_weight_g"], []).append(listing)
        for index, (weight, rows) in enumerate(by_weight.items()):
            card_items.append({**item, "net_weight_g": weight, "listings": rows, "flavors": item["flavors"] if index == 0 else ""})

    segments = []
    for name in _SEGMENT_ORDER:
        members = [i for i in items if i["segment"] == name]
        if not members:
            continue
        listings = [l for i in members for l in i["listings"]]
        segments.append({"name": name, "product_count": len(members), "listing_count": len(listings),
                         "per100": _spread([l["price_per_100g"] for l in listings]),
                         "per_piece": _spread([l["price_per_piece"] for l in listings]),
                         "price": _spread([l["current_price_vnd"] for l in listings])})

    by_id = {i["product_id"]: i for i in items}
    priority_cards = []
    for pid, why in _PRIORITY:
        item = by_id.get(pid)
        if not item:
            continue
        family = [i for i in items if i["brand"] == item["brand"]]
        listings = [l for i in family for l in i["listings"]]
        priority_cards.append({
            "product_id": pid, "brand": item["brand"], "product_ko": item["product_ko"], "segment": item["segment"], "why": why,
            "product_count": len(family), "seller_count": len({l["seller"] for l in listings}),
            "per100": _spread([l["price_per_100g"] for l in listings]), "per_piece": _spread([l["price_per_piece"] for l in listings]),
            "price": _spread([l["current_price_vnd"] for l in listings]),
        })

    gifts = sorted(
        ({"product_id": i["product_id"], "brand": i["brand"], "product_ko": i["product_ko"], "segment": i["segment"],
          "seller": l["seller"], "option": l["option"] or l["sku"], "pack_count": l["pack_count"], "price": l["current_price_vnd"],
          "per_piece": l["price_per_piece"], "source_url": l["source_url"]}
         for i in items for l in i["listings"] if l["pack_count"] and l["pack_count"] >= 3),
        key=lambda g: (g["pack_count"], g["price"] or 0))

    spreads = []
    for item in items:
        by_sku = {}
        for listing in item["listings"]:
            if listing["current_price_vnd"] and listing["net_weight_g"]:
                by_sku.setdefault(listing["net_weight_g"], []).append(listing)
        for weight, rows in by_sku.items():
            sellers = {l["seller"] for l in rows}
            if len(sellers) < 2:
                continue
            low = min(rows, key=lambda l: l["current_price_vnd"])
            high = max(rows, key=lambda l: l["current_price_vnd"])
            spreads.append({"product_id": item["product_id"], "brand": item["brand"], "product_ko": item["product_ko"],
                            "weight": weight, "low": low["current_price_vnd"], "low_seller": low["seller"],
                            "high": high["current_price_vnd"], "high_seller": high["seller"], "seller_count": len(sellers),
                            "gap_pct": round((high["current_price_vnd"] - low["current_price_vnd"]) / low["current_price_vnd"] * 100)})
    spreads.sort(key=lambda s: -s["gap_pct"])

    review_types = {}
    for row in review_rows:
        review_types[row.get("queue_type", "")] = review_types.get(row.get("queue_type", ""), 0) + 1
    marketplace = sum(1 for row in review_rows if row.get("seller") in ("Shopee", "Lazada") and "검색어: " in row.get("reason", ""))
    per100_all = [l["price_per_100g"] for i in items for l in i["listings"] if l["price_per_100g"]]
    return {
        "source": "research",
        "file": f"{rel}/competitor_products.csv",
        "listing_file": f"{rel}/competitor_listings.csv",
        "summary_file": f"{rel}/competitor_research_summary.md",
        "columns": COMPETITOR_COLUMNS,
        "marketing_labels": COMPETITOR_MARKETING,
        "as_of": as_of,
        "items": items,
        "card_items": card_items,
        "segments": segments,
        "priority": priority_cards,
        "gifts": gifts,
        "spreads": spreads,
        "marketing": [{**row, "brand": row.get("brand", "")} for row in marketing_rows],
        "summary": {
            "product_count": len(items),
            "direct_count": sum(i["competition_level"] == "직접 경쟁" for i in items),
            "adjacent_count": len(items) - sum(i["competition_level"] == "직접 경쟁" for i in items),
            "listing_count": len(listing_rows),
            "seller_count": len({row.get("seller") for row in listing_rows}),
            "channel_count": len({row.get("seller") for row in listing_rows}),
            # '다낭 배송 여부 미확인' 같은 문구와 구분해, 매장 목록에 다낭이 있는 판매처만 셉니다
            "danang_store_brands": sorted({i["brand"] for i in items for l in i["listings"]
                                           if l["region"].startswith("매장:") and "다낭" in l["region"]}),
            "per100_median": round(_median(per100_all)) if per100_all else None,
            "priced_product_count": sum(i["price_min_vnd"] is not None for i in items),
            "imaged_product_count": 0,
            "review_total": len(review_rows), "review_types": review_types, "marketplace_candidates": marketplace,
            "excluded_total": len(exclusion_rows),
        },
    }


def _number(text):
    if not text:
        return None
    cleaned = re.sub(r"[^\d.\-]", "", text)
    try:
        value = float(cleaned)
    except ValueError:
        return None
    return int(value) if value.is_integer() else value


# ---------- 국가 · 문화 ----------

def _load_culture(country):
    path = _DATA_DIR / f"country_{country.lower()}.json"
    try:
        with path.open(encoding="utf-8") as f:
            basic = json.load(f)
    except (OSError, ValueError):
        basic = None
    return {
        "basic_file": f"market_analysis/data/country_{country.lower()}.json",
        "basic": basic,
        "guidelines_file": f"market_analysis/data/content_guidelines_{country.lower()}.json",
        "guidelines": get_content_guidelines(country),
    }


# ---------- AI 인사이트 탭: 데이터 준비 상태 ----------

def _readiness(country, trend, competitors, culture):
    guidelines = culture["guidelines"] or {}
    trend_files = (
        [c["timeline"] for c in trend["categories"]] + [c["rising"] for c in trend["categories"]]
        + [trend["fruit"]] + trend["seasonality"] + trend["geo"]
    )
    has_guidelines = any(guidelines.get(k) for k in ("avoid_expressions", "visual_cautions", "prompt_rules"))
    return [
        {"label": "트렌드 (Google Trends CSV)", "ready": sum(1 for f in trend_files if f["data"]),
         "total": len(trend_files), "where": trend["folder"]},
        {"label": "경쟁 제품 조사표", "ready": len(competitors["items"]), "total": None,
         "where": competitors["file"]},
        {"label": "국가 기본 정보 (World Bank)", "ready": 1 if culture["basic"] else 0, "total": 1,
         "where": culture["basic_file"]},
        {"label": "문화 · 금기 · 컬러 가이드라인", "ready": 1 if has_guidelines else 0, "total": 1,
         "where": culture["guidelines_file"]},
    ]


# ---------- 공통 ----------

def _read_text(path):
    try:
        raw = path.read_bytes()
    except OSError:
        return None
    # 엑셀에서 저장하면 UTF-8(BOM) 또는 CP949로 저장되므로 둘 다 받습니다
    for encoding in ("utf-8-sig", "cp949"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return None


def _file_date(path):
    try:
        return date.fromtimestamp(path.stat().st_mtime).isoformat()
    except OSError:
        return None


def _safe(loader, path):
    # 파일 하나가 깨져도 화면 전체가 멈추지 않도록, 읽기 실패는 "수집 전"과 같게 처리합니다
    if not path.exists():
        return None
    try:
        return loader(path)
    except (csv.Error, ValueError, IndexError, OSError):
        return None


@bp.get('/api/countries/<country_code>/trends')
def trends_api(country_code):
    from .repositories.trend_repository import TrendRepository
    from .services.trend_service import TrendService
    if country_code.upper() != 'VN':
        return jsonify(error='현재 트렌드 분석은 베트남만 지원합니다.'), 404
    try:
        payload = TrendService(TrendRepository()).get_dashboard('VN')
    except (ValueError, KeyError, TypeError, OSError):
        return jsonify(error='트렌드 데이터를 읽지 못했습니다. 데이터 담당자에게 문의해 주세요.'), 503
    return jsonify(payload)
