"""AI 인사이트: 근거 목록·과일 규칙·근거 태그 검증·API (OpenAI는 호출하지 않고 흉내 냅니다)."""
import os
import sys
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_trend_integration import create_test_app  # noqa: E402  (market_analysis.models를 테스트용으로 대체)

from market_analysis.services import insight_service as s  # noqa: E402

CONFIG = {"fruit_flavors": [{"id": "coconut", "label": "코코넛", "query": "dừa", "mochi_fit": True},
                            {"id": "banana", "label": "바나나", "query": "chuối", "mochi_fit": True},
                            {"id": "durian", "label": "두리안", "query": "sầu riêng", "mochi_fit": False}]}
TREND = {
    "checked_at": "2026-10-26T04:00:00+07:00",
    "categories": [{"label": "떡·모찌", "recent_average": 36.7, "change_rate": -19.3, "short_change_rate": 8.8,
                    "ranking": [{"name": "아이스크림 모찌", "query": "bánh mochi kem lạnh", "recent_average": 23, "rising_value": "+90%"}]}],
    "fruit_flavors": [{"id": "coconut", "rank": 1, "name": "코코넛", "recent_average": 75.4, "change_rate": -3.5},
                      {"id": "banana", "rank": 2, "name": "바나나", "recent_average": 67.9, "change_rate": 7.1},
                      {"id": "durian", "rank": 3, "name": "두리안", "recent_average": 34.2, "change_rate": 6.5}],
    "seasonality": [{"id": "fruit-limited", "type": "fruits", "fruits": [
        {"id": "coconut", "name": "코코넛", "peak_months": [3, 1]},
        {"id": "banana", "name": "바나나", "peak_months": [10, 7]},
        {"id": "durian", "name": "두리안", "peak_months": [11]}]},
        {"id": "danang-travel-kr", "type": "query", "peak_months": [8, 7]}],
    "regions": [{"geo": "VN-DN", "rank": 5}], "regions_meta": {"compared": 10},
}
GUIDELINES = {"culture_dashboard": {
    "sources": [{"id": "danang", "publisher": "Danang Fantasticity", "checked_date": "2025-08-01"},
                {"id": "datareportal_2026", "publisher": "DataReportal", "checked_date": "2025-11-08"}],
    "consumer_facts": [{"label": "TikTok 광고 도달", "value": "7,610만"}],
    "insight_evidence": [{"tag": "K-다낭", "text": "한국은 2016년부터 다낭 국제 관광객 1위 시장", "source_ids": ["danang"]}],
}}
BODY = {"goal": "tourist", "period": "3m", "channels": ["souvenir", "online"]}


