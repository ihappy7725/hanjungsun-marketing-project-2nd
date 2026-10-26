"""HOME 관리 명령의 flask 등록. [주연]

flask --app app home <명령> 형태로 실행합니다. (PM1 요청)
기존 python -B -m home.<모듈> 방식도 그대로 동작합니다.
자료 명령은 기존 event_import.py·news_import.py를 재사용합니다.
DB 준비 명령은 HOME 테이블에만 적용하고, 실제 변경은 --apply를 명시할 때만 실행합니다.
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


@bp.cli.command("holidays-sync")
@click.option("--from", "first", type=int, required=True)
@click.option("--to", "last", type=int, required=True)
def holidays_sync(first, last):
    """법정 공휴일을 연도별로 받아 보관합니다. 이미 받은 연도는 다시 부르지 않습니다."""
    from .holiday_feed import sync
    if last < first or last - first > 20:
        raise SystemExit("연도 범위를 확인해주세요. 한 번에 20년까지입니다.")

    def run():
        added = sync(range(first, last + 1))
        print("새로 받은 연도: " + (", ".join(str(year) for year in added) if added else "없음 (이미 보관됨)"))

    _run(run)


@bp.cli.command("tasks-add-category")
@click.option("--apply", is_flag=True, help="승인 후 HOME 업무에 종류 칸을 실제 추가합니다")
def tasks_add_category(apply):
    """기존 업무를 지우지 않고 category 칸만 추가합니다. 기본은 확인만 합니다."""
    from sqlalchemy.exc import SQLAlchemyError
    from platform_core.extensions import db

    if db.engine.dialect.name != "sqlite":
        raise click.ClickException("이 명령은 현재 공통 앱의 SQLite DB에서만 사용할 수 있습니다.")
    try:
        with db.engine.connect() as connection:
            connection.exec_driver_sql("BEGIN IMMEDIATE" if apply else "BEGIN")
            columns = connection.exec_driver_sql("PRAGMA table_info(home_tasks)").mappings().all()
            if not columns:
                raise click.ClickException("HOME 업무 테이블이 없습니다. DB 준비 절차를 먼저 확인해주세요.")
            category = next((column for column in columns if column["name"] == "category"), None)
            if category:
                if (category["type"].upper() != "VARCHAR(20)" or category["notnull"] != 1
                        or category["dflt_value"] != "''"):
                    raise click.ClickException("이미 있는 종류 칸의 구조가 예상과 다릅니다. 변경하지 않고 멈춥니다.")
                invalid = connection.exec_driver_sql(
                    "SELECT COUNT(*) FROM home_tasks WHERE category IS NULL OR "
                    "category NOT IN ('', 'research', 'content', 'collaboration', 'meeting', 'other')"
                ).scalar_one()
                if invalid:
                    raise click.ClickException("이미 있는 업무 종류에 확인이 필요한 값이 있습니다. 변경하지 않았습니다.")
                click.echo("종류 칸이 이미 준비되어 있습니다. 기록과 구조는 변경하지 않았습니다.")
                return
            if not apply:
                click.echo("업무 종류 칸 추가가 필요합니다. 아직 변경하지 않았습니다. 승인 후 --apply로 실행하세요.")
                return
            count_before = connection.exec_driver_sql("SELECT COUNT(*) FROM home_tasks").scalar_one()
            connection.exec_driver_sql(
                "ALTER TABLE home_tasks ADD COLUMN category VARCHAR(20) NOT NULL DEFAULT '' "
                "CONSTRAINT ck_home_tasks_category "
                "CHECK (category IN ('', 'research', 'content', 'collaboration', 'meeting', 'other'))"
            )
            count_after = connection.exec_driver_sql("SELECT COUNT(*) FROM home_tasks").scalar_one()
            after = connection.exec_driver_sql("PRAGMA table_info(home_tasks)").mappings().all()
            if count_before != count_after or [dict(c) for c in after if c["name"] != "category"] != [dict(c) for c in columns]:
                raise click.ClickException("기존 기록 수나 저장 칸이 달라져 작업 전체를 취소했습니다.")
            connection.commit()
            click.echo("HOME 업무에 종류 칸을 추가했습니다. 기존 업무는 모두 미지정이며 나머지 기록은 그대로입니다.")
    except SQLAlchemyError:
        raise click.ClickException("종류 칸을 추가하지 못했습니다. 이번 작업은 취소했으며 상세 DB 내용은 표시하지 않습니다.") from None
