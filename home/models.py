"""HOME DB 테이블. [주연]

테이블 이름 접두어: home_  (README 8장 DB 충돌 방지)
정의한 테이블: home_campaigns · home_tasks · home_schedules · home_campaign_collaboration_links
다른 탭의 ID는 외래키 없이 문자열 칸으로 저장합니다.

HOME 업무는 서버 DB에 저장합니다. category 칸은 별도 DB 반영 승인 전 준비 상태입니다.
기존 DB를 지우지 않으며, category 반영 명령 실행 전에는 새 모델로 서버를 재시작하지 않습니다.
실제 SQLite 파일은 공통 app.py 설정의 instance/dashboard.sqlite3에 놓입니다.
home/db/ 폴더를 별도로 만들거나 공통 DB 연결 설정을 이 파일에서 바꾸지 않습니다.
기존 기록이 쌓인 뒤의 구조 변경은 백업·이관 방법을 PM1과 먼저 합의합니다.
"""
from platform_core.extensions import db


TASK_CATEGORIES = {
    "": "미지정", "research": "조사", "content": "콘텐츠",
    "collaboration": "협업", "meeting": "회의", "other": "기타",
}


class HomeCampaign(db.Model):
    """HOME에서 만든 이벤트. 외부 일정은 event_id만 보관합니다."""

    __tablename__ = "home_campaigns"
    __table_args__ = (
        db.CheckConstraint(
            "status IN ('preparing', 'active', 'done', 'blocked', 'cancelled', 'archived')",
            name="ck_home_campaigns_status",
        ),
    )

    id = db.Column(db.String(255), primary_key=True)
    name = db.Column(db.Text, nullable=False)
    target_date = db.Column(db.Date, nullable=False)
    template = db.Column(db.Text, nullable=False, default="")
    status = db.Column(db.String(20), nullable=False, default="preparing")
    product = db.Column(db.Text, nullable=False, default="")
    audience = db.Column(db.Text, nullable=False, default="")
    channel = db.Column(db.Text, nullable=False, default="")
    event_id = db.Column(db.String(255), nullable=False, default="")
    review = db.Column(db.Text, nullable=False, default="")
    revision = db.Column(db.Integer, nullable=False, default=1)
    import_batch_id = db.Column(db.String(255), nullable=True, index=True)

    __mapper_args__ = {"version_id_col": revision}


class HomeTask(db.Model):
    """캠페인 준비 업무. 날짜가 없는 업무와 고정 일정도 보존합니다."""

    __tablename__ = "home_tasks"
    __table_args__ = (
        db.CheckConstraint(
            "status IN ('todo', 'doing', 'blocked', 'done', 'cancelled')",
            name="ck_home_tasks_status",
        ),
        db.CheckConstraint("importance IN ('normal', 'high')", name="ck_home_tasks_importance"),
        db.CheckConstraint(
            "category IN ('', 'research', 'content', 'collaboration', 'meeting', 'other')",
            name="ck_home_tasks_category",
        ),
        db.CheckConstraint(
            "start_date IS NULL OR due_date IS NULL OR start_date <= due_date",
            name="ck_home_tasks_date_order",
        ),
    )

    id = db.Column(db.String(255), primary_key=True)
    campaign_id = db.Column(
        db.String(255), db.ForeignKey("home_campaigns.id"), nullable=False, index=True,
    )
    key = db.Column(db.Text, nullable=False, default="")
    offset = db.Column(db.Integer, nullable=False, default=0)
    title = db.Column(db.Text, nullable=False)
    start_date = db.Column(db.Date, nullable=True)
    due_date = db.Column(db.Date, nullable=True, index=True)
    # HH:MM, Asia/Seoul 기준. 빈 문자열은 종일 또는 시간 미지정입니다.
    due_time = db.Column(db.String(5), nullable=False, default="")
    fixed = db.Column(db.Boolean, nullable=False, default=False)
    status = db.Column(db.String(20), nullable=False, default="todo")
    importance = db.Column(db.String(20), nullable=False, default="normal")
    category = db.Column(db.String(20), nullable=False, default="", server_default="")
    related_tab = db.Column(db.Text, nullable=False, default="")
    memo = db.Column(db.Text, nullable=False, default="")
    # 기존 브라우저의 UTC ISO 문자열을 그대로 보존합니다. 미기록은 빈 문자열입니다.
    completed_at = db.Column(db.Text, nullable=False, default="")
    revision = db.Column(db.Integer, nullable=False, default=1)
    import_batch_id = db.Column(db.String(255), nullable=True, index=True)

    __mapper_args__ = {"version_id_col": revision}


class HomeSchedule(db.Model):
    """기존 직접 등록 일정. title과 구형 name을 모두 보존합니다."""

    __tablename__ = "home_schedules"

    id = db.Column(db.String(255), primary_key=True)
    title = db.Column(db.Text, nullable=False, default="")
    name = db.Column(db.Text, nullable=False, default="")
    date = db.Column(db.Date, nullable=False, index=True)
    campaign_id = db.Column(
        db.String(255), db.ForeignKey("home_campaigns.id"), nullable=True, index=True,
    )
    memo = db.Column(db.Text, nullable=False, default="")
    revision = db.Column(db.Integer, nullable=False, default=1)
    import_batch_id = db.Column(db.String(255), nullable=True, index=True)

    __mapper_args__ = {"version_id_col": revision}


class HomeCampaignCollaborationLink(db.Model):
    """HOME 캠페인과 외부 협업의 연결. 외부 협업 내용은 복사하지 않습니다."""

    __tablename__ = "home_campaign_collaboration_links"

    campaign_id = db.Column(
        db.String(255), db.ForeignKey("home_campaigns.id"), primary_key=True,
    )
    # 두 ID를 합친 기본키로 같은 연결의 중복 저장을 막습니다. 외부 ID에는 외래키가 없습니다.
    collaboration_id = db.Column(db.String(255), primary_key=True)
    revision = db.Column(db.Integer, nullable=False, default=1)
    import_batch_id = db.Column(db.String(255), nullable=True, index=True)

    __mapper_args__ = {"version_id_col": revision}
