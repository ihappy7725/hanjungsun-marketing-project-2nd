"""카테고리별 상품 후보 검색어 제안.

실제 연관 검색어(인기·급상승)에서 상품이 아닌 검색을 걸러 후보를 만들고, 최근 16개월 데이터로
충분한지 검증합니다. 설정 반영은 담당자가 결과를 확인한 뒤 apply()로 따로 실행합니다.
"""
import json
import re

from .trend_service import (
    MAX_RANK_CANDIDATES, MIN_INTEREST, anchor_batches, anchor_scale, now_vn, parse_timeseries, trend_period,
    trend_stats,
)

# 상품이 아닌 검색(만드는 법·재료·위치·뜻·숙제 등)
EXCLUDE_PATTERNS = {
    "만드는 법": ("cách làm", "công thức", "hướng dẫn", "dạy làm", "tự làm"),
    "재료·도구": ("nguyên liệu", "bột", "khuôn", "gạo nếp", "dầu", "máy"),
    "위치·가격": ("near me", "gần đây", "gần nhất", "ở đâu", "giá", "bao nhiêu",
                "hà nội", "sài gòn", "hồ chí minh", "đà nẵng", "hải phòng", "cần thơ",
                # 가게가 있는 거리·동네 (2026-10-25 확인). "đường"(길)은 설탕 뜻이 있어 넣지 않습니다
                "hàm long", "thái phiên", "phố", "quận", "phường",
                # 2026-10-26 확인: 꼰다오·말레이시아·하노이 거리
                "côn đảo", "mã lai", "tô tịch", "nguyễn trãi"),
    "뜻·정보": ("là gì", "calo", "bao nhiêu calo", "what is"),
    "숙제·문학": ("bài thơ", "phân tích", "lớp ", "thơ"),
    # 2026-10-25 확인: xôi lạc = 축구 중계 사이트, chè thái nguyên = 녹차 산지
    # 2026-10-26 확인: vua bánh mì = 드라마 제빵왕 김탁구, thuyết minh = 더빙(드라마 회차 검색)
    "다른 의미": ("bóng đá", "trực tiếp", "xôi lạc", "phim", "thái nguyên", "vua bánh mì", "thuyết minh"),
    # 2026-10-26 확인: 메뉴가 아닌 가게 상호 ("bánh mochi sweet"도 함께 걸립니다)
    "가게·브랜드": ("mochi sweet", "merino", "the bingsu", "boulevard", "mr bingsu", "mrp", "sul bingsu",
                "hata bingsu", "bunny bingsu"),
}
MAX_CANDIDATES = MAX_RANK_CANDIDATES
RELATED_SEEDS_PER_CATEGORY = 4  # 출발 검색어(suggest_seeds) 최대 사용 개수
MIN_RELATED_POOL = 30  # 상품 후보가 이만큼 모이면 남은 출발 검색어는 건너뜁니다


def plain(term):
    return term.replace('"', "").strip().lower()


def exclusion_reason(query, roots):
    text = f" {query.lower()} "
    if query.lower().startswith("làm "):
        return "만드는 법"
    for reason, patterns in EXCLUDE_PATTERNS.items():
        # 단어 단위로 비교 ("thơ"가 "thơm"에 걸리지 않도록)
        if any(f" {pattern.strip()} " in text for pattern in patterns):
            return reason
    if not any(root in text for root in roots):
        return "카테고리와 무관"
    if query.lower().strip() in roots:
        return "대표 검색어와 같음"
    return None


def related_value(row):
    value = row.get("extracted_value")
    if isinstance(value, (int, float)):
        return float(value)
    digits = "".join(ch for ch in str(row.get("value") or "") if ch.isdigit())
    return float(digits) if digits else None


