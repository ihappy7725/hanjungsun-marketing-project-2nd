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

    def test_regions_combined_by_category_average(self):
        def region(geo, value):
            return {"geo": geo, "name": geo, "location": geo, "interest": value}
        by_category = [
            {"id": "a", "items": [region("R1", 100), region("R2", 20), region("R3", 0), region("R4", 50)]},
            {"id": "b", "items": [region("R1", 40), region("R2", 80), region("R3", 0)]},
        ]
        result, meta = combine_regions(by_category)  # 검색 규모가 없으면 같은 비중
        rows = {row["geo"]: row for row in result}
        self.assertEqual(meta, {"method": "equal", "weights": {"a": 50, "b": 50}})
        # 평균 R1 70, R2 50 -> 1위 = 100으로 맞춤
        self.assertEqual((rows["R1"]["interest"], rows["R1"]["rank"]), (100, 1))
        self.assertEqual((rows["R2"]["interest"], rows["R2"]["rank"]), (71.4, 2))
        self.assertEqual((rows["R3"]["rank"], rows["R3"]["data_status"]), (None, "insufficient"))
        # 한 카테고리에 값이 없으면 0으로 채우지 않고 순위에서 뺍니다.
        self.assertEqual((rows["R4"]["interest"], rows["R4"]["rank"], rows["R4"]["data_status"]), (None, None, "insufficient"))
        self.assertEqual(rows["R4"]["categories"], {"a": 50})

    def test_regions_combined_weighted_by_category_search_size(self):
        def region(geo, value):
            return {"geo": geo, "name": geo, "location": geo, "interest": value}
        by_category = [
            {"id": "big", "items": [region("R1", 100), region("R2", 20)]},
            {"id": "small", "items": [region("R1", 10), region("R2", 100)]},
        ]
        # 단순 평균이면 R2(60)가 R1(55)보다 앞서지만, 검색 규모가 3배인 big을 더 반영하면 R1이 1위
        result, meta = combine_regions(by_category, {"big": 30, "small": 10})
        self.assertEqual(meta, {"method": "weighted", "weights": {"big": 75, "small": 25}})
        self.assertEqual([(row["geo"], row["interest"]) for row in result], [("R1", 100), ("R2", 51.6)])
        # 검색 규모가 하나라도 없으면 같은 비중으로 계산하고 그 사실을 알립니다.
        self.assertEqual(combine_regions(by_category, {"big": 30})[1]["method"], "equal")

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



if __name__ == "__main__": unittest.main()
