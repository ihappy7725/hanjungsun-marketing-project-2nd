"""DB 객체. [PM1 상준만 수정]

app.py에 두면 기능 모듈이 app.py를 import해야 해서 순환 참조가 생기므로 따로 둡니다. (README 5장)
사용: from platform_core.extensions import db
"""
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()