def related_candidates(fetch, category, config, save=None, seed=None):
    """출발 검색어의 인기 연관 검색어 중 식품을 Google 인기값 순으로 돌려줍니다.

    출발 검색어 = seed(시험용) → 설정의 ranking_seed → 대표 묶음 첫 검색어 순으로 정합니다.

    인기값 = 최근 3개월 연관 검색어끼리의 상대 인기(1위 = 100). 출발 검색어마다 따로 매겨지므로
    다른 검색어의 연관 검색어와 섞지 않습니다. 같은 검색어가 급상승에도 있으면 상승률을 붙입니다.
    연관 검색어를 못 받으면 예외를 그대로 올립니다. save(name, raw)를 주면 원본 응답을 저장합니다.
    """
    terms = category.get("representative_queries", [category["representative_query"]])
    seed = seed or category.get("ranking_seed") or terms[0]
    roots = [plain(term) for term in category.get("root_terms") or terms]
    include = category.get("ranking_include") or []

    def reason(query):
        # ranking_include가 있으면 그 형태 단어(단어 단위)가 들어간 검색어만 남깁니다 (예: 과일 → 케이크·사탕·말린 과일)
        found = exclusion_reason(query, roots)
        if not found and include and not any(f" {word} " in f" {query.lower()} " for word in include):
            return "디저트 형태 아님"
        return found

    try:
        raw = fetch("RELATED_QUERIES", seed, config["recent_period"])
    except Exception as error:
        # 검색량이 적은 검색어는 Google이 결과를 줬다 안 줬다 합니다(2026-10-26 "bánh nếp" 확인). 한 번만 다시 요청합니다
        if "hasn't returned any results" not in str(error):
            raise
        raw = fetch("RELATED_QUERIES", seed, config["recent_period"])
    if save:
        save(f"related_rank_{category['id']}", raw)
    block = raw.get("related_queries") or {}
    rising = {(row.get("query") or "").strip().lower(): row.get("value") for row in block.get("rising") or []}
    related, seen = [], {plain(seed)}
    for source, rows in (("연관 인기", block.get("top")), ("연관 급상승", block.get("rising"))):
        for row in rows or []:
            query = (row.get("query") or "").strip()
            if not query or query.lower() in seen:
                continue
            seen.add(query.lower())
            related.append({"query": query, "source": source, "origin": seed, "related_value": row.get("value"),
                            "reason": reason(query)})
    ranked = [{"query": row["query"], "source": "연관 인기", "origin": seed,
               "related_value": related_value(row), "rising_value": rising.get(row["query"].strip().lower())}
              for row in block.get("top") or []
              if row.get("query") and not reason(row["query"].strip())
              and plain(row["query"]) != plain(seed)]
    ranked.sort(key=lambda row: -(row["related_value"] or 0))  # 동점은 Google이 준 순서 유지
    return {"seed": seed, "related": related, "ranked": ranked}


