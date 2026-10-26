import sys, unittest, tempfile, json
from pathlib import Path
from datetime import date, datetime, timedelta, timezone
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.trend_service import *
from repositories.trend_repository import TrendRepository
NOW = datetime(2026,10,25,9,0,tzinfo=VN_TZ)
def timeline(queries, days, value_fn, end=date(2026, 10, 22), step=1):
    points = []
    for offset in range(days - 1, -1, -1):
        day = end - timedelta(days=offset * step)
        stamp = int(datetime(day.year, day.month, day.day, tzinfo=timezone.utc).timestamp())
        values = []
        for index, query in enumerate(queries):
            value = value_fn(index, offset, day)
            if value is not None:
                values.append({"query": query, "value": str(value), "extracted_value": value})
        points.append({"date": day.isoformat(), "timestamp": str(stamp), "values": values})
    return {"interest_over_time": {"timeline_data": points}}


class CalculationTests(unittest.TestCase):
    def test_year_over_year_and_short_term_change(self):
        # 최근 4주 66, 그 앞 8주 60, 1년 전 같은 12주 50
        raw = timeline(["a"], 70, lambda i, off, day: 66 if off < 4 else 60 if off < 12 else 50 if 52 <= off < 64 else 30, step=7)
        dates, values = parse_timeseries(raw, ["a"])
        stats = trend_stats(dates, values["a"])
        self.assertEqual(stats["recent_average"], 62.0)
        self.assertEqual(stats["year_ago_average"], 50.0)
        self.assertEqual(stats["change_rate"], 24.0)
        self.assertEqual(stats["short_change_rate"], 10.0)
        self.assertEqual(stats["data_status"], "normal")

    def test_seasonal_drop_is_not_a_decline(self):
        # 매년 같은 계절 패턴이면 직전 기간보다 낮아도 전년 동기 대비는 0%
        raw = timeline(["a"], 70, lambda i, off, day: 20 if off % 52 < 12 else 80, step=7)
        dates, values = parse_timeseries(raw, ["a"])
        self.assertEqual(trend_stats(dates, values["a"])["change_rate"], 0.0)

    def test_short_history_is_insufficient(self):
        raw = timeline(["a"], 20, lambda i, off, day: 50, step=7)
        dates, values = parse_timeseries(raw, ["a"])
        stats = trend_stats(dates, values["a"])
        self.assertIsNone(stats["change_rate"])
        self.assertEqual(stats["data_status"], "insufficient")

    def test_partial_last_week_is_excluded(self):
        raw = timeline(["a"], 5, lambda i, off, day: 50, step=7)
        raw["interest_over_time"]["timeline_data"][-1]["partial_data"] = True
        dates, values = parse_timeseries(raw, ["a"])
        self.assertEqual(len(dates), 4)

    def test_trend_period_covers_year_ago_window(self):
        period = trend_period({"period_days": 490}, NOW)
        start, end = (date.fromisoformat(part) for part in period.split())
        self.assertEqual(end, NOW.date())
        self.assertGreaterEqual((end - start).days, 52 * 7 + 12 * 7)

    def test_combined_query_matches_by_position(self):
        queries = ["bánh mochi", "bingsu + hotteok + yakgwa"]
        raw = timeline(["bánh mochi", "bingsu   hotteok   yakgwa"], 90, lambda i, off, day: 10 + i)
        dates, values = parse_timeseries(raw, queries)
        self.assertEqual(len(values["bingsu + hotteok + yakgwa"]), 90)
        self.assertEqual(values["bingsu + hotteok + yakgwa"][dates[0]], 11.0)

    def test_days_with_all_queries_zero_are_missing(self):
        raw = timeline(["a", "b"], 90, lambda i, off, day: 0 if 40 <= off < 44 else 30 + i)
        dates, values = parse_timeseries(raw, ["a", "b"])
        self.assertEqual(len(dates), 90)
        self.assertEqual(len(values["a"]), 86)
        self.assertNotIn(0.0, values["a"].values())
        single = parse_timeseries(timeline(["a"], 10, lambda i, off, day: 0), ["a"])[1]
        self.assertEqual(len(single["a"]), 10)  # 검색어 하나는 실제 0일 수 있어 유지

    def test_year_ago_zero_is_new_interest(self):
        raw = timeline(["a"], 70, lambda i, off, day: 40 if off < 52 else 0, step=7)
        dates, values = parse_timeseries(raw, ["a"])
        stats = trend_stats(dates, values["a"])
        self.assertIsNone(stats["change_rate"])
        self.assertTrue(stats["is_new"])
        self.assertEqual(stats["data_status"], "normal")
        ranked = rank_items([{**stats, "query": "a"}])
        self.assertEqual(ranked[0]["growth_rank"], 1)

    def test_missing_points_are_not_zero_and_low_coverage_is_insufficient(self):
        raw = timeline(["a"], 70, lambda i, off, day: 50 if off % 2 == 0 else None, step=7)
        dates, values = parse_timeseries(raw, ["a"])
        self.assertNotIn(0.0, values["a"].values())
        stats = trend_stats(dates, values["a"])
        self.assertEqual(stats["recent_average"], 50.0)
        self.assertEqual(stats["data_status"], "insufficient")

    def test_popular_and_growth_ranks(self):
        items = [
            {"query": "low", "recent_average": 3.0, "change_rate": 300.0, "data_status": "normal"},
            {"query": "big", "recent_average": 60.0, "change_rate": -10.0, "data_status": "normal"},
            {"query": "rising", "recent_average": 20.0, "change_rate": 80.0, "data_status": "normal"},
            {"query": "new", "recent_average": 10.0, "change_rate": None, "is_new": True, "data_status": "normal"},
        ]
        ranked = {item["query"]: item for item in rank_items(items)}
        self.assertEqual([ranked[q]["rank"] for q in ("big", "rising", "new")], [1, 2, 3])
        self.assertEqual([ranked[q]["growth_rank"] for q in ("new", "rising", "big")], [1, 2, 3])
        self.assertTrue(ranked["rising"]["is_rising"])
        self.assertFalse(ranked["big"]["is_rising"])
        # 증감률이 커도 관심도 5 미만은 두 순위 모두 제외
        self.assertEqual(ranked["low"]["data_status"], "insufficient")
        self.assertIsNone(ranked["low"]["rank"])
        self.assertIsNone(ranked["low"]["growth_rank"])

    def test_seasonality_requires_twelve_months(self):
        short = timeline(["a"], 13, lambda i, off, day: 50, step=7)
        dates, values = parse_timeseries(short, ["a"])
        self.assertEqual(monthly_seasonality(dates, values["a"])[1], "insufficient")
        long = timeline(["a"], 60, lambda i, off, day: day.month * 5, step=7)
        dates, values = parse_timeseries(long, ["a"])
        months, status = monthly_seasonality(dates, values["a"])
        self.assertEqual(status, "normal")
        self.assertEqual(months[6]["interest"], 35.0)
        self.assertEqual(months[11]["index"], 100)
        self.assertEqual(months[5]["index"], 50)
        self.assertEqual(peak_months(months), [12, 11])

    def test_fruits_ranked_by_interest(self):
        items = [
            {"query": "a", "recent_average": 20.0, "change_rate": 50.0, "data_status": "normal"},
            {"query": "b", "recent_average": 40.0, "change_rate": -10.0, "data_status": "normal"},
            {"query": "c", "recent_average": 2.0, "change_rate": 300.0, "data_status": "normal"},
        ]
        ranked = rank_items(items)
        self.assertEqual([(item["query"], item["rank"]) for item in ranked], [("b", 1), ("a", 2), ("c", None)])

    def test_anchor_scaling_between_requests(self):
        first = parse_timeseries(timeline(["anchor", "x"], 10, lambda i, off, day: [80, 40][i]), ["anchor", "x"])
        second = parse_timeseries(timeline(["anchor", "y"], 10, lambda i, off, day: [40, 30][i]), ["anchor", "y"])
        dates, values = anchor_scale([first, second], "anchor")
        self.assertEqual(values["x"][dates[0]], 40)
        self.assertEqual(values["y"][dates[0]], 60)  # 기준 검색어가 절반으로 나왔으므로 2배

    def test_regions_combined_by_average_rank(self):
        def region(geo, value):
            return {"geo": geo, "name": geo, "location": geo, "interest": value}
        by_category = [
            {"id": "a", "items": [region("R1", 100), region("R2", 50), region("R3", 10), region("R4", 70), region("R5", 0)]},
            {"id": "b", "items": [region("R1", 30), region("R2", 90), region("R3", 20), region("R4", 60), region("R5", 0)]},
            {"id": "c", "items": [region("R1", 80), region("R2", 60), region("R3", 60), region("R5", 0)]},
        ]
        result, meta = combine_regions(by_category)
        rows = {row["geo"]: row for row in result}
        self.assertEqual(meta, {"method": "rank_average", "compared": 4})
        # 한 카테고리에 값이 없는 지역(R4)도 비교하고, 빠진 c는 공동 꼴찌(4위)로 계산합니다.
        # 등수 a(R1 1·R4 2·R2 3·R3 4), b(R2 1·R4 2·R1 3·R3 4), c(R1 1, R2·R3 동점 2.5, R4 4) -> 평균 1.7 / 2.2 / 2.7 / 3.5
        self.assertEqual([row["geo"] for row in result[:4]], ["R1", "R2", "R4", "R3"])
        self.assertEqual([(rows[g]["avg_rank"], rows[g]["interest"]) for g in ("R1", "R2", "R4", "R3")],
                         [(1.7, 77.8), (2.2, 61.1), (2.7, 44.4), (3.5, 16.7)])
        self.assertEqual(rows["R4"]["data_status"], "normal")
        # 모든 카테고리가 0인 지역(R5)만 순위에서 뺍니다.
        self.assertEqual((rows["R5"]["rank"], rows["R5"]["avg_rank"], rows["R5"]["data_status"]), (None, None, "insufficient"))

    def test_regions_one_category_spike_does_not_dominate(self):
        def region(geo, value):
            return {"geo": geo, "name": geo, "location": geo, "interest": value}
        by_category = [
            {"id": "a", "items": [region("SPIKE", 100), region("EVEN", 50), region("LOW", 40)]},
            {"id": "b", "items": [region("SPIKE", 5), region("EVEN", 50), region("LOW", 40)]},
            {"id": "c", "items": [region("SPIKE", 5), region("EVEN", 50), region("LOW", 4)]},
        ]
        # 한 카테고리만 압도적인 지역보다 모든 카테고리에 고르게 관심 있는 지역이 1위
        result, _ = combine_regions(by_category)
        self.assertEqual([row["geo"] for row in result], ["EVEN", "SPIKE", "LOW"])

    def test_regions_by_category_for_selected_category(self):
        item = {"geo": "VN-49", "name": "Vĩnh Long", "location": "Vĩnh Long", "interest": 80, "rank": 1}
        sections = {"regions": {"checked_at": "2026-10-25T09:00:00+07:00", "by_category": [
            {"id": "a", "query": "x + y", "source_url": "u", "items": [item]}]}}
        by_category = TrendService._regions_by_category(sections, {"VN-49": "빈롱"})
        self.assertEqual(list(by_category), ["a"])
        self.assertEqual((by_category["a"][0]["name"], by_category["a"][0]["query"]), ("빈롱", "x + y"))
        # 이전 형식(검색어 하나) 수집본에는 카테고리별 데이터가 없습니다.
        self.assertEqual(TrendService._regions_by_category({"regions": {"items": [item]}}, {}), {})

    def test_anchor_batches_split_after_five(self):
        self.assertEqual(anchor_batches(list("abcd")), [list("abcd")])
        self.assertEqual(anchor_batches(list("abcdefghi")), [list("abcde"), list("afghi")])

    def test_rankings_over_five_candidates_scaled_by_anchor(self):
        class Fake:
            calls = []
            def fetch(self, data_type, queries, date, **extra):
                self.calls.append(list(queries))
                scale = 1 if len(self.calls) == 1 else 0.5  # 두 번째 요청은 기준 검색어가 절반으로 나옴
                return timeline(queries, 70, lambda i, off, day: [40, 30, 20, 10, 8][i] * scale, step=7)
        fake = Fake()
        service = TrendCollectionService(TrendRepository(data_dir=tempfile.mkdtemp()), collector=fake)
        config = {"period_days": 490, "geo": "VN",
                  "categories": [{"id": "c", "candidate_queries": list("abcdefghi")}]}
        items = {row["query"]: row for row in service._collect_rankings("VN", config, NOW)["by_category"]["c"]["items"]}
        self.assertEqual([batch[0] for batch in fake.calls], ["a", "a"])
        self.assertEqual((items["a"]["recent_average"], items["e"]["recent_average"]), (40, 8))
        self.assertEqual((items["f"]["recent_average"], items["i"]["recent_average"]), (30, 8))  # ×2 환산

    def test_rising_products_keep_only_new_product_queries(self):
        category = {"representative_query": "bánh mochi", "root_terms": ["mochi"], "candidate_queries": ["mochi kem"]}
        related = {"rising": [
            {"query": "bánh mochi đậu đỏ", "value": "+110%"},
            {"query": "nguyên liệu làm bánh mochi", "value": "+90%"},  # 재료 검색
            {"query": "mochi kem", "value": "+70%"},                   # 이미 순위 후보
            {"query": "trà sữa", "value": "Breakout"},                 # 카테고리와 무관
        ]}
        self.assertEqual([row["query"] for row in rising_products(category, related)], ["bánh mochi đậu đỏ"])
        self.assertEqual(rising_products(category, None), [])

    def test_related_keeps_all_rows_and_falls_back_to_next_term(self):
        class Fake:
            calls = []
            def fetch(self, data_type, queries, date, **extra):
                self.calls.append((data_type, queries))
                if queries == "a":
                    raise RuntimeError("no results")
                if data_type == "RELATED_TOPICS":
                    return {"related_topics": {"top": [{"topic": {"title": "Mochi", "type": "Món ăn"}, "value": "100"}]}}
                return {"related_queries": {"top": [{"query": f"q{i}", "value": str(100 - i)} for i in range(25)]}}
        fake = Fake()
        service = TrendCollectionService(TrendRepository(data_dir=tempfile.mkdtemp()), collector=fake)
        config = {"recent_period": "today 3-m", "categories": [{"id": "c", "representative_query": "a + b", "representative_queries": ["a", "b"]}]}
        row = service._collect_related("VN", config, NOW)["by_category"]["c"]
        self.assertEqual(fake.calls, [("RELATED_QUERIES", "a"), ("RELATED_QUERIES", "b"), ("RELATED_TOPICS", "b")])
        self.assertEqual((row["query"], len(row["top"])), ("b", 25))
        self.assertEqual(row["topics"]["top"][0]["title"], "Mochi")

    def test_food_related_drops_non_food(self):
        category = {"representative_query": "bánh mochi", "root_terms": ["mochi"]}
        related = {"query": "bánh mochi",
                   "top": [{"query": "bánh trung thu mochi", "value": "40"},
                           {"query": "cách làm bánh mochi", "value": "100"},   # 만드는 법
                           {"query": "bánh mochi hà nội", "value": "20"},     # 지역
                           {"query": "mochi hàm long", "value": "15"},        # 가게 거리
                           {"query": "mochi phố cổ", "value": "10"}],         # 거리
                   "rising": [{"query": "bánh mochi nướng", "value": "Breakout"},
                              {"query": "công thức làm bánh mochi", "value": "+900%"}],
                   "topics": {"top": [{"title": "Mochi", "type": "Món ăn"}, {"title": "Bánh trung thu", "type": "Bánh kẹo"},
                                      {"title": "Tết Trung thu", "type": "Ngày lễ"}]}}
        food = food_related(category, related, {"bánh trung thu mochi": "모찌 월병"})
        self.assertEqual([(row["query"], row["name"]) for row in food["top"]], [("bánh trung thu mochi", "모찌 월병")])
        self.assertEqual([row["query"] for row in food["rising"]], ["bánh mochi nướng"])
        self.assertEqual([row["title"] for row in food["topics"]], ["Mochi", "Bánh trung thu"])
        self.assertTrue(food["collected"])
        self.assertFalse(food_related(category, {"error": "x", "top": [], "rising": []})["collected"])
        self.assertFalse(food_related(category, None)["collected"])

    def test_check_related_ranks_food_only_and_saves_nothing(self):
        from services.candidate_service import CandidateSuggestionService
        class Fake:
            calls = []
            def fetch(self, data_type, queries, date, **extra):
                self.calls.append((data_type, queries))
                return {"related_queries": {"top": [{"query": "bánh mochi đậu đỏ", "extracted_value": 9},
                                                    {"query": "cách làm bánh mochi", "extracted_value": 47},
                                                    {"query": "bánh mochi nhật", "extracted_value": 37}]}}
        data_dir = tempfile.mkdtemp()
        fake = Fake()
        result = CandidateSuggestionService(TrendRepository(data_dir=data_dir), fake).check_related("VN", ["mochi"])
        category = result["categories"][0]
        self.assertEqual(fake.calls, [("RELATED_QUERIES", category["seed"])])
        self.assertEqual([row["query"] for row in category["ranked"]], ["bánh mochi nhật", "bánh mochi đậu đỏ"])
        self.assertEqual([row["reason"] for row in category["related"]], [None, "만드는 법", None])
        self.assertEqual(list(Path(data_dir).iterdir()), [])

    def test_related_ranking_uses_google_popularity(self):
        from services.candidate_service import exclusion_reason, related_candidates
        self.assertEqual(exclusion_reason("bánh mochi sweet", ["mochi"]), "가게·브랜드")
        calls = []
        def fetch(data_type, queries, date, **extra):
            calls.append(data_type)
            return {"related_queries": {
                "top": [{"query": "cách làm bánh nếp", "value": "100", "extracted_value": 100},
                        {"query": "bánh nếp chiên", "value": "34", "extracted_value": 34},
                        {"query": "bánh nếp đậu xanh", "value": "45", "extracted_value": 45},
                        {"query": "bánh tẻ", "value": "51", "extracted_value": 51}],
                "rising": [{"query": "bánh nếp chiên", "value": "+250%"}]}}
        category = {"id": "s", "representative_query": '"bánh nếp"', "root_terms": ["nếp"]}
        found = related_candidates(fetch, category, {"recent_period": "today 3-m"})
        self.assertEqual(calls, ["RELATED_QUERIES"])  # 주간 관심도는 받지 않음
        self.assertEqual([(row["query"], row["related_value"], row["rising_value"]) for row in found["ranked"]],
                         [("bánh nếp đậu xanh", 45, None), ("bánh nếp chiên", 34, "+250%")])
        self.assertEqual(found["ranked"][0]["origin"], '"bánh nếp"')

    def test_related_seed_priority_and_new_exclusions(self):
        from services.candidate_service import exclusion_reason, related_candidates
        roots = ["kem", "dừa", "bingsu"]
        self.assertEqual(exclusion_reason("dầu dừa", roots), "재료·도구")
        self.assertEqual(exclusion_reason("kem dừa côn đảo", roots), "위치·가격")
        self.assertEqual(exclusion_reason("kem merino", roots), "가게·브랜드")
        self.assertEqual(exclusion_reason("mr bingsu", roots), "가게·브랜드")
        self.assertIsNone(exclusion_reason("kem sữa dừa", roots))
        seeds = []
        def fetch(data_type, queries, date, **extra):
            seeds.append(queries)
            return {"related_queries": {"top": []}}
        category = {"id": "f", "representative_query": '"hoa quả dầm"', "ranking_seed": "kem dừa", "root_terms": roots}
        related_candidates(fetch, category, {"recent_period": "today 3-m"})
        related_candidates(fetch, category, {"recent_period": "today 3-m"}, seed="chè trái cây")
        self.assertEqual(seeds, ["kem dừa", "chè trái cây"])

    def test_fruit_flavor_source_skips_collection_and_fills_ranking(self):
        class Fake:
            calls = []
            def fetch(self, data_type, queries, date, **extra):
                self.calls.append(data_type)
        fake = Fake()
        service = TrendCollectionService(TrendRepository(data_dir=tempfile.mkdtemp()), collector=fake)
        config = {"period_days": 490, "geo": "VN", "recent_period": "today 3-m", "categories": [
            {"id": "f", "ranking_source": "fruit_flavors", "representative_query": "x", "candidate_queries": ["kem dừa"]}]}
        self.assertEqual((service._collect_rankings("VN", config, NOW)["by_category"], fake.calls), ({}, []))
        config.update({"fruit_flavors": [{"id": "coconut", "label": "코코넛", "query": "dừa"}]})
        config["categories"][0]["label"] = "과일"
        sections = {"fruit_flavors": {"items": [{"query": "dừa", "recent_average": 75.4, "change_rate": -3.5,
                                                 "data_status": "normal"}]}}
        category = TrendService._categories(config, sections, {})[0]
        self.assertEqual((category["ranking_metric"], category["ranking"][0]["name"]), ("fruit_flavors", "코코넛"))

    def test_related_include_keeps_dessert_forms_only(self):
        from services.candidate_service import related_candidates
        top = [("ăn trái cây", 100), ("nước trái cây", 42), ("sữa trái cây", 29), ("giỏ trái cây", 24),
               ("bánh trái cây", 18), ("trái cây sấy", 9), ("kem trái cây", 9)]
        def fetch(data_type, queries, date, **extra):
            return {"related_queries": {"top": [{"query": q, "extracted_value": v} for q, v in top]}}
        category = {"id": "f", "representative_query": "x", "ranking_seed": "trái cây", "root_terms": ["trái cây"],
                    "ranking_include": ["bánh", "kẹo", "sấy", "kem", "trà", "sữa"]}
        found = related_candidates(fetch, category, {"recent_period": "today 3-m"})
        self.assertEqual([row["query"] for row in found["ranked"]],
                         ["sữa trái cây", "bánh trái cây", "trái cây sấy", "kem trái cây"])  # 동점(9)은 Google 순서
        reasons = {row["query"]: row["reason"] for row in found["related"]}
        self.assertEqual((reasons["nước trái cây"], reasons["giỏ trái cây"]), ("디저트 형태 아님", "디저트 형태 아님"))

    def test_paused_section_skipped_in_due_and_status(self):
        class Repo(TrendRepository):
            def get_keywords(self, country_code):
                config = super().get_keywords(country_code)
                return {**config, "paused_sections": ["related"]}
        repo = Repo(data_dir=tempfile.mkdtemp())
        self.assertNotIn("related", TrendCollectionService(repo, collector=None).due_sections("VN", now=NOW))
        old = (NOW - timedelta(days=60)).isoformat()
        fresh = NOW.isoformat()
        repo.save_latest("VN", {"sections": {name: {"checked_at": old if name == "related" else fresh}
                                             for name in SERPAPI_SECTIONS}})
        self.assertNotEqual(TrendService(repo).get_dashboard("VN", now=NOW)["data_status"], "delayed")

    def test_rankings_keep_previous_when_one_category_fails(self):
        class Fake:
            calls = []
            def fetch(self, data_type, queries, date, **extra):
                self.calls.append(queries)
                if queries == "bánh nếp":
                    raise RuntimeError("SerpApi 오류: Google Trends hasn't returned any results for this query.")
                return {"related_queries": {"top": [{"query": "bánh mochi nhật", "extracted_value": 37}]}}
        repo = TrendRepository(data_dir=tempfile.mkdtemp())
        repo.save_latest("VN", {"sections": {"rankings": {"checked_at": "2026-10-25T00:00:00+07:00", "by_category": {
            "s": {"metric": "related", "items": [{"query": "bánh nếp chiên"}]}}}}})
        fake = Fake()
        service = TrendCollectionService(repo, collector=fake)
        config = {"period_days": 490, "geo": "VN", "recent_period": "today 3-m", "categories": [
            {"id": "m", "ranking_source": "related", "representative_query": "bánh mochi", "root_terms": ["mochi"]},
            {"id": "s", "ranking_source": "related", "representative_query": "bánh nếp", "root_terms": ["nếp"]}]}
        result = service._collect_rankings("VN", config, NOW)
        self.assertEqual(fake.calls, ["bánh mochi", "bánh nếp", "bánh nếp"])  # 결과 없음은 1회 재시도
        self.assertEqual(result["by_category"]["m"]["items"][0]["query"], "bánh mochi nhật")
        self.assertEqual(result["by_category"]["s"]["items"][0]["query"], "bánh nếp chiên")  # 이전 데이터 유지
        self.assertEqual(result["by_category"]["s"]["kept_from"], "2026-10-25T00:00:00+07:00")
        self.assertIn("s", result["category_errors"])
        config["categories"] = config["categories"][1:]
        with self.assertRaises(RuntimeError):  # 모두 실패하면 영역 전체 실패
            service._collect_rankings("VN", config, NOW)

    def test_rankings_use_related_source(self):
        class Fake:
            def fetch(self, data_type, queries, date, **extra):
                return {"related_queries": {"top": [{"query": f"bánh nếp {i}", "extracted_value": 50 - i} for i in range(5)]}}
        data_dir = tempfile.mkdtemp()
        service = TrendCollectionService(TrendRepository(data_dir=data_dir), collector=Fake())
        config = {"period_days": 490, "geo": "VN", "recent_period": "today 3-m", "categories": [
            {"id": "s", "ranking_source": "related", "representative_query": "bánh nếp", "root_terms": ["nếp"],
             "candidate_queries": ["설정 후보"]}]}
        section = service._collect_rankings("VN", config, NOW)["by_category"]["s"]
        self.assertEqual(section["items"][0]["query"], "bánh nếp 0")
        self.assertEqual((section["metric"], section["items"][0]["origin"], section["items"][0]["recent_average"]),
                         ("related", "bánh nếp", 50))
        self.assertNotIn("설정 후보", [row["query"] for row in section["items"]])
        self.assertTrue(any(path.name.startswith("related_rank_s") for path in Path(data_dir).rglob("*.json")))

    def test_check_bundles_one_request_and_saves_nothing(self):
        from services.candidate_service import CandidateSuggestionService
        import suggest_candidates
        class Fake:
            calls = []
            def fetch(self, data_type, queries, date, **extra):
                self.calls.append(list(queries))
                return timeline(queries, 70, lambda i, off, day: [40, 20, 3, 10][i], step=7)
        data_dir = tempfile.mkdtemp()
        fake = Fake()
        result = CandidateSuggestionService(TrendRepository(data_dir=data_dir), fake).check_bundles("VN", now=NOW)
        self.assertEqual(len(fake.calls), 1)
        self.assertEqual(len(fake.calls[0]), 4)
        self.assertEqual([row["passed"] for row in result["bundles"]], [True, True, False, True])  # 3 < 5 미달
        self.assertEqual(list(Path(data_dir).iterdir()), [])
        import contextlib, io
        with contextlib.redirect_stdout(io.StringIO()) as out:
            suggest_candidates.print_bundle_check(result)  # 출력 함수 문법·동작 확인
        self.assertIn("[현지 과일 디저트] 미달", out.getvalue())

    def test_suggest_only_selected_category(self):
        from services.candidate_service import CandidateSuggestionService
        class Fake:
            calls = []
            def fetch(self, data_type, queries, date, **extra):
                self.calls.append((data_type, queries))
                if data_type == "RELATED_QUERIES":
                    return {"related_queries": {"top": [], "rising": []}}
                return timeline(queries, 70, lambda i, off, day: 40 - i, step=7)
        fake = Fake()
        repo = TrendRepository(data_dir=tempfile.mkdtemp())  # 설정은 실제 파일을 읽기만 하고, 제안 결과는 임시 폴더에 저장
        service = CandidateSuggestionService(repo, fake)
        suggestion = service.suggest("VN", now=NOW, category_ids=["k-dessert"])
        self.assertEqual([category["id"] for category in suggestion["categories"]], ["k-dessert"])
        seeds = repo.get_keywords("VN")["categories"][-1]["suggest_seeds"]
        self.assertEqual([q for t, q in fake.calls if t == "RELATED_QUERIES"], seeds[:4])
        with self.assertRaises(ValueError):
            service.suggest("VN", now=NOW, category_ids=["없는-카테고리"])



