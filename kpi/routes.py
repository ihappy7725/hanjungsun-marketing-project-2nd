"""KPI 화면·API. [민지]

API는 /kpi/api/... 아래에만 추가합니다. 다른 기능 데이터는 그 기능의 public.py로만 읽습니다. (README 8장)
공식은 README 9장 "광고비·예산 계산 공식 (민지 제안 · 확정 전)"을 따릅니다.
외부 API 값이 없거나 실패하면 0이나 만든 값으로 바꾸지 않고 None과 오류 안내를 돌려줍니다.
"""
import csv
import datetime
import email.utils
import json
import os
import time
import urllib.error
import urllib.request

from flask import jsonify, render_template

from . import bp

# ---------------------------------------------------------------------------
# 시연 데이터 (DEMO · 예시 데이터) — CSV 업로드(2단계) 전까지 화면 확인용
# ---------------------------------------------------------------------------

DEMO_BUDGET = {
    "campaign_month": "2026-10",
    "total_budget_krw": 30_000_000,
    "base_exchange_rate": 5.40,  # 예산 편성 시점, 100 VND당 KRW
    # 인플루언서 협찬비: 인플루언서 탭과 예상·실제 지출 기준이 확정되기 전(README 8장)까지 시연 값을 씁니다.
    "influencer_paid_vnd": 60_000_000,
    "influencer_expected_vnd": 45_000_000,
}

# 채널별 10월 누적 (kpi_ad_performance_daily를 채널로 합친 모양)
DEMO_CHANNELS = [
    {"channel": "Meta", "label": "Meta", "ad_spend_vnd": 110_000_000, "sales_revenue_vnd": 385_000_000,
     "conversions": 1_420, "landing_clicks": 18_600},
    {"channel": "TikTok", "label": "TikTok", "ad_spend_vnd": 140_000_000, "sales_revenue_vnd": 574_000_000,
     "conversions": 2_050, "landing_clicks": 26_300},
    {"channel": "Shopee_Ads", "label": "Shopee Ads", "ad_spend_vnd": 80_000_000, "sales_revenue_vnd": 196_000_000,
     "conversions": 860, "landing_clicks": 9_400},
    {"channel": "Influencer", "label": "인플루언서", "ad_spend_vnd": 60_000_000, "sales_revenue_vnd": 168_000_000,
     "conversions": 610, "landing_clicks": 7_900},
]

# GA4 시연 값. kpi/data/ga4_demo.csv(GA4 공식 데모 계정 내보내기)가 있으면 세션·참여 세션은 그 파일 값을 씁니다.
# 쇼피 이동 클릭·팜플렛 QR 유입은 한정선 사이트에만 있는 값이라 데모 계정에 없어 항상 시연 값입니다.
DEMO_GA4 = {"sessions": 12_400, "engaged_sessions": 5_890, "shopee_clicks": 1_540, "pamphlet_sessions": 1_180}
GA4_DEMO_CSV = os.path.join(os.path.dirname(__file__), "data", "ga4_demo.csv")

DEMO_CREATORS = [
    {"creator": "@danang.foodie", "platform": "TikTok", "clicks": 3_120, "conversions": 248},
    {"creator": "@banhngot.review", "platform": "Instagram", "clicks": 2_460, "conversions": 191},
    {"creator": "@hanquoc.daily", "platform": "TikTok", "clicks": 1_980, "conversions": 133},
    {"creator": "@mevabe.dn", "platform": "Instagram", "clicks": 1_210, "conversions": 87},
    {"creator": "@quatang.tet", "platform": "YouTube", "clicks": 890, "conversions": 52},
]

SENTIMENTS = ("Positive", "Neutral", "Negative")
KEYWORD_TAGS = ("당도/맛", "냉장배송/포장", "가격", "선물용", "기타")

