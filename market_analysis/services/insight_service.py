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


# ---------- 베트남 공휴일·기념일 (Open API 연동 + 마케팅 캘린더) ----------

NAGER_HOLIDAY_URL = "https://date.nager.at/api/v3/PublicHolidays/{year}/VN"
CALENDARIFIC_URL = "https://calendarific.com/api/v2/holidays?api_key={key}&country=VN&year={year}"
HOLIDAY_TIMEOUT = 4
_HOLIDAY_CACHE = {}

# 베트남 핵심 명절·상업 기념일 (20년 차 글로벌 마케터용 선물 수요·리드타임·패키징 기준)
VN_MARKETING_CALENDAR = [
    {
        "code": "new_year",
        "month": 1,
        "day": 1,
        "dates": {2026: "2026-01-01", 2027: "2027-01-01"},
        "name_ko": "신정 (Tết Dương lịch)",
        "name_vi": "Tết Dương lịch",
        "kind": "공휴일 · 연초 성수기",
        "demand": "연초 다낭 해외 관광객 및 젊은 층 카페·기념품 소비 증가",
        "lead_time": "D-21 (12월 초) 관광 채널 프로모션·SNS 캠페인 시작",
        "action": "공항·관광지 소포장 기프트 및 한국 찹쌀 디저트 체험팩 전면 배치",
    },
    {
        "code": "tet",
        "month": 2,
        "day": 17,
        "dates": {2026: "2026-02-17", 2027: "2027-02-06"},
        "name_ko": "베트남 설날 뗏 (Tết Nguyên Đán)",
        "name_vi": "Tết Nguyên Đán",
        "kind": "최대 명절 · 선물 성수기",
        "demand": "연중 최대 가족·귀성·기업 선물 성수기, 전통 찹쌀떡·과자 선물세트 수요 폭발",
        "lead_time": "D-45 (12월 말~1월 초) 선물세트 발주·사전예약 / D-21 집중 광고",
        "action": "빨강·금색·노랑 패키지, 선호 숫자(6·8·9개입) 프리미엄 선물상자 + 쇼핑백 구성",
    },
    {
        "code": "womens_day_intl",
        "month": 3,
        "day": 8,
        "dates": {2026: "2026-03-08", 2027: "2027-03-08"},
        "name_ko": "국제 여성의 날 (Quốc tế Phụ nữ 3/8)",
        "name_vi": "Quốc tế Phụ nữ",
        "kind": "핵심 선물 기념일",
        "demand": "남성이 여성 가족·연인·직장 동료에게 꽃과 프리미엄 디저트 세트를 선물하는 핵심 시즌",
        "lead_time": "D-21 (2월 중순) TikTok·Facebook·Zalo 기프트 캠페인 가동",
        "action": "분홍·연꽃 모티프 패키지, 과일 찹쌀떡 6·8개입 기프트 세트 및 메시지 카드 동봉",
    },
    {
        "code": "hung_kings",
        "month": 4,
        "day": 26,
        "dates": {2026: "2026-04-26", 2027: "2027-04-16"},
        "name_ko": "흥왕기념일 (Giỗ Tổ Hùng Vương)",
        "name_vi": "Giỗ Tổ Hùng Vương",
        "kind": "공휴일 · 전통 떡 기념일",
        "demand": "베트남 건국 신화 속 찹쌀떡(bánh chưng·bánh dày) 유래일로 찹쌀 디저트에 대한 문화적 친숙도 최고조",
        "lead_time": "D-14 (4월 초) 브랜드 스토리텔링 콘텐츠 배포",
        "action": "'한국과 베트남이 공유하는 정성스러운 찹쌀떡 문화' 스토리텔링 및 가족 간식 세트 제안",
    },
    {
        "code": "reunification_labor",
        "month": 4,
        "day": 30,
        "dates": {2026: "2026-04-30", 2027: "2027-04-30"},
        "name_ko": "남부해방기념일 · 노동절 연휴 (4/30~5/1)",
        "name_vi": "Ngày Giải phóng & Quốc tế Lao động",
        "kind": "황금연휴 · 관광 성수기",
        "demand": "4~5일 장기 연휴로 다낭 국내외 여행객 급증 및 더운 철(4~9월) 시원한 디저트 수요 상승",
        "lead_time": "D-30 (3월 말) 다낭 매장·기념품점 재고 확대 및 보냉 패키지 점검",
        "action": "차갑게 먹는 과일·아이스 찹쌀떡 시식 행사 및 여행객 휴대용 보냉 기프트팩 운영",
    },
    {
        "code": "national_day",
        "month": 9,
        "day": 2,
        "dates": {2026: "2026-09-02", 2027: "2027-09-02"},
        "name_ko": "베트남 독립기념일 연휴 (Quốc khánh 9/2)",
        "name_vi": "Quốc khánh",
        "kind": "공휴일 · 가을 연휴",
        "demand": "가을 연휴 가족 모임·여행 수요 및 중추절 선물 시즌 개막과 맞물리는 시점",
        "lead_time": "D-21 (8월 중순) 연휴 간식 프로모션 + 중추절 얼리버드 동시 오픈",
        "action": "가족 공유용 다맛(믹스) 패키지 구성 및 국가 상징(국기·국장) 상업적 오남용 엄격 주의",
    },
    {
        "code": "mid_autumn",
        "month": 9,
        "day": 25,
        "dates": {2026: "2026-09-25", 2027: "2027-09-15"},
        "name_ko": "중추절 · 추석 (Tết Trung Thu)",
        "name_vi": "Tết Trung Thu",
        "kind": "2대 명절 · B2B/선물 성수기",
        "demand": "명절 2개월 전(7~8월)부터 선물 시장이 과열되며, 최근 저당·과일 스노우스킨(찹쌀피) 디저트가 젊은 층에서 대유행",
        "lead_time": "D-60~D-45 (7월 말~8월 초) 기업 B2B·유통사 사전예약 및 한정판 출시",
        "action": "기존 고당도 월병을 대체하는 '담백한 저당 한국 수제 과일 찹쌀떡 선물세트'로 차별화 포지셔닝",
    },
    {
        "code": "womens_day_vn",
        "month": 10,
        "day": 20,
        "dates": {2026: "2026-10-20", 2027: "2027-10-20"},
        "name_ko": "베트남 여성의 날 (Ngày Phụ nữ Việt Nam 10/20)",
        "name_vi": "Ngày Phụ nữ Việt Nam",
        "kind": "하반기 핵심 선물 기념일",
        "demand": "3/8과 함께 여성 대상 선물 수요가 가장 집중되는 날로, 감각적인 패키징과 SNS 언박싱이 구매를 좌우",
        "lead_time": "D-21 (9월 말) TikTok Shop 라이브·인플루언서 언박싱 캠페인",
        "action": "피하는 숫자(4개입)와 흰색·검정 단색 포장을 피하고, 분홍·금색 포인트 6·8개입 선물박스 출시",
    },
    {
        "code": "teachers_day",
        "month": 11,
        "day": 20,
        "dates": {2026: "2026-11-20", 2027: "2027-11-20"},
        "name_ko": "베트남 스승의 날 (Ngày Nhà giáo Việt Nam 11/20)",
        "name_vi": "Ngày Nhà giáo Việt Nam",
        "kind": "핵심 감사 선물 기념일",
        "demand": "학생·학부모가 교사에게 감사를 표하는 전국적 기념일로, 부담 없으면서 격식 있는 디저트·차 세트 선호",
        "lead_time": "D-21 (10월 말) 학부모·학생 타깃 Facebook·Zalo 선물 추천 광고",
        "action": "10만~30만 VND 가격대의 단정한 손잡이형 기프트 박스 및 차(Tea)·커피 페어링 메시지 소구",
    },
    {
        "code": "year_end",
        "month": 12,
        "day": 25,
        "dates": {2026: "2026-12-25", 2027: "2027-12-25"},
        "name_ko": "크리스마스 · 연말 선물 & 뗏 사전예약 (12월)",
        "name_vi": "Giáng sinh & Cuối năm",
        "kind": "연말 시즌 · 뗏 얼리버드",
        "demand": "Z세대 중심 연말 홈파티·카페 디저트 소비 증가 및 1~2월 뗏(설) 기업 선물 사전 발주 시작",
        "lead_time": "D-21 (12월 초) 연말 에디션 출시 및 뗏 선물세트 B2B 프리오더 동시 개시",
        "action": "연말 파티용 믹스팩 판매와 동시에 뗏(Tết) 프리미엄 선물세트 조기 예약 혜택 연계",
    },
]


