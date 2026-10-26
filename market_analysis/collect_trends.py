"""트렌드 데이터 수집 실행 스크립트.

페이지 접속 시에는 SerpApi를 호출하지 않습니다. 이 스크립트를 Windows 작업 스케줄러 등으로
하루 1회 실행하면 권장 갱신 주기가 지난 영역만 수집합니다.

    python collect_trends.py              # 주기가 지난 영역만 수집
    python collect_trends.py --all        # 전체 수집 (SerpApi 약 18회, 일시 정지 영역 제외)
    python collect_trends.py --sections categories rankings
    python collect_trends.py --plan       # 수집 대상과 예상 호출 수만 출력
"""
import argparse
import math
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from collectors.ad_trend_collector import AdTrendCollector
from collectors.serpapi_trends_collector import SerpApiTrendsCollector
from repositories.trend_repository import TrendRepository
from services.trend_service import TrendCollectionService
from services.trend_service import SECTIONS, MAX_RANK_CANDIDATES, anchor_batches


def expected_calls(sections, config):
    fruits = len(config["fruit_flavors"])
    per_section = {
        "categories": 1,
        # 후보 5개 초과 시 기준 검색어 + 4개씩 나눠 요청. 연관 검색어 방식 카테고리는 연관 검색어 1회,
        # 과일 맛 방식 카테고리는 fruit_flavors 영역 데이터를 쓰므로 0회
        "rankings": sum(1 if category.get("ranking_source") == "related"
                        else 0 if category.get("ranking_source") == "fruit_flavors"
                        else len(anchor_batches(category["candidate_queries"][:MAX_RANK_CANDIDATES]))
                        for category in config["categories"]),
        "fruit_flavors": max(1, math.ceil((fruits - 1) / 4)),  # 기준 과일 + 4개씩
        "seasonality": len(config["seasonality_themes"]) + math.ceil(fruits / 5),
        "regions": len(config["categories"]),  # 카테고리별 지역 관심도
        # 카테고리별 연관 검색어 + 관련 주제 (첫 검색어에 결과가 없으면 다음 검색어로 1회씩 더)
        "related": 2 * len(config["categories"]),
        "ads": 0,
    }
    return sum(per_section[name] for name in sections)


def main():
    parser = argparse.ArgumentParser(description="트렌드 분석 데이터 수집")
    parser.add_argument("--country", default="VN")
    parser.add_argument("--all", action="store_true", help="갱신 주기와 관계없이 전체 수집")
    parser.add_argument("--sections", nargs="+", choices=SECTIONS)
    parser.add_argument("--plan", action="store_true", help="실제 호출 없이 계획만 출력")
    args = parser.parse_args()

    repository = TrendRepository()
    config = repository.get_keywords(args.country)
    if config is None:
        sys.exit(f"{args.country} 검색어 설정 파일이 없습니다.")

    collector = SerpApiTrendsCollector(geo=config["geo"], hl=config["language"], tz=config["timezone"])
    service = TrendCollectionService(repository, collector, AdTrendCollector)
    paused = config.get("paused_sections", [])
    sections = ([name for name in SECTIONS if name not in paused] if args.all
                else args.sections or service.due_sections(args.country))
    if args.sections and set(args.sections) & set(paused):
        print(f"일시 정지된 영역입니다(설정 paused_sections): {', '.join(sorted(set(args.sections) & set(paused)))} · 직접 지정해 수집합니다")

    print(f"수집 대상: {', '.join(sections) or '없음'} · 예상 SerpApi 호출 {expected_calls(sections, config)}회")
    if args.plan or not sections:
        return
    if not collector.api_key and any(name != "ads" for name in sections):
        sys.exit("SERPAPI_API_KEY 환경변수가 설정되지 않았습니다.")

    report = service.refresh(args.country, sections)
    for name, result in report.items():
        print(f"- {name}: {result}")
    if any(result.startswith("실패") for result in report.values()):
        sys.exit(1)


if __name__ == "__main__":
    main()