DEMO_REVIEWS = [
    {"review_id": "demo_voc_01", "platform": "Shopee_VN",
     "raw_text_vn": "Bánh mochi dâu rất tươi, vị ngọt vừa phải, cả nhà đều thích.",
     "translated_kr": "딸기 찹쌀떡이 아주 신선하고 단맛이 적당해서 가족 모두 좋아해요.",
     "sentiment": "Positive", "keyword_tag": "당도/맛"},
    {"review_id": "demo_voc_02", "platform": "Shopee_VN",
     "raw_text_vn": "Trời nóng quá nên khi nhận hàng phần kem bên trong hơi bị chảy.",
     "translated_kr": "날씨가 너무 더워서 받았을 때 안쪽 크림이 조금 녹아 있었어요.",
     "sentiment": "Negative", "keyword_tag": "냉장배송/포장"},
    {"review_id": "demo_voc_03", "platform": "Instagram",
     "raw_text_vn": "Hộp quà gói bằng vải bojagi nhìn sang trọng, rất hợp để biếu tặng.",
     "translated_kr": "보자기로 싼 선물 상자가 고급스러워 보여서 선물하기 딱 좋아요.",
     "sentiment": "Positive", "keyword_tag": "선물용"},
    {"review_id": "demo_voc_04", "platform": "TikTok",
     "raw_text_vn": "Giá hơi cao so với bánh mochi bình thường, nhưng chất lượng tốt.",
     "translated_kr": "일반 찹쌀떡보다 가격이 조금 비싸지만 품질은 좋아요.",
     "sentiment": "Neutral", "keyword_tag": "가격"},
    {"review_id": "demo_voc_05", "platform": "Shopee_VN",
     "raw_text_vn": "Vỏ bánh dẻo mềm, nhân xoài thơm, sẽ mua lại.",
     "translated_kr": "떡피가 쫀득하고 부드럽고 망고 소가 향긋해요. 재구매할게요.",
     "sentiment": "Positive", "keyword_tag": "당도/맛"},
    {"review_id": "demo_voc_06", "platform": "Instagram",
     "raw_text_vn": "Giao hàng đến Đà Nẵng mất 3 ngày, đá khô đã tan hết.",
     "translated_kr": "다낭까지 배송이 3일 걸려서 드라이아이스가 다 녹았어요.",
     "sentiment": "Negative", "keyword_tag": "냉장배송/포장"},
    {"review_id": "demo_voc_07", "platform": "TikTok",
     "raw_text_vn": "Mình mua làm quà Tết cho sếp, ai cũng khen đẹp.",
     "translated_kr": "상사에게 뗏(설) 선물로 샀는데 다들 예쁘다고 칭찬했어요.",
     "sentiment": "Positive", "keyword_tag": "선물용"},
    {"review_id": "demo_voc_08", "platform": "Shopee_VN",
     "raw_text_vn": "Vị sầu riêng hơi gắt, không hợp khẩu vị của mình.",
     "translated_kr": "두리안 맛이 좀 강해서 제 입맛에는 안 맞았어요.",
     "sentiment": "Negative", "keyword_tag": "당도/맛"},
    {"review_id": "demo_voc_09", "platform": "Instagram",
     "raw_text_vn": "Bánh ăn được, không có gì đặc biệt lắm.",
     "translated_kr": "먹을 만하지만 특별한 건 없어요.",
     "sentiment": "Neutral", "keyword_tag": "당도/맛"},
    {"review_id": "demo_voc_10", "platform": "TikTok",
     "raw_text_vn": "Mong có hộp nhỏ 4 cái để giá mềm hơn.",
     "translated_kr": "4개짜리 작은 상자가 나와서 가격이 좀 더 부담 없었으면 좋겠어요.",
     "sentiment": "Neutral", "keyword_tag": "가격"},
    # Zalo_OA: 제품 팜플렛 QR → 한정선 Zalo 공식 계정 1:1 문의 (한국 본사 카카오톡 채널 CS의 베트남 현지화)
    {"review_id": "demo_voc_11", "platform": "Zalo_OA",
     "raw_text_vn": "Hộp giữ lạnh tốt, bánh vẫn mềm khi về đến nhà ở Đà Nẵng.",
     "translated_kr": "보냉 상자가 좋아서 다낭 집에 도착했을 때도 떡이 말랑했어요.",
     "sentiment": "Positive", "keyword_tag": "냉장배송/포장"},
    {"review_id": "demo_voc_12", "platform": "Zalo_OA",
     "raw_text_vn": "Cho mình hỏi bánh để tủ lạnh được mấy ngày?",
     "translated_kr": "냉장고에 며칠 보관할 수 있나요?",
     "sentiment": "Neutral", "keyword_tag": "기타"},
    {"review_id": "demo_voc_13", "platform": "Zalo_OA",
     "raw_text_vn": "Hộp bị móp một góc khi giao, mong shop đóng gói kỹ hơn.",
     "translated_kr": "배송 중에 상자 한쪽이 찌그러졌어요. 포장을 더 꼼꼼히 해 주세요.",
     "sentiment": "Negative", "keyword_tag": "냉장배송/포장"},
]

