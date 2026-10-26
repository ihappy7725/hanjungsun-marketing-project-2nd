"""의사결정 카드: 맛 이름 통일·빈틈/과밀 분류·100g당 가격 분포·채널 집계·D- 근거."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_trend_integration import create_test_app  # noqa: E402,F401  (market_analysis.models를 테스트용으로 대체)

from market_analysis.services import decision_cards as d  # noqa: E402

TREND = {
    "fruit_flavors": [{"id": "coconut", "name": "코코넛", "rank": 1, "recent_average": 75.4},
                      {"id": "strawberry", "name": "딸기", "rank": 10, "recent_average": 5.5},
                      {"id": "mango", "name": "망고", "rank": 5, "recent_average": 27.1}],
    "seasonality": [{"type": "fruits", "fruits": [{"id": "coconut", "peak_months": [3, 1]}]}],
}


def product(flavors, weight=100, storage="dry", listings=()):
    return {"flavors": flavors, "net_weight_g": weight, "storage": storage,
            "listings": [{"platform": p, "current_price_vnd": price} for p, price in listings]}


COMPETITORS = (
    [product("strawberry; mixed", listings=[("Shopee", 40000)]) for _ in range(8)]
    + [product("dâu tây", listings=[("AEONESHOP", 30000)])]
    + [product("mango, red_bean", weight=200, listings=[("TikTok Shop", 100000), ("Sakuko", 120000)]) for _ in range(4)]
    + [product("coconut", storage="frozen", listings=[("Lazada", 25000)])]
)
ECOMMERCE = {"shares": {"as_of": "2025", "items": [{"name": "Shopee", "share": 56.04}, {"name": "TikTok Shop", "share": 41.31},
                                                     {"name": "Lazada·Tiki", "share": 3}]}}


class DecisionCardTests(unittest.TestCase):
    def test_flavor_aliases_and_kinds(self):
        supply = d.flavor_supply(COMPETITORS)
        self.assertEqual((supply["strawberry"], supply["mango"], supply["coconut"]), (9, 4, 1))  # dâu tây도 딸기로 셈, mixed는 제외
        rows = {r["id"]: r for r in d.flavor_card(TREND, COMPETITORS, "2026-10-26")["rows"]}
        self.assertEqual((rows["coconut"]["kind"], rows["strawberry"]["kind"], rows["mango"]["kind"]), ("gap", "crowded", "contested"))
        self.assertEqual(rows["coconut"]["peak_months"], [3, 1])

    def test_price_per_100g_distribution_by_storage(self):
        card = d.price_card(COMPETITORS, "2026-10-26")
        self.assertEqual(card["overall"]["count"], 18)
        dry = next(r for r in card["rows"] if r["storage"] == "dry")
        self.assertEqual(dry["median"], 40000)  # 200g 제품은 100g당 50,000·60,000
        frozen = next(r for r in card["rows"] if r["storage"] == "frozen")
        self.assertNotIn("median", frozen)  # 표본 1건은 분포를 내지 않음

    def test_channel_groups_and_platform_share(self):
        rows = {r["channel"]: r for r in d.channel_card(COMPETITORS, ECOMMERCE, "2026-10-26")["rows"]}
        self.assertEqual(rows["수입·일본 식품점"]["listings"], 5)  # AEONESHOP + Sakuko
        self.assertEqual((rows["TikTok Shop"]["listings"], rows["TikTok Shop"]["platform_share"]), (4, 41.31))
        self.assertEqual(rows["Lazada"]["platform_share"], 3)

    def test_insufficient_data_and_evidence(self):
        empty = d.build_cards({}, [], None, None)
        self.assertEqual({k: v["status"] for k, v in empty.items()}, {"flavor": "insufficient", "price": "insufficient", "channel": "insufficient"})
        self.assertEqual(d.card_evidence(empty, "2026-10-26"), {})
        evidence = d.card_evidence(d.build_cards(TREND, COMPETITORS, ECOMMERCE, "2026-10-26"), "2026-10-26")
        self.assertEqual(set(evidence), {"D-맛기회", "D-가격", "D-채널"})
        self.assertIn("경쟁 제품 9개", evidence["D-맛기회"]["text"])
        self.assertIn("공급 기준", evidence["D-맛기회"]["text"])


if __name__ == "__main__":
    unittest.main()
