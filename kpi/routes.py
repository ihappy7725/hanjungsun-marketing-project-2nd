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

# GA4 시연 값. kpi/data/ga4_demo.json(GA4 공식 데모 계정 화면을 옮겨 적음)이 있으면 세션·참여·전환은 그 파일 값을 씁니다.
# 매장 예약·길찾기 클릭·팜플렛 QR 유입은 한정선 사이트에만 있는 값이라 데모 계정에 없어 항상 시연 값입니다.
# 매장 예약·길찾기 클릭·팜플렛 QR 유입은 한정선 사이트 전용 이벤트라 시연 '비율'로 두고,
# 화면에 쓰는 세션 수(GA4 데모 CSV 또는 아래 시연 세션)에 곱해 건수를 냅니다 → 지표끼리 같은 세션 기준.
DEMO_GA4 = {"sessions": 12_400, "engaged_sessions": 5_890, "store_action_rate": 0.124, "pamphlet_share": 0.0952}
GA4_DEMO_JSON = os.path.join(os.path.dirname(__file__), "data", "ga4_demo.json")
# 팜플렛 QR 설문 주관식 한 줄 의견 (시연, 응답자 186명 · platform = 설문을 받은 창구)
SURVEY_COMMENTS_CSV = os.path.join(os.path.dirname(__file__), "data", "voc_survey_comments.csv")

DEMO_CREATORS = [
    {"creator": "@danang.foodie", "platform": "TikTok", "clicks": 3_120, "conversions": 248},
    {"creator": "@banhngot.review", "platform": "Instagram", "clicks": 2_460, "conversions": 191},
    {"creator": "@hanquoc.daily", "platform": "TikTok", "clicks": 1_980, "conversions": 133},
    {"creator": "@mevabe.dn", "platform": "Instagram", "clicks": 1_210, "conversions": 87},
    {"creator": "@quatang.tet", "platform": "YouTube", "clicks": 890, "conversions": 52},
]

SENTIMENTS = ("Positive", "Neutral", "Negative")
# 한정선은 현지 배달·온라인 배송이 없습니다(매장 구매·예약 후 매장 픽업만). 포장·보냉(휴대) 반응만 다룹니다.
# 1:1 문의 창구라 보관 방법·매장 위치·단체 주문 같은 문의가 많아 "문의/기타"로 묶습니다.
KEYWORD_TAGS = ("당도/맛", "포장/보냉", "가격", "선물용", "문의/기타")
OTHER_TAG = "문의/기타"

# VOC 1:1 문의·후기 (시연). CS 창구는 제품 팜플렛 하단 QR 3개: Zalo OA · 카카오톡 채널 · WhatsApp
# raw_text_vn은 고객이 쓴 원문이고 lang(vi/ko)으로 언어를 구분합니다. 파일이 없으면 빈 목록.
REVIEWS_CSV = os.path.join(os.path.dirname(__file__), "data", "voc_reviews_demo.csv")
REVIEW_CHANNELS = ("Zalo_OA", "KakaoTalk", "WhatsApp")


def _read_demo_reviews(path=REVIEWS_CSV):
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8", newline="") as f:
        lines = [line for line in f if not line.startswith("#")]
    return [{
        "review_id": row["review_id"],
        "platform": row["platform"],
        "raw_text_vn": row["raw_text_vn"],
        "translated_kr": row["translated_kr"],
        "sentiment": row["sentiment"] if row["sentiment"] in SENTIMENTS else None,
        "keyword_tag": row["keyword_tag"] if row["keyword_tag"] in KEYWORD_TAGS else OTHER_TAG,
        "lang": row.get("lang") or "vi",
        "source": "message",
    } for row in csv.DictReader(lines)]


DEMO_REVIEWS = _read_demo_reviews()

