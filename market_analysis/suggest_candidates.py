"""카테고리별 상품 후보 검색어 제안 (월 1회 권장).

    python suggest_candidates.py           # 제안만 생성 (SerpApi 약 8~24회). 설정은 바꾸지 않음
    python suggest_candidates.py --apply   # 담당자 확인 후, 마지막 제안을 설정 파일에 반영 (호출 없음)

반영 후 python collect_trends.py --sections rankings 로 순위를 다시 수집합니다.
"""
import argparse
import sys

from collectors.serpapi_trends_collector import SerpApiTrendsCollector
from repositories.trend_repository import TrendRepository
from services.candidate_service import CandidateSuggestionService


def print_suggestion(suggestion):
    print(f"제안 생성: {suggestion['created_at']}")
    for category in suggestion["categories"]:
        print(f"\n[{category['label']}] 현재: {', '.join(category['current'])}")
        for row in category["proposed"]:
            status = "충분" if row.get("data_status") == "normal" else "부족"
            rate = "신규" if row.get("is_new") else (f"{row['change_rate']:+.1f}%" if row.get("change_rate") is not None else "-")
            print(f"  · {row['query']:<35} {row['source']:<7} 관심도 {row.get('recent_average')}  전년 동기 {rate}  [{status}]")
        if category["excluded"]:
            print("  제외: " + ", ".join(f"{row['query']}({row['reason']})" for row in category["excluded"][:8]))


def main():
    parser = argparse.ArgumentParser(description="상품 후보 검색어 제안")
    parser.add_argument("--country", default="VN")
    parser.add_argument("--apply", action="store_true", help="마지막 제안 중 데이터가 충분한 검색어를 설정에 반영")
    args = parser.parse_args()

    repository = TrendRepository()
    config = repository.get_keywords(args.country)
    if config is None:
        sys.exit(f"{args.country} 검색어 설정 파일이 없습니다.")
    collector = SerpApiTrendsCollector(geo=config["geo"], hl=config["language"], tz=config["timezone"])
    service = CandidateSuggestionService(repository, collector)

    if args.apply:
        applied = service.apply(args.country)
        for category_id, queries in applied.items():
            print(f"- {category_id}: {', '.join(queries)}")
        print("반영했습니다. 상품명(한국어)은 설정 파일의 query_labels에 추가해 주세요.")
        return
    if not collector.api_key:
        sys.exit("SERPAPI_API_KEY가 .env에 없습니다.")
    print_suggestion(service.suggest(args.country))
    print("\n확인 후 반영하려면: python suggest_candidates.py --apply")


if __name__ == "__main__":
    main()
