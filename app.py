"""한정선 베트남 마케팅 대시보드 — 앱 생성·설정·메뉴 등록·DB 초기화 명령.

[PM1 상준만 수정] 다른 팀원은 이 파일을 고치지 않고 PM1에게 요청합니다. (README 5장)
기능 모듈은 이 파일을 import하지 않습니다. DB 객체는 platform_core.extensions에서 가져옵니다.
"""
import os

import click
from flask import Flask, jsonify, redirect, url_for
from flask.cli import with_appcontext
from werkzeug.middleware.proxy_fix import ProxyFix

from platform_core.extensions import db


def create_app():
    app = Flask(__name__, instance_relative_config=True)
    os.makedirs(app.instance_path, exist_ok=True)

    secret_key = os.environ.get("SECRET_KEY", "").strip()
    if os.environ.get("RENDER") and (not secret_key or secret_key == "dev"):
        raise RuntimeError("Render 운영 환경에는 안전한 SECRET_KEY가 필요합니다.")

    # .env 읽는 방식(python-dotenv 사용 여부)은 README 8장 확정 항목입니다. 확정 전에는 OS 환경변수만 읽습니다.
    app.config.from_mapping(
        SECRET_KEY=secret_key or "dev",
        SQLALCHEMY_DATABASE_URI="sqlite:///" + os.path.join(app.instance_path, "dashboard.sqlite3"),
        UPLOAD_ROOT=os.path.join(app.instance_path, "uploads"),  # uploads/<모듈명>/
        EXPORT_ROOT=os.path.join(app.instance_path, "exports"),  # exports/<모듈명>/
        # 참고 영상은 50MB까지 허용하므로 multipart 여유분을 포함해 전역 상한을 둡니다.
        MAX_CONTENT_LENGTH=55 * 1024 * 1024,
    )
    # Render의 HTTPS·호스트 전달 헤더를 Flask가 올바르게 해석하도록 합니다.
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

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

    @app.get("/healthz")
    def healthz():
        """Render가 프로세스 생존 여부를 확인하는 비용 없는 상태 점검 주소."""
        return jsonify(status="ok"), 200

    app.cli.add_command(init_db_command)
    return app


@click.command("init-db")
@with_appcontext
def init_db_command():
    """모든 모듈의 테이블을 만듭니다. 테이블 구조가 바뀌면 instance/dashboard.sqlite3를 지우고 다시 실행합니다."""
    db.create_all()
    click.echo("DB 초기화 완료: instance/dashboard.sqlite3")
