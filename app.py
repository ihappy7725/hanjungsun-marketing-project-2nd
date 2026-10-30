"""한정선 베트남 마케팅 대시보드 — 앱 생성·설정·메뉴 등록·DB 초기화 명령.

[PM1 상준만 수정] 다른 팀원은 이 파일을 고치지 않고 PM1에게 요청합니다. (README 5장)
기능 모듈은 이 파일을 import하지 않습니다. DB 객체는 platform_core.extensions에서 가져옵니다.
"""
import os
import tempfile

import click
from flask import Flask, jsonify, redirect, url_for
from flask.cli import with_appcontext
from werkzeug.middleware.proxy_fix import ProxyFix

from platform_core.extensions import db


def create_app():
    on_vercel = os.environ.get("VERCEL") == "1"
    app_options = {"instance_relative_config": True}
    if on_vercel:
        # Vercel의 쓰기 가능한 임시 공간입니다. 영구 저장소로 사용하지 않습니다.
        app_options["instance_path"] = os.path.join(tempfile.gettempdir(), "hanjeongseon")
    app = Flask(__name__, **app_options)

    secret_key = os.environ.get("SECRET_KEY", "").strip()
    database_url = os.environ.get("DATABASE_URL", "").strip()
    # 일부 제공사가 예전 postgres:// 형식을 주므로 SQLAlchemy용 이름으로 맞춥니다.
    if database_url.startswith("postgres://"):
        database_url = "postgresql://" + database_url[len("postgres://"):]
    database_uri = database_url or "sqlite:///" + os.path.join(app.instance_path, "dashboard.sqlite3")
    if (os.environ.get("RENDER") or on_vercel) and (not secret_key or secret_key == "dev"):
        raise RuntimeError("운영 환경에는 안전한 SECRET_KEY가 필요합니다.")
    if on_vercel and not database_url.startswith(("postgresql://", "postgresql+psycopg://")):
        raise RuntimeError("Vercel 운영 환경에는 외부 PostgreSQL DATABASE_URL이 필요합니다.")
    if on_vercel and database_url.startswith("postgresql://"):
        # requirements.txt에 설치된 psycopg 3 드라이버를 명시합니다.
        database_url = "postgresql+psycopg://" + database_url[len("postgresql://"):]
        database_uri = database_url
    os.makedirs(app.instance_path, exist_ok=True)

    # .env 읽는 방식(python-dotenv 사용 여부)은 README 8장 확정 항목입니다. 확정 전에는 OS 환경변수만 읽습니다.
    app.config.from_mapping(
        SECRET_KEY=secret_key or "dev",
        SQLALCHEMY_DATABASE_URI=database_uri,
        SQLALCHEMY_ENGINE_OPTIONS={"pool_pre_ping": True, "pool_recycle": 300} if database_url else {},
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
    """현재 DATABASE_URL(없으면 로컬 SQLite)에 모든 모듈의 테이블을 만듭니다."""
    db.create_all()
    target = "DATABASE_URL의 PostgreSQL" if os.environ.get("DATABASE_URL", "").strip() else "instance/dashboard.sqlite3"
    click.echo(f"DB 초기화 완료: {target}")


# Vercel은 모듈의 app 인스턴스를 불러옵니다. 로컬·Render는 기존 팩토리를 사용합니다.
if os.environ.get("VERCEL") == "1":
    app = create_app()