# 팜플렛 QR 흐름과 QR 설문 만족도 (5점 만점) — 시연 값
DEMO_QR = {"pamphlets": 2_000, "qr_scans": 1_240, "zalo_follows": 410, "survey_responses": 186}
DEMO_SURVEY = [
    {"item": "맛", "score": 4.5},
    {"item": "포장", "score": 3.6},
    {"item": "배송", "score": 3.8},
]

FX_STALE_DAYS = 7  # 환율 기준일이 이보다 오래되면 화면에 주의 표시

ROAS_BEP_PERCENT = 300  # 손익분기 기준선 (README 9장)

# ---------------------------------------------------------------------------
# 환율 — 한국은행 ECOS Open API (ECOS_API_KEY, 일별 고시). 단위는 100 VND당 KRW로 맞춥니다.
# 키가 없거나 ECOS 호출이 실패하면 open.er-api.com(키 없음)을 "대체 출처"로 표시해 씁니다.
# 키는 URL 경로에 들어가므로 오류 안내에 URL·예외 메시지를 넣지 않습니다.
# ---------------------------------------------------------------------------

ECOS_BASE = "https://ecos.bok.or.kr/api"
# 원/베트남 동이 있을 것으로 보는 일별 환율 통계표. 앞에서부터 찾아 "베트남" 항목이 있는 표를 씁니다.
ECOS_STAT_CODES = ("731Y001", "731Y002", "731Y003")
ECOS_LOOKBACK_DAYS = 14  # 주말·공휴일이면 직전 영업일 값을 씁니다.
FALLBACK_FX_URL = "https://open.er-api.com/v6/latest/VND"
FX_CACHE_SECONDS = 60 * 60
_fx_cache = {"fetched_at": 0.0, "data": None}
_ecos_item_cache = {"item": None}


def _get_json(url, timeout=8):
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _ecos_rows(payload, service):
    """ECOS 응답에서 row 목록을 꺼냅니다. 데이터 없음(INFO-200)은 빈 목록, 그 밖의 오류는 ValueError."""
    if service in payload:
        return payload[service].get("row") or []
    result = payload.get("RESULT") or {}
    if result.get("CODE") == "INFO-200":
        return []
    raise ValueError(result.get("CODE") or "ECOS_UNKNOWN")


def _find_ecos_vnd_item(api_key):
    if _ecos_item_cache["item"]:
        return _ecos_item_cache["item"]
    for stat_code in ECOS_STAT_CODES:
        url = f"{ECOS_BASE}/StatisticItemList/{api_key}/json/kr/1/500/{stat_code}"
        for row in _ecos_rows(_get_json(url), "StatisticItemList"):
            if "베트남" in (row.get("ITEM_NAME") or "") and (row.get("CYCLE") or "D") == "D":
                item = {
                    "stat_code": stat_code,
                    "stat_name": row.get("STAT_NAME") or "",
                    "item_code": row.get("ITEM_CODE"),
                    "item_name": row.get("ITEM_NAME") or "",
                    "unit_name": row.get("UNIT_NAME") or "",
                }
                _ecos_item_cache["item"] = item
                return item
    raise LookupError("ECOS_VND_ITEM_NOT_FOUND")


