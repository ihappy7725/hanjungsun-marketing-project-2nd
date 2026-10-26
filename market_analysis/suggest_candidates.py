"""카테고리별 상품 후보 검색어 제안 (월 1회 권장).

    python suggest_candidates.py           # 제안만 생성 (SerpApi 약 8~24회). 설정은 바꾸지 않음
    python suggest_candidates.py --category k-dessert   # 한 카테고리만 제안 (약 2~6회)
    python suggest_candidates.py --apply   # 담당자 확인 후, 마지막 제안을 설정 파일에 반영 (호출 없음)
    python suggest_candidates.py --check-terms   # 대표 검색어 묶음 + 새 후보 점검 (약 13회, 아무것도 저장하지 않음)
    python suggest_candidates.py --check-related mochi sticky-rice   # 출발 검색어 연관 검색어 중 식품만 측정 (카테고리당 1회, 저장 없음)
    python suggest_candidates.py --check-related fruit --seed "kem dừa" "chè trái cây"   # 출발 검색어 후보 시험 (검색어당 1회)
    python suggest_candidates.py --check-bundles   # 설정의 proposed_bundle 4개 기준 통과 확인 (1회, 저장 없음)

반영 후 python collect_trends.py --sections rankings 로 순위를 다시 수집합니다.
"""
import argparse
import sys

from collectors.serpapi_trends_collector import SerpApiTrendsCollector
from repositories.trend_repository import TrendRepository
from services.candidate_service import CandidateSuggestionService
from services.trend_service import MIN_INTEREST


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


def print_term_check(result):
    print(f"대표 검색어 점검 · 기간 {result['period']} · 최근 12주 평균 관심도 (카테고리 첫 검색어 기준)")
    for category in result["categories"]:
        print(f"\n[{category['label']}]")
        if category.get("error"):
            print(f"  환산 실패: {category['error']}")
        for row in category["terms"]:
            kind = "새" if row["new"] else "  "
            print(f"  {kind} {str(row['recent_average']):>6}  {row['query']}")
            if row.get("related"):
                print(f"         연관: {', '.join(row['related'])}")
            if row.get("related_error"):
                print(f"         연관 검색어 없음 ({row['related_error']})")
    check = result["bundle_check"]
    print("\n[늘린 묶음 4개를 한 번에 요청]")
    if check["ok"]:
        for bundle in check["bundles"]:
            print(f"  {bundle['id']:<12} 최근 12주 평균 {bundle['recent_average']}  ({bundle['length']}자)")
    else:
        print(f"  요청 실패: {check['error']}")


def print_related_check(result):
    print("출발 검색어 연관 검색어 점검 · 최근 3개월 · 식품만 Google 인기값 순 (1위 = 100, 저장 없음)")
    for category in result["categories"]:
        print(f"\n[{category['label']}] 출발 검색어: {category['seed']}")
        if category.get("error"):
            print(f"  {category['error']}")
        for row in category["related"]:
            mark = f"제외({row['reason']})" if row["reason"] else "후보"
            print(f"  {row['source']:<7} {str(row['related_value']):>8}  {row['query']:<40} {mark}")
        if category["ranked"]:
            print(f"  -- 순위 (인기값 {MIN_INTEREST} 미만은 검색 적음)")
        for rank, row in enumerate(category["ranked"], start=1):
            low = "" if (row["related_value"] or 0) >= MIN_INTEREST else "  [검색 적음]"
            rising = f"  급상승 {row['rising_value']}" if row["rising_value"] else ""
            print(f"  {rank}. {row['query']:<40} 인기 {row['related_value']}{rising}{low}")
        if not category.get("error"):
            print(f"  -- 식품 {len(category['ranked'])}개 (5개 이상이면 순위 5위까지 채움)")


def print_bundle_check(result):
    print(f"새 대표 묶음 점검 · 기간 {result['period']} · 4개를 한 번에 요청 (가장 큰 주 = 100, 저장 없음)")
    for row in result["bundles"]:
        mark = "통과" if row["passed"] else "미달"
        rate = "신규" if row["is_new"] else (f"{row['change_rate']:+.1f}%" if row["change_rate"] is not None else "-")
        short = f"{row['short_change_rate']:+.1f}%" if row["short_change_rate"] is not None else "-"
        print(f"\n[{row['label']}] {mark}\n  {row['query']}\n  최근 12주 {row['recent_average']} · 1년 전 {row['year_ago_average']}"
              f" · 전년 동기 {rate} · 4주 {short} · 값 있는 주 {int(row['coverage'] * 100)}%")


def main():
    parser = argparse.ArgumentParser(description="상품 후보 검색어 제안")
    parser.add_argument("--country", default="VN")
    parser.add_argument("--apply", action="store_true", help="마지막 제안 중 데이터가 충분한 검색어를 설정에 반영")
    parser.add_argument("--category", nargs="+", metavar="ID", help="이 카테고리만 제안 (예: --category k-dessert)")
    parser.add_argument("--check-terms", action="store_true", help="대표 검색어 묶음과 새 후보 점검 (저장 없음)")
    parser.add_argument("--check-related", nargs="+", metavar="ID",
                        help="출발 검색어의 연관 검색어 중 식품만 인기값 순으로 보기 (저장 없음, 예: --check-related mochi)")
    parser.add_argument("--check-bundles", action="store_true", help="설정의 proposed_bundle 4개 기준 통과 확인 (1회, 저장 없음)")
    parser.add_argument("--seed", nargs="+", metavar="검색어", help="--check-related와 함께: 설정 대신 이 출발 검색어들을 시험")
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
    if args.check_terms:
        print_term_check(service.check_terms(args.country))
        return
    if args.check_bundles:
        print_bundle_check(service.check_bundles(args.country))
        return
    if args.check_related:
        try:
            print_related_check(service.check_related(args.country, args.check_related, seeds=args.seed))
        except ValueError as error:
            sys.exit(str(error))
        return
    try:
        suggestion = service.suggest(args.country, category_ids=args.category)
    except ValueError as error:
        sys.exit(str(error))
    print_suggestion(suggestion)
    print("\n확인 후 반영하려면: python suggest_candidates.py --apply")


if __name__ == "__main__":
    main()
