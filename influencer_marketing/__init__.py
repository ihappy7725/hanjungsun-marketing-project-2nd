"""인플루언서 마케팅 모듈 (담당: 진혁).

PM1(상준)이 app.py에서 이 bp를 등록합니다.
    from influencer_marketing import bp as influencer_marketing_bp
    app.register_blueprint(influencer_marketing_bp)

URL은 /influencer_marketing/ 아래만 사용합니다.
"""
from flask import Blueprint

bp = Blueprint(
    "influencer_marketing",
    __name__,
    url_prefix="/influencer_marketing",
    template_folder="templates",
    static_folder="static",
)

from . import routes  # noqa: E402,F401  (라우트 등록. models도 여기서 함께 불러와져 init-db 때 테이블이 생성됩니다)
