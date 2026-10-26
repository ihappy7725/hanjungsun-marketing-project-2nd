"""트렌드 데이터 검증·계산·정규화와 화면용 응답 생성."""
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from statistics import mean
from urllib.parse import urlencode

VN_TZ = timezone(timedelta(hours=7))
RECENT_WEEKS = 12  # 기본 지표: 최근 12주 vs 전년 동기 12주
SHORT_WEEKS = 4    # 보조 지표: 최근 4주 vs 직전 4주
MIN_COVERAGE = 0.7
MIN_INTEREST = 5
RISING_THRESHOLD = 50  # 전년 동기 대비 +50% 이상이면 "급상승" 배지
DELAY_GRACE = timedelta(hours=48)
MIN_AD_CASES = 20
PEAK_THRESHOLD = 90
FLAT_MIN_INDEX = 80  # 모든 달이 이 값 이상이면 계절성이 없는 연중 수요로 봅니다
WINDOW_RATIO = 0.5   # 주 단위 '수요 높은 기간' = 정점의 50% 이상이 이어지는 구간
WINDOW_MAX_WEEKS = 26  # 그 구간이 반년을 넘으면 특정 시기를 타지 않는 것으로 봅니다
MAX_PER_REQUEST = 5
MAX_RANK_CANDIDATES = 9  # 카테고리별 상품 후보 최대 개수 (5개 초과분은 기준 검색어로 환산)
MAX_RISING_PRODUCTS = 3  # 순위표 아래 "새로 뜨는 검색어" 최대 개수
# 관련 주제 중 식품으로 보는 종류(Google이 붙이는 type, 소문자 부분 일치). 베트남어(hl=vi) 응답 기준
FOOD_TOPIC_TYPES = ("món ăn", "thực phẩm", "thức ăn", "đồ ăn", "ẩm thực", "bánh", "kẹo", "tráng miệng",
                    "đồ uống", "thức uống", "trái cây", "hoa quả", "kem", "food", "dish", "dessert", "confection")

# 권장 갱신 주기 (주 2회 = 3.5일)
REFRESH_INTERVALS = {
    "categories": timedelta(days=3.5),
    "rankings": timedelta(days=3.5),
    "fruit_flavors": timedelta(days=3.5),
    "regions": timedelta(days=7),
    "related": timedelta(days=7),
    "seasonality": timedelta(days=30),
    "ads": timedelta(days=7),
}
SECTIONS = tuple(REFRESH_INTERVALS)
SERPAPI_SECTIONS = tuple(name for name in SECTIONS if name != "ads")

SOURCE_SEARCH = "SerpApi Google Trends"
SOURCE_ADS = "TikTok Creative Center"


def now_vn():
    return datetime.now(VN_TZ).replace(microsecond=0)


def round1(value):
    return None if value is None else round(value, 1)


def trend_period(config, now):
    """전년 동기 비교에 필요한 최근 period_days일(주간 데이터) 범위."""
    end = now.date()
    return f"{end - timedelta(days=config['period_days'])} {end}"


def trends_url(queries, date, geo="VN"):
    return "https://trends.google.com/trends/explore?" + urlencode({"date": date, "geo": geo, "q": ",".join(queries)})


# ---------------------------------------------------------------- 계산


def parse_timeseries(raw, queries):
    """SerpApi TIMESERIES 응답 -> (전체 날짜 목록, {query: {date: interest}}).

    응답에 값이 없는 날짜는 비워 둡니다. 누락을 0으로 바꾸지 않습니다.
    여러 검색어가 같은 날 모두 0이면 Google Trends 수집 공백으로 보고 누락 처리합니다.
    """
    timeline = (raw.get("interest_over_time") or {}).get("timeline_data") or []
    dates, values = [], {query: {} for query in queries}
    for point in timeline:
        try:
            day = datetime.fromtimestamp(int(point["timestamp"]), tz=timezone.utc).date()
        except (KeyError, TypeError, ValueError):
            continue
        if point.get("partial_data"):
            continue  # 아직 집계 중인 마지막 주는 제외
        dates.append(day)
        point_values = point.get("values") or []
        if len(point_values) > 1 and all(item.get("extracted_value") == 0 for item in point_values):
            continue
        by_position = len(point_values) == len(queries)
        for index, item in enumerate(point_values):
            query, value = item.get("query"), item.get("extracted_value")
            if query not in values and by_position:
                query = queries[index]  # 결합 검색어는 응답 표기가 다를 수 있어 요청 순서로 매칭
            if query in values and isinstance(value, (int, float)):
                values[query][day] = float(value)
    return sorted(set(dates)), values


def change_rate(current, base):
    if current is None or not base:
        return None
    return (current - base) / base * 100


