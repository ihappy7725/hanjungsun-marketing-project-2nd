"""인플루언서 마케팅 모듈 (담당: 진혁).

PM1(상준)이 app.py에서 이 bp를 등록합니다.
    from influencer_marketing import bp as influencer_marketing_bp
    app.register_blueprint(influencer_marketing_bp)

URL은 /influencer_marketing/ 아래만 사용합니다.
"""
import hashlib
import os

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
    _seed_demo_if_empty()


def _seed_demo_if_empty():
    """배포 서버(Render)에서만: 인플루언서가 한 명도 없으면 예시 인플루언서·견적을 넣습니다.
    PM 요청(2026-10-27): HOME 요약이 0으로 시작하지 않도록 시연 표시(is_demo) 없이 저장합니다.
    제안·회신·확정·견적은 가상 인물만 맡습니다. 화면에서 '시연'·'demo'가 보이지 않게 핸들·이메일·채널 주소는 비우고
    지표 출처는 '에이전시 자료'로 둡니다(실존 계정·메일함과 겹치지 않도록 그럴듯한 가짜 연락처는 만들지 않음).
    실제 계정은 '베트남 크리에이터 목록'에서 식품(맛집·먹방) TikTok 팔로워 상위 3명을 [발굴]과 같은 규칙으로 '후보'로만 등록합니다.
    무료 서버는 재시작 때 DB가 비므로, 다시 켜질 때마다 [발굴]·요약 시연이 바로 되게 합니다.
    팀원 로컬 DB에는 아무것도 넣지 않습니다(Render가 자동으로 넣는 RENDER 환경변수로 구분)."""
    if not os.environ.get("RENDER"):
        return
    from flask import current_app
    from . import discovery as disc
    from . import models
    try:
        if models.Influencer.query.first() is not None:
            return
        new_id = lambda old: "inf_2610" + hashlib.md5(old.encode()).hexdigest()[:8]  # 일반 등록과 같은 모양의 ID
        for inf in routes.DEMO_INFLUENCERS:
            pf = {k: {**ch, "url": ""} for k, ch in inf["pf"].items()}
            models.save_influencer({**inf, "id": new_id(inf["id"]), "handle": "", "email": "", "manager": "", "pf": pf,
                                    "metricsSource": "에이전시 자료", "example": False})
        for q in routes.DEMO_QUOTES:
            models.save_quote({**q, "id": "q_2610" + hashlib.md5(q["id"].encode()).hexdigest()[:8],
                               "infId": new_id(q["infId"]), "example": False})
        rows, _info = disc._ref_search("ref:creator_list_vn.csv", "tt", {})
        picks = sorted((r for r in rows if r.get("segment") == disc.SEGMENT_NAMES[0] and r.get("url")),
                       key=lambda r: -(r.get("followers") or 0))[:3]
        routes.register_records(picks)
        current_app.logger.info("인플루언서 마케팅: 빈 DB에 예시 인플루언서를 넣었어요")
    except Exception as e:  # 다른 탭이 멈추지 않도록 경고만 남김
        models.db.session.rollback()
        current_app.logger.warning("인플루언서 마케팅: 예시 데이터 넣기 실패 (%s)", e.__class__.__name__)