# 팜플렛 QR 흐름과 QR 설문 만족도 (5점 만점) — 시연 값
# follows: 팜플렛 QR로 채널을 추가한 수(Zalo OA 친구 추가 · WhatsApp 대화 시작 · 카카오톡 채널 추가). 베트남은 Zalo 이용자가 가장 많음
DEMO_QR = {"pamphlets": 2_000, "qr_scans": 1_240, "follows": {"Zalo_OA": 410, "WhatsApp": 150, "KakaoTalk": 90}, "survey_responses": 186}
# 응답자 186명이 문항마다 1~5점 중 하나를 고른 인원 수(dist = [1점, 2점, 3점, 4점, 5점]).
# 평균·긍정 비율은 이 분포에서 계산합니다(_survey_block).
DEMO_SURVEY = [
    {"item": "맛", "dist": [2, 3, 12, 55, 114]},
    {"item": "식감", "dist": [3, 5, 18, 68, 92]},
    {"item": "포장/보냉", "dist": [6, 14, 41, 72, 53]},
    {"item": "가격", "dist": [9, 21, 58, 61, 37]},
    {"item": "매장 응대", "dist": [4, 9, 38, 79, 56]},
    {"item": "재구매 의향", "dist": [5, 8, 27, 63, 83]},
]

FX_STALE_DAYS = 7  # 환율 기준일이 이보다 오래되면 화면에 주의 표시

# 집행 시뮬레이션용 인플루언서 후보 — 인플루언서 탭 get_quote_summary()가 비었거나 실패할 때만 씁니다. (시연)
# 필드는 influencer_marketing/public.py get_quote_summary 반환 형식과 같습니다.
DEMO_INFLUENCER_QUOTES = [
    {"quote_id": "demo_q_01", "influencer": "@danang.foodie", "platform": "TikTok", "content_format": "숏폼 1편",
     "price_type": "quote", "amount": 18_000_000, "currency": "VND", "amount_vnd": 18_000_000, "is_demo": True},
    {"quote_id": "demo_q_02", "influencer": "@banhngot.review", "platform": "Instagram", "content_format": "릴스 1편 + 스토리 2",
     "price_type": "quote", "amount": 14_000_000, "currency": "VND", "amount_vnd": 14_000_000, "is_demo": True},
    {"quote_id": "demo_q_03", "influencer": "@hanquoc.daily", "platform": "TikTok", "content_format": "숏폼 1편",
     "price_type": "public", "amount": 9_500_000, "currency": "VND", "amount_vnd": 9_500_000, "is_demo": True},
    {"quote_id": "demo_q_04", "influencer": "@mevabe.dn", "platform": "Instagram", "content_format": "피드 1편",
     "price_type": "contract", "amount": 7_000_000, "currency": "VND", "amount_vnd": 7_000_000, "is_demo": True},
    {"quote_id": "demo_q_05", "influencer": "@quatang.tet", "platform": "YouTube", "content_format": "쇼츠 1편",
     "price_type": "public", "amount": 12_000_000, "currency": "VND", "amount_vnd": 12_000_000, "is_demo": True},
]
PRICE_TYPE_LABEL = {"public": "공개 참고가", "quote": "견적", "contract": "계약가"}

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
_usd_cache = {"fetched_at": 0.0, "data": None}
_ecos_item_cache = {}  # 찾는 말("베트남", "미국달러") → ECOS 항목


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


def _find_ecos_item(api_key, keyword, prefer="매매기준율"):
    """ECOS 일별 환율 통계표에서 이름에 keyword가 들어간 항목을 찾습니다. 여러 개면 prefer가 들어간 항목."""
    if keyword in _ecos_item_cache:
        return _ecos_item_cache[keyword]
    for stat_code in ECOS_STAT_CODES:
        url = f"{ECOS_BASE}/StatisticItemList/{api_key}/json/kr/1/500/{stat_code}"
        matches = [
            row for row in _ecos_rows(_get_json(url), "StatisticItemList")
            if keyword in (row.get("ITEM_NAME") or "") and (row.get("CYCLE") or "D") == "D"
        ]
        if matches:
            row = next((r for r in matches if prefer in (r.get("ITEM_NAME") or "")), matches[0])
            item = {
                "stat_code": stat_code,
                "stat_name": row.get("STAT_NAME") or "",
                "item_code": row.get("ITEM_CODE"),
                "item_name": row.get("ITEM_NAME") or "",
                "unit_name": row.get("UNIT_NAME") or "",
            }
            _ecos_item_cache[keyword] = item
            return item
    raise LookupError("ECOS_VND_ITEM_NOT_FOUND" if keyword == "베트남" else "ECOS_USD_ITEM_NOT_FOUND")