def trend_stats(dates, series, end=None):
    """주간 데이터로 최근 12주 평균, 전년 동기 대비 증감률, 최근 4주 대비 직전 4주 증감률을 계산합니다.

    전년 동기 = 52주 전의 같은 12주. 같은 계절끼리 비교하므로 계절 변동이 증감률에 섞이지 않습니다.
    """
    if not dates:
        return {"recent_average": None, "year_ago_average": None, "change_rate": None,
                "short_change_rate": None, "is_new": False, "coverage": 0.0, "data_status": "insufficient"}
    end = end or dates[-1]

    def window(stop, weeks):
        start = stop - timedelta(weeks=weeks) + timedelta(days=1)
        expected = [day for day in dates if start <= day <= stop]
        found = [series[day] for day in expected if day in series]
        return (mean(found) if found else None), (len(found) / len(expected) if expected else 0.0)

    recent_average, recent_coverage = window(end, RECENT_WEEKS)
    year_ago_average, year_ago_coverage = window(end - timedelta(weeks=52), RECENT_WEEKS)
    short_average, short_coverage = window(end, SHORT_WEEKS)
    short_previous, short_previous_coverage = window(end - timedelta(weeks=SHORT_WEEKS), SHORT_WEEKS)

    coverage = min(recent_coverage, year_ago_coverage)
    short_rate = None
    if min(short_coverage, short_previous_coverage) >= MIN_COVERAGE:
        short_rate = change_rate(short_average, short_previous)
    insufficient = coverage < MIN_COVERAGE or recent_average is None
    # 1년 전에는 검색이 없었고 지금은 있는 경우: 증감률은 계산할 수 없지만 새로 생긴 관심입니다.
    is_new = year_ago_average == 0 and (recent_average or 0) >= MIN_INTEREST
    return {
        "recent_average": round1(recent_average),
        "year_ago_average": round1(year_ago_average),
        "change_rate": round1(change_rate(recent_average, year_ago_average)),
        "short_change_rate": round1(short_rate),
        "is_new": is_new,
        "coverage": round(coverage, 2),
        "data_status": "insufficient" if insufficient else "normal",
    }


def monthly_seasonality(dates, series):
    """같은 달의 관심도를 연도와 관계없이 평균합니다. 12개월 미만이면 데이터 부족입니다."""
    found = sorted(day for day in dates if day in series)
    if not found or (found[-1] - found[0]).days < 364:
        return [{"month": month, "interest": None} for month in range(1, 13)], "insufficient"
    buckets = defaultdict(list)
    for day in found:
        buckets[day.month].append(series[day])
    months = [{"month": month, "interest": round1(mean(buckets[month])) if buckets[month] else None}
              for month in range(1, 13)]
    status = "normal" if all(item["interest"] is not None for item in months) else "insufficient"
    # 가장 높은 달 = 100 으로 환산한 지수
    peak = max((item["interest"] for item in months if item["interest"] is not None), default=0)
    for item in months:
        item["index"] = round(item["interest"] / peak * 100) if peak and item["interest"] is not None else None
    return months, status


def peak_months(months, threshold=PEAK_THRESHOLD, limit=3):
    """지수가 threshold 이상인 달(최대 limit개)을 높은 순서로 반환합니다. 최소 1개는 포함합니다."""
    ranked = sorted((item for item in months if item.get("index") is not None), key=lambda item: -item["index"])
    peaks = [item["month"] for item in ranked if item["index"] >= threshold][:limit]
    return peaks or [item["month"] for item in ranked[:1]]


