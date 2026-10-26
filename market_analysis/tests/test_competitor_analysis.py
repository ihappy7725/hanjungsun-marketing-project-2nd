"""경쟁제품 정규화 결과 검사. [상준]"""
import csv
import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("build_competitors", ROOT / "build_competitors.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


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


if __name__ == "__main__":
    unittest.main()
