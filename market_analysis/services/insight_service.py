"""AI 인사이트: 대시보드 근거 목록 → 규칙 계산(과일·타임라인) → AI 문장 → 근거 태그 검증.

설계: AI 인사이트 출력 내용 설계 (2026-10-26, 상준). 출력 11블록, 모든 사실 문장에 근거 태그.
- 근거 태그 접두어: T- 트렌드 분석, C- 경쟁사 분석, K- 국가·문화
- 과일 추천과 타임라인 날짜는 서버가 규칙으로 정하고, AI는 이유·할 일 문장만 씁니다.
- 대시보드에 없는 태그를 단 문장, 근거 숫자가 없는 숫자를 쓴 문장은 버립니다. 판매 예측은 하지 않습니다.
- 결과는 저장하지 않습니다(요청마다 새로 생성).
"""
import json
import os
import re
import urllib.error
import urllib.request
from datetime import date

from .decision_cards import card_evidence

# 키는 다른 탭과 같은 OPENAI_API_KEY (서버에서만 사용). 모델은 콘텐츠 스튜디오·KPI와 같은 gpt-4o-mini
OPENAI_URL = "https://api.openai.com/v1/chat/completions"
OPENAI_MODEL = "gpt-4o-mini"
OPENAI_TIMEOUT = 60

GOALS = {
    "awareness": {"label": "인지도 만들기", "focus": "콘텐츠 주제, 채널", "data": "급상승 키워드, 채널 규모"},
    "first_sale": {"label": "첫 입점·첫 판매", "focus": "입점 채널, 가격대", "data": "★ 경쟁사 가격, 채널"},
    "season": {"label": "시즌 매출", "focus": "출시 시기, 한정판 과일", "data": "계절성, 과일 순위"},
    "tourist": {"label": "관광객 기념품 판매", "focus": "기념품 채널, 패키징", "data": "다낭 관광 통계, 관광 성수기"},
}
PERIODS = {"1m": 1, "3m": 3, "6m": 6}
CHANNELS = {
    "souvenir": "공항·관광지 기념품점",
    "online": "온라인 (TikTok·Facebook)",
    "retail": "오프라인 소매",
    "korean_mart": "한인 마트",
}
BUDGETS = {"small": "작게(테스트)", "medium": "보통", "large": "크게"}
MEMO_MAX = 200
FRUIT_PICKS = 2
MAX_OPINIONS = 4  # AI 종합 의견 최대 개수 (의견마다 근거 태그 2개 이상)
CARD_KEYS = ("flavor", "price", "channel")
LAUNCH_LEAD_MONTHS = 2  # 한정판은 검색 피크 2개월 전 출시

DATA_LIMITS = [
    "트렌드 값은 Google 검색 관심도이지 판매량이 아닙니다.",
    "광고 도달 수치는 광고 도구 기준이며 실제 이용자 수와 다릅니다.",
    "과일의 찹쌀떡 활용 가능 여부는 기본값(전부 가능)이며 제품팀 확인이 필요합니다.",
    "맛 기회·채널 카드는 판매량이 아니라 공급(경쟁 제품·판매처 수) 기준입니다.",
]