def _fetch_open_api_holidays(year):
    """Calendarific(키가 있을 때) 또는 Nager.Date 공개 Open API에서 베트남 공휴일 일정을 가져옵니다."""
    if year in _HOLIDAY_CACHE:
        return _HOLIDAY_CACHE[year]
    found = {}
    api_source = None
    cal_key = os.environ.get("CALENDARIFIC_API_KEY", "").strip()
    if cal_key:
        try:
            url = CALENDARIFIC_URL.format(key=cal_key, year=year)
            req = urllib.request.Request(url, headers={"User-Agent": "Hanjeongseon-MarketAnalysis/1.0"})
            with urllib.request.urlopen(req, timeout=HOLIDAY_TIMEOUT) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            for h in (data.get("response") or {}).get("holidays") or []:
                iso = str(((h.get("date") or {}).get("iso") or ""))[:10]
                if len(iso) == 10:
                    found[iso] = h.get("name") or ""
            if found:
                api_source = "Calendarific Open API"
        except (urllib.error.URLError, TimeoutError, ValueError, KeyError, OSError):
            found = {}
    if not found:
        try:
            url = NAGER_HOLIDAY_URL.format(year=year)
            req = urllib.request.Request(url, headers={"User-Agent": "Hanjeongseon-MarketAnalysis/1.0"})
            with urllib.request.urlopen(req, timeout=HOLIDAY_TIMEOUT) as resp:
                rows = json.loads(resp.read().decode("utf-8"))
            for h in rows if isinstance(rows, list) else []:
                iso = str(h.get("date") or "")[:10]
                if len(iso) == 10:
                    found[iso] = h.get("localName") or h.get("name") or ""
            if found:
                api_source = "Nager.Date Open API"
        except (urllib.error.URLError, TimeoutError, ValueError, KeyError, OSError):
            found = {}
    result = {"dates": found, "source": api_source}
    if found:
        _HOLIDAY_CACHE[year] = result
    return result