def _to_rate_per_100_vnd(value, item):
    """ECOS 값이 1동당 원이면 100을 곱합니다. (100동당 원 ≈ 5원 수준, 1동당 원 ≈ 0.05원 수준)"""
    per_100 = "100" in item["item_name"] or "100" in item["unit_name"]
    if not per_100 and value < 1:
        value *= 100
    return round(value, 4)


def _fetch_ecos_rate(api_key):
    item = _find_ecos_vnd_item(api_key)
    end = time.localtime()
    start = time.localtime(time.time() - ECOS_LOOKBACK_DAYS * 86400)
    url = (
        f"{ECOS_BASE}/StatisticSearch/{api_key}/json/kr/1/100/{item['stat_code']}/D/"
        f"{time.strftime('%Y%m%d', start)}/{time.strftime('%Y%m%d', end)}/{item['item_code']}"
    )
    rows = [r for r in _ecos_rows(_get_json(url), "StatisticSearch") if r.get("DATA_VALUE") not in (None, "", "-")]
    if not rows:
        raise LookupError("ECOS_NO_RECENT_DATA")
    latest = max(rows, key=lambda r: r.get("TIME") or "")
    day = latest["TIME"]
    return {
        "ok": True,
        "rate_per_100_vnd": _to_rate_per_100_vnd(float(latest["DATA_VALUE"]), item),
        "updated_at": f"{day[:4]}-{day[4:6]}-{day[6:8]} 고시",
        "as_of": f"{day[:4]}-{day[4:6]}-{day[6:8]}",
        "source": "한국은행 ECOS",
        "source_detail": f"{item['stat_name']} · {item['item_name']}",
        "is_fallback": False,
    }


def _fetch_fallback_rate(reason):
    try:
        payload = _get_json(FALLBACK_FX_URL, timeout=5)
        if payload.get("result") != "success":
            raise ValueError(payload.get("error-type") or "unknown")
        krw_per_vnd = float(payload["rates"]["KRW"])
    except (urllib.error.URLError, TimeoutError, ValueError, KeyError, TypeError) as exc:
        return {"ok": False, "error": f"{reason} 대체 환율도 불러오지 못했습니다 ({exc.__class__.__name__})."}
    try:
        as_of = email.utils.parsedate_to_datetime(payload.get("time_last_update_utc", "")).date().isoformat()
    except (TypeError, ValueError):
        as_of = None
    return {
        "ok": True,
        "rate_per_100_vnd": round(krw_per_vnd * 100, 4),
        "updated_at": f"{as_of} 기준" if as_of else "",
        "as_of": as_of,
        "source": "open.er-api.com",
        "source_detail": reason,
        "is_fallback": True,
    }


def _fetch_exchange_rate():
    now = time.time()
    if _fx_cache["data"] and now - _fx_cache["fetched_at"] < FX_CACHE_SECONDS:
        return _fx_cache["data"]
    api_key = os.environ.get("ECOS_API_KEY", "").strip()
    if not api_key:
        data = _fetch_fallback_rate("ECOS_API_KEY가 없어 대체 출처를 씁니다.")
    else:
        try:
            data = _fetch_ecos_rate(api_key)
        except urllib.error.HTTPError as exc:
            data = _fetch_fallback_rate(f"ECOS 호출 실패(HTTP {exc.code})로 대체 출처를 씁니다.")
        except (urllib.error.URLError, TimeoutError) as exc:
            data = _fetch_fallback_rate(f"ECOS 서버에 연결하지 못해({exc.__class__.__name__}) 대체 출처를 씁니다.")
        except (ValueError, LookupError, KeyError, TypeError) as exc:
            code = exc.args[0] if exc.args and isinstance(exc.args[0], str) and exc.args[0].isupper() else exc.__class__.__name__
            data = _fetch_fallback_rate(f"ECOS 응답 오류({code})로 대체 출처를 씁니다.")
    if data.get("ok"):
        _fx_cache.update(fetched_at=now, data=data)
    return data


# ---------------------------------------------------------------------------
# 인플루언서 탭 — public.py로만 읽고, 실패해도 KPI 화면은 계속 보여 줍니다.
# ---------------------------------------------------------------------------


