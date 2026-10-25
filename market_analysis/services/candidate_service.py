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
    "재료·도구": ("nguyên liệu", "bột", "khuôn", "gạo nếp"),
    "위치·가격": ("near me", "gần đây", "gần nhất", "ở đâu", "giá", "bao nhiêu",
                "hà nội", "sài gòn", "hồ chí minh", "đà nẵng", "hải phòng", "cần thơ"),
    "뜻·정보": ("là gì", "calo", "bao nhiêu calo"),
    "숙제·문학": ("bài thơ", "phân tích", "lớp ", "thơ"),
    # 2026-10-25 확인: xôi lạc = 축구 중계 사이트, chè thái nguyên = 녹차 산지
    "다른 의미": ("bóng đá", "trực tiếp", "xôi lạc", "phim", "thái nguyên"),
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


class CandidateSuggestionService:
    def __init__(self, repository, collector):
        self.repository = repository
        self.collector = collector

    def suggest(self, country_code, now=None):
        config = self.repository.get_keywords(country_code)
        now = now or now_vn()
        stored = (self.repository.get_latest(country_code) or {}).get("sections", {})
        current_rows = stored.get("rankings", {}).get("by_category", {})
        period = trend_period(config, now)
        result = []

        for category in config["categories"]:
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