def build_vn_holidays(today, months_in_period, fetch_live=False):
    """2026년 기준 베트남 주요 공휴일·기념일 마케팅 일정을 생성합니다."""
    today = today or date.today()
    target_year = 2026
    api_sources = []
    api_dates = {}
    if fetch_live:
        res = _fetch_open_api_holidays(target_year)
        if res.get("source") and res["source"] not in api_sources:
            api_sources.append(res["source"])
        api_dates.update(res.get("dates") or {})
    prep_months = {((m % 12) + 1) for m in months_in_period} | {(((m + 1) % 12) + 1) for m in months_in_period}
    items = []
    for entry in VN_MARKETING_CALENDAR:
        m = entry["month"]
        iso_date = entry["dates"].get(target_year, f"{target_year}-{m:02d}-{entry['day']:02d}")
        if api_dates:
            matched_iso = next((d for d in sorted(api_dates) if d.startswith(f"{target_year}-{m:02d}-") and d == iso_date), None)
            if matched_iso:
                iso_date = matched_iso
        in_period = m in months_in_period
        in_prep = (not in_period) and (m in prep_months)
        items.append({
            "code": entry["code"],
            "date": iso_date,
            "month": m,
            "name": entry["name_ko"],
            "name_vi": entry["name_vi"],
            "kind": entry["kind"],
            "demand": entry["demand"],
            "lead_time": entry["lead_time"],
            "action": entry["action"],
            "in_period": in_period,
            "in_prep": in_prep,
            "status": entry["kind"],
        })
    # 날짜순(월·일 순)으로 정렬하되 실행 기간/준비 기간 해당 월이 있으면 먼저 선택하여 날짜순 배치
    matched = [x for x in items if x["in_period"] or x["in_prep"]]
    matched.sort(key=lambda x: x["date"])
    others = [x for x in items if not (x["in_period"] or x["in_prep"])]
    others.sort(key=lambda x: x["date"])
    ordered = matched + others
    source_label = (" · ".join(api_sources) + " · Vietnam Tourism") if api_sources else "Nager.Date Open API · Vietnam Tourism"
    return {"items": ordered, "source": source_label, "as_of": today.isoformat()}


