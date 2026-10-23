"""KPI 화면·API. [민지]

API는 /kpi/api/... 아래에만 추가합니다. 다른 기능 데이터는 그 기능의 public.py로만 읽습니다. (README 8장)
공식은 README 9장 "광고비·예산 계산 공식 (민지 제안 · 확정 전)"을 따릅니다.
외부 API 값이 없거나 실패하면 0이나 만든 값으로 바꾸지 않고 None과 오류 안내를 돌려줍니다.
"""
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

DEMO_GA4 = {"sessions": 12_400, "engaged_sessions": 5_890, "shopee_clicks": 1_540}

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
]

ROAS_BEP_PERCENT = 300  # 손익분기 기준선 (README 9장)

# ---------------------------------------------------------------------------
# 환율 — open.er-api.com (키 없음). 1 VND당 KRW를 받아 100 VND당 KRW로 바꿉니다.
# ---------------------------------------------------------------------------

FX_URL = "https://open.er-api.com/v6/latest/VND"
FX_CACHE_SECONDS = 60 * 60
_fx_cache = {"fetched_at": 0.0, "data": None}


def _fetch_exchange_rate():
    now = time.time()
    if _fx_cache["data"] and now - _fx_cache["fetched_at"] < FX_CACHE_SECONDS:
        return _fx_cache["data"]
    try:
        with urllib.request.urlopen(FX_URL, timeout=5) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        if payload.get("result") != "success":
            raise ValueError(payload.get("error-type") or "unknown")
        krw_per_vnd = float(payload["rates"]["KRW"])
    except (urllib.error.URLError, TimeoutError, ValueError, KeyError, TypeError) as exc:
        return {"ok": False, "error": f"환율을 불러오지 못했습니다 ({exc.__class__.__name__})"}
    data = {
        "ok": True,
        "rate_per_100_vnd": round(krw_per_vnd * 100, 4),
        "updated_at": payload.get("time_last_update_utc", ""),
        "source": "open.er-api.com",
    }
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
        "ga4": {
            **DEMO_GA4,
            "engagement_rate_percent": _pct(DEMO_GA4["engaged_sessions"], DEMO_GA4["sessions"]),
            "shopee_ctr_percent": _pct(DEMO_GA4["shopee_clicks"], DEMO_GA4["sessions"]),
        },
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
        "sentiment_counts": sentiment_counts,
        "top_keywords": [{"keyword": k, "count": n} for k, n in top_keywords],
    }


# ---------------------------------------------------------------------------
# VOC AI — Gemini API (서버에서만 키 사용, 표준 라이브러리 urllib로 호출)
# ---------------------------------------------------------------------------

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
GEMINI_DEFAULT_MODEL = "gemini-2.5-flash"
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


def _call_gemini(reviews):
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        return None, "GEMINI_API_KEY 환경변수가 없어 AI 분석을 실행하지 못했습니다."
    model = os.environ.get("GEMINI_MODEL", "").strip() or GEMINI_DEFAULT_MODEL
    source = [{"review_id": r["review_id"], "platform": r["platform"], "text": r["raw_text_vn"]} for r in reviews]
    body = {
        "contents": [{"role": "user", "parts": [{"text": VOC_PROMPT + json.dumps(source, ensure_ascii=False)}]}],
        "generationConfig": {"temperature": 0.2, "responseMimeType": "application/json"},
    }
    req = urllib.request.Request(
        GEMINI_URL.format(model=model),
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        text = payload["candidates"][0]["content"]["parts"][0]["text"]
        parsed = json.loads(text)
    except urllib.error.HTTPError as exc:
        return None, f"Gemini 호출 실패 (HTTP {exc.code}). 키·모델 이름·사용 한도를 확인해 주세요."
    except (urllib.error.URLError, TimeoutError) as exc:
        return None, f"Gemini 서버에 연결하지 못했습니다 ({exc.__class__.__name__})."
    except (ValueError, KeyError, IndexError, TypeError):
        return None, "Gemini 응답 형식을 읽지 못했습니다."

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
        return None, "Gemini 응답에 분석 결과가 없습니다."
    return {
        "model": model,
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
        "ai": _voc_ai_cache["result"],
    })


@bp.post("/api/voc/analyze")
def api_voc_analyze():
    result, error = _call_gemini(DEMO_REVIEWS)
    if error:
        return jsonify({"ok": False, "error": error}), 502
    _voc_ai_cache["result"] = result
    return jsonify({"ok": True, "ai": result})
