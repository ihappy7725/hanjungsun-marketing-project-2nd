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

_schema_checked = False


@bp.before_app_request
def _ensure_schema_once():
    """서버가 켜진 뒤 첫 요청 때 한 번만, 예전 로컬 DB에 빠진 칸(예: segment)을 추가합니다. DB를 지울 필요가 없습니다."""
    global _schema_checked
    if _schema_checked:
        return
    _schema_checked = True
    from flask import current_app
    from . import models
    fn = getattr(models, "ensure_columns", None)
    if fn is None:
        return
    try:
        added = fn()
        if added:
            current_app.logger.info("인플루언서 마케팅: 예전 DB에 빠진 칸을 추가했어요 → %s", ", ".join(added))
    except Exception as e:  # 다른 탭이 멈추지 않도록 경고만 남김
        current_app.logger.warning("인플루언서 마케팅: DB 칸 확인 실패 (%s). instance 폴더의 DB를 확인해 주세요.", e.__class__.__name__)