# ---------- 근거 목록 ----------

def _source(sources, ids):
    found = [sources[i] for i in ids if i in sources]
    return {"source": " · ".join(s["publisher"] for s in found) or "출처 미확인",
            "as_of": " · ".join(str(s.get("checked_date") or s.get("date") or "") for s in found)}


def _pct(value):
    return "-" if value is None else f"{value:+.1f}%"


def build_evidence(trend, guidelines, competitors, cards=None, holidays=None, basic=None, competitor_meta=None):
    """태그 → {tag, text, source, date}. 데이터가 없는 태그는 만들지 않습니다(AI가 쓸 수 없음).

    cards(의사결정 카드 계산 결과)를 주면 D- 근거(맛기회·가격·채널)를 함께 만듭니다.
    holidays(베트남 공휴일·기념일 일정)를 주면 K-기념일 근거를 함께 만듭니다.
    basic(World Bank Open API 국가 지표)을 주면 K-거시 근거를 함께 만듭니다.
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
        if price and pack:
            return f"개당 약 {round(price / pack):,}동"
        if c.get("price_per_piece_min"):
            pmin, pmax = c.get("price_per_piece_min"), c.get("price_per_piece_max")
            return f"개당 {pmin:,}~{pmax:,}동" if pmax and pmax != pmin else f"개당 약 {pmin:,}동"
        return f"{price:,}동" if price else "가격 미확인"

    core = [c for c in competitors if c.get("is_core")]  # 경쟁사 탭에서 ★로 표시한 제품
    if core:
        add("C-★", " / ".join(
            f"{c.get('brand')} {c.get('product_ko') or c.get('product')}: {piece_price(c)}, 메시지 '{c.get('key_message') or c.get('takeaway') or '-'}'"
            for c in core[:6]), "경쟁사 실측 조사표", str(max((c.get("surveyed_at") or "") for c in core)))
    if competitor_meta and competitor_meta.get("summary"):
        cs = competitor_meta["summary"]
        add("C-마케팅", f"베트남 모찌·찹쌀디저트 경쟁 제품 {cs.get('product_count', 54)}개·판매처 {cs.get('seller_count', 16)}곳 실측 조사(100g당 중앙값 {cs.get('per100_median', 25833):,}동). 다낭 오프라인 매장 확인 브랜드는 {', '.join(cs.get('danang_store_brands') or ['Mochi Sweets'])}뿐이며 대다수 수입 모찌는 상온 과자류로 유통",
            "경쟁사 실측 조사표 · TikTok/Meta 광고 라이브러리", str(competitor_meta.get("as_of") or trend_date))

    if basic and basic.get("indicators"):
        inds = {i["id"]: i for i in basic["indicators"]}
        pop = inds.get("population", {}).get("value", 101598527)
        gdp = round(float(inds.get("gdp_per_capita", {}).get("value", 5066)))
        urb = round(float(inds.get("urban_population", {}).get("value", 38.8)), 1)
        wb_src = (basic.get("source") or {}).get("title") or "World Bank Open Data (WDI)"
        wb_date = (basic.get("source") or {}).get("last_updated") or basic.get("checked_at") or trend_date
        add("K-거시", f"베트남 인구 약 1억 명({pop:,}명), 1인당 GDP {gdp:,} USD, 도시화율 {urb}% — 젊은 소비층과 대도시·관광지 중심 프리미엄 디저트 구매력 성장",
            wb_src, wb_date)

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
    if holidays and holidays.get("items"):
        focused = [h for h in holidays["items"] if h.get("in_period") or h.get("in_prep")][:5] or holidays["items"][:4]
        add("K-기념일", " / ".join(
            f"{h['name']}({h['date']}, {h['month']}월, {h['status']}): {h['demand']} · 권장 {h['action']} ({h['lead_time']})"
            for h in focused), holidays.get("source") or "Nager.Date Open API · Vietnam Tourism", holidays.get("as_of") or trend_date)
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

SYSTEM_PROMPT = """너는 한정선(한국 프리미엄 과일 찹쌀떡·모찌 브랜드)의 베트남 시장 진출 전략 수석 컨설턴트다. 독자는 경력 20년 차 한정선 글로벌 마케팅 총괄 담당자다.
규칙:
1. 모든 사실·수치 문장에는 반드시 evidence 목록에 존재하는 태그만 tags 배열에 넣는다(예: ["K-다낭", "T-과일"]). 목록에 없는 태그를 절대 만들지 않는다.
2. 숫자는 반드시 인용한 tags의 evidence 원문에 있는 숫자(또는 server_picks의 월·순위)만 사용한다. 판매량·매출 예측, 임의의 수치 추측은 절대 쓰지 않는다.
3. 데이터가 없으면 "근거 부족"이라고 쓴다.
4. 과일 추천과 타임라인 월은 server_picks 값을 그대로 쓰고, 각 월의 베트남 기념일(K-기념일)·과일 피크(T-계절성)·관광 성수기(T-관광)와 연결된 구체적 실행 과제를 쓴다.
5. 모든 문장은 20년 차 실무 책임자가 즉시 의사결정에 쓸 수 있도록 명확하고 간결한 한국어 비즈니스 문체로 작성하며, 결론을 먼저 제시한다.
6. 목표(goal)의 focus와 data를 결론·인사이트의 중심으로 삼고, 선택한 채널만 channels에 쓴다.
7. D- 태그(D-맛기회, D-가격, D-채널), K-기념일(Open API 베트남 기념일), K-거시(World Bank Open API), C-★·C-마케팅(경쟁사 실측), K-광고법·K-색숫자·K-라벨을 적극 교차 인용한다.
8. swot(S·W·O·T)은 대시보드 요약과 외부 검증 자료(World Bank, Calendarific/Nager.Date Open API, Google Trends, DataReportal, Metric, B&Company, 다낭시 관광청, 베트남 국회 법률)를 바탕으로 S·W·O·T 각 3개씩 구체적으로 작성하고, 모든 항목에 반드시 evidence의 유효한 tags를 1개 이상 넣는다. T(위협)에는 대응 방안(response)도 함께 쓴다.
9. checks에는 베트남 광고법(K-광고법), 외국어 표기 비율(K-언어), 식품 라벨 시행령(K-라벨), 지도·상징물 금기(K-지도), 포장 색상·숫자 금기(K-색숫자) 중 핵심 리스크 점검 사항을 3~4개 작성한다.
10. opinions에는 2개 이상의 근거 태그를 교차 결합한 고도화된 전략 제언(맛 포트폴리오, 가격 포지셔닝, 채널·기념일 시즌 캠페인, 리스크 관리)을 3~4개 작성한다.
JSON만 출력한다. 형식:
{"conclusion": "다음 N개월 동안 가장 먼저 실행할 핵심 전략 한 문장",
 "insights": [{"fact": "", "tags": [], "meaning": "", "action": ""}] (3개),
 "fruits": [{"rank": 1, "reason": "", "idea": ""}] (server_picks.fruits 순서대로),
 "marketing": [{"method": "", "content": "", "tags": []}] (3개),
 "timeline": [{"step": 1, "action": "", "tags": []}] (server_picks.timeline 단계마다),
 "channels": [{"channel": "", "message": "", "content_packaging": "", "tags": []}],
 "positioning": {"text": "", "tags": []},
 "swot": {"S": [{"text": "", "tags": []}] (3개), "W": [{"text": "", "tags": []}] (3개), "O": [{"text": "", "tags": []}] (3개), "T": [{"text": "", "tags": [], "response": ""}] (3개)},
 "checks": [{"text": "", "tags": []}] (3~4개),
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
    found = set()
    for raw in NUMBER.findall(str(text or "")):
        clean = raw.replace(",", "").rstrip(".")
        if not clean:
            continue
        found.add(clean)
        if "." in clean:
            try:
                val = float(clean)
                found.add(str(int(val)))
                found.add(str(round(val)))
            except ValueError:
                pass
    return found


class Checker:
    """AI 문장을 근거 목록과 대조합니다. 버린 문장 수를 세어 화면에 알립니다."""

    def __init__(self, evidence, allowed_numbers=()):
        self.evidence = evidence
        self.allowed = set(allowed_numbers)
        self.dropped = 0

    def tags(self, item):
        raw_tags = item.get("tags") or []
        cleaned = [str(t).strip().strip("[]") for t in raw_tags if t]
        return [t for t in dict.fromkeys(cleaned) if t in self.evidence]

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


def _supplement_swot(swot, evidence):
    """OpenAI 응답에서 일부 SWOT 칸이 누락되거나 태그 검증에서 빠졌을 때, 대시보드·외부 검증 근거로 보강합니다."""
    defaults = {
        "S": [
            ({"D-맛기회", "T-과일"}, "코코넛·바나나·망고 등 베트남 현지 인기 과일과 결합 가능한 한국식 수제 과일 찹쌀떡 라인업 보유"),
            ({"K-당", "K-디저트"}, "고당도 음료를 줄이는 베트남 소비자(82%) 및 저당 스노우스킨 디저트 유행에 부합하는 담백한 찹쌀 디저트 포지셔닝"),
            ({"K-다낭", "K-선물"}, "다낭 국제 관광객 1위(한국) 인지도와 명절·기념일 과자(bánh kẹo) 선물 문화에 적합한 프리미엄 개별 포장 구성"),
        ],
        "W": [
            ({"C-★", "C-마케팅"}, "다낭 Vincom·호이안 오프라인 매장을 선점한 Mochi Sweets 및 저가 대만·일본 상온 모찌 대비 현지 초기 브랜드 인지도 부족"),
            ({"K-선물", "D-가격"}, "고온다습한 베트남 기후 특성상 냉장·생과일 찹쌀떡 유통 시 콜드체인·보냉 패키징 비용 및 상온 수입 모찌 대비 높은 단가 부담"),
            ({"K-이커머스", "D-채널"}, "Shopee(56.04%)·TikTok Shop(41.31%) 중심 현지 이커머스 공식몰(Mall) 리뷰·판매 레퍼런스 초기 구축 필요"),
        ],
        "O": [
            ({"K-다낭", "T-관광"}, "한국-다낭 직항 주 150편 및 연간 한국인 방문객 100만 명 돌파로 공항·관광지 기념품 및 K-디저트 체험 수요 확대"),
            ({"K-기념일", "K-명절떡"}, "뗏(설)·중추절·여성의 날(3/8·10/20)·스승의 날(11/20) 등 연중 촘촘한 베트남 선물 시즌과 찹쌀떡 선물 전통"),
            ({"K-채널", "K-이커머스"}, "TikTok 광고 도달 7,610만·Zalo 월간 이용자 7,830만 및 TikTok Shop(+60.96% 성장)을 통한 숏폼·메신저 커머스 고속 성장"),
        ],
        "T": [
            ({"C-★", "D-가격"}, "대만(Royal Family)·일본(Seiki) 상온 포장 모찌 및 현지 냉장 '찍어 먹는 모찌'의 공격적인 저가·대량 유통 경쟁",
             "단순 상온 간식이 아닌 '한국 프리미엄 과일 찹쌀떡 기프트(6·8·9개입)'로 선물·관광 세그먼트 차별화"),
            ({"K-광고법", "K-라벨"}, "2026년 개정 베트남 광고법(협찬 표시·비교/최상급 증빙 의무) 및 식품 라벨 시행령(37/2026) 등 현지 규제 강화",
             "베트남어 원문·실물 라벨 필수 표기 준수 및 최상급('1위·최고') 대신 원재료·식감 중심 콘텐츠 검수"),
            ({"K-지도", "K-색숫자"}, "국가 상징·지도(구단선) 논란 시 즉각적 불매 운동 위험 및 포장 색상(흰·검)·숫자(4)에 대한 문화적 금기",
             "빨강·금색·분홍 패키지 및 6·8개입 구성을 표준화하고 현지인 사전 검수 프로세스 의무화"),
        ],
    }
    for key, candidates in defaults.items():
        current = list(swot.get(key) or [])
        # 기본 "근거 부족" 플레이스홀더 제거
        current = [x for x in current if not str(x.get("text") or "").startswith("근거 부족")]
        existing_texts = {x.get("text") for x in current}
        for entry in candidates:
            if len(current) >= 3:
                break
            req_tags, text = entry[0], entry[1]
            response = entry[2] if len(entry) > 2 else ""
            matched_tags = [t for t in req_tags if t in evidence]
            if matched_tags and text not in existing_texts:
                item = {"text": text, "tags": matched_tags}
                if key == "T":
                    item["response"] = response
                current.append(item)
                existing_texts.add(text)
        if key == "T" and not current:
            current = [{"text": "근거 부족 · 위협 항목을 만들 데이터가 없음", "tags": [], "response": ""}]
        swot[key] = current[:3]
    return swot


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
        "opinions": check.facts(raw.get("opinions"), "text", min_tags=2, limit=MAX_OPINIONS)
    }
    for item in result["channels"]:
        item["tags"] = check.tags(item)
    result["dropped"] = check.dropped
    return result


