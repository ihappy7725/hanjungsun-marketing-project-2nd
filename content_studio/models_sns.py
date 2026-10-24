"""대화·메시지·디자인 버전 테이블. [유진]

테이블 이름 접두어: content_studio_sns_ (희주 테이블이 필요하면 content_studio_media_ 접두어로 희주 파일에 둡니다)
세 탭(포스터·카드뉴스·영상)이 같이 씁니다. 결과물(design) 내용은 들여다보지 않고 그대로 저장합니다.
다른 탭의 ID(제품·기념일)는 외래키 없이 문자열 칸으로 저장합니다.
"""
from datetime import datetime, timezone

from platform_core.extensions import db

KINDS = ("poster", "cardnews", "video")
MAX_VERSIONS = 60


def _now():
    return datetime.now(timezone.utc)


class SnsChat(db.Model):
    """작업 하나 = 대화 하나."""

    __tablename__ = "content_studio_sns_chat"

    id = db.Column(db.Integer, primary_key=True)
    kind = db.Column(db.String(20), nullable=False, index=True)  # KINDS
    title = db.Column(db.String(200), nullable=False, default="")
    product_id = db.Column(db.String(64))  # products.py의 id
    event_id = db.Column(db.String(64))    # 현지 시장 분석 기념일 ID (외래키 없음)
    tone = db.Column(db.String(64))
    file_id = db.Column(db.String(64))     # 첨부 사진 (희주 업로드 API의 파일 ID)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=_now)
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=_now, onupdate=_now)

    messages = db.relationship(
        "SnsMessage", backref="chat", order_by="SnsMessage.id", cascade="all, delete-orphan"
    )
    design = db.relationship("SnsDesign", backref="chat", uselist=False, cascade="all, delete-orphan")


class SnsMessage(db.Model):
    """대화 메시지 + 결과 카드(캡션·콘티·검수)."""

    __tablename__ = "content_studio_sns_message"

    id = db.Column(db.Integer, primary_key=True)
    chat_id = db.Column(db.Integer, db.ForeignKey("content_studio_sns_chat.id"), nullable=False, index=True)
    role = db.Column(db.String(20), nullable=False)  # user / assistant
    text = db.Column(db.Text, nullable=False, default="")
    cards = db.Column(db.JSON, nullable=False, default=list)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=_now)


class SnsDesign(db.Model):
    """결과물 버전 목록(최대 60개) + 지금 보고 있는 위치. 작업 하나당 한 줄."""

    __tablename__ = "content_studio_sns_design"

    id = db.Column(db.Integer, primary_key=True)
    chat_id = db.Column(db.Integer, db.ForeignKey("content_studio_sns_chat.id"), nullable=False, unique=True)
    versions = db.Column(db.JSON, nullable=False, default=list)
    current = db.Column(db.Integer, nullable=False, default=-1)  # 버전이 없으면 -1
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=_now, onupdate=_now)

    def __init__(self, **kwargs):
        # 칸 기본값은 DB에 넣을 때 채워지므로, 저장 전에도 쓸 수 있게 미리 채웁니다.
        kwargs.setdefault("versions", [])
        kwargs.setdefault("current", -1)
        super().__init__(**kwargs)

    @property
    def doc(self):
        return self.versions[self.current] if self.current >= 0 else None

    @property
    def can_undo(self):
        return self.current > 0

    @property
    def can_redo(self):
        return self.current < len(self.versions) - 1

    def push(self, doc):
        """새 버전 저장. 되돌린 상태였으면 그 뒤 버전은 버립니다."""
        versions = list(self.versions or [])[: self.current + 1] + [doc]
        # JSON 칸은 새 목록을 넣어야 변경이 저장됩니다.
        self.versions = versions[-MAX_VERSIONS:]
        self.current = len(self.versions) - 1

    def undo(self):
        if not self.can_undo:
            return False
        self.current -= 1
        return True

    def redo(self):
        if not self.can_redo:
            return False
        self.current += 1
        return True


class SnsCreditLog(db.Model):
    """대시보드에서 Higgsfield에 보낸 유료 요청 기록. 하루 한도(higgsfield.DAILY_LIMIT)를 여기서 셉니다.
    실패한 작업도 지우지 않습니다(환불 여부를 알 수 없어 넉넉하게 셈)."""

    __tablename__ = "content_studio_sns_credit_log"

    id = db.Column(db.Integer, primary_key=True)
    chat_id = db.Column(db.Integer, index=True)            # 작업이 지워져도 기록은 남깁니다 (외래키 없음)
    job_kind = db.Column(db.String(20), nullable=False)    # image(미리보기) / video
    model = db.Column(db.String(64), nullable=False)
    credits = db.Column(db.Float, nullable=False)          # 요청 직전 generate cost 값
    request_id = db.Column(db.String(64))                  # Higgsfield 작업 ID
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=_now, index=True)