class InsightRuleTests(unittest.TestCase):
    def test_evidence_has_source_and_date_and_skips_missing_data(self):
        evidence = s.build_evidence(TREND, GUIDELINES, competitors=[])
        self.assertEqual((evidence["K-다낭"]["source"], evidence["K-다낭"]["date"]), ("Danang Fantasticity", "2025-08-01"))
        self.assertIn("7,610만", evidence["K-채널"]["text"])
        self.assertIn("+90%", evidence["T-급상승"]["text"])
        self.assertNotIn("C-★", evidence)  # ★ 경쟁사가 없으면 태그를 만들지 않음
        core = [{"brand": "A", "product": "모찌", "price_vnd": 120000, "pack_count": 6, "key_message": "정통", "is_core": True,
                 "surveyed_at": "2026-10-26"}]
        self.assertIn("개당 약 20,000동", s.build_evidence(TREND, GUIDELINES, core)["C-★"]["text"])

    def test_fruit_rule_fit_then_rank_then_peak_in_period(self):
        picks = s.pick_fruits(TREND, CONFIG, chosen=[], months_in_period=[10, 11, 12])
        self.assertEqual([p["name"] for p in picks], ["바나나", "코코넛"])  # 두리안(11월 피크)은 찹쌀떡 활용 X
        self.assertTrue(picks[0]["peak_in_period"])
        self.assertTrue(picks[0]["launch"].startswith("즉시"))  # 피크 10월까지 2개월 여유 없음
        self.assertEqual([p["name"] for p in s.pick_fruits(TREND, CONFIG, ["coconut"], [10, 11, 12])], ["코코넛"])

    def test_validation_drops_unknown_tags_invented_numbers_and_weak_opinions(self):
        evidence = s.build_evidence(TREND, GUIDELINES, [])
        raw = {"conclusion": "관광객 채널 집중",
               "insights": [{"fact": "한국은 2016년부터 다낭 국제 관광객 1위 시장", "tags": ["K-다낭"]},
                            {"fact": "한국인 300만 명 방문", "tags": ["K-다낭"]},   # 근거에 없는 숫자
                            {"fact": "근거 없는 사실", "tags": ["K-가짜"]}],       # 없는 태그
               "opinions": [{"text": "관광객 채널 우선", "tags": ["K-다낭", "K-채널"]},
                            {"text": "태그 하나", "tags": ["K-다낭"]}],
               "swot": {"S": [{"text": "x", "tags": []}]}}
        result = s.validate(raw, evidence, [], [10, 11, 12])
        self.assertEqual(len(result["insights"]), 1)
        self.assertEqual(len(result["opinions"]), 1)
        self.assertEqual(result["swot"]["S"], [])
        self.assertTrue(result["swot"]["T"][0]["text"].startswith("근거 부족"))  # 위협은 항상 1개 이상
        self.assertTrue(result["positioning"]["text"].startswith("근거 부족"))
        self.assertEqual(result["dropped"], 5)

    def test_card_evidence_usable_in_opinions_up_to_four(self):
        cards = {"flavor": {"status": "ok", "rule": "규칙", "as_of": "2026-10-26",
                            "rows": [{"name": "코코넛", "rank": 1, "interest": 75.4, "supply": 3, "peak_months": [3], "kind": "gap"}]}}
        evidence = s.build_evidence(TREND, GUIDELINES, [], cards)
        self.assertIn("D-맛기회", evidence)
        raw = {"opinions": [{"text": "코코넛 경쟁 제품 3개뿐이라 1순위", "tags": ["D-맛기회", "T-과일"]}]
               + [{"text": f"의견 {name}", "tags": ["K-다낭", "D-맛기회"]} for name in "가나다라마"],
               "card_opinions": {"flavor": {"text": "x", "tags": ["D-맛기회"]}}}  # 화면에서 뺀 항목은 결과에 넣지 않음
        result = s.validate(raw, evidence, [], [10, 11, 12])
        self.assertEqual(result["opinions"][0]["tags"], ["D-맛기회", "T-과일"])
        self.assertEqual(len(result["opinions"]), s.MAX_OPINIONS)
        self.assertNotIn("card_opinions", result)

    def test_input_validation(self):
        with self.assertRaises(s.InsightError):
            s.validate_input({"goal": "tourist", "period": "3m", "channels": []}, CONFIG)
        with self.assertRaises(s.InsightError):
            s.validate_input({**BODY, "memo": "가" * 201}, CONFIG)
        self.assertEqual(s.validate_input({**BODY, "fruits": ["durian", "banana"]}, CONFIG)["fruits"], ["banana"])

    def test_generate_passes_only_evidence_and_server_picks_to_ai(self):
        seen = {}

        def fake_ai(payload):
            seen.update(payload)
            return {"conclusion": "다음 3개월 관광객 채널 입점"}
        out = s.generate(BODY, CONFIG, TREND, GUIDELINES, [], today=date(2026, 10, 26), ai=fake_ai)
        self.assertEqual([step["month"] for step in seen["server_picks"]["timeline"]], [10, 11, 12])
        self.assertEqual({e["tag"] for e in seen["evidence"]}, set(out["evidence"]))
        self.assertIn("K-기념일", out["evidence"])
        self.assertTrue(out["holidays"]["items"])
        self.assertIn("★ 경쟁사 데이터가 없어 경쟁사 비교는 비어 있습니다.", out["limits"])


class InsightApiTests(unittest.TestCase):
    def setUp(self):
        self.client = create_test_app().test_client()
        self.url = "/market_analysis/api/insight?country=VN"

    def test_options_list_only_mochi_fit_fruits(self):
        body = self.client.get(self.url).get_json()
        self.assertEqual([g["id"] for g in body["goals"]], ["awareness", "first_sale", "season", "tourist"])
        self.assertTrue(body["fruits"])

    def test_without_key_returns_503_and_no_result(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": ""}):
            response = self.client.post(self.url, json=BODY)
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("result", response.get_json())

    def test_bad_input_returns_400(self):
        self.assertEqual(self.client.post(self.url, json={"goal": "tourist"}).status_code, 400)

    def test_generate_with_mocked_ai(self):
        with patch.object(s, "call_openai", return_value={"conclusion": "관광객 채널 우선"}):
            response = self.client.post(self.url, json=BODY)
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertEqual(body["result"]["conclusion"], "관광객 채널 우선")
        self.assertEqual(len(body["result"]["fruits"]), 2)


if __name__ == "__main__":
    unittest.main()