def months_steps(months):
    return [{"step": i + 1, "month": m, "label": f"{i + 1}개월 차 ({m}월)"} for i, m in enumerate(months)]


# ---------- 생성 ----------

def generate(body, config, trend, guidelines, competitors, cards=None, today=None, ai=None, basic=None, competitor_meta=None):
    fetch_live = ai is None
    ai = ai or call_openai
    request = validate_input(body, config)
    today = today or date.today()
    months = _months_ahead(today, PERIODS[request["period"]])
    holidays = build_vn_holidays(today, months, fetch_live=fetch_live)
    evidence = build_evidence(trend, guidelines, competitors, cards, holidays=holidays, basic=basic, competitor_meta=competitor_meta)
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
    result["swot"] = _supplement_swot(result["swot"], evidence)
    limits = list(DATA_LIMITS)
    if not any(t.startswith("C-") for t in evidence):
        limits.append("★ 경쟁사 데이터가 없어 경쟁사 비교는 비어 있습니다.")
    if result["dropped"]:
        limits.append(f"근거가 확인되지 않은 AI 문장 {result['dropped']}개를 제외했습니다.")
    return {"input": {**request, "goal_label": goal["label"], "period_label": f"{PERIODS[request['period']]}개월",
                      "channel_labels": [CHANNELS[c] for c in request["channels"]]},
            "result": result, "evidence": evidence, "cards": cards or {}, "holidays": holidays,
            "limits": limits, "generated_at": today.isoformat()}
