"""AI 인사이트 의사결정 카드: 트렌드·경쟁 조사·이커머스 데이터를 서버가 교차 계산합니다(AI 없음).

- 맛 기회: 과일 검색 관심도 × 그 맛의 경쟁 제품 수 × 검색 피크
- 가격 위치: 경쟁 판매가 ÷ 중량 = 100g당 가격 분포 (보관 방식별)
- 채널 기회: 경쟁 판매처 분포 × 플랫폼 점유율
맛·채널은 판매량이 아니라 공급(제품·판매처 수) 기준입니다. 판매량이 있는 목록이 적기 때문입니다.
결과마다 D- 근거 문장을 만들어 AI 인사이트 근거로 넘깁니다.
"""
from statistics import quantiles

# 경쟁 제품 flavors 표기(영어 id·베트남어) → 트렌드 과일 id
FLAVOR_ALIASES = {
    "coconut": ("coconut", "dừa"), "banana": ("banana", "chuối"), "mango": ("mango", "xoài"),
    "dragon-fruit": ("dragon fruit", "thanh long"), "durian": ("durian", "sầu riêng"), "pomelo": ("pomelo", "bưởi"),
    "jackfruit": ("jackfruit", "mít"), "strawberry": ("strawberry", "dâu tây", "dâu"), "rambutan": ("rambutan", "chôm chôm"),
    "passion-fruit": ("passion fruit", "chanh dây"),
}
TOP_INTEREST_RANK = 5   # 과일 관심도 상위 5위까지 "관심 높음"
GAP_MAX_SUPPLY = 3      # 경쟁 제품이 3개 이하면 "경쟁 적음"
CROWDED_MIN_SUPPLY = 8  # 경쟁 제품이 8개 이상이면 "경쟁 많음"
MIN_PRICE_SAMPLES = 4   # 분포(4분위)를 낼 최소 판매 건수
STORAGE_LABELS = {"dry": "상온", "frozen": "냉동·냉장", "": "보관 방식 미확인"}
# 판매처 → 채널 묶음 (일본·수입 식품 매장은 하나로)
CHANNEL_GROUPS = {"Shopee": "Shopee", "TikTok Shop": "TikTok Shop", "Lazada": "Lazada", "Tiki": "Tiki",
                  "AEONESHOP": "수입·일본 식품점", "Sakuko": "수입·일본 식품점", "Farmers Market": "수입·일본 식품점"}
MARKET_SOURCE = "경쟁 조사표"


def _tokens(text):
    return [t.strip().lower().replace("_", " ") for t in str(text or "").replace(";", ",").split(",") if t.strip()]


def flavor_supply(competitors):
    """과일 id → 그 맛이 들어간 경쟁 제품 수. 'mixed' 같은 묶음 맛은 세지 않습니다."""
    counts = {fruit: 0 for fruit in FLAVOR_ALIASES}
    for item in competitors:
        tokens = _tokens(item.get("flavors"))
        for fruit, aliases in FLAVOR_ALIASES.items():
            if any(token in aliases for token in tokens):
                counts[fruit] += 1
    return counts


def flavor_card(trend, competitors, as_of):
    fruits = trend.get("fruit_flavors") or []
    if not fruits or not competitors:
        return {"status": "insufficient", "rows": []}
    supply = flavor_supply(competitors)
    peaks = {f["id"]: f.get("peak_months") or [] for t in trend.get("seasonality") or [] if t.get("type") == "fruits"
             for f in t.get("fruits", [])}
    rows = []
    for f in fruits:
        count = supply.get(f["id"], 0)
        high = bool(f.get("rank")) and f["rank"] <= TOP_INTEREST_RANK
        kind = ("gap" if high and count <= GAP_MAX_SUPPLY else "crowded" if count >= CROWDED_MIN_SUPPLY
                else "contested" if high else "low")
        rows.append({"id": f["id"], "name": f["name"], "rank": f.get("rank"), "interest": f.get("recent_average"),
                     "supply": count, "peak_months": peaks.get(f["id"], []), "kind": kind})
    return {"status": "ok", "rows": rows, "as_of": as_of,
            "rule": f"관심 높음 = 과일 관심도 상위 {TOP_INTEREST_RANK}위, 경쟁 적음 = 경쟁 제품 {GAP_MAX_SUPPLY}개 이하, "
                    f"경쟁 많음 = {CROWDED_MIN_SUPPLY}개 이상"}


