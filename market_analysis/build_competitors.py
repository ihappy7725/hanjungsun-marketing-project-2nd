"""1·2차 경쟁제품 조사표를 제품 기준표와 판매처 기준표로 정규화한다. [상준]

원본 CSV는 수정하지 않는다. 상품 사진은 ``--images``를 지정했을 때 공개 상품
페이지의 og:image만 내려받으며, 찾지 못한 경우 빈 값으로 남긴다.
"""
from __future__ import annotations

import argparse
import csv
import html
import re
import unicodedata
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
IMAGE_DIR = ROOT / "static" / "images" / "competitors"
FIRST = DATA / "competitor_products_researched_vn_2026-10-26.csv"
SECOND = DATA / "marketplace_competitors_vn_2026-10-26.csv"
PRODUCTS = DATA / "competitor_products_vn.csv"
LISTINGS = DATA / "competitor_listings_vn.csv"
LEGACY = DATA / "competitors_vn.csv"

PRODUCT_COLUMNS = [
    "product_id", "canonical_key", "brand", "product_name", "competitor_level",
    "segment", "product_form", "flavors", "net_weight_g", "piece_count", "origin",
    "storage", "image_path", "image_source_url", "image_asset_url",
    "image_checked_at", "image_status",
]
LISTING_COLUMNS = [
    "listing_id", "product_id", "platform", "seller", "seller_location",
    "current_price_vnd", "price_max_vnd", "regular_price_vnd", "discount_percent",
    "stock_status", "product_rating", "review_count", "sold_count", "variant_count",
    "sales_method", "marketing_observation", "verification_level", "source_freshness",
    "source_url", "checked_at", "data_limitations",
]
LEGACY_COLUMNS = [
    "brand", "product", "segment", "origin", "pack_count", "unit_weight_g",
    "price_vnd", "monthly_sales", "channels", "is_core", "region", "source_url",
    "surveyed_at", "promotion", "sns_influencer", "seasonal_limited", "packaging",
    "key_message", "sales_event", "review_keywords", "takeaway",
]

# 브랜드·규격이 명확히 같은 2차 상품만 통합한다. 무브랜드 상품은 판매자별로 유지한다.
SECOND_KEYS = {
    "MP002": "mclune-flowing-cream",
    "MP010": "mclune-flowing-cream",
    "MP013": "mclune-mix-1kg-7",
    "MP018": "mclune-mix-1kg-6",
    "MP024": "mclune-random-single-6",
    "MP035": "mclune-mix-1kg-7",
    "MP014": "royal-family-assorted-210",
    "MP015": "royal-family-milk-tea-120",
    "MP021": "royal-family-strawberry-120",
    "MP023": "royal-family-redbean-120",
    "MP028": "royal-family-mixed-120",
    "MP036": "royal-family-strawberry-120",
    "MP030": "sachi-lemon-soda-115",
}

# 공개 상품 목록에서 제품명과 함께 확인한 대표 이미지. 검색·캠페인 대표 이미지는 넣지 않는다.
IMAGE_OVERRIDES = {
    "royal-family-strawberry-132": (
        "https://concung.com/banh-an-dam-va-keo-cho-be/banh-mochi-dau-tay-132g-70232.html",
        "https://cdn1.concung.com/2025/03/70232-119143-large_mobile/banh-mochi-dau-tay-132g.webp",
    ),
    "royal-family-strawberry-120": (
        "https://farmersmarket.vn/collections/vendors?q=dai-loan",
        "https://product.hstatic.net/1000141988/product/hi_nhan_dau_tay_dai_loan_royal_family_4a27c51f46084901a3436215892ecaaf_9d959f529a0c4b89ab05b26d4b107df2_small.jpg",
    ),
    "royal-family-mixed-250": (
        "https://farmersmarket.vn/collections/vendors?q=dai-loan",
        "https://product.hstatic.net/1000141988/product/banh_mochi_hon_hop_royal_family_250gr_02c733b9058041ee84c20398869d33e9_ed8d9db8445d4ded860cab76cfbadeb0_small.jpg",
    ),
}


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return [{key: (value or "").strip() for key, value in row.items()}
                for row in csv.DictReader(handle)]