class CandidateSuggestionService:
    def __init__(self, repository, collector):
        self.repository = repository
        self.collector = collector

    def suggest(self, country_code, now=None, category_ids=None):
        """category_ids를 주면 그 카테고리만 제안합니다. apply()는 제안에 든 카테고리만 고치므로 나머지는 그대로입니다."""
        config = self.repository.get_keywords(country_code)
        now = now or now_vn()
        stored = (self.repository.get_latest(country_code) or {}).get("sections", {})
        current_rows = stored.get("rankings", {}).get("by_category", {})
        period = trend_period(config, now)
        result = []
        categories = config["categories"]
        if category_ids:
            unknown = set(category_ids) - {category["id"] for category in categories}
            if unknown:
                raise ValueError(f"설정에 없는 카테고리입니다: {', '.join(sorted(unknown))}")
            categories = [category for category in categories if category["id"] in category_ids]

        for category in categories:
            # 연관 검색어를 찾을 출발 검색어와 카테고리 판별 단어 (설정에 없으면 대표 검색어 사용)
            terms = category.get("representative_queries", [category["representative_query"]])
            seeds = category.get("suggest_seeds") or terms
            roots = [plain(term) for term in category.get("root_terms") or terms]
            related, excluded, seen = [], [], set()
            for term in seeds[:RELATED_SEEDS_PER_CATEGORY]:
                if len(related) >= MIN_RELATED_POOL:
                    break
                try:
                    raw = self.collector.fetch("RELATED_QUERIES", plain(term), config["recent_period"])
                except Exception:
                    continue
                self.repository.save_raw(f"suggest_related_{category['id']}", raw, now)
                block = raw.get("related_queries") or {}
                for source, rows in (("연관 인기", block.get("top")), ("연관 급상승", block.get("rising"))):
                    for row in rows or []:
                        query = (row.get("query") or "").strip()
                        if not query or query.lower() in seen:
                            continue
                        seen.add(query.lower())
                        reason = exclusion_reason(query, roots)
                        if reason:
                            excluded.append({"query": query, "reason": reason})
                        else:
                            related.append({"query": query, "source": source, "related_value": row.get("value")})

            # 데이터가 충분한 기존 후보를 관심도 높은 순으로 앞에 두고, 남는 자리를 연관 검색어로 채웁니다.
            # 맨 앞 후보가 5개 초과분을 환산하는 기준 검색어가 되므로 검색이 꾸준한 검색어를 앞에 둡니다.
            current = {row["query"]: row for row in current_rows.get(category["id"], {}).get("items", [])}
            keep = [{"query": query, "source": "현재 후보"} for query in category["candidate_queries"]
                    if current.get(query, {}).get("data_status") == "normal"
                    and (current[query].get("recent_average") or 0) >= MIN_INTEREST]
            keep.sort(key=lambda row: -current[row["query"]]["recent_average"])
            proposed = keep + [row for row in related if row["query"] not in {item["query"] for item in keep}]
            proposed = proposed[:MAX_CANDIDATES]

            if proposed:
                queries = [row["query"] for row in proposed]
                batches = anchor_batches(queries)
                checked = []
                for index, batch in enumerate(batches):
                    raw = self.collector.fetch("TIMESERIES", batch, period)
                    suffix = f"_{index + 1}" if len(batches) > 1 else ""
                    self.repository.save_raw(f"suggest_check_{category['id']}{suffix}", raw, now)
                    checked.append(parse_timeseries(raw, batch))
                try:
                    dates, values = checked[0] if len(checked) == 1 else anchor_scale(checked, queries[0])
                except ValueError:  # 기준 검색어 데이터가 없으면 환산할 수 없으므로 모두 검증 실패로 둡니다
                    dates, values = checked[0][0], {}
                for row in proposed:
                    stats = trend_stats(dates, values.get(row["query"], {}))
                    if (stats["recent_average"] or 0) < MIN_INTEREST:
                        stats["data_status"] = "insufficient"
                    row.update({key: stats[key] for key in ("recent_average", "change_rate", "is_new", "data_status")})

            result.append({
                "id": category["id"],
                "label": category["label"],
                "current": category["candidate_queries"],
                "proposed": proposed,
                "excluded": excluded,
            })

        suggestion = {"country": country_code.upper(), "created_at": now.isoformat(), "period": period,
                      "categories": result}
        self.repository.save_suggestions(country_code, suggestion)
        return suggestion

    def check_terms(self, country_code, now=None):
        """카테고리 대표 검색어 묶음에 새 후보(bundle_candidates)를 넣어도 되는지 점검합니다.

        결과만 돌려주고 아무것도 저장하지 않습니다(원본 응답 data/raw/ 저장도 하지 않음).
        ① 기존 대표 검색어 + 새 후보 각각의 최근 12주 평균 관심도 (카테고리 첫 검색어 기준으로 환산)
        ② 상품 순위 후보에 없던 새 후보의 연관 검색어 상위 10개 (디저트가 아닌 뜻이 섞였는지)
        ③ 새 후보까지 넣은 묶음을 한 번에 요청했을 때 Google이 받아 주는지
        """
        config = self.repository.get_keywords(country_code)
        period = trend_period(config, now or now_vn())
        categories, bundles = [], {}
        for category in config["categories"]:
            existing = category.get("representative_queries", [category["representative_query"]])
            new = [term for term in category.get("bundle_candidates", []) if term not in existing]
            terms = existing + new
            checked = [parse_timeseries(self.collector.fetch("TIMESERIES", batch, period), batch)
                       for batch in anchor_batches(terms)]
            try:
                dates, values = checked[0] if len(checked) == 1 else anchor_scale(checked, terms[0])
            except ValueError as error:  # 기준 검색어 데이터가 없으면 환산할 수 없습니다
                categories.append({"id": category["id"], "label": category["label"], "error": str(error), "terms": []})
                continue
            rows = []
            for term in terms:
                stats = trend_stats(dates, values.get(term, {}))
                row = {"query": term, "new": term in new, "recent_average": stats["recent_average"],
                       "data_status": stats["data_status"]}
                if term in new and term not in category["candidate_queries"]:  # 순위 후보는 이미 확인한 검색어
                    try:
                        related = self.collector.fetch("RELATED_QUERIES", plain(term), "today 12-m")
                        row["related"] = [r["query"] for r in ((related.get("related_queries") or {}).get("top") or [])[:10]]
                    except Exception as error:  # Google이 결과를 주지 않는 검색어도 있습니다
                        row["related_error"] = str(error)
                rows.append(row)
            categories.append({"id": category["id"], "label": category["label"], "terms": rows})
            bundles[category["id"]] = " + ".join(terms)

        queries = list(bundles.values())
        try:
            dates, values = parse_timeseries(self.collector.fetch("TIMESERIES", queries, period), queries)
            bundle_check = {"ok": True, "bundles": [
                {"id": cid, "length": len(query), "recent_average": trend_stats(dates, values.get(query, {}))["recent_average"]}
                for cid, query in bundles.items()]}
        except Exception as error:
            bundle_check = {"ok": False, "error": str(error)}
        return {"period": period, "categories": categories, "bundle_check": bundle_check}

    def check_related(self, country_code, category_ids, seeds=None):
        """출발 검색어의 인기 연관 검색어 중 식품을 실시간으로 받아 인기값 순으로 보여 줍니다.

        seeds를 주면 설정을 바꾸지 않고 그 검색어들을 출발 검색어로 하나씩 시험합니다(검색어마다 1회 호출).
        결과만 돌려주고 아무것도 저장하지 않습니다(원본 응답 data/raw/ 저장도 하지 않음).
        """
        config = self.repository.get_keywords(country_code)
        unknown = set(category_ids) - {category["id"] for category in config["categories"]}
        if unknown:
            raise ValueError(f"설정에 없는 카테고리입니다: {', '.join(sorted(unknown))}")
        result = []
        for category in config["categories"]:
            if category["id"] not in category_ids:
                continue
            default = category.get("ranking_seed") or category.get(
                "representative_queries", [category["representative_query"]])[0]
            for seed in seeds or [default]:
                row = {"id": category["id"], "label": category["label"], "seed": seed, "related": [], "ranked": []}
                result.append(row)
                try:
                    row.update(related_candidates(self.collector.fetch, category, config, seed=seed))
                except Exception as error:
                    row["error"] = str(error)
        return {"categories": result}

    def check_bundles(self, country_code, now=None):
        """설정의 proposed_bundle(검색어 선정 기준으로 고른 새 대표 묶음) 4개를 한 번에 요청해 기준 통과 여부를 봅니다.

        기준: 최근 12주 평균 MIN_INTEREST 이상, 12주 중 70% 이상 값 있음(data_status normal). 아무것도 저장하지 않습니다.
        """
        config = self.repository.get_keywords(country_code)
        period = trend_period(config, now or now_vn())
        bundles = {category["id"]: " + ".join(category["proposed_bundle"])
                   for category in config["categories"] if category.get("proposed_bundle")}
        queries = list(bundles.values())
        dates, values = parse_timeseries(self.collector.fetch("TIMESERIES", queries, period), queries)
        rows = []
        for category in config["categories"]:
            query = bundles.get(category["id"])
            if not query:
                continue
            stats = trend_stats(dates, values.get(query, {}))
            rows.append({"id": category["id"], "label": category["label"], "query": query, **stats,
                         "passed": stats["data_status"] == "normal" and (stats["recent_average"] or 0) >= MIN_INTEREST})
        return {"period": period, "bundles": rows}

    def apply(self, country_code):
        """마지막 제안 중 데이터가 충분한 검색어를 설정 파일의 candidate_queries에 반영합니다."""
        suggestion = self.repository.get_suggestions(country_code)
        if suggestion is None:
            raise ValueError("먼저 후보 제안을 실행해 주세요.")
        path = self.repository.keywords_path(country_code)
        text = path.read_text(encoding="utf-8")
        applied = {}
        for category in suggestion["categories"]:
            queries = [row["query"] for row in category["proposed"] if row.get("data_status") == "normal"]
            if not queries:
                continue
            # 해당 카테고리 블록의 candidate_queries 한 줄만 교체해 파일 형식을 유지합니다.
            pattern = re.compile(r'("id": "%s".*?"candidate_queries": )\[[^\]]*\]' % re.escape(category["id"]), re.S)
            text, count = pattern.subn(lambda m: m.group(1) + json.dumps(queries, ensure_ascii=False), text, count=1)
            if count:
                applied[category["id"]] = queries
        path.write_text(text, encoding="utf-8")
        return applied
