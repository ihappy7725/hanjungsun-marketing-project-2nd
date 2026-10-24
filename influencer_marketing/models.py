"""인플루언서 마케팅 DB 테이블과 저장 함수 (담당: 진혁).

- 테이블 이름은 모두 influencer_marketing_ 으로 시작합니다.
- 다른 기능은 이 파일을 직접 import하지 않고 public.py만 사용합니다.
- routes.py와 public.py는 아래 '저장 함수'만 부르고, 쿼리를 직접 쓰지 않습니다.
- 날짜는 'YYYY-MM-DD' 문자열, 시각은 ISO 문자열로 저장합니다(README 8장 공통 기준).
"""
from datetime import datetime

from platform_core.extensions import db


def _now():
    return datetime.now().isoformat(timespec="seconds")


class Influencer(db.Model):
    """인플루언서 1명 = 협업 1건. id가 곧 collaboration_id 입니다."""

    __tablename__ = "influencer_marketing_influencers"

    id = db.Column(db.String(40), primary_key=True)          # 문자열 ID (예: inf_lx2k9a)
    name = db.Column(db.String(120), nullable=False)
    handle = db.Column(db.String(120), default="")
    category = db.Column(db.String(40), default="")
    city = db.Column(db.String(40), default="")
    email = db.Column(db.String(200), default="")
    zalo = db.Column(db.String(80), default="")
    manager = db.Column(db.String(120), default="")
    channels = db.Column(db.JSON, default=dict)               # {"tt": {"f": 팔로워, "v": 조회수 중앙값, "url": ""}, ...}
    metrics_date = db.Column(db.String(10), default="")
    metrics_source = db.Column(db.String(40), default="")
    status = db.Column(db.String(20), default="candidate")
    event_id = db.Column(db.String(80), default="", index=True)  # 현지 시장 분석(상준)의 기념일 ID. 외래키 없이 문자열로 보관
    sent_at = db.Column(db.String(25), default="")
    confirmed_shoot = db.Column(db.String(10), default="")
    post_date = db.Column(db.String(10), default="")
    notes = db.Column(db.Text, default="")
    reply = db.Column(db.JSON, default=None)                  # 회신 내용 (가능 여부·날짜·희망 비용 등)
    is_demo = db.Column(db.Boolean, default=False)            # 시연 데이터 여부
    created_at = db.Column(db.String(25), default=_now)
    updated_at = db.Column(db.String(25), default=_now)

    def to_dict(self):
        return {
            "id": self.id, "name": self.name, "handle": self.handle or "", "category": self.category or "",
            "city": self.city or "", "email": self.email or "", "zalo": self.zalo or "", "manager": self.manager or "",
            "pf": self.channels or {}, "metricsDate": self.metrics_date or "", "metricsSource": self.metrics_source or "",
            "status": self.status or "candidate", "eventId": self.event_id or "", "sentAt": self.sent_at or "",
            "confirmedShoot": self.confirmed_shoot or "", "postDate": self.post_date or "", "notes": self.notes or "",
            "resp": self.reply, "example": bool(self.is_demo), "createdAt": self.created_at or "", "updatedAt": self.updated_at or "",
        }


class Quote(db.Model):
    """받은 광고 단가 기록. price_type: public(공개 참고가) / quote(견적) / contract(계약가)."""

    __tablename__ = "influencer_marketing_quotes"

    id = db.Column(db.String(40), primary_key=True)
    influencer_id = db.Column(db.String(40), default="", index=True)  # 외래키 없이 문자열
    influencer_name = db.Column(db.String(120), default="")           # 인플루언서가 삭제돼도 이름을 보여 주기 위한 사본
    platform = db.Column(db.String(4), default="tt")
    content_format = db.Column(db.String(40), default="")
    price_type = db.Column(db.String(10), default="quote")
    quoted_on = db.Column(db.String(10), default="")
    amount = db.Column(db.Float, default=0)
    currency = db.Column(db.String(3), default="VND")
    followers = db.Column(db.Integer, nullable=True)
    expected_views = db.Column(db.Integer, nullable=True)
    actual_views = db.Column(db.Integer, nullable=True)
    conditions = db.Column(db.String(300), default="")
    is_demo = db.Column(db.Boolean, default=False)
    updated_at = db.Column(db.String(25), default=_now)

    def to_dict(self):
        return {
            "id": self.id, "infId": self.influencer_id or "", "name": self.influencer_name or "", "platform": self.platform,
            "format": self.content_format or "", "layer": self.price_type, "date": self.quoted_on or "", "amount": self.amount or 0,
            "cur": self.currency or "VND", "followers": self.followers, "expViews": self.expected_views,
            "actualViews": self.actual_views, "cond": self.conditions or "", "example": bool(self.is_demo), "updatedAt": self.updated_at or "",
        }