def write_csv(path: Path, columns: list[str], rows: list[dict[str, object]]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def slug(value: str) -> str:
    plain = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", plain).strip("-") or "unknown"


def first_value(rows: list[dict[str, str]], key: str) -> str:
    return next((row.get(key, "") for row in rows if row.get(key)), "")


def number(value: str) -> float | None:
    cleaned = re.sub(r"[^0-9.\-]", "", value or "")
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def int_text(value: float | None) -> str:
    if value is None:
        return ""
    return str(int(value)) if value.is_integer() else str(round(value, 2))


def existing_image_metadata() -> dict[str, dict[str, str]]:
    """재생성 전 제품 CSV에 저장된 사진 근거를 canonical_key별로 보존한다."""
    if not PRODUCTS.exists():
        return {}
    return {
        row.get("canonical_key", ""): {
            key: row.get(key, "")
            for key in (
                "image_path", "image_source_url", "image_asset_url",
                "image_checked_at", "image_status",
            )
        }
        for row in read_csv(PRODUCTS)
        if row.get("canonical_key") and row.get("image_path")
    }


def local_image_metadata(product_id: str, canonical_key: str) -> dict[str, str]:
    """이미 내려받은 제품 사진을 제품 ID로 찾아 CSV 연결을 복구한다."""
    matches = [
        path for path in sorted(IMAGE_DIR.glob(f"{product_id.lower()}.*"))
        if path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}
    ]
    if not matches:
        return {}
    path = matches[0]
    override = IMAGE_OVERRIDES.get(canonical_key)
    return {
        "image_path": f"images/competitors/{path.name}",
        "image_source_url": override[0] if override else "",
        "image_asset_url": override[1] if override else "",
        "image_checked_at": date.fromtimestamp(path.stat().st_mtime).isoformat(),
        "image_status": "확인 완료",
    }


def platform_from(row: dict[str, str]) -> str:
    url = row.get("source_url", "").lower()
    channel = row.get("sales_channel", "")
    if "aeon" in url:
        return "AEONESHOP"
    if "concung" in url:
        return "Con Cưng"
    if "farmersmarket" in url:
        return "Farmers Market"
    if "sakuko" in url:
        return "Sakuko"
    if "cooponline" in url:
        return "Saigon Co.op"
    if "metric.vn" in url:
        return "Marketplace aggregate"
    return channel or "Online retail"


FRUIT_FLAVOR_TERMS = {
    "fruit", "strawberry", "mango", "durian", "melon", "peach", "avocado",
    "coconut", "banana", "grape", "orange", "kiwi", "raspberry", "blueberry",
    "yuzu", "lemon", "passion_fruit", "apricot",
}


def segment(
    product_form: str,
    storage: str,
    name: str,
    flavors: str,
    net_weight_g: str,
    piece_count: str,
) -> str:
    """제품을 마케팅 비교에 쓰는 하나의 판매 유형으로 분류한다.

    포장 규모가 제품 형태보다 구매·유통 의사결정에 먼저 영향을 주므로
    대용량과 혼합 세트를 우선 판정한다. ``cold_filled``나 제품명의 ``kem``은
    크림 제품일 수 있어, 냉동 또는 ice_cream 표기가 있을 때만 아이스크림으로 본다.
    """
    form = product_form.lower()
    storage_text = storage.lower()
    name_text = f" {name.lower()} "
    flavor_text = flavors.lower()
    weight = number(net_weight_g)
    pieces = number(piece_count)

    if weight is not None and weight >= 500:
        return "대용량·도매형"
    if (
        (pieces is not None and pieces >= 18)
        or "assorted" in form
        or any(term in flavor_text for term in ("mixed", "mix;", "assorted", "flavors"))
    ):
        return "혼합·선물세트"
    if storage_text == "frozen" or "ice_cream" in form or "frozen_cream" in form:
        return "모찌 아이스크림"
    if any(term in form for term in ("cream", "cold_filled", "custard")) or " kem " in name_text:
        return "크림·코팅 모찌"
    if any(term in flavor_text for term in FRUIT_FLAVOR_TERMS):
        return "과일맛 모찌"
    return "전통·차·팥 모찌"


def second_key(row: dict[str, str]) -> str:
    listing_id = row["listing_id"]
    if listing_id in SECOND_KEYS:
        return SECOND_KEYS[listing_id]
    brand = row.get("brand", "")
    # 무브랜드 상품을 이름이 비슷하다는 이유만으로 합치지 않는다.
    if not brand or brand.lower() in {"no brand", "mochi"}:
        return f"marketplace-{listing_id.lower()}"
    return slug(f"{brand}-{row.get('product_name_vi', '')}-{row.get('net_weight_g', '')}")