class CheckTermsTests(unittest.TestCase):
    def test_check_terms_saves_nothing_and_checks_meaning_of_new_terms_only(self):
        from services.candidate_service import CandidateSuggestionService
        class Fake:
            calls = []
            def fetch(self, data_type, queries, date, **extra):
                self.calls.append((data_type, queries))
                if data_type == "RELATED_QUERIES":
                    return {"related_queries": {"top": [{"query": f"{queries} ngon"}]}}
                return timeline(queries, 70, lambda i, off, day: 40 - i, step=7)
        data_dir = tempfile.mkdtemp()
        fake = Fake()
        result = CandidateSuggestionService(TrendRepository(data_dir=data_dir), fake).check_terms("VN", now=NOW)
        config = TrendRepository().get_keywords("VN")
        self.assertEqual(len(result["categories"]), len(config["categories"]))
        self.assertTrue(result["bundle_check"]["ok"])
        mochi = next(c for c in result["categories"] if c["id"] == "mochi")
        self.assertTrue(any(row["new"] for row in mochi["terms"]))
        # 순위 후보(mochi kem)는 이미 확인한 검색어라 연관 검색어를 다시 조회하지 않습니다.
        related_terms = [q for t, q in fake.calls if t == "RELATED_QUERIES"]
        self.assertNotIn("mochi kem", related_terms)
        self.assertIn("mochi", related_terms)
        self.assertEqual(list(Path(data_dir).iterdir()), [])  # 원본 응답도, 결과도 저장하지 않음


