"""합성 뉴스만 사용하는 HOME 영향 분류 회귀 검사. 외부 API·운영 DB에 쓰지 않습니다."""
import copy
import unittest
from unittest.mock import patch
from xml.etree import ElementTree

from flask import Flask

from home import bp
from home import news_search as news
from home.news_search import SearchError, SourceUnavailable, classify_article, search


def article(description="", **overrides):
    return {"title": "DEMO synthetic food market article", "description": description,
            "publisher": "DEMO test publisher", "source_label": "DEMO test feed",
            "published_at": "2026-11-10", "url": "https://example.test/demo-article",
            "verification_status": "unverified", "registration_status": "candidate",
            "is_demo": True, **overrides}


OPPORTUNITY = "Vietnam food demand grows as local dessert distribution expands. Retailers report interest in packaged food for the upcoming gift season."
CAUTION = "Vietnam food labeling regulation requires preparation by food importers and dessert retailers serving the domestic food market this season."
RISK = "Vietnam food import ban affects a range of packaged dessert products shipped through distribution channels to retailers in the local market."


class NewsImpactTest(unittest.TestCase):
    def setUp(self):
        native = patch.object(news, "_native", return_value=([], []))
        native.start()
        self.addCleanup(native.stop)
        app = Flask(__name__)
        app.register_blueprint(bp)
        app.config["TESTING"] = True
        self.client = app.test_client()

    def test_categories_and_source_states_are_independent(self):
        for state, registration in [("unverified", "candidate"), ("verified", "approved")]:
            for description, category in [(OPPORTUNITY, "opportunity"), (CAUTION, "caution"), (RISK, "risk"), ("", "hold")]:
                with self.subTest(state=state, category=category):
                    row = article(description, verification_status=state, registration_status=registration)
                    before = copy.deepcopy(row)
                    self.assertEqual(classify_article(row)["category"], category)
                    self.assertEqual(row, before)

    def test_vietnamese_and_korean_market_signals(self):
        examples = [
            ("Tại Việt Nam, nhu cầu tăng đối với thực phẩm và bánh ngọt khi các nhà bán lẻ mở rộng phân phối trong mùa quà tặng năm nay.", "opportunity"),
            ("Tại Việt Nam, quy định ghi nhãn thực phẩm yêu cầu các nhà nhập khẩu và nhà bán lẻ bánh ngọt chuẩn bị thông tin trên bao bì sản phẩm.", "caution"),
            ("Tại Việt Nam, cấm nhập khẩu một số sản phẩm thực phẩm đóng gói ảnh hưởng đến các nhà bán lẻ và nhà phân phối bánh ngọt trong nước.", "risk"),
            ("베트남 식품 및 디저트 시장에서 수요 증가 단서가 보고되어 현지 소매업체와 선물용 식품 판매 채널이 새 유통 기회를 살펴보고 있다.", "opportunity"),
        ]
        for description, expected in examples:
            with self.subTest(expected=expected):
                self.assertEqual(classify_article(article(description))["category"], expected)

    def test_missing_mixed_uncertain_and_wrong_scope(self):
        for description, reason in [("", "insufficient"), (OPPORTUNITY + " A food recall also affects local retailers.", "mixed"),
                                    (RISK + " Officials have not confirmed the details.", "unclear"),
                                    (RISK.replace("import ban affects", "import ban lifted for"), "unclear"),
                                    ("Vietnam food retailers discuss dessert sales. France announces a food recall across its own local distribution network.", "scope"),
                                    (OPPORTUNITY.replace("Vietnam", "France"), "scope"),
                                    ("Vietnam tourism demand grows for hotels and scenic tours in the local market ahead of the upcoming holiday travel season.", "scope")]:
            result = classify_article(article(description))
            self.assertEqual((result["category"], result["reason_code"]), ("hold", reason))
        self.assertEqual(classify_article(article("", title=RISK))["category"], "hold")

    def test_classification_failure_preserves_api_articles(self):
        row = article(OPPORTUNITY)
        with patch("home.routes.search", return_value=([row], [])), patch("home.routes.translate_titles", return_value=([row["title"]], True)), patch.object(news, "_classify_cached", side_effect=TimeoutError):
            response = self.client.get("/home/api/news/search?q=food")
        self.assertEqual(response.status_code, 200)
        result = response.json["items"][0]
        self.assertEqual((result["impact"]["category"], result["impact"]["reason_code"]), ("hold", "failed"))
        for key in ("url", "publisher", "source_label", "published_at", "verification_status", "registration_status"):
            self.assertEqual(result[key], row[key])
        self.assertTrue(response.json["translation_failed"])
        self.assertNotIn("impact", row)

    def test_classification_cache(self):
        news._classify_cached.cache_clear()
        row = article(OPPORTUNITY)
        a = classify_article(row)
        a["topics"].clear()
        b = classify_article(row)
        self.assertEqual(news._classify_cached.cache_info().hits, 1)
        self.assertIn("food", b["topics"])
        classify_article({**row, "description": RISK})
        self.assertEqual(news._classify_cached.cache_info().misses, 2)

    def test_unique_articles_and_period_before_limit(self):
        row = article(OPPORTUNITY)
        duplicate = {**row, "url": row["url"] + "?utm_source=test#top", "title": "DEMO variant headline"}
        same_title = {**row, "url": "https://example.test/mirror"}
        independent = {**row, "publisher": "DEMO another publisher", "url": "https://example.test/another-report"}
        outside = [{**row, "title": f"DEMO outside {i}", "published_at": "2026-11-11", "url": f"https://example.test/outside-{i}"} for i in range(15)]
        unknown = {**row, "published_at": "", "url": "https://example.test/undated", "title": "DEMO undated"}
        with patch.object(news, "_google", return_value=outside + [row, duplicate, same_title, independent, unknown]) as google:
            rows, failed = search(query="food", start="2026-11-10", end="2026-11-10")
        self.assertEqual(len(rows), 2)
        self.assertEqual(failed, [])
        self.assertIn("after:2026-11-09", google.call_args.args[0])
        self.assertIn("before:2026-11-11", google.call_args.args[0])
        self.assertTrue(all(r["published_at"] == "2026-11-10" for r in rows))

    def test_same_title_on_different_dates_is_preserved(self):
        row = article(OPPORTUNITY)
        next_day = {**row, "url": "https://example.test/next-day", "published_at": "2026-11-11"}
        with patch.object(news, "_google", return_value=[row, next_day]):
            rows, _ = search(query="food")
        self.assertEqual(len(rows), 2)

    def test_period_validation(self):
        for start, end in [("2026-11-12", "2026-11-10"), ("2026-02-30", None), ("20261110", None), (None, "9999-12-31")]:
            with self.assertRaises(SearchError):
                search(query="food", start=start, end=end)

    def test_presets_use_current_period_and_report_partial_failure(self):
        with patch.object(news, "_google", return_value=[article(OPPORTUNITY)]) as google, patch.object(news, "_vnexpress", side_effect=SourceUnavailable):
            rows, failed = search(preset="food_rules", start="2026-11-01")
        self.assertNotIn("when:", google.call_args.args[0])
        self.assertEqual((len(rows), failed), (1, ["VnExpress 영문"]))

    def test_search_failure_is_not_successful_zero(self):
        with patch("home.routes.search", side_effect=SourceUnavailable("DEMO source failure")):
            failed = self.client.get("/home/api/news/search?q=food")
        with patch("home.routes.search", return_value=([], [])):
            empty = self.client.get("/home/api/news/search?q=food")
        self.assertEqual((failed.status_code, empty.status_code), (502, 200))
        self.assertIn("error", failed.json)
        self.assertNotIn("error", empty.json)

    def test_rss_linked_title_is_not_body_evidence(self):
        node = ElementTree.fromstring('<item><title>' + RISK + '</title><link>https://example.test/demo</link><description>&lt;a href="https://example.test/demo"&gt;' + RISK + '&lt;/a&gt; DEMO publisher</description><source>DEMO publisher</source><pubDate>Tue, 10 Nov 2026 08:00:00 GMT</pubDate></item>')
        row = news._item(node, "DEMO feed")
        self.assertEqual(row["verification_status"], "unverified")
        self.assertEqual(classify_article(row)["reason_code"], "insufficient")


if __name__ == "__main__":
    unittest.main()