def _read_influencer_quotes():
    try:
        from influencer_marketing.public import get_quote_summary

        quotes = get_quote_summary(include_demo=True) or []
    except Exception as exc:  # 주인 탭 오류로 내 화면이 멈추지 않게 (README 10장)
        return {"ok": False, "error": f"인플루언서 단가를 불러오지 못했습니다 ({exc.__class__.__name__})"}
    counts = {"public": 0, "quote": 0, "contract": 0}
    for q in quotes:
        price_type = (q or {}).get("price_type")
        if price_type in counts:
            counts[price_type] += 1
    return {"ok": True, "total": len(quotes), "counts": counts}


# ---------------------------------------------------------------------------
# GA4 — 지금은 공식 데모 계정(Google Merchandise Store) CSV를 읽습니다.
# 한정선 GA4 속성 권한이 생기면 _read_ga4_demo_csv만 GA4 Data API 호출로 바꿉니다.
# (실연동에 필요한 것: 한정선 GA4 속성 보기 권한 · 서비스 계정 · GA4 Data API · 쇼피 이동은 '이탈 클릭' 이벤트)
# ---------------------------------------------------------------------------

GA4_COLUMNS = {
    "sessions": ("세션수", "세션", "Sessions"),
    "engaged_sessions": ("참여 세션수", "참여 세션", "Engaged sessions"),
    "purchases": ("거래", "구매", "Transactions", "Purchases", "Ecommerce purchases"),
}
GA4_DATE_KEYS = {"start": ("시작 날짜", "Start date"), "end": ("종료 날짜", "End date")}


def _ga4_number(text):
    text = (text or "").replace(",", "").replace("%", "").strip()
    try:
        return float(text)
    except ValueError:
        return None


def _ga4_date(text):
    text = (text or "").strip()
    return f"{text[:4]}-{text[4:6]}-{text[6:8]}" if len(text) == 8 and text.isdigit() else text


def _read_ga4_demo_csv(path=GA4_DEMO_CSV):
    """GA4 보고서 '내보내기 → CSV' 파일을 읽어 합계를 돌려줍니다. 파일이 없으면 None, 형식 오류는 ValueError."""
    if not os.path.exists(path):
        return None
    period = {}
    table = []
    with open(path, encoding="utf-8-sig", newline="") as f:
        for line in f:
            stripped = line.strip()
            if stripped.startswith("#"):
                key, _, value = stripped.lstrip("#").partition(":")
                for name, labels in GA4_DATE_KEYS.items():
                    if key.strip() in labels:
                        period[name] = _ga4_date(value)
                continue
            if not stripped:
                if table:
                    break  # 첫 번째 표만 읽습니다.
                continue
            table.append(line)
    rows = list(csv.reader(table))
    if len(rows) < 2:
        raise ValueError("GA4_CSV_EMPTY")
    header = [h.strip() for h in rows[0]]
    index = {}
    for field, labels in GA4_COLUMNS.items():
        for i, h in enumerate(header):
            if h in labels:
                index[field] = i
                break
    if "sessions" not in index:
        raise ValueError("GA4_CSV_NO_SESSIONS")

    data_rows = rows[1:]
    total_rows = [r for r in data_rows if r and any(t in r[0] for t in ("총계", "합계", "Total", "Grand total"))]
    use_rows = total_rows[:1] or data_rows
    totals = {}
    for field, i in index.items():
        values = [_ga4_number(r[i]) for r in use_rows if len(r) > i]
        values = [v for v in values if v is not None]
        totals[field] = round(sum(values)) if values else None
    return {"period": period, **totals}