class MetricSnapshot(db.Model):
    """채널 지표 기록 (시점별 비교용). 지표가 바뀔 때마다 한 줄씩 쌓입니다. 기존 테이블은 바꾸지 않는 추가 테이블."""

    __tablename__ = "influencer_marketing_metric_snapshots"

    id = db.Column(db.String(40), primary_key=True)
    influencer_id = db.Column(db.String(40), default="", index=True)
    platform = db.Column(db.String(4), default="")
    followers = db.Column(db.Integer, nullable=True)
    median_views = db.Column(db.Integer, nullable=True)
    avg_views = db.Column(db.Integer, nullable=True)
    engagement_rate = db.Column(db.Float, nullable=True)        # %
    vn_audience = db.Column(db.Float, nullable=True)            # 베트남 시청자 비중 %
    source_type = db.Column(db.String(20), default="manual")    # official_api / saas / saas_estimate / manual / submitted / demo
    provider = db.Column(db.String(60), default="")
    confidence = db.Column(db.String(10), default="")           # high / medium / low / demo
    collected_on = db.Column(db.String(10), default="")
    is_demo = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.String(25), default=_now)

    def to_dict(self):
        return {"id": self.id, "infId": self.influencer_id, "platform": self.platform, "followers": self.followers,
                "medianViews": self.median_views, "avgViews": self.avg_views, "er": self.engagement_rate,
                "vnAudience": self.vn_audience, "sourceType": self.source_type, "provider": self.provider,
                "confidence": self.confidence, "collectedOn": self.collected_on, "example": bool(self.is_demo),
                "createdAt": self.created_at}


class Setting(db.Model):
    """캠페인 정보·환율 같은 설정값. key='campaign' 한 줄을 씁니다."""

    __tablename__ = "influencer_marketing_settings"

    key = db.Column(db.String(40), primary_key=True)
    value = db.Column(db.JSON, default=dict)


# ---------------------------------------------------------------- 저장 함수
INF_FIELDS = {
    "name": "name", "handle": "handle", "category": "category", "city": "city", "email": "email", "zalo": "zalo",
    "manager": "manager", "pf": "channels", "metricsDate": "metrics_date", "metricsSource": "metrics_source",
    "status": "status", "eventId": "event_id", "sentAt": "sent_at", "confirmedShoot": "confirmed_shoot",
    "postDate": "post_date", "notes": "notes", "resp": "reply", "example": "is_demo",
}
QUOTE_FIELDS = {
    "infId": "influencer_id", "name": "influencer_name", "platform": "platform", "format": "content_format",
    "layer": "price_type", "date": "quoted_on", "amount": "amount", "cur": "currency", "followers": "followers",
    "expViews": "expected_views", "actualViews": "actual_views", "cond": "conditions", "example": "is_demo",
}


def list_influencers():
    return [row.to_dict() for row in Influencer.query.order_by(Influencer.name).all()]


def get_influencer(influencer_id):
    row = db.session.get(Influencer, influencer_id)
    return row.to_dict() if row else None


def save_influencer(data):
    """data는 to_dict()와 같은 형태. 없으면 만들고 있으면 덮어씁니다. 저장된 dict를 돌려줍니다."""
    row = db.session.get(Influencer, data["id"])
    if row is None:
        row = Influencer(id=data["id"], created_at=data.get("createdAt") or _now())
        db.session.add(row)
    for key, col in INF_FIELDS.items():
        if key in data:
            setattr(row, col, data[key])
    row.updated_at = _now()
    db.session.commit()
    return row.to_dict()


def delete_influencer(influencer_id):
    row = db.session.get(Influencer, influencer_id)
    if row:
        db.session.delete(row)
        db.session.commit()


def list_quotes():
    return [row.to_dict() for row in Quote.query.order_by(Quote.quoted_on.desc()).all()]


def save_quote(data):
    row = db.session.get(Quote, data["id"])
    if row is None:
        row = Quote(id=data["id"])
        db.session.add(row)
    for key, col in QUOTE_FIELDS.items():
        if key in data:
            setattr(row, col, data[key])
    row.updated_at = _now()
    db.session.commit()
    return row.to_dict()


def delete_quote(quote_id):
    row = db.session.get(Quote, quote_id)
    if row:
        db.session.delete(row)
        db.session.commit()


def get_setting(key, default=None):
    row = db.session.get(Setting, key)
    return row.value if row else default


def save_setting(key, value):
    row = db.session.get(Setting, key)
    if row is None:
        row = Setting(key=key)
        db.session.add(row)
    row.value = value
    db.session.commit()
    return value


def add_snapshot(data):
    row = MetricSnapshot(id=data["id"], influencer_id=data.get("infId", ""), platform=data.get("platform", ""),
                         followers=data.get("followers"), median_views=data.get("medianViews"), avg_views=data.get("avgViews"),
                         engagement_rate=data.get("er"), vn_audience=data.get("vnAudience"),
                         source_type=data.get("sourceType", "manual"), provider=data.get("provider", ""),
                         confidence=data.get("confidence", ""), collected_on=data.get("collectedOn", ""),
                         is_demo=bool(data.get("example")))
    db.session.add(row)
    db.session.commit()
    return row.to_dict()


def list_snapshots(influencer_id):
    rows = MetricSnapshot.query.filter_by(influencer_id=influencer_id).order_by(MetricSnapshot.created_at.desc()).limit(100).all()
    return [r.to_dict() for r in rows]


def clear_demo():
    """시연 데이터(is_demo=True)만 지웁니다."""
    Influencer.query.filter_by(is_demo=True).delete()
    Quote.query.filter_by(is_demo=True).delete()
    MetricSnapshot.query.filter_by(is_demo=True).delete()
    db.session.commit()
