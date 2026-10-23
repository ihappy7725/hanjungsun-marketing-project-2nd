"""한정선 베트남 마케팅 대시보드 — 앱 생성·설정·메뉴 등록·DB 초기화 명령.

[PM1 상준만 수정] 다른 팀원은 이 파일을 고치지 않고 PM1에게 요청합니다. (README 5장)
기능 모듈은 이 파일을 import하지 않습니다. DB 객체는 platform_core.extensions에서 가져옵니다.
"""
import os

import click
from flask import Flask, redirect, url_for
from flask.cli import with_appcontext

from platform_core.extensions import db


def create_app():
    app = Flask(__name__, instance_relative_config=True)
    os.makedirs(app.instance_path, exist_ok=True)

    # .env 읽는 방식(python-dotenv 사용 여부)은 README 8장 확정 항목입니다. 확정 전에는 OS 환경변수만 읽습니다.
    app.config.from_mapping(
        SECRET_KEY=os.environ.get("SECRET_KEY", "dev"),
        SQLALCHEMY_DATABASE_URI="sqlite:///" + os.path.join(app.instance_path, "dashboard.sqlite3"),
        UPLOAD_ROOT=os.path.join(app.instance_path, "uploads"),  # uploads/<모듈명>/
        EXPORT_ROOT=os.path.join(app.instance_path, "exports"),  # exports/<모듈명>/
    )

    db.init_app(app)

    from content_studio import bp as content_studio_bp
    from home import bp as home_bp
    from influencer_marketing import bp as influencer_marketing_bp
    from kpi import bp as kpi_bp
    from market_analysis import bp as market_analysis_bp
    from platform_core import bp as platform_core_bp

    for blueprint in (
        platform_core_bp,
        home_bp,
        market_analysis_bp,
        content_studio_bp,
        kpi_bp,
        influencer_marketing_bp,
    ):
        app.register_blueprint(blueprint)

    @app.route("/")
    def root():
        # 첫 접속 화면 경로가 확정되기 전까지 HOME으로 보냅니다. (README 7장)
        return redirect(url_for("home.index"))

    app.cli.add_command(init_db_command)
    return app


@click.command("init-db")
@with_appcontext
def init_db_command():
    """모든 모듈의 테이블을 만듭니다. 테이블 구조가 바뀌면 instance/dashboard.sqlite3를 지우고 다시 실행합니다."""
    db.create_all()
    click.echo("DB 초기화 완료: instance/dashboard.sqlite3")
