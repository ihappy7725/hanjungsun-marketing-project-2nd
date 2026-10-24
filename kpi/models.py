"""KPI DB 테이블. [민지]

테이블 이름 접두어: kpi_  (README 8장 DB 충돌 방지)
다른 탭의 ID는 외래키 없이 문자열 칸으로 저장합니다.
금액은 원래 통화와 함께 저장하고, 환산은 KPI 공식으로 합니다. (README 9장)

1단계에서는 화면을 routes.py의 시연 데이터로 보여 주고, 이 테이블은 CSV 업로드(2단계)부터 채웁니다.
"""
from platform_core.extensions import db


class KpiMarketingBudget(db.Model):
    """월별 총 배정 예산과 편성 시점 기준 환율."""

    __tablename__ = "kpi_marketing_budget"

    id = db.Column(db.Integer, primary_key=True)
    campaign_month = db.Column(db.String(7), nullable=False, unique=True)  # 예: 2026-10
    total_budget_krw = db.Column(db.Integer, nullable=False)
    base_exchange_rate = db.Column(db.Float, nullable=False)  # 100 VND당 KRW, 예: 5.40
    is_demo = db.Column(db.Boolean, nullable=False, default=False)


class KpiAdPerformanceDaily(db.Model):
    """채널별 일별 광고비·매출. Meta·TikTok·Shopee 정산 CSV에서 가져옵니다."""

    __tablename__ = "kpi_ad_performance_daily"
    __table_args__ = (db.UniqueConstraint("date", "channel", name="uq_kpi_ad_performance_daily_date_channel"),)

    id = db.Column(db.Integer, primary_key=True)
    date = db.Column(db.String(10), nullable=False)  # YYYY-MM-DD
    channel = db.Column(db.String(20), nullable=False)  # Meta | TikTok | Shopee_Ads | Influencer
    ad_spend_vnd = db.Column(db.BigInteger, nullable=False, default=0)
    sales_revenue_vnd = db.Column(db.BigInteger, nullable=False, default=0)
    conversions = db.Column(db.Integer, nullable=False, default=0)
    landing_clicks = db.Column(db.Integer, nullable=False, default=0)
    engaged_sessions = db.Column(db.Integer)  # GA4 10초 이상 유효 참여. GA4를 끄면 비워 둡니다.
    is_demo = db.Column(db.Boolean, nullable=False, default=False)


class KpiVocReview(db.Model):
    """현지 고객 반응(리뷰·댓글)과 AI 번역·감성 분류 결과."""

    __tablename__ = "kpi_voc_reviews"

    id = db.Column(db.Integer, primary_key=True)
    review_id = db.Column(db.String(64), nullable=False, unique=True)
    platform = db.Column(db.String(20), nullable=False)  # Shopee_VN | Instagram | TikTok | Zalo_OA(팜플렛 QR)
    raw_text_vn = db.Column(db.Text, nullable=False)
    translated_kr = db.Column(db.Text)
    sentiment = db.Column(db.String(10))  # Positive | Neutral | Negative
    keyword_tag = db.Column(db.String(40))  # 당도/맛 | 포장/보냉 | 가격 | 선물용 | 기타 (배송 없음)
    is_demo = db.Column(db.Boolean, nullable=False, default=False)