def _build_ga4():
    """GA4 패널 값과 데이터 상태. CSV가 없거나 읽지 못하면 시연 값을 쓰고 이유를 함께 돌려줍니다."""
    ga4 = {
        "sessions": DEMO_GA4["sessions"],
        "engaged_sessions": DEMO_GA4["engaged_sessions"],
        "status": "demo",
        "source": "시연 값",
        "period": None,
        "scope": "가상 한정선 사이트",
        "note": "kpi/data/ga4_demo.csv가 없어 시연 값을 씁니다.",
        "purchase_rate_percent": None,
    }
    try:
        demo = _read_ga4_demo_csv()
    except (OSError, ValueError, csv.Error) as exc:
        code = exc.args[0] if exc.args and isinstance(exc.args[0], str) and exc.args[0].isupper() else exc.__class__.__name__
        demo = None
        ga4["note"] = f"GA4 데모 CSV를 읽지 못해({code}) 시연 값을 씁니다."
    if demo and demo.get("sessions"):
        ga4.update(
            sessions=demo["sessions"],
            engaged_sessions=demo.get("engaged_sessions"),
            status="public_demo",
            source="GA4 공식 데모 · Google Merchandise Store",
            period=demo["period"] or None,
            scope="글로벌 데모 (한정선 데이터 아님)",
            note="GA4 데이터 형식 검증용 공개 데모 데이터입니다.",
            purchase_rate_percent=_pct(demo["purchases"], demo["sessions"]) if demo.get("purchases") is not None else None,
        )
    ga4["engagement_rate_percent"] = (
        _pct(ga4["engaged_sessions"], ga4["sessions"]) if ga4["engaged_sessions"] is not None else None
    )
    # 쇼피 이동 클릭·팜플렛 QR 유입은 한정선 사이트 전용 이벤트라 항상 시연 값입니다.
    ga4["shopee_clicks"] = DEMO_GA4["shopee_clicks"]
    ga4["shopee_ctr_percent"] = _pct(DEMO_GA4["shopee_clicks"], DEMO_GA4["sessions"])
    ga4["pamphlet_sessions"] = DEMO_GA4["pamphlet_sessions"]
    return ga4


# ---------------------------------------------------------------------------
# 계산 (README 9장 공식)
# ---------------------------------------------------------------------------


def _pct(numerator, denominator):
    return round(numerator / denominator * 100, 1) if denominator else None


def _vnd_to_krw(vnd, rate_per_100_vnd):
    return round(vnd * rate_per_100_vnd / 100)