def build_records() -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    first_rows = read_csv(FIRST)
    second_rows = read_csv(SECOND)
    saved_images = existing_image_metadata()
    grouped: dict[str, list[dict[str, str]]] = defaultdict(list)
    source_rows: list[dict[str, str]] = []

    for row in first_rows:
        key = row.get("canonical_key") or f"first-{row['listing_id'].lower()}"
        grouped[key].append({"source": "first", **row})
        source_rows.append({"source": "first", "key": key, **row})
    for row in second_rows:
        key = second_key(row)
        grouped[key].append({"source": "second", **row})
        source_rows.append({"source": "second", "key": key, **row})

    key_to_id = {key: f"VN-P{index:03d}" for index, key in enumerate(sorted(grouped), 1)}
    products: list[dict[str, str]] = []

    for key in sorted(grouped):
        rows = grouped[key]
        first_group = [row for row in rows if row["source"] == "first"]
        second_group = [row for row in rows if row["source"] == "second"]
        brand = first_value(first_group, "brand") or first_value(second_group, "brand")
        if brand.lower() in {"no brand", "mochi"}:
            brand = ""
        name = first_value(first_group, "product_name_vi") or first_value(second_group, "product_name_vi")
        flavors = first_value(first_group, "flavor") or first_value(second_group, "flavors")
        weight = first_value(first_group, "net_weight_g") or first_value(second_group, "net_weight_g")
        pieces = first_value(first_group, "piece_count") or first_value(second_group, "piece_count")
        product_form = first_value(first_group, "product_form") or first_value(second_group, "product_form")
        storage = first_value(first_group, "storage")
        image = saved_images.get(key) or local_image_metadata(key_to_id[key], key)
        products.append({
            "product_id": key_to_id[key],
            "canonical_key": key,
            "brand": brand,
            "product_name": name,
            "competitor_level": first_value(first_group, "competitor_level") or first_value(second_group, "competitor_level"),
            "segment": segment(product_form, storage, name, flavors, weight, pieces),
            "product_form": product_form,
            "flavors": flavors,
            "net_weight_g": weight,
            "piece_count": pieces,
            "origin": first_value(first_group, "origin"),
            "storage": storage,
            "image_path": image.get("image_path", ""),
            "image_source_url": image.get("image_source_url", ""),
            "image_asset_url": image.get("image_asset_url", ""),
            "image_checked_at": image.get("image_checked_at", ""),
            "image_status": image.get("image_status", "사진 확인 필요"),
        })

    listings: list[dict[str, str]] = []
    for row in source_rows:
        if row["source"] == "first":
            current = row.get("current_price_vnd", "")
            listings.append({
                "listing_id": row["listing_id"], "product_id": key_to_id[row["key"]],
                "platform": platform_from(row), "seller": row.get("seller", ""),
                "seller_location": row.get("region", ""), "current_price_vnd": current,
                "price_max_vnd": current, "regular_price_vnd": row.get("regular_price_vnd", ""),
                "discount_percent": "", "stock_status": row.get("stock_status", ""),
                "product_rating": "", "review_count": "", "sold_count": "", "variant_count": "",
                "sales_method": row.get("sales_method", ""),
                "marketing_observation": row.get("marketing_observation", ""),
                "verification_level": row.get("verification_level", ""), "source_freshness": "",
                "source_url": row.get("source_url", ""), "checked_at": row.get("checked_at", ""),
                "data_limitations": row.get("data_limitations", ""),
            })
        else:
            listings.append({
                "listing_id": row["listing_id"], "product_id": key_to_id[row["key"]],
                "platform": row.get("platform", ""), "seller": row.get("seller_name", ""),
                "seller_location": row.get("seller_location", ""),
                "current_price_vnd": row.get("price_min_vnd", ""),
                "price_max_vnd": row.get("price_max_vnd", ""),
                "regular_price_vnd": row.get("regular_price_min_vnd", ""),
                "discount_percent": row.get("discount_percent", ""),
                "stock_status": row.get("stock_status", ""),
                "product_rating": row.get("product_rating", ""), "review_count": row.get("review_count", ""),
                "sold_count": row.get("sold_count", ""), "variant_count": row.get("variant_count", ""),
                "sales_method": row.get("sales_method", ""),
                "marketing_observation": row.get("marketing_observation", ""),
                "verification_level": row.get("verification_level", ""),
                "source_freshness": row.get("source_freshness", ""),
                "source_url": row.get("source_url", ""), "checked_at": row.get("checked_at", ""),
                "data_limitations": row.get("data_limitations", ""),
            })
    return products, listings


def product_page_candidates(product_id: str, listings: list[dict[str, str]]) -> list[str]:
    # 검색·캠페인·음식점 페이지의 og:image는 해당 상품 사진이 아닐 수 있으므로 제외한다.
    blocked = ("/search/", "/collections/", "/tag/", "/list/", "/pages/", "metric.vn/ereport", "food.be.com.vn")
    urls = [row["source_url"] for row in listings if row["product_id"] == product_id and row["source_url"]]
    return [url for url in urls if not any(part in url.lower() for part in blocked)]