class InsightError(RuntimeError):
    """입력 오류(400) 또는 생성 불가(503)를 알립니다."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def options(config):
    """입력 폼 선택지. 과일은 트렌드 설정 중 찹쌀떡 활용 가능(mochi_fit)인 것만."""
    return {
        "goals": [{"id": k, "label": v["label"]} for k, v in GOALS.items()],
        "periods": [{"id": k, "label": f"앞으로 {v}개월"} for k, v in PERIODS.items()],
        "channels": [{"id": k, "label": v} for k, v in CHANNELS.items()],
        "budgets": [{"id": k, "label": v} for k, v in BUDGETS.items()],
        "fruits": [{"id": f["id"], "label": f["label"]} for f in config.get("fruit_flavors", []) if f.get("mochi_fit")],
        "memo_max": MEMO_MAX,
        "ai_ready": bool(os.environ.get("OPENAI_API_KEY", "").strip()),
    }


def validate_input(body, config):
    body = body or {}
    goal, period = body.get("goal"), body.get("period")
    channels = [c for c in body.get("channels") or [] if c in CHANNELS]
    if goal not in GOALS:
        raise InsightError("이번 목표를 선택해 주세요.")
    if period not in PERIODS:
        raise InsightError("실행 기간을 선택해 주세요.")
    if not channels:
        raise InsightError("주력 채널을 하나 이상 선택해 주세요.")
    fit = {f["id"] for f in config.get("fruit_flavors", []) if f.get("mochi_fit")}
    budget = body.get("budget") if body.get("budget") in BUDGETS else None
    memo = str(body.get("memo") or "").strip()
    if len(memo) > MEMO_MAX:
        raise InsightError(f"추가 메모는 {MEMO_MAX}자까지 입력할 수 있습니다.")
    return {"goal": goal, "period": period, "channels": channels,
            "fruits": [f for f in body.get("fruits") or [] if f in fit], "budget": budget, "memo": memo}


# ---------- 근거 목록 ----------

def _source(sources, ids):
    found = [sources[i] for i in ids if i in sources]
    return {"source": " · ".join(s["publisher"] for s in found) or "출처 미확인",
            "as_of": " · ".join(str(s.get("checked_date") or s.get("date") or "") for s in found)}


def _pct(value):
    return "-" if value is None else f"{value:+.1f}%"


def build_evidence(trend, guidelines, competitors, cards=None):
    """태그 → {tag, text, source, date}. 데이터가 없는 태그는 만들지 않습니다(AI가 쓸 수 없음).

    cards(의사결정 카드 계산 결과)를 주면 D- 근거(맛기회·가격·채널)를 함께 만듭니다.
    """
    evidence = {}

    def add(tag, text, source, as_of):
        if text:
            evidence[tag] = {"tag": tag, "text": text, "source": source, "date": as_of}

    trend_date = str(trend.get("checked_at") or "")[:10]
    trend_source = "Google Trends (SerpApi 수집)"
    if trend.get("categories"):
        add("T-추이", " / ".join(
            f"{c['label']} 최근 12주 관심도 {c['recent_average']} (전년 동기 {_pct(c['change_rate'])}, 최근 4주 {_pct(c['short_change_rate'])})"
            for c in trend["categories"] if c.get("recent_average") is not None), trend_source, trend_date)
        top = []
        for c in trend["categories"]:
            ranked = [r for r in c.get("ranking", []) if r.get("recent_average") is not None][:3]
            if ranked:
                top.append(f"{c['label']}: " + ", ".join(
                    f"{r['name']}({r['query']}){' 급상승 ' + str(r['rising_value']) if r.get('rising_value') else ''}" for r in ranked))
        add("T-급상승", " / ".join(top), trend_source + " 관련 검색어", trend_date)
    fruits = trend.get("fruit_flavors") or []
    if fruits:
        add("T-과일", ", ".join(f"{f['rank'] or '-'}위 {f['name']} 관심도 {f['recent_average']}(전년 대비 {_pct(f['change_rate'])})"
                               for f in fruits), trend_source, trend_date)
    tabs = {t["id"]: t for t in trend.get("seasonality") or []}
    fruit_tab = next((t for t in tabs.values() if t.get("type") == "fruits"), None)
    if fruit_tab:
        add("T-계절성", ", ".join(f"{f['name']} 검색 피크 {'·'.join(str(m) for m in f.get('peak_months') or [])}월"
                                 for f in fruit_tab.get("fruits", [])), trend_source + " 최근 5년 월평균", trend_date)
    tourism = tabs.get("danang-travel-kr")
    if tourism and tourism.get("peak_months"):
        add("T-관광", f"한국인 '다낭 여행' 검색 피크 {'·'.join(str(m) for m in tourism['peak_months'])}월 (최근 5년 월평균)",
            trend_source, trend_date)
    regions = trend.get("regions") or []
    danang = next((r for r in regions if r.get("geo") == "VN-DN"), None)
    if danang and danang.get("rank"):
        add("T-지역", f"카테고리 종합 지역 관심도 다낭 {danang['rank']}위 (비교 {trend.get('regions_meta', {}).get('compared')}개 지역)",
            trend_source, trend_date)

    def piece_price(c):
        price, pack = c.get("price_vnd"), c.get("pack_count")
        return f"개당 약 {round(price / pack):,}동" if price and pack else (f"{price:,}동" if price else "가격 미확인")

    core = [c for c in competitors if c.get("is_core")]  # 경쟁사 탭에서 ★로 표시한 제품
    if core:
        add("C-★", " / ".join(f"{c.get('brand')} {c.get('product')}: {piece_price(c)}, 메시지 '{c.get('key_message') or '-'}'"
                              for c in core[:3]), "경쟁사 조사표", str(max((c.get("surveyed_at") or "") for c in core)))

    d = (guidelines or {}).get("culture_dashboard") or {}
    sources = {s["id"]: s for s in d.get("sources", [])}
    facts = {f["label"]: f for f in d.get("consumer_facts", [])}
    channel_text = ", ".join(f"{label} {facts[label]['value']}" for label in
                             ("TikTok 광고 도달", "Facebook 광고 도달", "Zalo 월간 이용자", "YouTube 광고 도달") if label in facts)
    if channel_text:
        add("K-채널", channel_text + " (2025, 광고 도달은 광고 도구 기준)", **_source(sources, ["datareportal_2026"]))
    ec = d.get("ecommerce_facts") or {}
    if ec:
        shares = ", ".join(f"{x['name']} {x['share']}%" for x in ec.get("shares", {}).get("items", []))
        ec_cards = ", ".join(f"{x['label']} {x['value']}({x['as_of']})" for x in ec.get("cards", []))
        add("K-이커머스", f"{ec_cards} / 2025 점유율 {shares}", **_source(sources, ["vneconomy_ec_2025", "vietnamnet_ec_h1_2026"]))
    groups = {g["title"]: g for g in d.get("dessert_culture", [])}
    if "당 줄이기 흐름" in groups:
        g = groups["당 줄이기 흐름"]
        add("K-당", " / ".join(g["items"]), **_source(sources, g["source_ids"]))
    if "명절 떡·디저트" in groups:
        g = groups["명절 떡·디저트"]
        add("K-명절떡", " / ".join(g["items"]), **_source(sources, g["source_ids"]))
    gifts = d.get("gift_etiquette") or []
    if gifts:
        add("K-선물", " / ".join(f"{g['title']}: {g['fact']}" for g in gifts), **_source(sources, ["vt_gift"]))
    prefs = d.get("color_preferences") or {}
    numbers = d.get("numbers") or {}
    if prefs or numbers:
        add("K-색숫자", "포장 권장 색 " + "·".join(c["color"] for c in prefs.get("prefer", []))
            + ", 피하는 색 " + "·".join(c["color"] for c in prefs.get("avoid", []))
            + " / 선호 숫자 " + "·".join(n["number"] for n in numbers.get("prefer", []))
            + ", 피하는 숫자 " + "·".join(n["number"] for n in numbers.get("avoid", [])),
            **_source(sources, ["vt_gift", "vt_superstition"]))
    notices = {n[0]: n for n in d.get("notices") or []}
    if "협찬·광고 표시" in notices:
        add("K-광고법", notices["협찬·광고 표시"][1] + " / 증빙 없는 최상급·비교·건강 효과 주장 금지",
            **_source(sources, ["law", "amend"]))
    for item in d.get("insight_evidence") or []:
        add(item["tag"], item["text"], **_source(sources, item["source_ids"]))
    if cards:
        evidence.update(card_evidence(cards, trend_date))
    return evidence


# ---------- 규칙 계산 ----------

def _months_ahead(start, count):
    return [((start.month - 1 + i) % 12) + 1 for i in range(count)]


def pick_fruits(trend, config, chosen, months_in_period):
    """찹쌀떡 활용 가능 → 인기 순위 → 실행 기간 안 검색 피크. 기간 안 피크가 부족하면 순위로 채우고 표시합니다."""
    fit = {f["id"] for f in config.get("fruit_flavors", []) if f.get("mochi_fit")}
    allowed = set(chosen) if chosen else fit
    tabs = [t for t in trend.get("seasonality") or [] if t.get("type") == "fruits"]
    peaks = {f["id"]: f.get("peak_months") or [] for t in tabs for f in t.get("fruits", [])}
    ranked = [f for f in trend.get("fruit_flavors") or [] if f["id"] in allowed and f.get("rank")]
    in_period = [f for f in ranked if set(peaks.get(f["id"], [])) & set(months_in_period)]
    picks = in_period[:FRUIT_PICKS]
    for f in ranked:
        if len(picks) >= FRUIT_PICKS:
            break
        if f not in picks:
            picks.append(f)
    result = []
    for i, f in enumerate(picks, start=1):
        in_window = [m for m in months_in_period if m in peaks.get(f["id"], [])]
        first_peak = in_window[0] if in_window else (peaks.get(f["id"]) or [None])[0]
        launch_month = ((first_peak - 1 - LAUNCH_LEAD_MONTHS) % 12) + 1 if first_peak else None
        if in_window and months_in_period.index(first_peak) < LAUNCH_LEAD_MONTHS:
            launch = f"즉시 (피크 {first_peak}월까지 {months_in_period.index(first_peak)}개월)"  # 2개월 앞당길 여유 없음
        else:
            launch = f"{launch_month}월 (피크 {first_peak}월 2개월 전)" if first_peak else "피크 데이터 없음"
        result.append({
            "rank": i, "id": f["id"], "name": f["name"], "interest": f["recent_average"], "change_rate": f.get("change_rate"),
            "peak_months": peaks.get(f["id"], []), "peak_in_period": bool(in_window),
            "launch_month": launch_month, "launch": launch, "tags": ["T-과일", "T-계절성"],
        })
    return result


# ---------- AI 호출 ----------

SYSTEM_PROMPT = """너는 한정선(한국 찹쌀떡·모찌 브랜드) 베트남 마케팅 분석가다. 독자는 경력 20년 차 글로벌 마케팅 담당자다.
규칙:
1. 사실 문장에는 반드시 evidence 목록의 태그만 tags 배열에 넣는다. 목록에 없는 태그를 만들지 않는다.
2. 숫자는 evidence 문장에 있는 숫자만 쓴다. 판매량·매출 예측, 가격 목표, 근거 없는 추측을 쓰지 않는다.
3. 데이터가 없으면 "[ ]"로 비우거나 "근거 부족"이라고 쓴다.
4. 과일 추천과 타임라인 월은 server_picks 값을 그대로 쓰고, 이유·제품 아이디어·할 일 문장만 쓴다.
5. 모든 문장은 한국어 명사형 또는 짧은 평서문. 결론을 먼저 쓴다.
6. 목표(goal)의 focus와 data를 결론·인사이트의 중심으로 삼는다. 선택한 채널만 channels에 쓴다.
8. 근거가 있으면 판단과 추천을 분명하게 쓴다(무엇을 먼저, 무엇은 피할지). D- 태그(의사결정 카드 계산)를 적극 인용한다.
9. card_opinions는 카드별 AI 의견 2~3문장: flavor=어떤 맛을 먼저·나중에, price=우리 가격을 어디에 둘지, channel=어떤 채널을 먼저.
7. budget이 없으면 예산이 드는 방식에는 "예산 확인 필요"를 붙인다.
JSON만 출력한다. 형식:
{"conclusion": "다음 N개월 동안 가장 먼저 할 일 한 문장",
 "insights": [{"fact": "", "tags": [], "meaning": "", "action": ""}] (3개),
 "fruits": [{"rank": 1, "reason": "", "idea": ""}] (server_picks.fruits 순서대로),
 "marketing": [{"method": "", "content": "", "tags": []}] (2~3개),
 "timeline": [{"step": 1, "action": "", "tags": []}] (server_picks.timeline 단계마다),
 "channels": [{"channel": "", "message": "", "content_packaging": "", "tags": []}],
 "positioning": {"text": "", "tags": []},
 "swot": {"S": [{"text": "", "tags": []}], "W": [...], "O": [...], "T": [{"text": "", "tags": [], "response": ""}]},
 "checks": [{"text": "", "tags": []}],
 "card_opinions": {"flavor": {"text": "", "tags": []}, "price": {"text": "", "tags": []}, "channel": {"text": "", "tags": []}},
 "opinions": [{"text": "", "tags": []}] (최대 4개, 의견마다 태그 2개 이상)}"""


def call_openai(payload):
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise InsightError("OPENAI_API_KEY가 설정되지 않아 AI 인사이트를 생성할 수 없습니다.", status=503)
    body = {"model": OPENAI_MODEL, "temperature": 0.3, "response_format": {"type": "json_object"},
            "messages": [{"role": "system", "content": SYSTEM_PROMPT},
                         {"role": "user", "content": json.dumps(payload, ensure_ascii=False)}]}
    request = urllib.request.Request(OPENAI_URL, data=json.dumps(body).encode("utf-8"), method="POST",
                                     headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=OPENAI_TIMEOUT) as response:
            data = json.loads(response.read().decode("utf-8"))
        return json.loads(data["choices"][0]["message"]["content"])
    except urllib.error.HTTPError as error:
        raise InsightError(f"AI 호출 실패 (HTTP {error.code}). 잠시 후 다시 시도해 주세요.", status=503) from None
    except (urllib.error.URLError, TimeoutError):
        raise InsightError("AI 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.", status=503) from None
    except (KeyError, IndexError, json.JSONDecodeError):
        raise InsightError("AI 응답을 해석하지 못했습니다. 다시 시도해 주세요.", status=503) from None


# ---------- 검증 ----------

NUMBER = re.compile(r"\d[\d,.]*")


def _numbers(text):
    return {n.replace(",", "").rstrip(".") for n in NUMBER.findall(str(text or ""))}


class Checker:
    """AI 문장을 근거 목록과 대조합니다. 버린 문장 수를 세어 화면에 알립니다."""

    def __init__(self, evidence, allowed_numbers=()):
        self.evidence = evidence
        self.allowed = set(allowed_numbers)
        self.dropped = 0

    def tags(self, item):
        return [t for t in dict.fromkeys(item.get("tags") or []) if t in self.evidence]

    def grounded(self, text, tags):
        """사실 문장의 숫자는 인용한 근거 문장(또는 서버가 정한 값)에 있어야 합니다."""
        known = set(self.allowed)
        for tag in tags:
            known |= _numbers(self.evidence[tag]["text"])
        return _numbers(text) <= known

    def facts(self, items, text_key, min_tags=1, limit=None):
        kept = []
        for item in items or []:
            if not isinstance(item, dict):
                continue
            tags = self.tags(item)
            if len(tags) < min_tags or not self.grounded(item.get(text_key), tags):
                self.dropped += 1
                continue
            kept.append({**item, "tags": tags})
        return kept[:limit] if limit else kept


def validate(raw, evidence, picks, months):
    allowed = {str(m) for m in months} | {str(p) for p in (1, 2, 3, 6, 12)}
    for f in picks:
        allowed |= {str(m) for m in f["peak_months"]} | {str(f["launch_month"])}
    check = Checker(evidence, allowed)
    raw = raw if isinstance(raw, dict) else {}
    swot = raw.get("swot") if isinstance(raw.get("swot"), dict) else {}
    threats = check.facts(swot.get("T"), "text")
    result = {
        "conclusion": str(raw.get("conclusion") or "").strip() or "근거 부족 · 결론 없음",
        "insights": check.facts(raw.get("insights"), "fact", limit=3),
        "fruits": [{**pick, **{k: v for k, v in (next((f for f in raw.get("fruits") or [] if isinstance(f, dict)
                                                      and f.get("rank") == pick["rank"]), {})).items() if k in ("reason", "idea")}}
                   for pick in picks],
        "marketing": check.facts(raw.get("marketing"), "content", limit=3),
        "timeline": [{**step, "action": next((t.get("action") for t in raw.get("timeline") or []
                                              if isinstance(t, dict) and t.get("step") == step["step"]), "")}
                     for step in months_steps(months)],
        "channels": [c for c in raw.get("channels") or [] if isinstance(c, dict)],
        "positioning": (lambda p: p if check.facts([p], "text") else {"text": "근거 부족 · ★ 경쟁사 데이터 수집 후 작성", "tags": []})(
            raw.get("positioning") if isinstance(raw.get("positioning"), dict) else {}),
        "swot": {"S": check.facts(swot.get("S"), "text"), "W": check.facts(swot.get("W"), "text"),
                 "O": check.facts(swot.get("O"), "text"),
                 "T": threats or [{"text": "근거 부족 · 위협 항목을 만들 데이터가 없음", "tags": [], "response": ""}]},
        "checks": check.facts(raw.get("checks"), "text"),
        "opinions": check.facts(raw.get("opinions"), "text", min_tags=2, limit=MAX_OPINIONS),
        "card_opinions": {key: (check.facts([value], "text") or [None])[0] for key, value in
                          (raw.get("card_opinions") or {}).items() if key in CARD_KEYS and isinstance(value, dict)},
    }
    for item in result["channels"]:
        item["tags"] = check.tags(item)
    result["dropped"] = check.dropped
    return result


def months_steps(months):
    return [{"step": i + 1, "month": m, "label": f"{i + 1}개월 차 ({m}월)"} for i, m in enumerate(months)]


# ---------- 생성 ----------

def generate(body, config, trend, guidelines, competitors, cards=None, today=None, ai=None):
    ai = ai or call_openai
    request = validate_input(body, config)
    today = today or date.today()
    months = _months_ahead(today, PERIODS[request["period"]])
    evidence = build_evidence(trend, guidelines, competitors, cards)
    picks = pick_fruits(trend, config, request["fruits"], months)
    goal = GOALS[request["goal"]]
    payload = {
        "input": {"goal": goal["label"], "focus": goal["focus"], "data": goal["data"],
                  "period_months": PERIODS[request["period"]],
                  "channels": [CHANNELS[c] for c in request["channels"]],
                  "budget": BUDGETS.get(request["budget"]), "memo": request["memo"] or None,
                  "country": "베트남", "city_focus": "다낭"},
        "evidence": list(evidence.values()),
        "server_picks": {"fruits": picks, "timeline": months_steps(months)},
    }
    result = validate(ai(payload), evidence, picks, months)
    limits = list(DATA_LIMITS)
    if not any(t.startswith("C-") for t in evidence):
        limits.append("★ 경쟁사 데이터가 없어 경쟁사 비교는 비어 있습니다.")
    if result["dropped"]:
        limits.append(f"근거가 확인되지 않은 AI 문장 {result['dropped']}개를 제외했습니다.")
    return {"input": {**request, "goal_label": goal["label"], "period_label": f"{PERIODS[request['period']]}개월",
                      "channel_labels": [CHANNELS[c] for c in request["channels"]]},
            "result": result, "evidence": evidence, "limits": limits, "generated_at": today.isoformat()}