def _build_summary():
    budget = DEMO_BUDGET
    base_rate = budget["base_exchange_rate"]
    fx = _fetch_exchange_rate()
    live_rate = fx["rate_per_100_vnd"] if fx.get("ok") else None

    channels = []
    for c in DEMO_CHANNELS:
        channels.append({
            **c,
            "roas_percent": _pct(c["sales_revenue_vnd"], c["ad_spend_vnd"]),
            "cpa_vnd": round(c["ad_spend_vnd"] / c["conversions"]) if c["conversions"] else None,
        })
    total_spend_vnd = sum(c["ad_spend_vnd"] for c in DEMO_CHANNELS)
    total_revenue_vnd = sum(c["sales_revenue_vnd"] for c in DEMO_CHANNELS)
    platform_spend_vnd = sum(c["ad_spend_vnd"] for c in DEMO_CHANNELS if c["channel"] != "Influencer")

    # 예산은 KRW로 편성했으므로 VND 지출을 편성 시점 기준 환율로 환산해 비교합니다. (확정 전 안)
    platform_krw = _vnd_to_krw(platform_spend_vnd, base_rate)
    influencer_paid_krw = _vnd_to_krw(budget["influencer_paid_vnd"], base_rate)
    influencer_expected_krw = _vnd_to_krw(budget["influencer_expected_vnd"], base_rate)
    total_budget = budget["total_budget_krw"]
    remaining_krw = total_budget - (platform_krw + influencer_paid_krw + influencer_expected_krw)

    fx_block = {
        "ok": bool(fx.get("ok")),
        "error": fx.get("error"),
        "base_rate": base_rate,
        "live_rate": live_rate,
        "updated_at": fx.get("updated_at"),
        "source": fx.get("source"),
        "source_detail": fx.get("source_detail"),
        "is_fallback": bool(fx.get("is_fallback")),
        "as_of": fx.get("as_of"),
        "age_days": None,
        "is_stale": False,
        "stale_days": FX_STALE_DAYS,
        "revenue_krw_live": None,
        "gain_loss_krw": None,
        "revenue_gain_krw": None,
        "spend_loss_krw": None,
    }
    if live_rate is not None:
        diff = live_rate - base_rate
        # 환차손익 = 현지 집행·매출액(VND) × (현재 환율 − 기준 환율) ÷ 100
        # 매출은 환율이 오르면 이익, 지출은 환율이 오르면 손실이므로 부호를 나눠 보여 줍니다.
        revenue_gain = round(total_revenue_vnd * diff / 100)
        spend_loss = -round((total_spend_vnd + budget["influencer_expected_vnd"]) * diff / 100)
        fx_block.update(
            revenue_krw_live=_vnd_to_krw(total_revenue_vnd, live_rate),
            revenue_gain_krw=revenue_gain,
            spend_loss_krw=spend_loss,
            gain_loss_krw=revenue_gain + spend_loss,
        )
    if fx_block["as_of"]:
        try:
            age = (datetime.date.today() - datetime.date.fromisoformat(fx_block["as_of"])).days
            fx_block.update(age_days=age, is_stale=age > FX_STALE_DAYS)
        except ValueError:
            pass

    return {
        "is_demo": True,
        "campaign_month": budget["campaign_month"],
        "totals": {
            "ad_spend_vnd": total_spend_vnd,
            "ad_spend_krw_base": _vnd_to_krw(total_spend_vnd, base_rate),
            "revenue_vnd": total_revenue_vnd,
            "revenue_krw_base": _vnd_to_krw(total_revenue_vnd, base_rate),
            "roas_percent": _pct(total_revenue_vnd, total_spend_vnd),
            "conversions": sum(c["conversions"] for c in DEMO_CHANNELS),
        },
        "budget": {
            "total_krw": total_budget,
            "platform_krw": platform_krw,
            "influencer_paid_krw": influencer_paid_krw,
            "influencer_expected_krw": influencer_expected_krw,
            "remaining_krw": remaining_krw,
            "burn_rate_percent": _pct(platform_krw + influencer_paid_krw, total_budget),
            "remaining_percent": _pct(remaining_krw, total_budget),
        },
        "channels": channels,
        "roas_bep_percent": ROAS_BEP_PERCENT,
        "fx": fx_block,
        "ga4": _build_ga4(),
        "creators": [
            {**c, "cvr_percent": _pct(c["conversions"], c["clicks"])} for c in DEMO_CREATORS
        ],
        "influencer_link": _read_influencer_quotes(),
    }


def _voc_stats(reviews):
    sentiment_counts = {s: 0 for s in SENTIMENTS}
    keyword_counts = {}
    for r in reviews:
        if r.get("sentiment") in sentiment_counts:
            sentiment_counts[r["sentiment"]] += 1
        tag = r.get("keyword_tag") or "기타"
        keyword_counts[tag] = keyword_counts.get(tag, 0) + 1
    top_keywords = sorted(keyword_counts.items(), key=lambda kv: kv[1], reverse=True)[:5]
    return {
        "sample_size": len(reviews),
        "sentiment_counts": sentiment_counts,
        "top_keywords": [{"keyword": k, "count": n} for k, n in top_keywords],
    }


def _qr_block():
    q = DEMO_QR
    return {
        **q,
        "scan_rate_percent": _pct(q["qr_scans"], q["pamphlets"]),
        "follow_rate_percent": _pct(q["zalo_follows"], q["qr_scans"]),
        "response_rate_percent": _pct(q["survey_responses"], q["qr_scans"]),
        "survey": DEMO_SURVEY,
    }


# ---------------------------------------------------------------------------
# VOC AI — OpenAI API (OPENAI_API_KEY, 콘텐츠 스튜디오와 같은 키). 서버에서만 키 사용, urllib로 호출
# ---------------------------------------------------------------------------

OPENAI_URL = "https://api.openai.com/v1/chat/completions"
OPENAI_MODEL = "gpt-4o-mini"  # KPI README 3장
_voc_ai_cache = {"result": None}