class SeasonalityLocaleTests(unittest.TestCase):
    def test_theme_can_use_other_country(self):
        class Fake:
            calls = []
            def fetch(self, data_type, queries, date, **extra):
                self.calls.append((queries, extra))
                return timeline(queries, 300, lambda i, off, day: 10 + day.month, step=7)
        fake = Fake()
        service = TrendCollectionService(TrendRepository(data_dir=tempfile.mkdtemp()), collector=fake)
        config = {"seasonality_period": "today 5-y", "geo": "VN", "fruit_flavors": [], "seasonality_themes": [
            {"id": "vn", "query": "du lịch đà nẵng"},
            {"id": "kr", "query": "다낭 여행 + 다낭", "geo": "KR", "hl": "ko", "tz": -540}]}
        result = service._collect_seasonality("VN", config, NOW)
        self.assertEqual([extra for _, extra in fake.calls], [{}, {"geo": "KR", "hl": "ko", "tz": -540}])
        self.assertEqual([theme["geo"] for theme in result["themes"]], ["VN", "KR"])
        self.assertIn("geo=KR", result["themes"][1]["source_url"])


class WeeklyWindowTests(unittest.TestCase):
    def test_window_wraps_from_december_to_january(self):
        days = [date(2024, 1, 1) + timedelta(days=i) for i in range(730)]
        def value(day):
            slot = (day.month, (day.day - 1) // 7 + 1)
            if slot == (1, 3):
                return 100
            if day.month == 12 and slot[1] >= 2 or day.month == 1:
                return 60  # 정점의 50% 이상: 12월 2주 ~ 1월 말
            return 10
        window = weekly_window(days, {day: value(day) for day in days})
        self.assertEqual(window["peak"], {"month": 1, "week": 3})
        # 29~31일은 4주에 합치므로 끝은 1월 4주
        self.assertEqual((window["start"], window["end"]), ({"month": 12, "week": 2}, {"month": 1, "week": 4}))

    def test_window_longer_than_half_year_is_year_round(self):
        days = [date(2024, 1, 1) + timedelta(days=i) for i in range(730)]
        series = {day: (100 if day.month == 6 else 60 if 3 <= day.month <= 11 else 10) for day in days}
        self.assertEqual(weekly_window(days, series), {"year_round": True})  # 3~11월 = 36주

    def test_flat_series_is_year_round(self):
        days = [date(2024, 1, 1) + timedelta(days=i) for i in range(400)]
        self.assertEqual(weekly_window(days, {day: 50 + day.month for day in days}), {"year_round": True})
        self.assertIsNone(weekly_window(days, {}))


if __name__ == "__main__": unittest.main()
