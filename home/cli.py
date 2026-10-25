"""HOME 관리 명령의 flask 등록. [주연]

flask --app app home <명령> 형태로 실행합니다. (PM1 요청)
기존 python -B -m home.<모듈> 방식도 그대로 동작합니다.
실제 동작은 event_import.py·news_import.py에 있고 여기서는 호출만 합니다.
"""
import click

from . import bp
from .event_import import ReviewError


def _run(action, *args):
    """관리 명령의 오류 처리를 한 곳에 모읍니다. 자료·키 보호를 위해 상세는 숨깁니다."""
    try:
        action(*args)
    except ReviewError as error:
        raise SystemExit(str(error)) from None
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        raise SystemExit("파일·입력·응답 형식에 오류가 있습니다. 자료와 키 보호를 위해 상세는 표시하지 않습니다.") from None


@bp.cli.command("event-collect")
@click.option("--year", type=int, required=True)
@click.option("--request-api", is_flag=True, help="실제 API를 1회 호출합니다")
def event_collect(year, request_api):
    """베트남 일정을 1회 조회해 임시 분류만 보여 줍니다. 저장하지 않습니다."""
    from .event_import import collect
    if not 1900 <= year <= 2100:
        raise SystemExit("연도는 1900~2100 범위여야 합니다.")
    _run(collect, year, request_api)


@bp.cli.command("event-stage")
@click.option("--input", "input_path", required=True)
@click.option("--confirm", default=None)
def event_stage(input_path, confirm):
    """사람이 검증한 일정 JSON을 후보에 추가합니다. 기본은 미리보기입니다."""
    from .event_import import stage
    _run(stage, input_path, confirm)


@bp.cli.command("event-register")
@click.option("--candidate-id", required=True)
@click.option("--confirm", default=None)
def event_register(candidate_id, confirm):
    """검토를 마친 후보를 캘린더에 등록합니다. 기본은 미리보기입니다."""
    from .event_import import register
    _run(register, candidate_id, confirm)


@bp.cli.command("news-fetch")
@click.option("--url", required=True)
def news_fetch(url):
    """기사 본문 글자만 확인합니다. 저장·요약하지 않습니다."""
    from .news_import import fetch
    _run(fetch, url)


@bp.cli.command("news-stage")
@click.option("--input", "input_path", required=True)
@click.option("--confirm", default=None)
def news_stage(input_path, confirm):
    """검증한 뉴스 JSON을 승인 대기로 넣습니다. 화면에는 보이지 않습니다."""
    from .news_import import stage
    _run(stage, input_path, confirm)


@bp.cli.command("news-register")
@click.option("--news-id", required=True)
@click.option("--confirm", default=None)
def news_register(news_id, confirm):
    """승인 대기 뉴스를 화면에 노출합니다. 기본은 미리보기입니다."""
    from .news_import import register
    _run(register, news_id, confirm)