VOC_PROMPT = """당신은 베트남 시장에 진출한 한국 찹쌀떡 브랜드 '한정선'의 고객 리뷰 분석가입니다.
아래 JSON 배열은 베트남어 고객 리뷰입니다. 각 리뷰를 한국어로 자연스럽게 번역하고,
감성(sentiment)과 핵심 토픽(keyword_tag)을 분류한 뒤, 전체를 한국어 한 문장으로 요약하세요.

- sentiment는 Positive, Neutral, Negative 중 하나
- keyword_tag는 당도/맛, 냉장배송/포장, 가격, 선물용, 기타 중 하나
- review_id는 입력 값을 그대로 사용
- 과장하지 말고 리뷰에 있는 내용만 근거로 요약

다음 JSON 형식으로만 답하세요:
{"reviews": [{"review_id": "...", "translated_kr": "...", "sentiment": "...", "keyword_tag": "..."}],
 "summary_kr": "..."}

리뷰:
"""


def _call_openai(reviews):
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        return None, "OPENAI_API_KEY 환경변수가 없어 AI 분석을 실행하지 못했습니다."
    model = OPENAI_MODEL
    source = [{"review_id": r["review_id"], "platform": r["platform"], "text": r["raw_text_vn"]} for r in reviews]
    body = {
        "model": model,
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
        "messages": [{"role": "user", "content": VOC_PROMPT + json.dumps(source, ensure_ascii=False)}],
    }
    req = urllib.request.Request(
        OPENAI_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        text = payload["choices"][0]["message"]["content"]
        parsed = json.loads(text)
    except urllib.error.HTTPError as exc:
        hint = {401: "키가 올바른지", 429: "사용 한도·결제 상태를", 404: "모델 이름을"}.get(exc.code, "키·사용 한도를")
        return None, f"OpenAI 호출 실패 (HTTP {exc.code}). {hint} 확인해 주세요."
    except (urllib.error.URLError, TimeoutError) as exc:
        return None, f"OpenAI 서버에 연결하지 못했습니다 ({exc.__class__.__name__})."
    except (ValueError, KeyError, IndexError, TypeError):
        return None, "OpenAI 응답 형식을 읽지 못했습니다."

    known_ids = {r["review_id"] for r in reviews}
    analyzed = []
    for item in parsed.get("reviews") or []:
        if not isinstance(item, dict) or item.get("review_id") not in known_ids:
            continue
        sentiment = item.get("sentiment") if item.get("sentiment") in SENTIMENTS else None
        tag = item.get("keyword_tag") if item.get("keyword_tag") in KEYWORD_TAGS else "기타"
        analyzed.append({
            "review_id": item["review_id"],
            "translated_kr": str(item.get("translated_kr") or ""),
            "sentiment": sentiment,
            "keyword_tag": tag,
        })
    if not analyzed:
        return None, "OpenAI 응답에 분석 결과가 없습니다."
    return {
        "model": model,
        "reviewed": False,  # AI 번역·분류는 사람이 검수하기 전 결과입니다.
        "analyzed_at": time.strftime("%Y-%m-%d %H:%M", time.localtime()),
        "summary_kr": str(parsed.get("summary_kr") or ""),
        "reviews": analyzed,
        **_voc_stats(analyzed),
    }, None


# ---------------------------------------------------------------------------
# 화면·API
# ---------------------------------------------------------------------------


@bp.route("/")
def index():
    return render_template("kpi/kpi_index.html")


@bp.get("/api/summary")
def api_summary():
    return jsonify(_build_summary())


@bp.get("/api/voc")
def api_voc():
    return jsonify({
        "is_demo": True,
        "reviews": DEMO_REVIEWS,
        **_voc_stats(DEMO_REVIEWS),
        "qr": _qr_block(),
        "ai": _voc_ai_cache["result"],
    })


@bp.post("/api/voc/analyze")
def api_voc_analyze():
    result, error = _call_openai(DEMO_REVIEWS)
    if error:
        return jsonify({"ok": False, "error": error}), 502
    _voc_ai_cache["result"] = result
    return jsonify({"ok": True, "ai": result})