def _ecos_latest(api_key, item):
    """최근 ECOS_LOOKBACK_DAYS일 중 가장 최근 고시값 (값, 'YYYYMMDD')."""
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
    return float(str(latest["DATA_VALUE"]).replace(",", "")), latest["TIME"]


def _to_rate_per_100_vnd(value, item):
    """ECOS 값이 1동당 원이면 100을 곱합니다. (100동당 원 ≈ 5원 수준, 1동당 원 ≈ 0.05원 수준)"""
    per_100 = "100" in item["item_name"] or "100" in item["unit_name"]
    if not per_100 and value < 1:
        value *= 100
    return round(value, 4)


def _fetch_ecos_rate(api_key):
    item = _find_ecos_item(api_key, "베트남")
    value, day = _ecos_latest(api_key, item)
    return {
        "ok": True,
        "rate_per_100_vnd": _to_rate_per_100_vnd(value, item),
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
        except ECOS_ERRORS as exc:
            data = _fetch_fallback_rate(_ecos_error_reason(exc))
    if data.get("ok"):
        _fx_cache.update(fetched_at=now, data=data)
    return data


ECOS_ERRORS = (urllib.error.URLError, TimeoutError, ValueError, LookupError, KeyError, TypeError)


def _ecos_error_reason(exc):
    """ECOS 실패 이유 (키가 든 주소·예외 메시지는 넣지 않습니다)."""
    if isinstance(exc, urllib.error.HTTPError):
        return f"ECOS 호출 실패(HTTP {exc.code})로 대체 출처를 씁니다."
    if isinstance(exc, (urllib.error.URLError, TimeoutError)):
        return f"ECOS 서버에 연결하지 못해({exc.__class__.__name__}) 대체 출처를 씁니다."
    code = exc.args[0] if exc.args and isinstance(exc.args[0], str) and exc.args[0].isupper() else exc.__class__.__name__
    return f"ECOS 응답 오류({code})로 대체 출처를 씁니다."


def _fetch_usd_rate():
    """원/미국달러 고시 환율(1달러당 원). ROAS 블록 달러 표시용 — 공식 계산에는 쓰지 않습니다."""
    now = time.time()
    if _usd_cache["data"] and now - _usd_cache["fetched_at"] < FX_CACHE_SECONDS:
        return _usd_cache["data"]
    api_key = os.environ.get("ECOS_API_KEY", "").strip()
    reason = "ECOS_API_KEY가 없어 대체 출처를 씁니다."
    data = None
    if api_key:
        try:
            item = _find_ecos_item(api_key, "미국달러")
            value, day = _ecos_latest(api_key, item)
            data = {"ok": True, "krw_per_usd": round(value, 2), "as_of": f"{day[:4]}-{day[4:6]}-{day[6:8]}",
                    "source": "한국은행 ECOS", "is_fallback": False}
        except ECOS_ERRORS as exc:
            reason = _ecos_error_reason(exc)
    if data is None:
        try:
            rates = _get_json(FALLBACK_FX_URL, timeout=5)["rates"]  # 1 VND 기준 → 1달러당 원 = KRW ÷ USD
            data = {"ok": True, "krw_per_usd": round(float(rates["KRW"]) / float(rates["USD"]), 2), "as_of": None,
                    "source": "open.er-api.com", "is_fallback": True, "note": reason}
        except (urllib.error.URLError, TimeoutError, ValueError, KeyError, TypeError, ZeroDivisionError) as exc:
            return {"ok": False, "error": f"달러 환율을 불러오지 못했습니다 ({exc.__class__.__name__})."}
    _usd_cache.update(fetched_at=now, data=data)
    return data


# ---------------------------------------------------------------------------
# 인플루언서 탭 — public.py로만 읽고, 실패해도 KPI 화면은 계속 보여 줍니다.
# ---------------------------------------------------------------------------


def _get_influencer_quotes():
    """get_quote_summary() 원본 목록. 실패하면 (None, 오류 안내)."""
    try:
        from influencer_marketing.public import get_quote_summary

        return list(get_quote_summary(include_demo=True) or []), None
    except Exception as exc:  # 주인 탭 오류로 내 화면이 멈추지 않게 (README 10장)
        return None, f"인플루언서 단가를 불러오지 못했습니다 ({exc.__class__.__name__})"


def _read_influencer_quotes():
    quotes, error = _get_influencer_quotes()
    if error:
        return {"ok": False, "error": error}
    counts = {"public": 0, "quote": 0, "contract": 0}
    for q in quotes:
        price_type = (q or {}).get("price_type")
        if price_type in counts:
            counts[price_type] += 1
    return {"ok": True, "total": len(quotes), "counts": counts}


def _quote_amount_vnd(q):
    """VND 금액. amount_vnd가 없으면 통화가 VND일 때만 amount를 씁니다(USD 환산 기준은 README 8장 미정)."""
    if q.get("amount_vnd") not in (None, ""):
        return float(q["amount_vnd"])
    if (q.get("currency") or "").upper() == "VND" and q.get("amount") not in (None, ""):
        return float(q["amount"])
    return None


def _simulator_influencers():
    """시뮬레이션 인플루언서 후보와 데이터 상태. 탭 데이터가 없거나 실패하면 시연 후보."""
    quotes, error = _get_influencer_quotes()
    status, note = "live", "인플루언서 탭 단가(get_quote_summary)"
    if error or not quotes:
        quotes = DEMO_INFLUENCER_QUOTES
        status = "demo"
        note = f"{error} 시연 후보를 씁니다." if error else "인플루언서 탭 단가가 아직 없어 시연 후보를 씁니다."
    options, skipped = [], 0
    for q in quotes:
        q = q or {}
        try:
            amount_vnd = _quote_amount_vnd(q)
        except (TypeError, ValueError):
            amount_vnd = None
        if not amount_vnd:
            skipped += 1
            continue
        options.append({
            "id": str(q.get("quote_id") or q.get("collaboration_id") or len(options)),
            "influencer": q.get("influencer") or "이름 없음",
            "platform": q.get("platform") or "",
            "content_format": q.get("content_format") or "",
            "price_type": q.get("price_type") or "",
            "price_type_label": PRICE_TYPE_LABEL.get(q.get("price_type"), "단가"),
            "amount_vnd": round(amount_vnd),
            "is_demo": bool(q.get("is_demo")) or status == "demo",
        })
    if skipped:
        note += f" (VND 금액이 없는 {skipped}건 제외)"
    return {"status": status, "note": note, "options": options}


def _simulator_influencer_list():
    """인플루언서 탭 리스트(get_collaborations) — 단가가 없는 인플루언서도 계정 자동완성에 보여 주기 위함.

    이름 · 대표 매체 · 팔로워 · 진행 상태만 씁니다(같은 이름은 한 번만). 실패하거나 비어 있으면 빈 목록이고,
    그때 화면은 단가 목록(get_quote_summary 또는 시연 후보)만으로 동작합니다.
    """
    try:
        from influencer_marketing.public import get_collaborations

        rows = list(get_collaborations(include_demo=True) or [])
    except Exception:  # 주인 탭 오류로 내 화면이 멈추지 않게 (README 10장)
        return []
    out, seen = [], set()
    for r in rows:
        r = r or {}
        name = str(r.get("influencer") or "").strip()
        if not name or name in seen:
            continue
        seen.add(name)
        followers = r.get("followers")
        out.append({
            "influencer": name,
            "platform": r.get("main_platform") or "",
            "followers": followers if isinstance(followers, int) else None,
            "status_label": r.get("status_label") or "",
            "is_demo": bool(r.get("is_demo")),
        })
    return out


def _simulator_creator_list():
    """인플루언서 탭 크리에이터 목록(get_creator_list) — 실제 계정 자료(제3자 추정 팔로워), 단가 없음.

    계정 자동완성에 함께 보여 주고, 고르면 집행 매체를 그 플랫폼으로 맞춥니다. 실패하면 빈 목록(화면은 그대로 동작).
    """
    try:
        from influencer_marketing.public import get_creator_list

        rows = list(get_creator_list() or [])
    except Exception:  # 주인 탭 오류로 내 화면이 멈추지 않게 (README 10장)
        return []
    out = []
    for r in rows:
        r = r or {}
        name = str(r.get("name") or "").strip()
        followers = r.get("followers")
        if not name or not r.get("platform"):
            continue
        out.append({
            "name": name,
            "platform": r.get("platform") or "",
            "followers": followers if isinstance(followers, int) else None,
            "tier": r.get("tier") or "",
            "segment": r.get("segment") or "",
            "category": r.get("category") or "",
            "follower_source": r.get("follower_source") or "",
            "list_as_of": r.get("list_as_of") or "",
            "is_demo": bool(r.get("is_demo")),
        })
    return out


# ---------------------------------------------------------------------------
# GA4 — 지금은 공식 데모 계정(Google Merchandise Store) 화면을 옮겨 적은 JSON을 읽습니다(데모 계정은 CSV 다운로드 불가).
# 한정선 GA4 속성 권한이 생기면 _read_ga4_demo_json만 GA4 Data API 호출로 바꿉니다(같은 키 이름으로 돌려주면 됨).
# (실연동에 필요한 것: 한정선 GA4 속성 보기 권한 · 서비스 계정 · GA4 Data API · 매장 예약·길찾기는 클릭 이벤트)
# ---------------------------------------------------------------------------

GA4_CHANNEL_FIELDS = (
    "sessions", "engaged_sessions", "avg_engagement_sec", "key_events", "session_key_event_rate_percent", "revenue_usd",
)


def _read_ga4_demo_json(path=GA4_DEMO_JSON):
    """GA4 데모 JSON(totals · channels · top_events)을 읽습니다. 파일이 없으면 None, 형식 오류는 ValueError."""
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    totals = data.get("totals") or {}
    if not isinstance(totals.get("sessions"), (int, float)):
        raise ValueError("GA4_JSON_NO_SESSIONS")
    channels = []
    for c in data.get("channels") or []:
        if not isinstance(c, dict) or not c.get("channel") or not isinstance(c.get("sessions"), (int, float)):
            continue
        row = {"channel": str(c["channel"]), **{k: c.get(k) for k in GA4_CHANNEL_FIELDS}}
        row["engagement_rate_percent"] = _pct(row["engaged_sessions"], row["sessions"]) if row["engaged_sessions"] is not None else None
        channels.append(row)
    channels.sort(key=lambda c: c["sessions"], reverse=True)
    meta = data.get("meta") or {}
    events = data.get("top_events") or {}
    return {
        "period": meta.get("period") or {},
        **{k: totals.get(k) for k in ("sessions", *GA4_CHANNEL_FIELDS[1:], "event_count")},
        "channels": channels,
        "top_events": [e for e in events.get("rows") or [] if isinstance(e, dict) and e.get("event")],
        "top_events_note": events.get("note") or "",
    }


def _build_ga4():
    """GA4 패널 값과 데이터 상태. CSV가 없거나 읽지 못하면 시연 값을 쓰고 이유를 함께 돌려줍니다."""
    ga4 = {
        "sessions": DEMO_GA4["sessions"],
        "engaged_sessions": DEMO_GA4["engaged_sessions"],
        "status": "demo",
        "source": "시연 값",
        "period": None,
        "scope": "가상 한정선 사이트",
        "note": "kpi/data/ga4_demo.json이 없어 시연 값을 씁니다.",
        "channels": [],
        "top_events": [],
    }
    try:
        demo = _read_ga4_demo_json()
    except (OSError, ValueError) as exc:
        code = exc.args[0] if exc.args and isinstance(exc.args[0], str) and exc.args[0].isupper() else exc.__class__.__name__
        demo = None
        ga4["note"] = f"GA4 데모 JSON을 읽지 못해({code}) 시연 값을 씁니다."
    if demo and demo.get("sessions"):
        ga4.update(
            sessions=demo["sessions"],
            engaged_sessions=demo.get("engaged_sessions"),
            status="public_demo",
            source="GA4 공식 데모 · Google Merchandise Store",
            period=demo["period"] or None,
            scope="글로벌 데모 (한정선 데이터 아님)",
            note="GA4 데이터 형식 검증용 공개 데모 데이터입니다.",
            channels=demo.get("channels") or [],
            top_events=demo.get("top_events") or [],
            top_events_note=demo.get("top_events_note") or "",
            # 전환 대체 지표(데모 매장 값): 주요 이벤트 · 세션 주요 이벤트 비율 · 평균 참여 시간 · 수익(USD)
            **{k: demo.get(k) for k in ("avg_engagement_sec", "key_events", "session_key_event_rate_percent", "revenue_usd", "event_count")},
        )
    ga4["engagement_rate_percent"] = (
        _pct(ga4["engaged_sessions"], ga4["sessions"]) if ga4["engaged_sessions"] is not None else None
    )
    # 매장 예약·길찾기 클릭·팜플렛 QR 유입은 한정선 사이트 전용 이벤트라 항상 시연 값입니다(시연 비율 × 같은 세션 수).
    ga4["store_action_clicks"] = round(ga4["sessions"] * DEMO_GA4["store_action_rate"])
    ga4["store_action_ctr_percent"] = _pct(ga4["store_action_clicks"], ga4["sessions"])
    ga4["pamphlet_sessions"] = round(ga4["sessions"] * DEMO_GA4["pamphlet_share"])
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
        # ROAS 블록 통화 전환용: 원화 = 편성 기준 환율, 달러 = 그 원화 ÷ 현재 원/달러 고시 (A안)
        "usd": _fetch_usd_rate(),
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
        tag = r.get("keyword_tag") or OTHER_TAG
        keyword_counts[tag] = keyword_counts.get(tag, 0) + 1
    top_keywords = sorted(keyword_counts.items(), key=lambda kv: kv[1], reverse=True)[:5]
    return {
        "sample_size": len(reviews),
        "sentiment_counts": sentiment_counts,
        "top_keywords": [{"keyword": k, "count": n} for k, n in top_keywords],
    }


def _read_survey_comments(path=SURVEY_COMMENTS_CSV):
    """QR 설문 주관식 한 줄 의견(응답자 1명당 1줄)을 읽습니다. '#'로 시작하는 줄은 설명입니다.

    시연 데이터는 응답자의 문항 점수와 맞게 작성했고(scores 열), 감성은 6문항 평균
    4점 이상 Positive / 3점 이상 Neutral / 3점 미만 Negative 입니다. 파일이 없으면 빈 목록.
    """
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8", newline="") as f:
        lines = [line for line in f if not line.startswith("#")]
    rows = []
    for row in csv.DictReader(lines):
        rows.append({
            "review_id": row["review_id"],
            "platform": row["platform"],
            "raw_text_vn": row["raw_text_vn"],
            "translated_kr": row["translated_kr"],
            "sentiment": row["sentiment"] if row["sentiment"] in SENTIMENTS else None,
            "keyword_tag": row["keyword_tag"] if row["keyword_tag"] in KEYWORD_TAGS else OTHER_TAG,
            "source": "survey",
        })
    return rows


def _survey_block(survey):
    """문항별 점수 분포(1~5점 인원)로 응답 수·평균·긍정(4~5점) 비율을 계산합니다."""
    items = []
    for s in survey:
        dist = s["dist"]
        n = sum(dist)
        score_sum = sum((i + 1) * c for i, c in enumerate(dist))
        items.append({
            "item": s["item"],
            "dist": dist,
            "responses": n,
            "avg": round(score_sum / n, 2) if n else None,
            "top2_percent": _pct(dist[3] + dist[4], n),
        })
    scored = [x["avg"] for x in items if x["avg"] is not None]
    return {
        "items": items,
        "overall_avg": round(sum(scored) / len(scored), 2) if scored else None,
    }


def _qr_block():
    q = DEMO_QR
    follows = sum(q["follows"].values())
    survey_by_channel = {}
    for c in _read_survey_comments():
        survey_by_channel[c["platform"]] = survey_by_channel.get(c["platform"], 0) + 1
    return {
        **q,
        "follows_total": follows,
        "survey_by_channel": survey_by_channel,
        "scan_rate_percent": _pct(q["qr_scans"], q["pamphlets"]),
        "follow_rate_percent": _pct(follows, q["qr_scans"]),
        "response_rate_percent": _pct(q["survey_responses"], q["qr_scans"]),
        "survey": _survey_block(DEMO_SURVEY),
    }


# ---------------------------------------------------------------------------
# VOC AI — OpenAI API (OPENAI_API_KEY, 콘텐츠 스튜디오와 같은 키). 서버에서만 키 사용, urllib로 호출
# ---------------------------------------------------------------------------

OPENAI_URL = "https://api.openai.com/v1/chat/completions"
OPENAI_MODEL = "gpt-4o-mini"  # KPI README 3장

VOC_PROMPT = """당신은 베트남 시장에 진출한 한국 찹쌀떡 브랜드 '한정선'의 고객 리뷰 분석가입니다.
고객은 제품 팜플렛 하단 QR로 Zalo OA · KakaoTalk · WhatsApp 중 한 창구에 들어와 1:1 문의·후기를 남기고 설문에 답합니다.
한정선은 현지 배달 서비스와 온라인 배송 서비스가 모두 없습니다. 고객은 매장에서 사서 직접 들고 가거나, 예약한 뒤 매장에서 찾아갑니다.
글을 배송·배달 상황으로 해석하지 말고, 번역·요약에 "배송", "배달", "~해서 왔다", "도착했다", "찌그러져 왔다" 같은 표현을 쓰지 마세요.
아래 JSON의 messages는 1:1 문의·후기(대부분 베트남어, 일부 한국어)이고, survey는 설문 주관식 의견(한국어)입니다.
messages의 각 글을 한국어로 자연스럽게 번역하고 감성(sentiment)과 핵심 토픽(keyword_tag)을 분류한 뒤,
창구별 요약을 한국어로 작성하세요. survey는 번역하지 말고 요약 근거로만 쓰세요.
요약은 반드시 이번 입력의 글에서 실제로 많이 나온 내용만 근거로 하고, 이 지시문의 표현을 그대로 옮겨 쓰지 마세요.

- sentiment는 Positive, Neutral, Negative 중 하나
- keyword_tag는 당도/맛, 포장/보냉, 가격, 선물용, 문의/기타 중 하나 (한정선은 배송을 하지 않으므로 포장·보냉·휴대 관련 내용은 포장/보냉,
  보관 방법·매장 정보·예약·응대 속도 같은 문의는 문의/기타)
- review_id는 입력 값을 그대로 사용
- translated_kr는 쿠팡 구매 후기처럼 자연스러운 구어체 존댓말 1~2문장
  (예: "~하더라고요", "~했어요!", "~네요..", 필요하면 "ㅠ"), 원문에 없는 내용은 더하지 말 것
- channel_summaries는 Zalo_OA, KakaoTalk, WhatsApp 세 창구 각각 하나씩(그 창구의 messages + survey 근거)
  summary: 그 창구에서 가장 많이 나온 의견을 한 문장(40자 이내, "~입니다/~습니다", 창구마다 다른 내용)
  caution: 마케터가 유의해야 할 점 한 문장(40자 이내). 반복되는 불만·요청이나 응대 문제 중 가장 시급한 것
  keep: 고객이 만족해 계속 유지할 점 1~2개를 짧은 명사구로
  improve: 불만·요청이 많아 개선할 점 1~2개를 짧은 명사구로
  근거가 없으면 빈 문자열·빈 배열, 원문에 없는 내용·수치는 만들지 말 것

다음 JSON 형식으로만 답하세요:
{"reviews": [{"review_id": "...", "translated_kr": "...", "sentiment": "...", "keyword_tag": "..."}],
 "channel_summaries": [{"channel": "Zalo_OA", "summary": "...", "caution": "...", "keep": ["..."], "improve": ["..."]}]}

입력:
"""


def _call_openai(reviews, survey=()):
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        return None, "OPENAI_API_KEY 환경변수가 없어 AI 분석을 실행하지 못했습니다."
    model = OPENAI_MODEL
    source = {
        "messages": [{"review_id": r["review_id"], "channel": r["platform"], "text": r["raw_text_vn"]} for r in reviews],
        "survey": [{"channel": c["platform"], "text_kr": c["translated_kr"]} for c in survey],
    }
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
        with urllib.request.urlopen(req, timeout=120) as resp:  # 문의 75건 번역 + 설문 186건 요약
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
        tag = item.get("keyword_tag") if item.get("keyword_tag") in KEYWORD_TAGS else OTHER_TAG
        analyzed.append({
            "review_id": item["review_id"],
            "translated_kr": str(item.get("translated_kr") or ""),
            "sentiment": sentiment,
            "keyword_tag": tag,
        })
    if not analyzed:
        return None, "OpenAI 응답에 분석 결과가 없습니다."
    as_list = lambda v: [str(x) for x in v][:2] if isinstance(v, list) else []  # noqa: E731
    channel_summaries = [
        {"channel": c["channel"], "summary": str(c.get("summary") or ""), "caution": str(c.get("caution") or ""),
         "keep": as_list(c.get("keep")), "improve": as_list(c.get("improve"))}
        for c in parsed.get("channel_summaries") or []
        if isinstance(c, dict) and c.get("channel") in REVIEW_CHANNELS
    ]
    return {
        "model": model,
        "reviewed": False,  # AI 번역·분류는 사람이 검수하기 전 결과입니다.
        "analyzed_at": time.strftime("%Y-%m-%d %H:%M", time.localtime()),
        "channel_summaries": channel_summaries,
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


@bp.get("/api/simulator")
def api_simulator():
    """예산 집행 시뮬레이션 재료. 계산은 화면에서 하고 저장하지 않습니다(공식 예산 숫자는 바뀌지 않음)."""
    summary = _build_summary()
    b = summary["budget"]
    return jsonify({
        "base_rate": DEMO_BUDGET["base_exchange_rate"],
        "budget": {k: b[k] for k in ("total_krw", "remaining_krw", "remaining_percent")},
        "channels": [
            {"channel": c["channel"], "label": c["label"], "roas_percent": c["roas_percent"]}
            for c in summary["channels"]
        ],
        "ad_channels": [c["channel"] for c in DEMO_CHANNELS if c["channel"] != "Influencer"],
        "roas_bep_percent": ROAS_BEP_PERCENT,  # 본전 매출 · 이익/손해 판정 기준
        "influencers": _simulator_influencers(),
        "influencer_list": _simulator_influencer_list(),
        "creator_list": _simulator_creator_list(),
    })


@bp.get("/api/voc")
def api_voc():
    return jsonify({
        "is_demo": True,
        "reviews": DEMO_REVIEWS,
        "channels": list(REVIEW_CHANNELS),
        **_voc_stats(DEMO_REVIEWS),
        # 설문 의견은 번역 대상이 아니라 데이터의 한국어를 그대로 씁니다(창구별 목록에 함께 표시, AI 창구별 요약의 근거).
        "survey_comments": _read_survey_comments(),
        "qr": _qr_block(),
        # AI 결과는 보내지 않습니다. AI 요약은 화면에서 [AI로 분석]을 눌렀을 때 /api/voc/analyze 응답으로만 보입니다.
    })


@bp.post("/api/voc/analyze")
def api_voc_analyze():
    result, error = _call_openai(DEMO_REVIEWS, _read_survey_comments())
    if error:
        return jsonify({"ok": False, "error": error}), 502
    return jsonify({"ok": True, "ai": result})