def download_images(products: list[dict[str, str]], listings: list[dict[str, str]]) -> None:
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    headers = {"User-Agent": "Mozilla/5.0 (compatible; HanJeongSeonMarketResearch/1.0)"}

    def save(product, page_url, asset_url):
        asset_request = urllib.request.Request(asset_url, headers=headers)
        with urllib.request.urlopen(asset_request, timeout=15) as response:
            content_type = response.headers.get_content_type()
            payload = response.read(5_000_000)
        if not content_type.startswith("image/") or len(payload) < 1000:
            return False
        extension = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}.get(content_type, ".jpg")
        filename = f"{product['product_id'].lower()}{extension}"
        (IMAGE_DIR / filename).write_bytes(payload)
        product.update({
            "image_path": f"images/competitors/{filename}",
            "image_source_url": page_url,
            "image_asset_url": asset_url,
            "image_checked_at": date.today().isoformat(),
            "image_status": "확인 완료",
        })
        return True

    for product in products:
        override = IMAGE_OVERRIDES.get(product["canonical_key"])
        if override:
            try:
                if save(product, *override):
                    continue
            except (OSError, ValueError, TimeoutError):
                pass
        for page_url in product_page_candidates(product["product_id"], listings):
            try:
                request = urllib.request.Request(page_url, headers=headers)
                with urllib.request.urlopen(request, timeout=12) as response:
                    body = response.read(1_500_000).decode("utf-8", "ignore")
                match = re.search(
                    r'<meta[^>]+(?:property|name)=["\']og:image["\'][^>]+content=["\']([^"\']+)',
                    body, re.I,
                ) or re.search(
                    r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']og:image["\']',
                    body, re.I,
                )
                if not match:
                    continue
                asset_url = html.unescape(match.group(1))
                if save(product, page_url, asset_url):
                    break
            except (OSError, ValueError, TimeoutError):
                continue


def build_legacy(products: list[dict[str, str]], listings: list[dict[str, str]]) -> list[dict[str, str]]:
    by_product: dict[str, list[dict[str, str]]] = defaultdict(list)
    for listing in listings:
        by_product[listing["product_id"]].append(listing)
    rows: list[dict[str, str]] = []
    for product in products:
        observed = by_product[product["product_id"]]
        prices = [number(row["current_price_vnd"]) for row in observed]
        prices = [value for value in prices if value is not None]
        channels = sorted({row["platform"] for row in observed if row["platform"]})
        sellers = sorted({row["seller"] for row in observed if row["seller"]})
        best = next((row for row in observed if row["verification_level"] in {"direct_product_page", "indexed_product_page"}), observed[0])
        piece_count = number(product["piece_count"])
        net_weight = number(product["net_weight_g"])
        unit_weight = net_weight / piece_count if net_weight and piece_count else None
        discount_values = [number(row["discount_percent"]) for row in observed]
        discount_values = [value for value in discount_values if value is not None]
        observations = [row["marketing_observation"] for row in observed if row["marketing_observation"]]
        rows.append({
            "brand": product["brand"], "product": product["product_name"],
            "segment": product["segment"], "origin": product["origin"],
            "pack_count": int_text(piece_count), "unit_weight_g": int_text(unit_weight),
            "price_vnd": str(int(min(prices))) if prices else "", "monthly_sales": "",
            "channels": "; ".join(channels), "is_core": "", "region": "; ".join(sorted({r["seller_location"] for r in observed if r["seller_location"]})) or "베트남 전국",
            "source_url": best["source_url"],
            "surveyed_at": max((row["checked_at"] for row in observed if row["checked_at"]), default=""),
            "promotion": f"최대 {int(max(discount_values))}% 할인 확인" if discount_values else "",
            "sns_influencer": "", "seasonal_limited": "",
            "packaging": f"{product['piece_count']}개입" if product["piece_count"] else (f"{product['net_weight_g']}g" if product["net_weight_g"] else ""),
            "key_message": observations[0] if observations else "", "sales_event": "",
            "review_keywords": "",
            "takeaway": f"{len(channels)}개 채널·{len(sellers)}개 판매자 확인; 동일 규격 가격 비교 필요",
        })
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--images", action="store_true", help="공개 상품 페이지의 og:image를 저장")
    args = parser.parse_args()
    products, listings = build_records()
    if args.images:
        download_images(products, listings)
    write_csv(PRODUCTS, PRODUCT_COLUMNS, products)
    write_csv(LISTINGS, LISTING_COLUMNS, listings)
    write_csv(LEGACY, LEGACY_COLUMNS, build_legacy(products, listings))
    print(f"products={len(products)} listings={len(listings)} images={sum(p['image_status'] == '확인 완료' for p in products)}")


if __name__ == "__main__":
    main()