def weekly_window(dates, series, ratio=WINDOW_RATIO, max_weeks=WINDOW_MAX_WEEKS):
    """연도와 관계없이 '몇 월 몇째 주'별 평균으로 수요가 높은 기간을 찾습니다.

    정점 = 평균이 가장 높은 주. 시작·끝 = 정점에서 앞뒤로 정점의 ratio 이상이 이어지는 마지막 주.
    연말에서 연초로 넘어가는 기간(예: 12월 1주 ~ 2월 2주)도 이어서 봅니다.
    한 달은 4주로 나눕니다(29~31일은 4주). 5주차는 표본이 적어 값이 튀기 때문입니다.
    기간이 max_weeks를 넘거나 모든 주가 ratio 이상이면 특정 시기를 타지 않으므로 year_round로 알립니다.
    """
    slots = defaultdict(list)
    for day in dates:
        if day in series:
            slots[(day.month, min((day.day - 1) // 7 + 1, 4))].append(series[day])
    if not slots:
        return None
    order = sorted(slots)
    averages = [mean(slots[slot]) for slot in order]
    peak_index = max(range(len(order)), key=lambda i: averages[i])
    peak = averages[peak_index]
    if not peak:
        return None
    if min(averages) >= peak * ratio:
        return {"year_round": True}

    def edge(step):
        index = peak_index
        while averages[(index + step) % len(order)] >= peak * ratio:
            index += step
        return index

    start, end = edge(-1), edge(1)
    if end - start + 1 > max_weeks:
        return {"year_round": True}
    as_dict = lambda index: {"month": order[index % len(order)][0], "week": order[index % len(order)][1]}
    return {"start": as_dict(start), "peak": as_dict(peak_index), "end": as_dict(end), "ratio": ratio}


def rank_items(items):
    """두 기준으로 순위를 매깁니다. 관심도 5 미만이거나 데이터가 부족한 항목은 순위에서 제외합니다.

    rank        = 인기순: 최근 12주 평균 관심도
    growth_rank = 성장순: 전년 동기 대비 증감률 ("신규"가 가장 앞)
    """
    for item in items:
        if item["recent_average"] is None or item["recent_average"] < MIN_INTEREST:
            item["data_status"] = "insufficient"
        item["is_rising"] = item["data_status"] == "normal" and (item.get("change_rate") or 0) >= RISING_THRESHOLD
        item["rank"] = item["growth_rank"] = None
    normal = [item for item in items if item["data_status"] == "normal"]
    for rank, item in enumerate(sorted(normal, key=lambda item: -item["recent_average"]), start=1):
        item["rank"] = rank
    growing = [item for item in normal if item.get("is_new") or item.get("change_rate") is not None]
    growing.sort(key=lambda item: (not item.get("is_new"), -(item.get("change_rate") or 0)))
    for rank, item in enumerate(growing, start=1):
        item["growth_rank"] = rank
    return sorted(normal, key=lambda item: item["rank"]) + [item for item in items if item["data_status"] != "normal"]


def anchor_batches(queries):
    """검색어가 5개를 넘으면 첫 검색어를 기준(anchor)으로 [기준 + 4개]씩 나눕니다."""
    if len(queries) <= MAX_PER_REQUEST:
        return [queries]
    anchor, others, size = queries[0], queries[1:], MAX_PER_REQUEST - 1
    return [[anchor, *others[start:start + size]] for start in range(0, len(others), size)]


def anchor_scale(batches, anchor):
    """5개씩 나눈 TIMESERIES를 공통 기준 검색어(anchor)로 첫 요청 기준에 맞춰 환산합니다.

    batches: [(dates, {query: {date: value}})]. 반환: (dates, {query: {date: value}})
    """
    base_dates, base_values = batches[0]
    base_mean = mean(base_values[anchor].values()) if base_values.get(anchor) else None
    merged = {anchor: base_values.get(anchor, {})}
    for dates, values in batches:
        anchor_mean = mean(values[anchor].values()) if values.get(anchor) else None
        if not base_mean or not anchor_mean:
            raise ValueError(f"기준 검색어 '{anchor}' 데이터가 없어 관심도를 환산할 수 없습니다.")
        factor = base_mean / anchor_mean
        for query, series in values.items():
            if query != anchor:
                merged[query] = {day: value * factor for day, value in series.items()}
    return base_dates, merged


def parse_regions(raw, region_labels):
    rows = []
    for item in raw.get("interest_by_region") or []:
        value = item.get("extracted_value")
        if not isinstance(value, (int, float)):
            continue
        geo = item.get("geo", "")
        rows.append({
            "geo": geo,
            "name": region_labels.get(geo) or item.get("location", geo),
            "location": item.get("location", geo),
            "interest": value,
        })
    rows.sort(key=lambda row: -row["interest"])
    for rank, row in enumerate(rows, start=1):
        row["rank"] = rank
        row["data_status"] = "normal"  # 0 = 그 지역 검색이 적음(데이터 부족 아님, 2026-10-26 담당자 결정)
    return rows


def combine_regions(by_category):
    """카테고리별 지역 관심도(각 1위 지역 = 100) -> 카테고리 등수의 평균으로 매긴 종합 순위.

    카테고리마다 지수 높은 순으로 등수를 매기고(동점은 같은 등수들의 평균), 등수 평균이 낮을수록 상위입니다.
    카테고리 크기·비중과 상관없이 모든 카테고리를 똑같이 반영해, 한 카테고리에 끌려가지 않습니다.
    어느 카테고리에든 값이 있는 지역은 모두 비교합니다. Google이 0을 주거나 빠뜨린 카테고리는 검색이 적다는 뜻이므로
    그 카테고리의 공동 꼴찌 등수로 계산합니다(2026-10-26 담당자 결정). 모든 카테고리가 0인 지역만 순위에서 뺍니다.
    interest = 막대 길이용 점수(모든 카테고리 1위 = 100, 모두 꼴찌 = 0), avg_rank = 표시용 평균 등수.
    반환: (rows, {"method": "rank_average", "compared": 비교한 지역 수})
    """
    regions = {}
    for category in by_category:
        for row in category["items"]:
            region = regions.setdefault(row["geo"], {
                "geo": row["geo"], "name": row["name"], "location": row["location"], "categories": {}})
            region["categories"][category["id"]] = row["interest"]
    compared, rest = [], []
    for region in regions.values():
        if any(region["categories"].values()):
            for category in by_category:  # 빠진 카테고리 = 검색 적음 → 0으로 두어 공동 꼴찌 등수가 되게 합니다
                region["categories"].setdefault(category["id"], 0)
            compared.append(region)
        else:
            region.update({"interest": None, "avg_rank": None, "rank": None, "data_status": "insufficient"})
            rest.append(region)

    ranks = defaultdict(list)
    for category in by_category:
        order = sorted(compared, key=lambda row: -row["categories"][category["id"]])
        position = 0
        while position < len(order):
            value = order[position]["categories"][category["id"]]
            tied = [row for row in order[position:] if row["categories"][category["id"]] == value]
            shared = position + (len(tied) + 1) / 2  # 동점이면 같은 등수들의 평균 (예: 2·3위 동점 = 2.5)
            for row in tied:
                ranks[row["geo"]].append(shared)
            position += len(tied)

    count = len(compared)
    for region in compared:
        region["avg_rank"] = mean(ranks[region["geo"]])
        region["interest"] = round1((count - region["avg_rank"]) / (count - 1) * 100) if count > 1 else 100.0
        region["data_status"] = "normal"
    compared.sort(key=lambda row: row["avg_rank"])
    for rank, row in enumerate(compared, start=1):
        row["rank"] = rank
        row["avg_rank"] = round1(row["avg_rank"])
    return compared + rest, {"method": "rank_average", "compared": count}


def rising_products(category, related, limit=MAX_RISING_PRODUCTS):
    """연관 검색어(급상승) 중 상품 검색어만 남깁니다. 이미 순위 후보인 검색어는 뺍니다.

    제외 규칙(만드는 법·재료·위치·다른 의미 등)은 후보 제안 도구와 같은 것을 씁니다.
    """
    from .candidate_service import exclusion_reason, plain  # candidate_service가 이 모듈을 import하므로 함수 안에서 불러옵니다

    terms = category.get("representative_queries", [category["representative_query"]])
    roots = [plain(term) for term in category.get("root_terms") or terms]
    current = {plain(query) for query in category["candidate_queries"]}
    rows = [row for row in (related or {}).get("rising", [])
            if row.get("query") and plain(row["query"]) not in current and not exclusion_reason(row["query"], roots)]
    return rows[:limit]


def parse_related(raw, limit=None):
    """Google이 주는 연관 검색어 전부(인기·급상승 각 최대 25개)를 저장합니다. 거르기는 화면용 응답에서 합니다."""
    related = raw.get("related_queries") or {}

    def pick(rows):
        return [{"query": row.get("query"), "value": row.get("value"), "extracted_value": row.get("extracted_value")}
                for row in (rows or [])[:limit] if row.get("query")]

    return {"rising": pick(related.get("rising")), "top": pick(related.get("top"))}


def parse_related_topics(raw):
    topics = raw.get("related_topics") or {}

    def pick(rows):
        return [{"title": (row.get("topic") or {}).get("title"), "type": (row.get("topic") or {}).get("type"),
                 "value": row.get("value"), "extracted_value": row.get("extracted_value")}
                for row in rows or [] if (row.get("topic") or {}).get("title")]

    return {"rising": pick(topics.get("rising")), "top": pick(topics.get("top"))}


def food_related(category, related, labels=None):
    """연관 검색어·관련 주제 중 식품만 남깁니다.

    검색어는 상품 후보 제안 도구와 같은 제외 규칙(만드는 법·재료·위치·다른 의미·카테고리와 무관 등)을,
    주제는 Google이 붙인 종류(FOOD_TOPIC_TYPES)를 씁니다.
    """
    from .candidate_service import exclusion_reason, plain

    related = related or {}
    labels = labels or {}
    terms = category.get("representative_queries", [category["representative_query"]])
    roots = [plain(term) for term in category.get("root_terms") or terms]

    def queries(rows):
        return [{"query": row["query"], "name": labels.get(row["query"]) or labels.get(f'"{row["query"]}"', row["query"]),
                 "value": row.get("value"),
                 "extracted_value": row.get("extracted_value")}
                for row in rows or [] if row.get("query") and not exclusion_reason(row["query"], roots)]

    def is_food(row):
        kind = (row.get("type") or "").lower()
        return any(word in kind for word in FOOD_TOPIC_TYPES)

    return {
        "query": related.get("query"),
        "collected": bool(related) and not related.get("error"),
        "top": queries(related.get("top")),
        "rising": queries(related.get("rising")),
        "topics": [row for row in (related.get("topics") or {}).get("top", []) if is_food(row)],
    }


def duration_bucket(seconds):
    if seconds <= 15:
        return "15초 이하"
    if seconds <= 30:
        return "16~30초"
    if seconds <= 60:
        return "31~60초"
    return "60초 초과"


def summarize_ads(cases, limit=3):
    total = len(cases)

    def top(values, size=limit):
        counts = Counter(value for value in values if value)
        return [{"label": label, "count": count, "share": round1(count / total * 100)}
                for label, count in counts.most_common(size)]

    return {
        "formats": top((case["format"] for case in cases), 5),
        "opening_hooks": top(case["opening_hook"] for case in cases),
        "subtitle_styles": top(case["subtitle_style"] for case in cases),
        "durations": top(duration_bucket(case["duration_seconds"]) for case in cases),
        "ctas": top(case["cta"] for case in cases),
    }


# ---------------------------------------------------------------- 수집


class TrendCollectionService:
    """정해진 시점에 SerpApi와 광고 조사 파일을 읽어 마지막 정상 데이터를 갱신합니다."""

    def __init__(self, repository, collector=None, ad_collector_factory=None):
        self.repository = repository
        self.collector = collector
        self.ad_collector_factory = ad_collector_factory

    def due_sections(self, country_code, now=None):
        """권장 주기가 지난 영역. 설정의 paused_sections(일시 정지)는 뺍니다."""
        now = now or now_vn()
        stored = self.repository.get_latest(country_code) or {}
        sections = stored.get("sections", {})
        paused = set((self.repository.get_keywords(country_code) or {}).get("paused_sections", []))
        due = []
        for name in SECTIONS:
            if name in paused:
                continue
            checked_at = sections.get(name, {}).get("checked_at")
            if not checked_at or now - datetime.fromisoformat(checked_at) >= REFRESH_INTERVALS[name]:
                due.append(name)
        return due

    def refresh(self, country_code, sections=None, now=None):
        """선택한 영역만 갱신합니다. 실패한 영역은 이전 정상 데이터를 유지하고 오류를 기록합니다."""
        config = self.repository.get_keywords(country_code)
        if config is None:
            raise ValueError(f"{country_code} 검색어 설정 파일이 없습니다.")
        now = now or now_vn()
        stored = self.repository.get_latest(country_code) or {"country": country_code.upper(), "sections": {}}
        stored.setdefault("sections", {})
        errors = stored.setdefault("errors", {})
        report = {}

        for name in sections or SECTIONS:
            try:
                result = getattr(self, f"_collect_{name}")(country_code, config, now)
            except Exception as error:  # 수집 실패 시 이전 데이터 유지
                errors[name] = {"message": str(error), "failed_at": now.isoformat()}
                report[name] = f"실패: {error}"
                continue
            stored["sections"][name] = {"checked_at": now.isoformat(), **result}
            errors.pop(name, None)
            partial = result.get("category_errors") if isinstance(result, dict) else None
            report[name] = ("일부 실패 (" + "; ".join(f"{cid}: {message}, 이전 데이터 유지" for cid, message in partial.items()) + ")"
                            if partial else "완료")

        self.repository.save_latest(country_code, stored)
        return report

    def _timeseries(self, name, queries, date, now, **extra):
        raw = self.collector.fetch("TIMESERIES", queries, date, **extra)
        self.repository.save_raw(name, raw, now)
        return parse_timeseries(raw, queries)

    def _collect_categories(self, country_code, config, now):
        queries = [category["representative_query"] for category in config["categories"]]
        period = trend_period(config, now)
        dates, values = self._timeseries("timeseries_categories", queries, period, now)
        items = []
        for category in config["categories"]:
            query = category["representative_query"]
            series = values.get(query, {})
            items.append({
                "id": category["id"],
                "query": query,
                **trend_stats(dates, series),
                "series": [{"date": day.isoformat(), "interest": series.get(day)} for day in dates],
            })
        return {"source_url": trends_url(queries, period, config["geo"]), "items": items}

    def _collect_rankings(self, country_code, config, now):
        """후보가 5개를 넘으면 첫 후보를 기준 검색어로 넣어 나눠 요청한 뒤 같은 기준으로 환산합니다.

        카테고리 하나가 실패하면(기준 검색어 데이터 없음, 연관 검색어 결과 없음 등) 그 카테고리만 이전 정상 순위를
        유지하고 오류를 기록합니다. 모든 카테고리가 실패하면 영역 전체를 실패로 둡니다.
        ranking_source가 "related"인 카테고리는 설정 후보 대신 출발 검색어의 인기 연관 검색어 중 식품을
        Google 인기값(최근 3개월, 1위 = 100) 순으로 씁니다. 주간 관심도는 받지 않으므로 증감률이 없습니다.
        """
        from .candidate_service import related_candidates  # candidate_service가 이 모듈을 import하므로 함수 안에서 불러옵니다

        stored = (self.repository.get_latest(country_code) or {}).get("sections", {}).get("rankings", {})
        previous, checked_at = stored.get("by_category", {}), stored.get("checked_at")
        period = trend_period(config, now)
        by_category, failures, attempted = {}, {}, 0
        for category in config["categories"]:
            if category.get("ranking_source") == "fruit_flavors":
                continue  # 과일 맛 관심도(fruit_flavors 영역)로 순위를 대신하므로 따로 수집하지 않습니다
            attempted += 1
            try:
                by_category[category["id"]] = self._collect_ranking(category, config, period, now, related_candidates)
            except Exception as error:
                failures[category["id"]] = str(error)
                if category["id"] in previous:
                    by_category[category["id"]] = {**previous[category["id"]], "kept_from": previous[category["id"]].get(
                        "kept_from", checked_at), "error": str(error)}
        if attempted and len(failures) == attempted:
            raise RuntimeError("; ".join(f"{cid}: {message}" for cid, message in failures.items()))
        return {"by_category": by_category, "category_errors": failures}

    def _collect_ranking(self, category, config, period, now, related_candidates):
        """카테고리 하나의 순위를 수집합니다. 실패하면 예외를 그대로 올립니다(_collect_rankings가 처리)."""
        if category.get("ranking_source") == "related":
            found = related_candidates(self.collector.fetch, category, config,
                                       save=lambda name, raw: self.repository.save_raw(name, raw, now))
            return {"metric": "related", "seed": found["seed"], "items": [{
                **row, "recent_average": row["related_value"], "year_ago_average": None, "change_rate": None,
                "short_change_rate": None, "is_new": False,
                "data_status": "normal" if row["related_value"] is not None else "insufficient",
            } for row in found["ranked"]]}
        queries = category["candidate_queries"][:MAX_RANK_CANDIDATES]
        batches = anchor_batches(queries)
        name = f"timeseries_rank_{category['id']}"
        if len(batches) == 1:
            dates, values = self._timeseries(name, queries, period, now)
        else:
            dates, values = anchor_scale([self._timeseries(f"{name}_{index + 1}", batch, period, now)
                                          for index, batch in enumerate(batches)], queries[0])
        items = [{"query": query, **trend_stats(dates, values.get(query, {}))} for query in queries]
        return {"source_url": trends_url(queries[:MAX_PER_REQUEST], period, config["geo"]), "items": items}

    def _collect_fruit_flavors(self, country_code, config, now):
        """과일이 5개를 넘으면 첫 과일을 기준 검색어로 넣어 나눠 요청한 뒤 같은 기준으로 환산합니다."""
        queries = [flavor["query"] for flavor in config["fruit_flavors"]]
        anchor, others = queries[0], queries[1:]
        size = MAX_PER_REQUEST - 1
        period = trend_period(config, now)
        batches = [
            self._timeseries(f"timeseries_fruit_{index + 1}", [anchor, *others[start:start + size]], period, now)
            for index, start in enumerate(range(0, len(others), size))
        ]
        dates, values = anchor_scale(batches, anchor)
        items = [{"query": query, **trend_stats(dates, values.get(query, {}))} for query in queries]
        return {"source_url": trends_url(queries[:MAX_PER_REQUEST], period, config["geo"]),
                "anchor": anchor, "items": items}

    def _collect_seasonality(self, country_code, config, now):
        """주제 검색어는 하나씩 요청하고 과일은 5개씩 요청해, 각각 가장 높은 달 = 100으로 환산합니다."""
        period, geo = config["seasonality_period"], config["geo"]
        span, themes, fruits = None, [], []
        for theme in config["seasonality_themes"]:
            query = theme["query"]
            # 주제마다 다른 나라에서 볼 수 있습니다(예: 한국인의 다낭 여행 관심 = geo KR, hl ko, tz -540).
            locale = {key: theme[key] for key in ("geo", "hl", "tz") if key in theme}
            dates, values = self._timeseries(f"timeseries_season_{theme['id']}", [query], period, now, **locale)
            months, status = monthly_seasonality(dates, values.get(query, {}))
            themes.append({"id": theme["id"], "query": query, "months": months, "data_status": status,
                           "weekly": weekly_window(dates, values.get(query, {})) if status == "normal" else None,
                           "geo": theme.get("geo", geo),
                           "source_url": trends_url([query], period, theme.get("geo", geo))})
            if dates and span is None:
                span = {"start": dates[0].isoformat(), "end": dates[-1].isoformat()}
        fruit_queries = [flavor["query"] for flavor in config["fruit_flavors"]]
        for index, start in enumerate(range(0, len(fruit_queries), MAX_PER_REQUEST)):
            queries = fruit_queries[start:start + MAX_PER_REQUEST]
            dates, values = self._timeseries(f"timeseries_season_fruit_{index + 1}", queries, period, now)
            for query in queries:
                months, status = monthly_seasonality(dates, values.get(query, {}))
                fruits.append({"query": query, "months": months, "data_status": status})
        return {"period": period, "span": span, "themes": themes, "fruits": fruits,
                "fruit_source_url": trends_url(fruit_queries[:MAX_PER_REQUEST], period, geo)}

    def _collect_regions(self, country_code, config, now):
        """카테고리마다 대표 검색어로 지역 관심도를 받습니다. 하나라도 실패하면 영역 전체를 실패로 둡니다.

        종합 순위(카테고리 등수 평균)는 화면에 보낼 때 다시 계산합니다(_regions). 여기 items는 수집 시점 기록입니다.
        """
        period = config["recent_period"]
        by_category = []
        for category in config["categories"]:
            query = category["representative_query"]
            raw = self.collector.fetch("GEO_MAP_0", query, period, region="REGION")
            self.repository.save_raw(f"geo_map_{category['id']}", raw, now)
            by_category.append({
                "id": category["id"],
                "query": query,
                "source_url": trends_url([query], period, config["geo"]),
                "items": parse_regions(raw, config.get("region_labels", {})),
            })
        items, meta = combine_regions(by_category)
        return {"by_category": by_category, "items": items, "combine": meta}

    def _collect_related(self, country_code, config, now):
        """카테고리 하나가 실패해도 나머지는 저장합니다. 모두 실패하면 이전 정상 데이터를 유지합니다.

        합산 검색어에는 Google이 연관 검색어를 주지 않으므로 묶음의 검색어를 하나씩 씁니다.
        첫 검색어에 결과가 없으면 다음 검색어로 다시 시도하고, 결과를 준 검색어로 관련 주제도 받습니다.
        """
        by_category, errors = {}, []
        for category in config["categories"]:
            terms = category.get("representative_queries", [category["representative_query"]])
            raw, failures = None, []
            for query in terms:
                try:
                    raw = self.collector.fetch("RELATED_QUERIES", query, config["recent_period"])
                    break
                except Exception as error:
                    failures.append(f"{query}: {error}")
            if raw is None:
                errors.append(f"{category['id']}: {'; '.join(failures)}")
                by_category[category["id"]] = {"query": terms[0], "rising": [], "top": [], "error": "; ".join(failures)}
                continue
            self.repository.save_raw(f"related_{category['id']}", raw, now)
            row = {"query": query, **parse_related(raw)}
            try:
                topics = self.collector.fetch("RELATED_TOPICS", query, config["recent_period"])
                self.repository.save_raw(f"related_topics_{category['id']}", topics, now)
                row["topics"] = parse_related_topics(topics)
            except Exception as error:  # 주제가 없어도 연관 검색어는 저장합니다
                row["topics_error"] = str(error)
            by_category[category["id"]] = row
        if len(errors) == len(config["categories"]):
            raise RuntimeError("; ".join(errors))
        return {"by_category": by_category}

    def _collect_ads(self, country_code, config, now):
        result = self.ad_collector_factory(self.repository.ad_source_path(country_code)).collect()
        existing = self.repository.get_ads(country_code) or {}
        # 담당자가 직접 정리한 사례 파일(platform 필드)이나 기존 사례를 빈 원본으로 덮어쓰지 않습니다.
        if existing.get("platform") or (not result["cases"] and existing.get("cases")):
            return {"case_count": len(existing.get("cases", [])), "skipped": "기존 광고 사례 파일 유지"}
        self.repository.save_ads(country_code, {
            "country": country_code.upper(),
            "checked_at": now.isoformat(),
            **result,
        })
        return {"case_count": len(result["cases"]), "rejected_count": len(result["rejected"])}


# ---------------------------------------------------------------- 화면 응답


class TrendService:
    def __init__(self, repository):
        self.repository = repository

    def get_dashboard(self, country_code, now=None):
        config = self.repository.get_keywords(country_code)
        if config is None:
            return None
        now = now or now_vn()
        stored = self.repository.get_latest(country_code) or {}
        sections = stored.get("sections", {})
        labels = config.get("query_labels", {})

        categories = self._categories(config, sections, labels)
        fruit_flavors = self._fruit_flavors(config, sections)
        seasonality = self._seasonality(config, sections)
        regions, regions_meta = self._regions(sections, config.get("region_labels", {}))
        ads = self._ads(country_code)

        section_status = {}
        for name in SECTIONS:
            checked_at = ads.get("checked_at") if name == "ads" else sections.get(name, {}).get("checked_at")
            if not checked_at:
                status = "empty"
            elif now - datetime.fromisoformat(checked_at) >= REFRESH_INTERVALS[name] + DELAY_GRACE:
                status = "delayed"
            else:
                status = "fresh"
            section_status[name] = {"checked_at": checked_at, "status": status,
                                    "error": (stored.get("errors") or {}).get(name)}

        # 일시 정지한 영역은 오래돼도 "갱신 지연"으로 보지 않습니다
        paused = set(config.get("paused_sections", []))
        search_status = [section_status[name]["status"] for name in SERPAPI_SECTIONS if name not in paused]
        insufficient = any(
            item.get("data_status") == "insufficient"
            for item in [*categories, *fruit_flavors, *seasonality, *regions,
                         *(fruit for tab in seasonality for fruit in tab.get("fruits", [])),
                         *(row for category in categories for row in category["ranking"])]
        )
        if all(status == "empty" for status in search_status):
            data_status = "empty"
        elif "delayed" in search_status:
            data_status = "delayed"
        elif insufficient or "empty" in search_status:
            data_status = "partial"
        else:
            data_status = "fresh"

        checked = [section_status[name]["checked_at"] for name in SERPAPI_SECTIONS if section_status[name]["checked_at"]]
        return {
            "country": country_code.upper(),
            "checked_at": max(checked) if checked else None,
            "data_status": data_status,
            "has_insufficient": insufficient,
            "sections": section_status,
            "categories": categories,
            "fruit_flavors": fruit_flavors,
            "fruit_anchor": sections.get("fruit_flavors", {}).get("anchor"),
            "seasonality": seasonality,
            "regions": regions,
            "regions_meta": regions_meta,
            "regions_by_category": self._regions_by_category(sections, config.get("region_labels", {})),
            "ad_creative_trends": ads,
            "source": {"search": SOURCE_SEARCH, "ads": SOURCE_ADS},
        }

    @staticmethod
    def _categories(config, sections, labels):
        trend = sections.get("categories", {})
        trend_items = {item["id"]: item for item in trend.get("items", [])}
        rankings = sections.get("rankings", {})
        related = sections.get("related", {}).get("by_category", {})
        result = []
        for category in config["categories"]:
            item = trend_items.get(category["id"], {})
            ranking_section = rankings.get("by_category", {}).get(category["id"], {})
            ranking = [{
                "rank": None,
                "name": labels.get(row["query"], row["query"]),
                "query": row["query"],
                "interest": row["recent_average"],
                "recent_average": row["recent_average"],
                "year_ago_average": row.get("year_ago_average"),
                "change_rate": row["change_rate"],
                "short_change_rate": row.get("short_change_rate"),
                "is_new": row.get("is_new", False),
                "data_status": row["data_status"],
                "checked_at": rankings.get("checked_at"),
                "rising_value": row.get("rising_value"),
            } for row in ranking_section.get("items", [])]
            status = item.get("data_status", "empty")
            result.append({
                "id": category["id"],
                "label": category["label"],
                "representative_query": category["representative_query"],
                "recent_average": item.get("recent_average"),
                "year_ago_average": item.get("year_ago_average"),
                "change_rate": item.get("change_rate"),
                "short_change_rate": item.get("short_change_rate"),
                "is_new": item.get("is_new", False),
                "data_status": status,
                "series": item.get("series", []),
                "checked_at": trend.get("checked_at"),
                "source_url": trend.get("source_url"),
                # fruit_flavors 방식: 메뉴 검색이 적은 카테고리는 과일 맛 관심도 순위로 대신합니다
                "ranking": (TrendService._fruit_flavors(config, sections)
                            if category.get("ranking_source") == "fruit_flavors" else rank_items(ranking)),
                "ranking_source_url": ranking_section.get("source_url"),
                "ranking_metric": ("fruit_flavors" if category.get("ranking_source") == "fruit_flavors"
                                   else ranking_section.get("metric", "interest")),
                "related_queries": related.get(category["id"]),
                "rising_products": rising_products(category, related.get(category["id"])),
                "related_food": food_related(category, related.get(category["id"]), labels),
                "related_checked_at": sections.get("related", {}).get("checked_at"),
            })
        return result

    @staticmethod
    def _fruit_flavors(config, sections):
        section = sections.get("fruit_flavors", {})
        rows = {row["query"]: row for row in section.get("items", [])}
        items = []
        for flavor in config["fruit_flavors"]:
            row = rows.get(flavor["query"])
            if row is None:
                continue
            items.append({
                "id": flavor["id"],
                "name": flavor["label"],
                "query": flavor["query"],
                "interest": row["recent_average"],
                "recent_average": row["recent_average"],
                "year_ago_average": row.get("year_ago_average"),
                "change_rate": row["change_rate"],
                "short_change_rate": row.get("short_change_rate"),
                "is_new": row.get("is_new", False),
                "data_status": row["data_status"],
                "checked_at": section.get("checked_at"),
                "source_url": section.get("source_url"),
            })
        return rank_items(items)

    @staticmethod
    def _seasonality(config, sections):
        section = sections.get("seasonality", {})
        meta = {"period": section.get("period"), "span": section.get("span"), "checked_at": section.get("checked_at")}
        theme_rows = {row["id"]: row for row in section.get("themes", [])}
        tabs = []
        for theme in config.get("seasonality_themes", []):
            row = theme_rows.get(theme["id"])
            if row is None or row["query"] != theme["query"]:
                continue
            tabs.append({"id": theme["id"], "label": theme["label"], "type": "query", "query": row["query"],
                         "months": row["months"], "peak_months": peak_months(row["months"]),
                         "weekly": row.get("weekly"),
                         "data_status": row["data_status"], "source_url": row["source_url"], **meta})

        fruit_rows = {row["query"]: row for row in section.get("fruits", [])}
        fruits = []
        for flavor in config["fruit_flavors"]:
            row = fruit_rows.get(flavor["query"])
            if row is None:
                continue
            indexes = [item["index"] for item in row["months"] if item["index"] is not None]
            fruits.append({"id": flavor["id"], "name": flavor["label"], "query": flavor["query"],
                           "months": row["months"], "peak_months": peak_months(row["months"], limit=2),
                           "year_round": bool(indexes) and min(indexes) >= FLAT_MIN_INDEX,
                           "data_status": row["data_status"]})
        if fruits:
            by_month = {month: [fruit["name"] for fruit in fruits
                                if fruit["data_status"] == "normal" and not fruit["year_round"]
                                and fruit["peak_months"][0] == month]
                        for month in range(1, 13)}
            tabs.append({"id": "fruit-limited", "label": "과일 한정판 시기", "type": "fruits", "fruits": fruits,
                         "peak_fruits_by_month": by_month,
                         "data_status": "normal" if all(f["data_status"] == "normal" for f in fruits) else "insufficient",
                         "source_url": section.get("fruit_source_url"), **meta})
        return tabs

    @staticmethod
    def _regions(sections, region_labels):
        """지역 종합 순위와 계산 방식. 카테고리별 수집본이 있으면 카테고리 등수 평균으로 다시 계산합니다."""
        section = sections.get("regions", {})
        by_category = section.get("by_category")
        if by_category:
            rows, meta = combine_regions(by_category)
        else:  # 이전 형식(검색어 하나 기준) 수집본
            rows, meta = section.get("items", []), {"method": "single"}
        return [{
            **row,
            "name": region_labels.get(row.get("geo")) or row.get("name"),
            "combined": bool(by_category),
            "query": section.get("query"),
            "checked_at": section.get("checked_at"),
            "source_url": section.get("source_url"),
        } for row in rows], meta

    @staticmethod
    def _regions_by_category(sections, region_labels):
        """카테고리 id -> 그 카테고리 대표 검색어의 지역 순위. 이전 형식 수집본이면 빈 사전."""
        section = sections.get("regions", {})
        return {category["id"]: [{
            **row,
            "name": region_labels.get(row.get("geo")) or row.get("name"),
            "query": category.get("query"),
            "checked_at": section.get("checked_at"),
            "source_url": category.get("source_url"),
        } for row in category.get("items", [])] for category in section.get("by_category", [])}

    def _ads(self, country_code):
        data = self.repository.get_ads(country_code) or {}
        research = self.repository.get_ad_research(country_code)
        tiktok_cases = None
        if data.get("platform"):  # 담당자가 정리한 TikTok Top Ads 사례 파일
            tiktok_cases = {
                "platform": data["platform"],
                "period": data.get("period"),
                "collected_at": data.get("collected_at"),
                "source_url": data.get("source_url"),
                "coded": data.get("cases", []),
                "pending": data.get("pending_content_review", []),
                "hypotheses": data.get("hans_apply_hypotheses", []),
                "limitations": data.get("limitations", []),
            }
            cases = []
        else:
            cases = data.get("cases", [])
        if not cases:
            return {"status": "research" if research or tiktok_cases else "empty", "case_count": 0,
                    "checked_at": research["checked_at"] if research else data.get("checked_at"),
                    "summary": None, "examples": [], "ideas": data.get("ideas", []),
                    "research": research, "tiktok_cases": tiktok_cases}
        examples = sorted(cases, key=lambda case: case["collected_at"], reverse=True)[:6]
        return {
            "status": "normal" if len(cases) >= MIN_AD_CASES else "insufficient",
            "case_count": len(cases),
            "checked_at": data.get("checked_at"),
            "latest_collected_at": max(case["collected_at"] for case in cases),
            "summary": summarize_ads(cases),
            "examples": [{key: case[key] for key in (
                "platform", "brand", "ad_url", "format", "duration_seconds",
                "opening_hook", "cta", "performance_band", "collected_at")} for case in examples],
            "ideas": data.get("ideas", []),
            "research": research,
            "tiktok_cases": tiktok_cases,
        }
