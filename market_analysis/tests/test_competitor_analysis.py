"""경쟁제품 정규화 결과 검사. [상준]"""
import csv
import importlib.util
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("build_competitors", ROOT / "build_competitors.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

# routes.py는 DB 모델을 import하므로 이 테스트 프로세스에서만 빈 모듈로 바꿉니다
sys.path.insert(0, str(ROOT.parent))
sys.modules.setdefault("market_analysis.models", types.ModuleType("market_analysis.models"))
from market_analysis import routes  # noqa: E402
from market_analysis.services.decision_cards import build_cards, flavor_supply  # noqa: E402


class CompetitorAnalysisTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.products, cls.listings = MODULE.build_records()

    def test_every_listing_links_to_product(self):
        product_ids = {row["product_id"] for row in self.products}
        self.assertTrue(product_ids)
        self.assertTrue(all(row["product_id"] in product_ids for row in self.listings))

    def test_product_ids_and_listing_ids_are_unique(self):
        self.assertEqual(len(self.products), len({row["product_id"] for row in self.products}))
        self.assertEqual(len(self.listings), len({row["listing_id"] for row in self.listings}))

    def test_sources_are_never_missing(self):
        self.assertTrue(all(row["source_url"].startswith("http") for row in self.listings))

    def test_known_same_products_are_merged(self):
        by_key = {row["canonical_key"]: row["product_id"] for row in self.products}
        strawberry_id = by_key["royal-family-strawberry-120"]
        linked = {row["listing_id"] for row in self.listings if row["product_id"] == strawberry_id}
        self.assertTrue({"VN005", "MP021", "MP036"}.issubset(linked))

    def test_unbranded_marketplace_items_are_not_merged(self):
        keys = {row["canonical_key"] for row in self.products}
        self.assertIn("marketplace-mp004", keys)
        self.assertIn("marketplace-mp005", keys)


class CompetitorResearchScreenTests(unittest.TestCase):
    """재조사 결과 폴더 → 경쟁사 탭 화면 데이터 변환."""

    @classmethod
    def setUpClass(cls):
        cls.folder = routes._research_folder("VN")
        if cls.folder is None:
            raise unittest.SkipTest("재조사 결과 폴더 없음")
        cls.data = routes._load_competitors("VN")
        with (cls.folder / "competitor_products.csv").open(encoding="utf-8-sig") as handle:
            cls.product_rows = list(csv.DictReader(handle))

    def test_uses_research_folder_first(self):
        self.assertEqual(self.data["source"], "research")
        self.assertEqual(len(self.data["items"]), len(self.product_rows))

    def test_every_item_has_confirmed_listings_with_source(self):
        for item in self.data["items"]:
            self.assertTrue(item["listings"], item["product_id"])
            self.assertTrue(all(l["source_url"].startswith("http") and l["stock_status"] == "판매 확인" for l in item["listings"]))

    def test_no_product_images_are_sent(self):
        self.assertTrue(all("image_url" not in item for item in self.data["items"]))
        self.assertEqual(self.data["summary"]["imaged_product_count"], 0)

    def test_danang_store_counts_only_store_lists(self):
        # Co.op 배송 지역 문구('다낭 배송 여부 미확인')는 매장으로 세지 않습니다
        self.assertEqual(self.data["summary"]["danang_store_brands"], ["Mochi Sweets"])

    def test_card_items_keep_flavor_counts(self):
        # 중량별로 나눠도 맛 공급 수는 제품 기준 그대로여야 합니다
        self.assertEqual(flavor_supply(self.data["card_items"]), flavor_supply(self.data["items"]))
        cards = build_cards({}, self.data["card_items"], None, self.data["as_of"])
        self.assertEqual(cards["price"]["status"], "ok")
        for item in self.data["card_items"]:
            weights = {l["net_weight_g"] for l in item["listings"]}
            self.assertEqual(weights, {item["net_weight_g"]})

    def test_priority_and_gifts_are_built(self):
        self.assertEqual(self.data["priority"][0]["brand"], "Mochi Sweets")
        self.assertTrue(all(g["pack_count"] >= 3 for g in self.data["gifts"]))
        self.assertTrue(all(s["high"] >= s["low"] for s in self.data["spreads"]))

    def test_falls_back_to_previous_catalog_without_research(self):
        from flask import Flask
        from market_analysis import bp

        app = Flask(__name__)
        app.register_blueprint(bp)  # 예전 조사표는 사진 주소(url_for)를 만들어서 앱 문맥이 필요합니다
        with app.test_request_context(), patch.object(routes, "_research_folder", return_value=None):
            legacy = routes._load_competitors("VN")
        self.assertNotEqual(legacy.get("source"), "research")
        self.assertTrue(legacy["items"])


if __name__ == "__main__":
    unittest.main()