def price_card(competitors, as_of):
    groups = {}
    for item in competitors:
        weight = item.get("net_weight_g")
        if not weight:
            continue
        for listing in item.get("listings") or []:
            price = listing.get("current_price_vnd")
            if price:
                groups.setdefault(item.get("storage") or "", []).append(price / weight * 100)
    rows = []
    for storage, values in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        row = {"storage": storage, "label": STORAGE_LABELS.get(storage, storage), "count": len(values)}
        if len(values) >= MIN_PRICE_SAMPLES:
            q1, median, q3 = quantiles(values, n=4)
            row.update({"p25": round(q1), "median": round(median), "p75": round(q3),
                        "min": round(min(values)), "max": round(max(values))})
        rows.append(row)
    total = [v for values in groups.values() for v in values]
    overall = None
    if len(total) >= MIN_PRICE_SAMPLES:
        q1, median, q3 = quantiles(total, n=4)
        overall = {"count": len(total), "p25": round(q1), "median": round(median), "p75": round(q3),
                   "min": round(min(total)), "max": round(max(total))}
    return {"status": "ok" if overall else "insufficient", "overall": overall, "rows": rows, "as_of": as_of}


def channel_card(competitors, ecommerce, as_of):
    counts = {}
    for item in competitors:
        for listing in item.get("listings") or []:
            group = CHANNEL_GROUPS.get(listing.get("platform"), "기타")
            counts[group] = counts.get(group, 0) + 1
    if not counts:
        return {"status": "insufficient", "rows": []}
    total = sum(counts.values())
    shares = {x["name"]: x["share"] for x in (ecommerce or {}).get("shares", {}).get("items", [])}
    share_of = {"Shopee": shares.get("Shopee"), "TikTok Shop": shares.get("TikTok Shop"),
                "Lazada": shares.get("Lazada·Tiki"), "Tiki": shares.get("Lazada·Tiki")}
    rows = [{"channel": name, "listings": n, "listing_share": round(n / total * 100, 1), "platform_share": share_of.get(name)}
            for name, n in sorted(counts.items(), key=lambda kv: -kv[1])]
    return {"status": "ok", "rows": rows, "total": total, "as_of": as_of,
            "share_as_of": (ecommerce or {}).get("shares", {}).get("as_of")}


def build_cards(trend, competitors, ecommerce, competitor_as_of):
    return {"flavor": flavor_card(trend, competitors, competitor_as_of),
            "price": price_card(competitors, competitor_as_of),
            "channel": channel_card(competitors, ecommerce, competitor_as_of)}


def _won(value):
    return f"{value:,}동"


def card_evidence(cards, trend_date):
    """카드 → D- 근거 문장 (AI 인사이트 근거 목록에 추가)."""
    evidence = {}
    flavor = cards.get("flavor") or {}
    if flavor.get("status") == "ok":
        label = {"gap": "빈틈(관심 높고 경쟁 적음)", "contested": "관심 높고 경쟁 보통", "crowded": "경쟁 많음", "low": "관심 낮음"}
        evidence["D-맛기회"] = {"tag": "D-맛기회", "text": " / ".join(
            f"{r['name']}: 관심도 {r['rank']}위({r['interest']}), 경쟁 제품 {r['supply']}개, 피크 {'·'.join(map(str, r['peak_months'])) or '-'}월 → {label[r['kind']]}"
            for r in flavor["rows"]) + f" ({flavor['rule']}, 판매량 아닌 공급 기준)",
            "source": f"Google Trends · {MARKET_SOURCE}", "date": f"{trend_date} · {flavor.get('as_of')}"}
    price = cards.get("price") or {}
    if price.get("status") == "ok":
        o = price["overall"]
        parts = [f"전체 {o['count']}건 100g당 하위25% {_won(o['p25'])}, 중간 {_won(o['median'])}, 상위25% {_won(o['p75'])}"]
        parts += [f"{r['label']} {r['count']}건 중간 {_won(r['median'])}" for r in price["rows"] if "median" in r]
        evidence["D-가격"] = {"tag": "D-가격", "text": " / ".join(parts), "source": MARKET_SOURCE, "date": str(price.get("as_of"))}
    channel = cards.get("channel") or {}
    if channel.get("status") == "ok":
        evidence["D-채널"] = {"tag": "D-채널", "text": " / ".join(
            f"{r['channel']} 경쟁 판매 {r['listings']}건({r['listing_share']}%)"
            + (f", 플랫폼 점유율 {r['platform_share']}%" if r.get("platform_share") is not None else "")
            for r in channel["rows"]) + f" (경쟁 판매 총 {channel['total']}건, 점유율은 {channel.get('share_as_of')} 거래액 기준)",
            "source": f"{MARKET_SOURCE} · Metric(VnEconomy)", "date": f"{channel.get('as_of')} · {channel.get('share_as_of')}"}
    return evidence
