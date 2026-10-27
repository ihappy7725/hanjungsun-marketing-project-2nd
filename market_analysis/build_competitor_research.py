"""베트남 경쟁제품 재조사표를 공개 상품 페이지에서 다시 확인해 만든다. [상준]

조사 지시서(2026-10-26)의 결과 파일 5종을 ``data/research_<날짜>/``에 UTF-8 BOM CSV로
쓴다. 판매 상태·가격·사진은 실행할 때마다 상품 페이지를 다시 읽어 판정하고, 판매가
확인되지 않은 판매처는 확정 목록 대신 추가 확인 목록으로 보낸다. 기존 1·2차 CSV는
읽기만 하고 수정하지 않는다. 로그인·캡차·접근 차단 페이지는 우회하지 않고 기록만 한다.

    python market_analysis/build_competitor_research.py
    python market_analysis/build_competitor_research.py --serpapi   # 구글 색인으로 TikTok·Shopee·Lazada 후보 추가

``--serpapi``는 환경변수 SERPAPI_API_KEY로 구글 검색을 호출한다(검색어 1개 = 1회 차감).
TikTok 상품은 공개 상품 페이지에서 판매를 다시 확인하고, Shopee·Lazada는 상품 페이지를
읽을 수 없으므로 확인 대상 목록에만 넣는다. 키는 출력하거나 저장하지 않는다.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import html
import json
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode

sys.path.insert(0, str(Path(__file__).resolve().parent))
from collectors.serpapi_trends_collector import API_URL, SerpApiError, load_api_key  # noqa: E402


ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
FIRST = DATA / "competitor_products_researched_vn_2026-10-26.csv"
SECOND = DATA / "marketplace_competitors_vn_2026-10-26.csv"
ICT = timezone(timedelta(hours=7))
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
DECODER = json.JSONDecoder()

D, A = "직접 경쟁", "인접 경쟁"
R_MOCHI = "찹쌀 피에 소를 넣은 모찌·다이후쿠로 한정선 찹쌀떡과 형태·식감이 겹침(잠정)"
R_ICE = "찹쌀 피로 아이스크림을 감싼 모찌 아이스크림으로 '쫀득한 피+차가운 속' 수요가 겹침(잠정)"
R_GIFT = "모찌 여러 개를 상자에 담은 선물 구성으로 선물 수요가 겹침(잠정)"
R_COM = "베트남 전통 찹쌀(cốm nếp 65%) 단과자로 쫀득한 식감·전통 선물(하노이 특산) 용도가 겹침"
R_DEO = "찹쌀가루 피의 추석 선물 과자로 식감·선물 시즌이 겹침(시즌 상품)"
R_TROI = "찹쌀 경단에 팥소를 넣은 냉동 디저트로 재료·식감이 겹침(조리 필요)"

# 제품 기준표: brand, 현지어 제품명, 한국어 번역, 경쟁 구분, 포함 이유, 유형, 맛·소, 제조국, 제조·수입, 보관
PRODUCTS: dict[str, tuple[str, ...]] = {
    "CP001": ("Royal Family", "Bánh Mochi Dâu Tây", "딸기 모찌", D, R_MOCHI, "포장 모찌", "딸기", "대만", "ROYAL FAMILY FOOD (Con Cưng 표기)", ""),
    "CP002": ("Royal Family", "Bánh Mochi Việt Quất", "블루베리 모찌", D, R_MOCHI, "포장 모찌", "블루베리", "대만", "ROYAL FAMILY FOOD (Con Cưng 표기)", ""),
    "CP003": ("Royal Family", "Bánh mochi nhân đậu đỏ", "팥 모찌", D, R_MOCHI, "포장 모찌", "팥", "대만", "", ""),
    "CP004": ("Royal Family", "Bánh mochi nhân đậu đỏ kem", "팥크림 모찌", D, R_MOCHI, "포장 모찌", "팥·크림", "대만", "", ""),
    "CP005": ("Royal Family", "Bánh mochi nhân trà xanh", "녹차 모찌", D, R_MOCHI, "포장 모찌", "녹차", "대만", "", ""),
    "CP006": ("Royal Family", "Bánh mochi nhân sữa", "우유 모찌", D, R_MOCHI, "포장 모찌", "우유", "대만", "", ""),
    "CP007": ("Royal Family", "Bánh mochi nhân trà sữa trân châu", "버블 밀크티 모찌", D, R_MOCHI, "포장 모찌", "밀크티·타피오카", "대만", "", ""),
    "CP008": ("Royal Family", "Bánh mochi nhân đậu phộng", "땅콩 모찌", D, R_MOCHI, "포장 모찌", "땅콩", "", "", ""),
    "CP009": ("Royal Family", "Bánh mochi nhân khoai môn phủ dừa", "토란 코코넛 모찌", D, R_MOCHI, "포장 모찌", "토란·코코넛", "대만", "", ""),
    "CP010": ("Royal Family", "Bánh mochi nhân mè đen phủ dừa", "흑임자 코코넛 모찌", D, R_MOCHI, "포장 모찌", "흑임자·코코넛", "대만", "", ""),
    "CP011": ("Royal Family", "Bánh mochi tổng hợp / hỗn hợp", "모둠 모찌", D, R_MOCHI, "포장 모찌(모둠)", "모둠(구성 맛은 판매처별 표기 상이)", "대만", "", ""),
    "CP012": ("Royal Family", "Bánh mochi custard tổng hợp", "커스터드 모둠 모찌", D, R_MOCHI, "포장 모찌", "커스터드", "확인 필요(판매처 표기 '베트남', 다른 SKU는 대만)", "", ""),
    "CP013": ("Royal Family", "Bánh Mochi vị bạc hà socola", "민트초코 모찌", D, R_MOCHI, "포장 모찌", "민트·초콜릿", "", "", ""),
    "CP014": ("Royal Family", "Hộp quà Mochi đỏ", "모찌 선물상자(빨강)", D, R_GIFT, "선물세트", "구성 맛 미표기", "", "", ""),
    "CP015": ("Daifuku(판매처 표기 브랜드)", "Bánh Mochi Cam Nhật Daifuku", "일본 귤 다이후쿠", D, R_MOCHI, "포장 다이후쿠", "귤", "", "", ""),
    "CP016": ("Daifuku(판매처 표기 브랜드)", "Bánh Mochi dưa lưới Daifuku", "멜론 다이후쿠", D, R_MOCHI, "포장 다이후쿠", "멜론", "", "", ""),
    "CP017": ("Daifuku(판매처 표기 브랜드)", "Bánh Mochi thanh yên Daifuku", "유자 다이후쿠", D, R_MOCHI, "포장 다이후쿠", "유자", "", "", ""),
    "CP018": ("Daifuku(판매처 표기 브랜드)", "Bánh mochi vị chocolate Daifuku", "초콜릿 다이후쿠", D, R_MOCHI, "포장 다이후쿠", "초콜릿·팥(판매처 설명)", "", "", ""),
    "CP019": ("Daifuku(판매처 표기 브랜드)", "Bánh mochi vị đào Daifuku", "복숭아 다이후쿠", D, R_MOCHI, "포장 다이후쿠", "복숭아·팥(판매처 설명)", "확인 필요(판매처 표기 '베트남')", "", ""),
    "CP020": ("Daifuku(판매처 표기 브랜드)", "Bánh mochi vị matcha Daifuku", "말차 다이후쿠", D, R_MOCHI, "포장 다이후쿠", "말차·팥(판매처 설명)", "확인 필요(판매처 표기 '베트남')", "", ""),
    "CP021": ("Sachi Mochi", "Bánh Mochi vị dâu tây (Ichigo Mochi)", "딸기 모찌", D, R_MOCHI, "포장 모찌", "딸기", "일본", "제조 Kubota Seika(나가노) / 수입 V V A V", "상온(서늘·건조)"),
    "CP022": ("Sachi Mochi", "Bánh Mochi vị đào", "복숭아 모찌", D, R_MOCHI, "포장 모찌", "복숭아", "일본", "제조 Kubota Seika / 수입 V V A V", "상온(서늘·건조)"),
    "CP023": ("Sachi Mochi", "Bánh mochi thanh yên (Yuzu)", "유자 모찌", D, R_MOCHI, "포장 모찌", "유자", "일본", "", "상온(서늘·건조)"),
    "CP024": ("Sachi Mochi", "Bánh Mochi Socola rice cake", "초콜릿 모찌", D, R_MOCHI, "포장 모찌", "초콜릿", "일본", "", "상온(서늘·건조)"),
    "CP025": ("Sachi Mochi", "Bánh Mochi Daifuku vị trà xanh", "말차 다이후쿠", D, R_MOCHI, "포장 다이후쿠", "말차·팥", "일본", "제조 Kubota Seika", "상온(서늘·건조)"),
    "CP026": ("Sachi Mochi", "Mochi vị cam Nhật", "일본 귤 모찌", D, R_MOCHI, "포장 모찌", "귤", "", "수입 V V A V", ""),
    "CP027": ("Sachi Mochi", "Mochi vị dưa lưới", "멜론 모찌", D, R_MOCHI, "포장 모찌", "멜론", "일본(제조사 주소 기준)", "제조 Kubota Seika / 수입 V V A V", ""),
    "CP028": ("Sachi Mochi", "Mochi vị soda chanh (Ramune)", "라무네 소다 모찌", D, R_MOCHI, "포장 모찌", "라무네 소다", "일본", "", "상온(서늘·건조)"),
    "CP029": ("Yuki & Love", "Bánh Mochi nhân khoai môn", "토란 모찌", D, R_MOCHI, "포장 모찌", "토란", "", "", ""),
    "CP030": ("Yuki & Love", "Bánh Mochi nhân đậu đỏ", "팥 모찌", D, R_MOCHI, "포장 모찌", "팥", "", "", ""),
    "CP031": ("Beautiful Girl(판매처 표기)", "Bánh Mochi tổng hợp Beautiful Girl Mixed Mochi", "모둠 모찌(8가지 맛)", D, R_MOCHI, "포장 모찌(모둠)", "팥·참깨·토란·흑당·현미·망고·벚꽃·커피", "대만", "", ""),
    "CP032": ("An Gia", "Bánh Mochi đậu đỏ An Gia", "팥 모찌", D, R_MOCHI, "포장 모찌", "팥", "대만", "유통 CÔNG TY CỔ PHẦN QUỐC TẾ AN PHÁT", "상온(서늘·건조)"),
    "CP033": ("브랜드 미표기", "Bánh bao chỉ khoai môn mochi", "토란 바오즈 모찌", D, R_MOCHI, "포장 모찌", "토란", "대만", "Huy Linh Food (New Taipei City)", "상온(서늘·건조)"),
    "CP034": ("브랜드 미표기", "Bánh bao chỉ trà xanh mochi", "녹차 바오즈 모찌", D, R_MOCHI, "포장 모찌", "녹차", "대만", "Huy Linh Food (New Taipei City)", "상온(서늘·건조)"),
    "CP035": ("Bình Vinh", "Bánh Mochi trà sữa trân châu", "버블 밀크티 모찌", D, R_MOCHI, "포장 모찌", "밀크티·타피오카", "", "", ""),
    "CP036": ("Bourbon", "Bánh mochi socola truffle", "초콜릿 트러플 모찌", D, R_MOCHI, "포장 미니 모찌", "초콜릿", "일본", "", "상온(서늘·건조)"),
    "CP037": ("Lotte Yukimi Daifuku", "Kem Yukimi Daifuku (vani)", "유키미 다이후쿠 바닐라", D, R_ICE, "모찌 아이스크림", "바닐라", "일본", "LOTTE (Co.op 표기: 일본 본사·LOTTE VIETNAM)", "냉동(-18°C)"),
    "CP038": ("Lotte Yukimi Daifuku", "Kem Mini Yukimi Daifuku", "유키미 다이후쿠 미니", D, R_ICE, "모찌 아이스크림", "페이지 맛 미표기", "", "", ""),
    "CP039": ("Lotte Yukimi Daifuku", "Kem Yukimi Daifuku Matcha", "유키미 다이후쿠 말차", D, R_ICE, "모찌 아이스크림", "말차", "일본", "", "냉동(-18°C)"),
    "CP040": ("Lotte Yukimi Daifuku", "Kem Yukimi Daifuku Socola", "유키미 다이후쿠 초콜릿", D, R_ICE, "모찌 아이스크림", "초콜릿", "", "", ""),
    "CP041": ("Aice", "Kem Mochi Socola", "모찌 아이스크림 초콜릿", D, R_ICE, "모찌 아이스크림(낱개)", "초콜릿", "", "", ""),
    "CP042": ("Aice", "Kem Mochi Vani", "모찌 아이스크림 바닐라", D, R_ICE, "모찌 아이스크림(낱개)", "바닐라", "", "", ""),
    "CP043": ("Joyday", "Kem Mochi dâu", "모찌 아이스크림 딸기", D, R_ICE, "모찌 아이스크림(낱개)", "딸기", "", "", ""),
    "CP044": ("Joyday", "Kem Mochi socola", "모찌 아이스크림 초콜릿", D, R_ICE, "모찌 아이스크림(낱개)", "초콜릿", "", "", ""),
    "CP045": ("Minh Nhật", "Mochi vị matcha chấm xốt kem tươi", "말차 모찌(생크림 소스 찍어 먹는)", D, R_MOCHI, "냉장 모찌(소스 동봉)", "말차·생크림 소스", "", "", "냉장(2~5°C, 판매처 안내)"),
    "CP046": ("Minh Nhật", "Mochi vị truyền thống chấm xốt kem tươi", "기본 모찌(생크림 소스 찍어 먹는)", D, R_MOCHI, "냉장 모찌(소스 동봉)", "기본·생크림 소스", "", "", ""),
    "CP047": ("Penguin", "Bánh Mochi Matcha đậu đỏ", "말차 팥 모찌", D, R_MOCHI, "포장 모찌", "말차·팥", "", "팥소 일본 생산 표기", ""),
    "CP048": ("Penguin (S-Trust)", "Bánh mochi Fukufuku maru 3 vị", "후쿠후쿠마루 3가지 맛 모찌", D, R_GIFT, "선물세트(모찌)", "바나나·백도·멜론 크림", "", "", ""),
    "CP049": ("BVSG", "Bánh mochi hồng phúc vị phô mai đào", "치즈 복숭아 모찌", D, R_MOCHI, "냉동 크림 모찌", "크림치즈·복숭아", "", "", "냉동(-18°C 이하, 해동 40~50분)"),
    "CP050": ("BVSG", "Bánh mochi trà sữa trân châu", "버블 밀크티 모찌", D, R_MOCHI, "냉동 크림 모찌", "밀크티·흑당 젤리", "", "", "냉동(-18°C 이하, 해동 40~50분)"),
    "CP051": ("Mochi Sweets", "Bánh mochi (chọn vị) – lẻ / hộp 3·6·9·12·18", "Mochi Sweets 모찌(맛 선택 낱개·선물상자)", D,
              "베트남 매장 체인의 크림 모찌·선물상자로 형태와 선물 용도가 모두 겹침. 다낭·호이안 매장 있음(잠정)",
              "매장·공식몰 모찌", "맛 선택(망고·초콜릿·녹차팥·두리안·치즈 등 20여 종)", "", "Mochi Sweets Việt Nam", ""),
    "CP052": ("Anh Hòa Bakery", "Bánh Mochi", "모찌(베이커리)", D, R_MOCHI, "베이커리 모찌", "페이지 미표기", "", "", ""),
    "CP053": ("Mochi Mashu", "Bánh mochi 2 cô gái mix vị đậu, mè, truyền thống", "'두 소녀' 모찌 믹스(콩·참깨·기본)", D, R_MOCHI, "포장 모찌(대용량)", "콩·참깨·기본", "", "", ""),
    "CP054": ("MCLUNE", "Bánh mochi kem lạnh mix 7 vị", "크림 모찌 7가지 맛", D, R_MOCHI, "크림 모찌(대용량)", "아보카도·두리안·복숭아·코코넛·토란·초콜릿·블루베리", "", "", ""),
    "CP055": ("Bảo Minh", "Bánh cốm (đậu xanh)", "꼼(햇찹쌀) 녹두 떡", A, R_COM, "베트남 찹쌀 전통과자", "녹두·코코넛", "베트남", "Bảo Minh (하노이 남탕롱 공단)", "상온"),
    "CP056": ("Bảo Minh", "Bánh cốm đậu xanh sầu riêng", "꼼 녹두 두리안 떡", A, R_COM, "베트남 찹쌀 전통과자", "녹두·두리안", "베트남", "Bảo Minh", "상온"),
    # 아래는 판매 확인 판매처가 없을 가능성이 높아 추가 확인 목록에 주로 남는 제품
    "CP057": ("Daifuku(판매처 표기 브랜드)", "Bánh mochi vị dâu tây Daifuku 121g", "딸기 다이후쿠 121g", D, R_MOCHI, "포장 다이후쿠", "딸기", "", "", ""),
    "CP058": ("Qidea", "Bánh mochi Qidea 210g", "Qidea 모찌 210g", D, R_MOCHI, "포장 모찌", "토란·땅콩·흑임자·팥·녹차", "대만", "Hoang Dang Food", "상온"),
    "CP059": ("An Gia", "Bánh mochi trà sữa trân châu 210g", "버블 밀크티 모찌 210g", D, R_MOCHI, "포장 모찌", "밀크티", "대만", "An Phát", "상온"),
    "CP060": ("브랜드 미표기", "Bánh Mochi mè đen / đậu phộng 180g", "흑임자·땅콩 모찌 180g", D, R_MOCHI, "포장 모찌", "흑임자·땅콩", "대만", "", "상온"),
    "CP061": ("Smile Pine Crane", "Bánh mochi Đài Loan nhân mè đen 180g", "흑임자 모찌 180g", D, R_MOCHI, "포장 모찌", "흑임자", "대만", "", ""),
    "CP062": ("Mayumifood", "Bánh Mochi trái cây thập cẩm 115g", "모둠 과일 모찌 115g", D, R_MOCHI, "포장 모찌", "모둠 과일", "", "", ""),
    "CP063": ("Minh Nhật", "Mochi Nama Socola 50g", "생초콜릿 모찌 50g", D, R_MOCHI, "냉장 모찌", "초콜릿", "", "", ""),
    "CP064": ("Penguin (S-Trust)", "Bánh Mochi Shofuku 20 chiếc", "쇼후쿠 모찌 20개입", D, R_GIFT, "선물세트", "살구·밤·참깨 등", "", "", ""),
    "CP065": ("Tsujisei", "Bánh Mochi 30 chiếc / 26 chiếc", "츠지세이 모찌 선물상자 30·26개입", D, R_GIFT, "선물세트", "딸기·말차 / 밤·호두·매실·쑥·콩가루", "", "", ""),
    "CP066": ("Seiki", "Bánh Mochi Daifuku vị dưa lưới 30 cái", "멜론 다이후쿠 30개입", D, R_GIFT, "선물세트", "멜론 크림", "", "", ""),
    "CP067": ("Irodori", "Bánh mochi 5 vị 413g", "이로도리 모찌 5가지 맛 413g", D, R_GIFT, "선물세트", "콩가루·호두·밤·매실·쑥", "", "", ""),
    "CP068": ("Sachi Mochi", "Bánh mochi hồng bạch 200g", "홍백 모찌 200g", D, R_MOCHI, "포장 모찌", "팥", "일본", "Kubota Seika", ""),
    "CP069": ("Kamereo(판매처, 제조사 미표기)", "Bánh Mochi / Dango 750g (đông lạnh)", "업소용 냉동 다이후쿠·당고 750g", D, R_MOCHI, "업소용 냉동 모찌", "팥·초콜릿·녹두·참깨·미타라시 등", "일본(판매처 표기)", "", "냉동"),
    "CP070": ("Mochi Sweets", "Hộp Mochi yến sào tinh thể vàng – 3 bánh", "제비집·식용금 모찌 3개입", D, R_GIFT, "선물세트(프리미엄)", "제비집", "", "Mochi Sweets Việt Nam", ""),
    "CP071": ("Yuki & Love", "Bánh mochi tổng hợp 300g / gói 180g", "Yuki&Love 모둠 300g·봉지 180g", D, R_MOCHI, "포장 모찌", "모둠·팥·토란", "대만", "", ""),
    "CP072": ("Kinh Đô", "Bánh dẻo (Trung thu)", "추석 찹쌀 월병(반뗘오)", A, R_DEO, "추석 찹쌀 과자", "녹두·소금 달걀 노른자 등", "베트남", "", "상온"),
    "CP073": ("Spring Home", "Bánh trôi nước nhân đậu đỏ 200g", "팥소 찹쌀 경단 200g", A, R_TROI, "냉동 찹쌀 경단", "팥", "베트남", "Nhịp Sống Mới", ""),
}

# 판매처 후보: listing_id, product_id, 옵션, 판매처, 채널, 지역, 파서, 링크, 옵션명, 입수, 총중량(g), 기존 ID, 메모
KF = "https://kingfoodmart.com/"
CO = "https://cooponline.vn/"
FM = "https://farmersmarket.vn/products/"
SK = "https://sakukostore.com.vn/products/"
CC = "https://concung.com/banh-an-dam-va-keo-cho-be/"
MS = "https://shop.mochisweets.com.vn/product/"
KM = "https://kamereo.vn/products/"
REG_CC = "전국(Con Cưng 매장 1,215곳 표기·온라인 배송, 지역별 재고 상이 가능)"
REG_CO = "Co.op Online 배송 지역(조회 기본 매장 기준, 다낭 배송 여부 미확인)"
REG_KF = "Kingfoodmart 배송 지역(조회 기본 지점 기준, 범위 미확인)"
REG_U = "배송 지역 미확인"
REG_MS = "매장: 호찌민 4·하노이 4·다낭(Vincom)·호이안·하이퐁 / 온라인 배송 범위 미확인"
CH_SUPER, CH_FM, CH_JP = "슈퍼마켓 온라인몰", "식품 전문점 온라인몰", "일본 식품 수입 판매점 온라인몰"
COOP, KING, FARM, SAKU = "Saigon Co.op (Co.op Online)", "Kingfoodmart", "Farmers Market", "Sakuko Store"

LISTINGS = [
    ("CL001", "CP001", "132g", "Con Cưng", "전문점 온라인몰(유아·생활)", REG_CC, "concung", CC + "banh-mochi-dau-tay-132g-70232.html", "132g", None, 132, "VN002", ""),
    ("CL002", "CP001", "132g", FARM, CH_FM, REG_U, "haravan", FM + "banh-mochi-nhan-dau-tay-royal-family-132-g-i0000118", "132g", None, 132, "VN004", "기존 VN004는 브랜드 목록 페이지 링크 → 개별 상품 링크로 교체"),
    ("CL003", "CP001", "120g", FARM, CH_FM, REG_U, "haravan", FM + "banh-mochi-nhan-dau-tay-dai-loan-royal-family-120-g-i0000111", "120g", None, 120, "VN005", "기존 VN005는 브랜드 목록 페이지 링크 → 개별 상품 링크로 교체"),
    ("CL004", "CP001", "132g x2 묶음", "Con Cưng", "전문점 온라인몰(유아·생활)", REG_CC, "concung", CC + "combo-2-banh-mochi-dau-tay-132g-78009.html", "Combo 2 x 132g", None, 264, "VN003", ""),
    ("CL005", "CP002", "132g", "Con Cưng", "전문점 온라인몰(유아·생활)", REG_CC, "concung", CC + "banh-mochi-viet-quat-132g-70233.html", "132g", None, 132, "VN007", "기존 VN007은 브랜드 페이지 링크 → 개별 상품 링크로 교체"),
    ("CL006", "CP002", "132g", FARM, CH_FM, REG_U, "haravan", FM + "banh-mochi-nhan-viet-quat-royal-family-132-g-i0000117", "132g", None, 132, "", ""),
    ("CL007", "CP003", "120g", FARM, CH_FM, REG_U, "haravan", FM + "banh-mochi-nhan-dau-do-dai-loan-royal-family-120-g-i0000107", "120g", 8, 120, "", "판매처 설명에 '1 gói 8 bánh' 표기"),
    ("CL008", "CP003", "120g", KING, CH_SUPER, REG_KF, "kingfood", KF + "banh-truyen-thong-dac-san/banh-mochi-dau-do-royal-family-goi-120g-1", "gói 120g", None, 120, "", ""),
    ("CL009", "CP004", "180g", FARM, CH_FM, REG_U, "haravan", FM + "banh-mochi-nhan-dau-do-kem-royal-family-180-g-i0000115", "Hộp 180g", None, 180, "", ""),
    ("CL010", "CP005", "120g", FARM, CH_FM, REG_U, "haravan", FM + "banh-mochi-nhan-tra-xanh-dai-loan-royal-family-bich-120gr", "120g", None, 120, "", ""),
    ("CL011", "CP005", "152g", FARM, CH_FM, REG_U, "haravan", FM + "banh-mochi-nhan-tra-xanh-royal-family-152-g-i0000218", "152g", None, 152, "", ""),
    ("CL012", "CP005", "152g", KING, CH_SUPER, REG_KF, "kingfood", KF + "banh-truyen-thong-dac-san/banh-mochi-tra-xanh-royal-family-hop-152g-2", "hộp 152g", None, 152, "", ""),
    ("CL013", "CP005", "120g", KING, CH_SUPER, REG_KF, "kingfood", KF + "banh-truyen-thong-dac-san/banh-mochi-tra-xanh-royal-family-goi-120g-2", "gói 120g", None, 120, "", ""),
    ("CL014", "CP006", "120g", FARM, CH_FM, REG_U, "haravan", FM + "banh-mochi-nhan-sua-dai-loan-royal-family-120-g-i0000110", "120g", None, 120, "", ""),
    ("CL015", "CP007", "120g", FARM, CH_FM, REG_U, "haravan", FM + "banh-mochi-nhan-tra-sua-tran-chau-dai-loan-royal-family-120g", "120g", None, 120, "", ""),
    ("CL016", "CP008", "152g", FARM, CH_FM, REG_U, "haravan", FM + "banh-mochi-nhan-dau-phong-royal-family-152-g-i0000119", "Hộp 152g", None, 152, "", "판매처 vendor 칸은 'Nhật Bản', 설명은 대만 수입 — 제조국 미확정"),
    ("CL017", "CP009", "152g", FARM, CH_FM, REG_U, "haravan", FM + "banh-mochi-nhan-khoai-mon-phu-dua-royal-family-152-g-i0000120", "152g", None, 152, "", ""),
    ("CL018", "CP010", "152g", FARM, CH_FM, REG_U, "haravan", FM + "banh-mochi-nhan-me-den-phu-dua-royal-family-1", "152g", None, 152, "", ""),
    ("CL019", "CP011", "250g", FARM, CH_FM, REG_U, "haravan", FM + "banh-mochi-hon-hop-royal-family-250-g-i0000113", "Gói 250g", None, 250, "VN014", "같은 판매처에 같은 상품 페이지가 1건 더 있음(banhmochi1 → 제외 목록 '중복')"),
    ("CL020", "CP011", "250g", KING, CH_SUPER, REG_KF, "kingfood", KF + "banh-truyen-thong-dac-san/banh-mochi-tong-hop-royal-family-goi-250g-2", "gói 250g", None, 250, "", ""),
    ("CL021", "CP012", "230g", FARM, CH_FM, REG_U, "haravan", FM + "banh-mochi-custard-royal-family-tong-hop-230-g", "túi 230g", None, 230, "VN012", "1차 조사 때 품절 → 이번 조회 판매 가능 표시. 설명의 원산지(베트남)·밀가루 피 표기가 다른 Royal Family SKU와 다름"),
    ("CL022", "CP013", "180g", KING, CH_SUPER, REG_KF, "kingfood", KF + "banh-man-banh-ngot/banh-mochi-royal-family-vi-bac-ha-socola-goi-180g", "gói 180g", None, 180, "", ""),
    ("CL023", "CP014", "132g x2", KING, CH_SUPER, REG_KF, "kingfood", KF + "banh-man-banh-ngot/hop-qua-mochi-do-royal-family-132g-x-2-1-hop", "Hộp quà 132g x 2", None, 264, "", ""),
    ("CL024", "CP014", "250g+132g x2", KING, CH_SUPER, REG_KF, "kingfood", KF + "banh-man-banh-ngot/hop-qua-mochi-do-royal-family-250g-132gx2-1-hop", "Hộp quà 250g + 132g x 2", None, 514, "", ""),
    ("CL025", "CP015", "200g", FARM, CH_FM, REG_U, "haravan", FM + "banh-mochi-cam-nhat-daifuku-goi-200g-i0020738", "Gói 200g", None, 200, "", ""),
    ("CL026", "CP016", "200g", FARM, CH_FM, REG_U, "haravan", FM + "banh-mochi-dua-luoi-daifuku-goi-200g-i0020739", "Gói 200g", None, 200, "", ""),
    ("CL027", "CP016", "113g", KING, CH_SUPER, REG_KF, "kingfood", KF + "banh-truyen-thong-dac-san/banh-mochi-vi-dua-luoi-daifuku-goi-113g-1-goi-60114", "gói 113g", None, 113, "", ""),
    ("CL028", "CP017", "200g", FARM, CH_FM, REG_U, "haravan", FM + "banh-mochi-thanh-yen-daifuku-goi-200g-i0020740", "Gói 200g", None, 200, "", ""),
    ("CL029", "CP018", "200g", FARM, CH_FM, REG_U, "haravan", FM + "banh-mochi-vi-chocolate-daifuku-goi-200-g-i0020741", "Gói 200g", None, 200, "", ""),
    ("CL030", "CP019", "200g", FARM, CH_FM, REG_U, "haravan", FM + "banh-mochi-vi-dao-daifuku-200-g", "túi 200g", None, 200, "", ""),
    ("CL031", "CP019", "113g", KING, CH_SUPER, REG_KF, "kingfood", KF + "banh-truyen-thong-dac-san/banh-mochi-vi-dao-daifuku-goi-113g-1-goi-60112", "gói 113g", None, 113, "", ""),
    ("CL032", "CP020", "200g", FARM, CH_FM, REG_U, "haravan", FM + "banh-mochi-vi-matcha-daifuku-200-g", "túi 200g", None, 200, "", ""),
    ("CL033", "CP057", "121g", KING, CH_SUPER, REG_KF, "kingfood", KF + "banh-truyen-thong-dac-san/banh-mochi-vi-dau-tay-daifuku-goi-121g-1-goi-60113", "gói 121g", None, 121, "", ""),
    ("CL034", "CP021", "200g", SAKU, CH_JP, REG_U, "haravan", SK + "sachi-mochi-banh-mochi-vi-dau-tay-200g", "200g", None, 200, "VN038", ""),
    ("CL035", "CP022", "200g", SAKU, CH_JP, REG_U, "haravan", SK + "sachi-mochi-banh-mochi-vi-dao-200g", "200g", None, 200, "VN039", ""),
    ("CL036", "CP023", "200g", SAKU, CH_JP, REG_U, "haravan", SK + "sachi-mochi-banh-mochi-thanh-yen-200g", "200g", None, 200, "VN040", ""),
    ("CL037", "CP024", "200g", SAKU, CH_JP, REG_U, "haravan", SK + "sachi-mochi-ba-nh-mochi-socola-rice-cake-200g", "200g", None, 200, "VN041", ""),
    ("CL038", "CP025", "200g", SAKU, CH_JP, REG_U, "haravan", SK + "sachi-mochi-banh-mochi-daifuku-vi-tra-xanh-200g", "200g", None, 200, "VN042", ""),
    ("CL039", "CP026", "200g", SAKU, CH_JP, REG_U, "haravan", SK + "sachi-mochi-mochi-vi-cam-nhat-200g", "200g", None, 200, "", ""),
    ("CL040", "CP027", "200g", SAKU, CH_JP, REG_U, "haravan", SK + "sachi-mochi-mochi-vi-dua-luoi-200g", "200g", None, 200, "", ""),
    ("CL041", "CP027", "200g", COOP, CH_SUPER, REG_CO, "coop", CO + "banh-mochi-dua-luoi-v-v-200g--s250518987", "200g", None, 200, "",
     "Co.op 표기 브랜드 'V&V'(수입사명). 제조사 주소(2430-1 Kanaenagokuma, Iida, Nagano)·맛·중량이 Sachi Mochi 멜론과 같아 같은 제품으로 연결 — 포장 사진 대조 필요"),
    ("CL042", "CP028", "115g", SAKU, CH_JP, REG_U, "haravan", SK + "sachi-mochi-mochi-vi-soda-chanh-115g", "115g", None, 115, "", ""),
    ("CL043", "CP068", "200g", SAKU, CH_JP, REG_U, "haravan", SK + "sachi-mochi-banh-mochi-hong-bach-200g", "200g", None, 200, "VN043", ""),
    ("CL044", "CP029", "210g", KING, CH_SUPER, REG_KF, "kingfood", KF + "banh-man-banh-ngot/banh-mochi-yuki-love-nhan-khoai-mon-hop-210g", "hộp 210g", None, 210, "", ""),
    ("CL045", "CP030", "210g", KING, CH_SUPER, REG_KF, "kingfood", KF + "banh-man-banh-ngot/banh-mochi-yuki-love-nhan-dau-do-hop-210g", "hộp 210g", None, 210, "", ""),
    ("CL046", "CP071", "300g", KING, CH_SUPER, REG_KF, "kingfood", KF + "banh-truyen-thong-dac-san/banh-mochi-dai-loan-tong-hop-yukiandlove-hop-300g", "hộp 300g", None, 300, "", ""),
    ("CL047", "CP071", "180g 팥", KING, CH_SUPER, REG_KF, "kingfood", KF + "banh-truyen-thong-dac-san/banh-mochi-nhan-dau-do-yukiandlove-goi-180g-1", "gói 180g", None, 180, "", ""),
    ("CL048", "CP071", "180g 토란", KING, CH_SUPER, REG_KF, "kingfood", KF + "banh-truyen-thong-dac-san/banh-mochi-nhan-khoai-mon-yukiandlove-goi-180g-1", "gói 180g", None, 180, "", ""),
    ("CL049", "CP031", "300g", FARM, CH_FM, REG_U, "haravan", FM + "banh-mochi-tong-hop-beautiful-girl-mixed-mochi-300-g-i0013181", "300g", None, 300, "",
     "MM Mega Market sitemap에는 'Yuki Love Beautiful Girl 300g' 주소가 있으나 상품 데이터를 읽지 못해 브랜드 미확정"),
    ("CL050", "CP032", "120g", COOP, CH_SUPER, REG_CO, "coop", CO + "banh-mochi-dau-do-an-gia-120g--s250100553", "120g", None, 120, "VN030", ""),
    ("CL051", "CP059", "210g", COOP, CH_SUPER, REG_CO, "coop", CO + "banh-mochi-tra-sua-tran-chau-210g-f--s250512422", "210g", None, 210, "", ""),
    ("CL052", "CP033", "210g", COOP, CH_SUPER, REG_CO, "coop", CO + "banh-bao-chi-khoai-mon-mochi-hop-210g--s250103398", "hộp 210g", None, 210, "", ""),
    ("CL053", "CP034", "210g", COOP, CH_SUPER, REG_CO, "coop", CO + "banh-bao-chi-tra-xanh-mochi-210g--s250109783", "210g", None, 210, "", ""),
    ("CL054", "CP058", "토란 210g", COOP, CH_SUPER, REG_CO, "coop", CO + "banh-mochi-qidea-vi-khoai-mon-210g-f--s250513422", "khoai môn 210g", None, 210, "", ""),
    ("CL055", "CP058", "땅콩 210g", COOP, CH_SUPER, REG_CO, "coop", CO + "banh-mochi-qidea-vi-dau-phong-210g-f--s250513577", "đậu phộng 210g", None, 210, "", ""),
    ("CL056", "CP058", "흑임자 210g", COOP, CH_SUPER, REG_CO, "coop", CO + "banh-mochi-qidea-me-den-hg-210g-f--s250513633", "mè đen 210g", None, 210, "", ""),
    ("CL057", "CP058", "팥 210g", COOP, CH_SUPER, REG_CO, "coop", CO + "b-mochi-qidea-dau-do-hg-210g--s250609988", "đậu đỏ 210g", None, 210, "", ""),
    ("CL058", "CP058", "녹차 210g", COOP, CH_SUPER, REG_CO, "coop", CO + "b-mochi-qidea-traxanh-hg210g--s250609993", "trà xanh 210g", None, 210, "", ""),
    ("CL059", "CP060", "흑임자 180g", COOP, CH_SUPER, REG_CO, "coop", CO + "f-banh-mochi-me-den-180g--s250623540", "180g", None, 180, "", ""),
    ("CL060", "CP060", "땅콩 180g", COOP, CH_SUPER, REG_CO, "coop", CO + "f-banh-mochi-dau-phong-180g--s250623542", "180g", None, 180, "", ""),
    ("CL061", "CP061", "180g", KING, CH_SUPER, REG_KF, "kingfood", KF + "banh-truyen-thong-dac-san/banh-mochi-dai-loan-nhan-me-den-smile-pine-crane-hop-180g-1-hop-62195", "hộp 180g", None, 180, "", ""),
    ("CL062", "CP035", "120g", KING, CH_SUPER, REG_KF, "kingfood", KF + "banh-man-banh-ngot/banh-mochi-tra-sua-tran-chau-binh-vinh-hop-120g-1-hop", "hộp 120g", None, 120, "", ""),
    ("CL063", "CP062", "115g", KING, CH_SUPER, REG_KF, "kingfood", KF + "banh-truyen-thong-dac-san/banh-mochi-trai-cay-thap-cam-mayumi-goi-115g-1-goi", "gói 115g", None, 115, "", ""),
    ("CL064", "CP036", "87g", FARM, CH_FM, REG_U, "haravan", FM + "banh-mochi-socola-truffle", "Hộp 87g", None, 87, "", ""),
    ("CL065", "CP036", "87g", SAKU, CH_JP, REG_U, "haravan", SK + "bourbon-banh-mochi-vi-socola-truffe-87g", "87g", None, 87, "", ""),
    ("CL066", "CP036", "87g", COOP, CH_SUPER, REG_CO, "coop", CO + "banh-mochi-bourbon-vi-socola-87g-f--s251200809", "87g", None, 87, "", ""),
    ("CL067", "CP037", "94ml", COOP, CH_SUPER, REG_CO, "coop", CO + "kem-yukimi-daifuku-lotte-khay-94ml-f--s250107027", "khay 94ml", None, None, "", ""),
    ("CL068", "CP037", "94ml", KING, CH_SUPER, REG_KF, "kingfood", KF + "kem-hop-kem-banh/kem-yukimi-daifuku-lotte-goi-94ml-1-goi", "hộp 94ml", None, None, "", ""),
    ("CL069", "CP037", "94ml", FARM, CH_FM, REG_U, "haravan", FM + "kem-yukimi-daifuku-lotte-94-ml", "94ml", None, None, "", ""),
    ("CL070", "CP037", "용량 미표기", SAKU, CH_JP, REG_U, "haravan", SK + "kem-vani-daifuku-lotte", "용량 미표기", None, None, "", "상품명에 용량이 없어 94ml와 같은 SKU인지 미확인 → 가격 비교에서 제외"),
    ("CL071", "CP038", "270ml", KING, CH_SUPER, REG_KF, "kingfood", KF + "kem-hop-kem-banh/kem-yukimi-daifuku-mini-lotte-goi-270ml-1-goi", "hộp 270ml", None, None, "", ""),
    ("CL072", "CP038", "270ml", FARM, CH_FM, REG_U, "haravan", FM + "kem-mini-yukimi-daifuku-lotte-270-ml", "270ml", None, None, "", ""),
    ("CL073", "CP039", "270ml", COOP, CH_SUPER, REG_CO, "coop", CO + "kem-yukimi-daifuku-matcha-270ml-f--s250107504", "270ml", None, None, "", ""),
    ("CL074", "CP039", "270ml", KING, CH_SUPER, REG_KF, "kingfood", KF + "kem-hop-kem-banh/kem-yukimi-daifuku-tra-xanh-lotte-hop-270ml-1-hop-58254", "hộp 270ml", None, None, "", ""),
    ("CL075", "CP039", "270ml", FARM, CH_FM, REG_U, "haravan", FM + "kem-yukimi-daifuku-vi-matcha-lotte-270-ml", "270ml", None, None, "", ""),
    ("CL076", "CP040", "270ml", FARM, CH_FM, REG_U, "haravan", FM + "kem-yukimi-daifuku-vi-socola-lotte-270-ml", "270ml", None, None, "", ""),
    ("CL077", "CP040", "270ml", KING, CH_SUPER, REG_KF, "kingfood", KF + "kem-hop-kem-banh/kem-yukimi-daifuku-socola-lotte-goi-270ml-1-goi", "hộp 270ml", None, None, "", ""),
    ("CL078", "CP041", "45ml", KING, CH_SUPER, REG_KF, "kingfood", KF + "kem-hop-kem-banh/kem-mochi-socola-aice-45ml-1-cai", "1 cái 45ml", 1, None, "", "같은 판매처에 같은 상품 페이지가 1건 더 있음(-71571 → 제외 목록 '중복')"),
    ("CL079", "CP042", "45ml", KING, CH_SUPER, REG_KF, "kingfood", KF + "kem-hop-kem-banh/kem-mochi-vani-aice-45ml-1-cai", "1 cái 45ml", 1, None, "", "같은 판매처에 같은 상품 페이지가 1건 더 있음(-71561 → 제외 목록 '중복')"),
    ("CL080", "CP043", "45ml", KING, CH_SUPER, REG_KF, "kingfood", KF + "kem-hop-kem-banh/joyday-kem-mochi-dau-45ml-70952", "gói 45ml", 1, None, "", ""),
    ("CL081", "CP044", "45ml", KING, CH_SUPER, REG_KF, "kingfood", KF + "kem-hop-kem-banh/joyday-kem-mochi-socola-45ml-70949", "gói 45ml", 1, None, "", ""),
    ("CL082", "CP045", "85g", KING, CH_SUPER, REG_KF, "kingfood", KF + "banh-lanh/mochi-vi-matcha-cham-xot-kem-tuoi-minh-nhat-hop-85g-1-hop", "hộp 85g", None, 85, "", ""),
    ("CL083", "CP046", "85g", KING, CH_SUPER, REG_KF, "kingfood", KF + "banh-lanh/mochi-vi-truyen-thong-cham-xot-kem-tuoi-minh-nhat-hop-85g-1-hop", "hộp 85g", None, 85, "", ""),
    ("CL084", "CP063", "50g", KING, CH_SUPER, REG_KF, "kingfood", KF + "banh-lanh/mochi-minh-nhat-nama-socola-hop-50g", "hộp 50g", None, 50, "", ""),
    ("CL085", "CP047", "10개", SAKU, CH_JP, REG_U, "haravan", SK + "penguin-banh-mochi-matcha-dau-do-10-cai", "10 cái", 10, None, "", ""),
    ("CL086", "CP048", "24개", SAKU, CH_JP, REG_U, "haravan", SK + "s-trust-banh-mochi-fukufuku-maru-3-vi-24-chiec-1", "24 chiếc", 24, None, "VN047", "기존 VN047은 추석 예약 기획전 페이지(250,000₫) 기준 → 개별 상품 페이지로 교체"),
    ("CL087", "CP064", "20개", SAKU, CH_JP, REG_U, "haravan", SK + "s-trust-banh-mochi-shofuku-20-chiec", "20 chiếc", 20, None, "", ""),
    ("CL088", "CP065", "30개", SAKU, CH_JP, REG_U, "haravan", SK + "fujiseika-banh-mochi-nhieu-vi-30-chiec", "30 chiếc", 30, None, "VN044", "상품 단위 available=false, 옵션 단위 available=true로 표시가 서로 다름"),
    ("CL089", "CP065", "26개", SAKU, CH_JP, REG_U, "haravan", SK + "koeido-banh-mochi-nhieu-vi-26-chiec", "26 chiếc", 26, None, "VN045", "상품 단위 available=false, 옵션 단위 available=true로 표시가 서로 다름"),
    ("CL090", "CP066", "30개", SAKU, CH_JP, REG_U, "haravan", SK + "seiki-banh-mochi-daifuku-vi-dua-luoi-30-cai", "30 cái", 30, None, "VN046", ""),
    ("CL091", "CP067", "413g", SAKU, CH_JP, REG_U, "haravan", SK + "irodori-banh-mochi-5-vi-413g", "413g", None, 413, "VN050", ""),
    ("CL092", "CP049", "10개", SAKU, CH_JP, REG_U, "haravan", SK + "bvsg-banh-mochi-hong-phuc-vi-pho-mai-dao-10-chiec", "10 chiếc", 10, None, "VN037", "1차 조사의 140g 표기는 이번 페이지에서 확인되지 않음"),
    ("CL093", "CP050", "4개", SAKU, CH_JP, REG_U, "haravan", SK + "bvsg-banh-mochi-tra-sua-tran-chau-4-chiec", "4 chiếc", 4, None, "VN036", "1차 조사의 120g 표기는 이번 페이지에서 확인되지 않음"),
    ("CL094", "CP051", "낱개", "Mochi Sweets (공식몰)", "브랜드 공식 온라인몰", REG_MS, "mochisweets", MS + "banh-mochi-le/", "bánh lẻ(맛 선택)", 1, None, "", ""),
    ("CL095", "CP051", "3개입", "Mochi Sweets (공식몰)", "브랜드 공식 온라인몰", REG_MS, "mochisweets", MS + "hop-banh-truyen-thong-3-banh-3/", "Hộp 3 bánh", 3, None, "", ""),
    ("CL096", "CP051", "6개입", "Mochi Sweets (공식몰)", "브랜드 공식 온라인몰", REG_MS, "mochisweets", MS + "hop-banh-truyen-thong-6-banh/", "Hộp 6 bánh: Original", 6, None, "", ""),
    ("CL097", "CP051", "9개입", "Mochi Sweets (공식몰)", "브랜드 공식 온라인몰", REG_MS, "mochisweets", MS + "hop-9-tinh-khoi-kiyomi/", "Hộp 9 bánh: Original", 9, None, "", ""),
    ("CL098", "CP051", "12개입", "Mochi Sweets (공식몰)", "브랜드 공식 온라인몰", REG_MS, "mochisweets", MS + "hop-banh-truyen-thong-12-banh-2/", "Hộp 12 bánh: Original", 12, None, "", ""),
    ("CL099", "CP051", "18개입 Luxury", "Mochi Sweets (공식몰)", "브랜드 공식 온라인몰", REG_MS, "mochisweets", MS + "hop-qua-tang-sang-trong-18-luxury-box/", "Hộp 18 bánh: Luxury", 18, None, "", ""),
    ("CL100", "CP070", "3개입", "Mochi Sweets (공식몰)", "브랜드 공식 온라인몰", REG_MS, "mochisweets", MS + "hop-mochi-yen-sao-tinh-the-vang-3-banh/", "Hộp 3 bánh", 3, None, "", ""),
    ("CL101", "CP052", "기본", "Anh Hòa Bakery (공식몰)", "베이커리 공식 온라인몰", REG_U, "haravan", "https://anhhoabakery.vn/products/banh-mochi", "Default", None, None, "VN052", "페이지에 맛·중량·입수 표기 없음"),
    ("CL102", "CP055", "6개 x 65g", COOP, CH_SUPER, REG_CO, "coop", CO + "banh-com-bao-minh-hop-6-cai-x-65g--s250100981", "hộp 6 cái x 65g", 6, 390, "", ""),
    ("CL103", "CP055", "65g", COOP, CH_SUPER, REG_CO, "coop", CO + "banh-com-bao-minh-hop-65g--s250100983", "hộp 65g", 1, 65, "", ""),
    ("CL104", "CP055", "종이상자 85g", COOP, CH_SUPER, REG_CO, "coop", CO + "banh-com-bao-minh-hop-giay-85g--s250512396", "hộp giấy 85g", None, 85, "", ""),
    ("CL105", "CP055", "390g", KING, CH_SUPER, REG_KF, "kingfood", KF + "banh-nhan-ngot/banh-com-bao-minh-hop-390g-1-hop", "hộp 390g", None, 390, "", "Co.op '6 cái x 65g'(390g)와 같은 구성으로 보이나 이 페이지에는 입수 표기 없음"),
    ("CL106", "CP055", "75g", KING, CH_SUPER, REG_KF, "kingfood", KF + "banh-truyen-thong-dac-san/banh-com-dau-xanh-bao-minh-goi-75g-1-goi-67231", "gói 75g", None, 75, "", ""),
    ("CL107", "CP056", "75g", COOP, CH_SUPER, REG_CO, "coop", CO + "banh-com-dau-xanh-sau-rieng-bao-minh-75g--s250100978", "75g", None, 75, "", ""),
    ("CL108", "CP056", "75g", KING, CH_SUPER, REG_KF, "kingfood", KF + "banh-truyen-thong-dac-san/banh-com-sau-rieng-bao-minh-goi-75g-1-goi-67232", "gói 75g", None, 75, "", ""),
    ("CL109", "CP072", "180g", COOP, CH_SUPER, REG_CO, "coop", CO + "banh-deo-kinh-do-93-dau-xanh-1-trung-180g--s250807991", "180g", None, 180, "", ""),
    ("CL110", "CP072", "230g", COOP, CH_SUPER, REG_CO, "coop", CO + "banh-deo-kinh-do-83-dau-xanh-hat-dua-1-trung-230g--s250807984", "230g", None, 230, "", ""),
    ("CL111", "CP072", "180g 무달걀", COOP, CH_SUPER, REG_CO, "coop", CO + "banh-deo-kinh-do-96-dau-xanh-0-trung-181g--s250807988", "180g", None, 180, "", ""),
    ("CL112", "CP073", "200g", COOP, CH_SUPER, REG_CO, "coop", CO + "banh-troi-nuoc-spring-home-nhan-dau-do-200g--s250105653", "200g", None, 200, "", ""),
]
for _i, (_h, _name) in enumerate([
        ("banh-mochi-daifuku-750g-GYF078", "Daifuku 750g"), ("banh-mochi-socola-daifuku-750g-GYF090", "Socola Daifuku 750g"),
        ("banh-mochi-dau-xanh-750g-GYF089", "Đậu xanh 750g"), ("banh-mochi-nhan-vung-750g-GYF091", "Nhân vừng 750g"),
        ("banh-mochi-nhan-sot-mitarashi-750g-GYF079", "Nhân sốt Mitarashi 750g"), ("banh-dango-shiratama-750g-GYF080", "Dango Shiratama 750g")]):
    LISTINGS.append((f"CL{113 + _i}", "CP069", _name, "Kamereo", "B2B 식자재 온라인몰", REG_U, "kamereo", KM + _h, _name, None, 750, "", "업소용(B2B) 판매 페이지"))

# TikTok Shop: product_id, TikTok 상품 ID, 기존 ID
TIKTOK = [("CP053", "1729751070290970681", "MP029"), ("CP054", "1731699885297861854", "MP035")]
# 기존 2차 TikTok 행 재확인용 (판매 확인 시에도 기존 제품과 연결 근거가 부족해 확인 목록에만 기록)
TIKTOK_LEGACY = {"MP028": "1729451592247773413", "MP030": "1731407119671855720", "MP031": "1730524928614304313", "MP036": "1729793533970385357"}

IMAGE_FLAGS = {
    FM + "banh-mochi-vi-chocolate-daifuku-goi-200-g-i0020741": "불일치 의심: 이미지 파일명이 다른 상품(nho_ngon_tay_hello_uc, 포도)",
    FM + "banh-mochi-thanh-yen-daifuku-goi-200g-i0020740": "불일치 의심: 이미지 파일명이 멜론 상품(banh_mochi_dua_luoi_daifuku)",
    FM + "banh-mochi-hon-hop-royal-family-250-g-i0000113": "확인 필요: 이미지 파일명에 'marshmallow' 포함",
    SK + "sachi-mochi-mochi-vi-dua-luoi-200g": "불일치 의심: 이미지 파일명이 딸기(dau_tay__2__)",
    MS + "banh-mochi-le/": "확인 필요: 대표 이미지 파일명 'Kem-Nho-Den'(흑포도)이 현재 맛 목록에 없음",
}

STATUS_KO = {
    "confirmed": "판매 확인", "unavailable": "품절·판매 불가 표시", "out_of_stock": "품절",
    "stock_zero": "재고 0 표시(판매 여부 확인 필요)", "discontinued": "판매 중단",
    "removed": "판매 중단(상품 삭제)", "access_error": "접속·데이터 조회 실패",
}

# 기존 1·2차 행 중 위 판매처 후보로 다시 확인하지 않은 행의 처리
LEGACY_REVIEW = {
    **{k: ("판매 여부 확인 필요", "AEON eShop 접근 차단(HTTP 403, curl·WebFetch 모두). 우회하지 않음")
       for k in ["VN001", "VN008", "VN015", "VN017", "VN021", "VN033", "VN034", "VN035"]},
    **{k: ("직접 링크 없음", "AEON eShop 검색 결과 페이지 링크 + 접근 차단(HTTP 403)")
       for k in ["VN006", "VN009", "VN010", "VN011", "VN013", "VN016", "VN018", "VN019", "VN020", "VN022", "VN023",
                 "VN024", "VN025", "VN026", "VN027", "VN028", "VN029", "VN031", "VN032"]},
    **{k: ("직접 링크 없음", "Sakuko 추석 예약 기획전 페이지만 있음(개별 상품 링크 없음, 상품은 JavaScript로 표시)")
       for k in ["VN048", "VN049", "VN051"]},
    "VN053": ("판매 여부 확인 필요", "Baoz Dimsum 2025-12-19 게시 성탄 시즌 한정 소개글. 현재 메뉴·주문 경로 미확인"),
    "VN054": ("판매 여부 확인 필요", "beFood 매장 메뉴(12,000₫)로 표시되나 브랜드·제품 특정 불가, 주문은 앱 필요"),
    "VN055": ("판매 여부 확인 필요", "beFood 매장 메뉴(12,000₫)로 표시되나 브랜드·제품 특정 불가, 주문은 앱 필요"),
    **{k: ("접근 제한", "Shopee 상품 페이지가 JavaScript로만 표시되어 가격·재고를 읽지 못함(로그인·캡차 우회 안 함)")
       for k in ["MP001", "MP002", "MP003", "MP004", "MP005", "MP006", "MP007", "MP008", "MP009", "MP010", "MP011"]},
    **{k: ("직접 링크 없음", "Shopee 검색 결과 페이지 링크 + 상품 데이터 미노출")
       for k in ["MP012", "MP013", "MP014", "MP015"]},
    **{k: ("직접 링크 없음", "Lazada 태그 페이지 링크 + 캡차 페이지 반환(우회 안 함)")
       for k in ["MP016", "MP017", "MP018", "MP019", "MP020", "MP021", "MP022", "MP023", "MP024"]},
    **{k: ("판매 여부 확인 필요", "vinmart.co는 공식 WinMart(winmart.vn) 도메인이 아니며 SSL 접속 실패")
       for k in ["MP025", "MP026", "MP027"]},
}
LEGACY_EXCLUDE = {
    "VN056": ("판매 페이지 아님", "metric.vn 전자상거래 분석 보고서 페이지 — 판매처·상품 특정 불가"),
    "VN057": ("판매 페이지 아님", "metric.vn 전자상거래 분석 보고서 페이지 — 판매처·상품 특정 불가"),
    "VN058": ("판매 페이지 아님", "metric.vn 전자상거래 분석 보고서 페이지 — 판매처·상품 특정 불가"),
    "VN059": ("판매 페이지 아님", "metric.vn 전자상거래 분석 보고서 페이지 — 판매처·상품 특정 불가"),
    "MP032": ("잘못 연결", "같은 TikTok 링크가 현재 Meiji 초콜릿(Kinoko no Yama) 상품을 표시 — 모찌 아님"),
    "MP033": ("범위 밖", "Hershey's 모찌 쿠키(밀가루 쿠키)이며 현재 페이지에 상품 데이터 없음"),
    "MP034": ("잘못 연결", "같은 TikTok 링크가 현재 '과일 젤리 800g' 상품을 표시 — 모찌 아님"),
}

# 이번 조사에서 판매처를 특정했지만 상품 데이터를 읽지 못했거나 접근이 막힌 후보
LEADS = [
    ("판매 여부 확인 필요", "", "Sachi Mochi", "Sachi Mochi socola 200g", "MM Mega Market", "https://online.mmvietnam.com/product/sachi-mochi-socola-200g-487103-24871037.html", "공개 sitemap에 주소는 있으나 상품 페이지가 JavaScript로만 표시되어 가격·재고 미확인", "브라우저로 가격·재고 확인"),
    ("판매 여부 확인 필요", "", "Sachi Mochi", "Sachi Mochi matcha 200g", "MM Mega Market", "https://online.mmvietnam.com/product/sachi-mochi-matcha-200g-487105-24871051.html", "위와 같음", "브라우저로 가격·재고 확인"),
    ("판매 여부 확인 필요", "", "Yuki & Love", "Bánh mochi Yuki Love mixed 450g", "MM Mega Market", "https://online.mmvietnam.com/product/banh-mochi-yuki-love-mixed-450g.html", "위와 같음", "브라우저로 가격·재고 확인"),
    ("판매 여부 확인 필요", "", "Yuki & Love", "Bánh mochi Yuki Love Beautiful Girl 300g", "MM Mega Market", "https://online.mmvietnam.com/product/banh-mochi-yuku-love-beautifull-girl-300g.html", "위와 같음. Farmers Market 'Beautiful Girl Mixed Mochi 300g'(CP031)과 같은 제품인지 확인 필요", "포장 사진 대조"),
    ("판매 여부 확인 필요", "", "Yuki & Love", "Bánh mochi Yuki Love Nhật 300g", "MM Mega Market", "https://online.mmvietnam.com/product/banh-mochi-yuki-love-nhat-300g.html", "위와 같음", "브라우저로 가격·재고 확인"),
    ("판매 여부 확인 필요", "", "Royal Family(추정 아님·표기 없음)", "Bánh mochi kem trà xanh đậu đỏ 180g / sữa dâu tây đậu đỏ 120g / trà xanh đậu phộng mè đen 152g", "MM Mega Market", "https://online.mmvietnam.com/category/mochi.html", "카테고리·상품 주소만 확인, 데이터 미노출", "브라우저로 브랜드·가격 확인"),
    ("판매 여부 확인 필요", "", "Lotte Yukimi Daifuku", "Yukimi 딸기·망고·카라멜 270ml", "MM Mega Market", "https://online.mmvietnam.com/product/lotte-yukimi-s-berry-icr-270ml-476379-24763790.html", "베트남 미확인 맛 SKU 존재 가능(딸기·망고·카라멜) — 데이터 미노출", "가격·재고 확인"),
    ("판매 여부 확인 필요", "", "Minamoto Kitchoan", "화과자(다이후쿠 등) 매장", "Kitchoan Takashimaya HCMC", "https://www.kitchoan.com/location/vietnam-ho-chi-minh-citystore/", "브랜드 공식 매장 안내(2019년 표기)만 있고 베트남 온라인 주문·가격 없음", "매장 운영·메뉴 현장 확인"),
    ("접근 제한", "", "Kim Thành", "Bánh Mochi Dâu Tây Kim Thành đặc biệt", "Quà Quê Hương (다낭)", "https://quaquehuong.vn/san-pham/banh-mochi-dau-tay-kim-thanh-dac-biet/", "보안 확인(OneShield) 화면이 떠서 상품 내용 미확인 — 우회 안 함. 검색 요약상 다낭 시내 배송", "브라우저로 가격·제품 확인(다낭 우선)"),
    ("판매 여부 확인 필요", "", "Bánh Mây Souffle", "모찌 크림(냉장) 등", "Bánh Mây Souffle (다낭 702 Trần Cao Vân)", "https://www.facebook.com/p/B%C3%A1nh-M%C3%A2y-souffle-702-Tr%E1%BA%A7n-Cao-V%C3%A2n-%C4%90%C3%A0-N%E1%BA%B5ng-61573514412492/", "검색 요약에만 나타남. Facebook 페이지 본문 미확인(로그인 필요 가능)", "다낭 현장·SNS 확인"),
    ("접근 제한", "", "Hương Đà", "Bánh mochi rong biển", "Đặc sản Hương Đà (다낭)", "https://store.dacsanhuongda.vn/banh-mochi-rong-bien/", "도메인 접속 실패(DNS). 해초 모찌 — 단맛 디저트인지 확인 필요", "재접속·제품 형태 확인"),
    ("판매 여부 확인 필요", "CP051", "Mochi Sweets", "Nama Mochi · Mochelato · Trung Thu 카테고리", "Mochi Sweets (공식몰)", "https://shop.mochisweets.com.vn/products/", "메뉴에 카테고리 이름은 있으나 상품이 표시되지 않음", "매장·SNS에서 생모찌·모찌 젤라또 판매 여부 확인"),
]

EXCLUSIONS = [
    ("비식품", "Mochi's soft pillow 50x70 810g", "MM Mega Market", "https://online.mmvietnam.com/product/mochi-s-soft-pillow-50-70-810g-487038-24870382.html", "이름에 mochi가 들어간 베개", ""),
    ("비식품", "Ruột gối nằm CSTN Kimochi 30x50", "Saigon Co.op", "https://cooponline.vn/ruot-goi-nam-cstn-kimochi-30x50--s250518514", "베개 속통", ""),
    ("비식품", "STELLA BEAUTE – Thanh massage chăm sóc da mặt", "Sakuko Store", "https://sakukostore.com.vn/products/stella-beaute-thanh-massage-cham-soc-da-mat", "'mochi' 검색 결과에 섞인 미용 기구", ""),
    ("원재료", "Bột bánh mochi mix Asahi 400g", "MM Mega Market", "https://online.mmvietnam.com/product/bot-banh-mochi-mix-asahi-400g.html", "모찌 만들기 가루(완제품 아님)", ""),
    ("원재료", "Maehara Seifun dried mochi 1kg / Original flavour mochi 1kg", "Kamereo", "https://kamereo.vn/products/banh-mochi-kho-1kg-GYN063", "조리용 건조·기본 떡(완제품 디저트 아님)", ""),
    ("원재료", "KIRIMOCHI – Bánh gạo 400g", "Sakuko Store", "https://sakukostore.com.vn/products/kirimochi-banh-gao-400g", "구이·조리용 키리모찌", ""),
    ("범위 밖(식사용)", "Bánh gạo Hàn Quốc DNA 500g", "Saigon Co.op", "https://cooponline.vn/banh-gao-han-quoc-dna-500g--s250616564", "떡볶이용 떡(조리 안내: 튀기거나 떡볶이 소스)", ""),
    ("범위 밖(식사용)", "Bánh hotteok (CJ·Pulmuone·Kitkool·Co.op Select) 등 6건", "Saigon Co.op", "https://cooponline.vn/banh-hotteok-pho-mai-mozzarella-cj-280g--s250102744", "밀가루 호떡·피자·소시지 맛 냉동 간식", ""),
    ("범위 밖(밀가루 과자·빵)", "Bánh cá Bống Bang mochi socola đậu đỏ 5x29g (Orion)", "Saigon Co.op", "https://cooponline.vn/banh-ca-bong-bang-mochi-socola-dau-do-145g--s250109367", "밀가루·달걀 붕어빵 과자(모찌 일부 사용)", ""),
    ("범위 밖(밀가루 과자·빵)", "Bánh C'est Bon phủ mochi cốm dừa 137.5g", "Saigon Co.op / Kingfoodmart", "https://cooponline.vn/banh-c-est-bon-phu-mochi-com-dua-137-5g--s260405755", "카스텔라류 빵에 모찌 토핑", ""),
    ("범위 밖(밀가루 과자·빵)", "Paris Baguette: Red bean mochi matcha bread / cream pastry / Cream cheese mochi ball / Fried mochi stick", "Paris Baguette Vietnam", "https://parisbaguette.com.vn/product/cream-cheese-mochi-ball-2-pcs/", "빵·페이스트리(가격 미표기). 한국 베이커리의 모찌 활용 사례로만 참고", ""),
    ("범위 밖(식감 다름)", "Bánh cốm sữa Xuân Thanh 200g", "Saigon Co.op", "https://cooponline.vn/banh-com-sua-xuan-thanh-200g--s250105194", "튀긴 찹쌀(nếp nổ) 바삭한 과자 — 쫀득한 식감 아님", ""),
    ("범위 밖(과자·사탕)", "Socola vị đậu nành mochi Tirol 35g/77g", "Kingfoodmart", "https://kingfoodmart.com/socola/socola-vi-dau-nanh-mochi-tirol-goi-35g-1-goi-62232", "초콜릿 사탕", ""),
    ("범위 밖(과자·사탕)", "쌀 과자·센베이(Want Want·Kameda·Iwatsuka·Happy Turn·Beanstalk 등)", "Farmers Market / Sakuko Store", "https://farmersmarket.vn/search?q=banh+gao", "'bánh gạo' 검색 결과의 바삭한 쌀과자", ""),
    ("범위 밖(젤리)", "Thạch mochi cafe cốc", "MM Mega Market", "https://online.mmvietnam.com/product/thach-mochi-cafe-coc-thd-xa-480152-24801522.html", "컵 젤리", ""),
    ("레시피·콘텐츠", "Kingfoodmart 레시피 글(banh mochi·banh deo·banh day 등 약 100건)", "Kingfoodmart", "https://kingfoodmart.com/bai-viet/tags/banh-mochi", "만드는 법 콘텐츠(구매 상품 아님)", ""),
    ("중복", "Bánh mochi hỗn hợp Royal Family (250G) — banhmochi1", "Farmers Market", "https://farmersmarket.vn/products/banhmochi1", "같은 판매처의 같은 상품 페이지 중복(CL019 유지)", ""),
    ("중복", "Kem Mochi socola Aice 45ml (-71571)", "Kingfoodmart", "https://kingfoodmart.com/kem-hop-kem-banh/kem-mochi-socola-aice-45ml-1-cai-71571", "같은 판매처의 같은 상품 페이지 중복(CL078 유지)", ""),
    ("중복", "Kem Mochi vani Aice 45ml (-71561)", "Kingfoodmart", "https://kingfoodmart.com/kem-hop-kem-banh/kem-mochi-vani-aice-45ml-1-cai-71561", "같은 판매처의 같은 상품 페이지 중복(CL079 유지)", ""),
]

# 판매 페이지에서 직접 읽은 마케팅 문구. 관찰/해석/미확인을 나눠 적는다.
MARKETING = [
    ("CP051", "Mochi Sweets", "Mochi Sweets (공식몰)", "선물 포장 이야기",
     "3·6·12개입 상자 설명: 'Đối với người Nhật, cây Ngân Hạnh là loài cây mang ý nghĩa phồn thịnh…' — 상자의 은행나무 그림에 번영·평안의 의미를 붙임",
     "상자 디자인 자체를 선물 메시지로 쓰는 방식", "상자별 판매 비중", MS + "hop-banh-truyen-thong-6-banh/", ""),
    ("CP051", "Mochi Sweets", "Mochi Sweets (공식몰)", "선물·고가 구성",
     "18개입 Luxury(690,000₫): 등나무·모란 그림, 'Đây sẽ là món quà hoàn hảo thay bạn gửi gắm tình yêu và niềm hy vọng'",
     "대량 선물 수요를 겨냥한 최상위 상자", "실제 구매자 유형", MS + "hop-qua-tang-sang-trong-18-luxury-box/", ""),
    ("CP070", "Mochi Sweets", "Mochi Sweets (공식몰)", "프리미엄 원재료",
     "제비집·식용 24k 금 모찌 3개입(145,000₫): '…món quà SỨC KHOẺ…' — 현재 'Hết hàng'",
     "건강·고급 선물 이미지를 원재료로 강조", "판매 재개 여부", MS + "hop-mochi-yen-sao-tinh-the-vang-3-banh/", ""),
    ("CP051", "Mochi Sweets", "Mochi Sweets (공식몰)", "배송·보냉",
     "모든 상자에 보냉백 추가 옵션(6개입 3,000₫, 9·12개입 5,000₫, 18개입 10,000₫), 주문 전화 1800 7274(08:00–20:30)",
     "냉장 유통 상품의 배송 품질을 옵션으로 해결", "보냉백 없이 배송 가능 시간·지역", MS + "banh-mochi-le/", ""),
    ("CP051", "Mochi Sweets", "Mochi Sweets (공식몰)", "매장망",
     "매장 목록: 호찌민 4곳, 하노이 4곳, 다낭 Vincom(4층), 호이안 구시가(2/2 Lê Lợi), 하이퐁 AEON Mall",
     "다낭·호이안 관광 동선에 이미 매장이 있음 — 한정선 다낭 진출 시 직접 비교 대상", "매장별 매출·방문객", "https://shop.mochisweets.com.vn/stores/", ""),
    ("CP051", "Mochi Sweets", "Mochi Sweets (공식몰)", "브랜드 이야기",
     "소개 페이지: '…12 cửa hàng… 353 cửa hàng tại 6 nước Châu Á' — 일본 기원·아시아 확장을 주장",
     "일본 정통성을 신뢰 근거로 사용", "353개 매장 주장의 사실 여부·기준 시점", "https://shop.mochisweets.com.vn/gioi-thieu/", ""),
    ("CP051", "Mochi Sweets", "Mochi Sweets", "공식 SNS",
     "공식몰에 Facebook(MochiSweetsVN)·Instagram(mochisweetsvn)·YouTube 채널 링크 게시",
     "SNS 채널 운영", "게시 빈도·캠페인 내용(본문 미확인)", "https://www.facebook.com/MochiSweetsVN", ""),
    ("", "여러 일본 브랜드", "Sakuko Store", "시즌 예약 할인",
     "'[PREORDER] TRUNG THU VIỆT – CHỌN VỊ NHẬT' 기획전: 5상자 이상 15%, 10상자 25%, 20상자 30%, 50상자 40% 할인 예약",
     "추석에 모찌를 월병 대체 선물로 제안하고 기업·단체 대량 주문을 노림", "기획전 기간·실제 할인 적용 실적", "https://sakukostore.com.vn/pages/trung-thu-viet-chon-vi-nhat-ban", "게시일 미표시(2026 추석 전후로 판단 근거 없음)"),
    ("CP065", "Tsujisei", "Sakuko Store", "설·선물",
     "30개입 설명: '…món quà sum vầy ý nghĩa, mang lại may mắn cho dịp năm mới', 기업·개인 선물 대상 명시",
     "뗏(설) 선물 시즌 겨냥", "판매 재개 여부(현재 상품 단위 판매 불가 표시)", SK + "fujiseika-banh-mochi-nhieu-vi-30-chiec", ""),
    ("CP048", "Penguin (S-Trust)", "Sakuko Store", "선물·대상",
     "24개입 설명: 'Dành cho người lớn và trẻ em từ 6 tuổi trở lên, phù hợp làm quà tặng hoặc ăn nhẹ hàng ngày'",
     "선물과 일상 간식을 함께 제안", "", SK + "s-trust-banh-mochi-fukufuku-maru-3-vi-24-chiec-1", ""),
    ("CP001", "Royal Family", "Con Cưng", "판매 채널·대상",
     "상품 설명 'Có tại 1215 siêu thị Con Cưng trên toàn quốc. Mua Online giao nhanh tận nhà', 대상 연령 'Trẻ em, người lớn', 분류 'Bánh và kẹo cho bé'",
     "유아·가족 매장 채널에서 아이 간식으로 판매", "매장별 실제 진열 여부", CC + "banh-mochi-dau-tay-132g-70232.html", ""),
    ("CP001", "Royal Family", "Con Cưng", "평점·판매수 표시",
     "페이지 표시: 평점 5.0(리뷰 13건), '5K+ đã bán' — 판매처 표시값 그대로 기록",
     "", "표시값의 집계 기간·기준(매출로 해석하지 않음)", CC + "banh-mochi-dau-tay-132g-70232.html", ""),
    ("CP001", "Royal Family", "Con Cưng", "묶음 구성 종료",
     "2개 묶음(132g x2) 페이지에 'NGỪNG KINH DOANH' 표시, 표시 가격 124,000₫(1차 조사 93,000₫)",
     "묶음 할인 판매를 중단한 것으로 보임", "중단 사유", CC + "combo-2-banh-mochi-dau-tay-132g-78009.html", ""),
    ("CP014", "Royal Family", "Kingfoodmart", "선물세트",
     "'Hộp quà Mochi đỏ' 132g x2(86,000₫) · 250g+132g x2(216,000₫) 빨간 선물상자 판매",
     "빨간색(행운) 포장으로 명절 선물 수요를 노린 구성", "구성 맛·시즌 한정 여부", KF + "banh-man-banh-ngot/hop-qua-mochi-do-royal-family-132g-x-2-1-hop", ""),
    ("CP005", "Royal Family", "Farmers Market", "선물 포장",
     "152g 설명: 'Bánh được đóng gói đẹp mắt, sang trọng, phù hợp để làm quà tặng cho bạn bè và người thân'",
     "포장 모찌도 선물용으로 제안", "", FM + "banh-mochi-nhan-tra-xanh-royal-family-152-g-i0000218", ""),
    ("CP038", "Lotte Yukimi Daifuku", "Farmers Market", "유행 문구",
     "판매처 설명: '\"Cơn Sốt\" Kem Mochi Mini Yukimi Daifuku… nếu bạn chưa \"đu trend\"…' (판매처 SEO 문구)",
     "여름·트렌드형 디저트로 소개", "브랜드 공식 메시지 여부(판매처 작성 문구)", FM + "kem-mini-yukimi-daifuku-lotte-270-ml", ""),
    ("CP037", "Lotte Yukimi Daifuku", "Sakuko Store", "할인",
     "정상가 44,000₫ → 40,480₫ 표시(8% 할인)", "", "할인 기간", SK + "kem-vani-daifuku-lotte", ""),
    ("CP033", "브랜드 미표기(대만)", "Saigon Co.op", "할인",
     "바오즈 모찌 210g 정상가 76,300₫ → 69,000₫ 표시", "", "할인 기간·조건", CO + "banh-bao-chi-khoai-mon-mochi-hop-210g--s250103398", ""),
    ("CP045", "Minh Nhật", "Kingfoodmart", "제품 형태",
     "'Mochi chấm xốt kem tươi'(생크림 소스에 찍어 먹는 모찌) 85g 23,000₫, 냉장 2~5°C 보관 안내, 유통기한 7일",
     "SNS에서 유행한 '찍어 먹는 모찌'를 냉장 소포장 제품으로 판매", "실제 SNS 유행 규모", KF + "banh-lanh/mochi-vi-matcha-cham-xot-kem-tuoi-minh-nhat-hop-85g-1-hop", ""),
    ("CP054", "MCLUNE", "Bông Bi ăn vặt (TikTok Shop)", "대용량·다양한 맛",
     "1kg·500g 옵션, 7가지 맛(아보카도·두리안·복숭아·코코넛·토란·초콜릿·블루베리)과 '믹스' 동일가, 정상가 대비 할인가 표시",
     "가성비 대용량 간식 포지션", "표시 누적판매의 기준(매출로 해석하지 않음)", "https://shop-vn.tiktok.com/pdp/1731699885297861854", ""),
    ("", "Baoz Dimsum", "Baoz Dimsum", "시즌 한정",
     "'BÁNH MOCHI NGƯỜI TUYẾT – Tuyệt phẩm đáng yêu dành cho mùa Đông': 성탄 시즌 눈사람 모양 딸기 모찌 'phiên bản độc quyền'",
     "시즌 한정·귀여운 모양으로 화제성 확보", "현재 판매 여부(2025년 시즌 게시물)", "https://baozdimsum.com/banh-mochi-nguoi-tuyet-tuyet-pham-dang-yeu-danh-cho-mua-dong/", "2025-12-19"),
    ("CP069", "Kamereo", "Kamereo", "업소용 유통",
     "업소용 냉동 다이후쿠·당고 750g(114,999₫, 품절)을 'GYOMU_SUPER' 태그로 판매",
     "일본 식자재 B2B 경로로도 모찌가 음식점에 공급됨", "공급 브랜드·재입고 일정", KM + "banh-mochi-daifuku-750g-GYF078", ""),
]


def now() -> str:
    return datetime.now(ICT).strftime("%Y-%m-%d %H:%M ICT")


def progress(message: str) -> None:
    # 오래 걸리는 조회 단계가 멈춘 것처럼 보이지 않게 즉시 출력한다
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {message}", flush=True)


def fetch(url: str, retries: int = 2) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip", "Accept-Language": "vi-VN,vi;q=0.9"})
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(request, timeout=40) as response:
                body = response.read()
                if response.headers.get("Content-Encoding") == "gzip":
                    body = gzip.decompress(body)
                return body.decode("utf-8", "replace")
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            if attempt == retries:
                return f"ERR {error}"
            time.sleep(2)
    return ""


def page_text(raw: str) -> str:
    raw = re.sub(r"<script.*?</script>|<style.*?</style>", " ", raw, flags=re.S)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", raw)))


def ld_product(raw: str) -> dict:
    for block in re.findall(r"<script[^>]+ld\+json[^>]*>(.*?)</script>", raw, re.S):
        try:
            data = json.loads(block)
        except ValueError:
            continue
        for item in data if isinstance(data, list) else [data]:
            if isinstance(item, dict) and item.get("@type") == "Product":
                return item
    return {}


def first_offer(product: dict) -> dict:
    offers = product.get("offers") or {}
    if isinstance(offers, list):
        return offers[0] if offers else {}
    return offers if isinstance(offers, dict) else {}


def availability(offer: dict) -> str:
    return str(offer.get("availability", "")).rsplit("/", 1)[-1]


def parse_haravan(url: str) -> dict:
    try:
        data = json.loads(fetch(url + ".js"))
    except ValueError:
        return {"status": "access_error", "evidence": "상품 JSON 조회 실패"}
    variant = (data.get("variants") or [{}])[0]
    image = data.get("featured_image") or ""
    price = (variant.get("price") or 0) // 100
    regular = (variant.get("compare_at_price") or 0) // 100
    ok = bool(data.get("available"))
    return {
        "price": price, "regular": regular if regular > price else "", "status": "confirmed" if ok else "unavailable",
        "evidence": "상품 페이지 가격·장바구니 + 상품 JSON available=true(재고 수량 비공개)" if ok else "상품 JSON available=false",
        "image": "https:" + image if image.startswith("//") else image, "title": data.get("title", ""),
    }


def parse_coop(url: str) -> dict:
    raw = fetch(url)
    product = ld_product(raw)
    if not product:
        return {"status": "access_error", "evidence": "구조화 데이터 없음"}
    offer = first_offer(product)
    sell = re.search(r'"sellPrice":"(\d+)"', raw)
    price = int(float(offer.get("price") or 0))
    regular = int(sell.group(1)) if sell else 0
    stock = availability(offer)
    return {
        "price": price, "regular": regular if regular > price else "", "status": "confirmed" if stock == "InStock" else "out_of_stock",
        "evidence": f"구조화 데이터 availability={stock}(조회 기본 매장 기준)", "image": product.get("image", ""),
        "title": product.get("name", ""), "props": {p.get("name"): p.get("value") for p in product.get("additionalProperty", [])},
    }


def parse_kingfood(url: str) -> dict:
    raw = fetch(url)
    product = ld_product(raw)
    offer = first_offer(product)
    match = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', raw, re.S)
    data: dict = {}
    if match:
        try:
            data = json.loads(match.group(1))["props"]["pageProps"]["data"]
        except (ValueError, KeyError, TypeError):
            data = {}
    try:
        detail = json.loads(data.get("description") or "{}")
    except ValueError:
        detail = {}
    price = int(float(offer.get("price") or 0))
    original = data.get("originalPrice") or 0
    quantity = data.get("inStock")
    rate = (offer.get("shippingDetails") or {}).get("shippingRate") or {}
    images = product.get("image") or [""]
    ok = isinstance(quantity, int) and quantity > 0
    return {
        "price": price, "regular": original if original and original > price else "",
        "status": "confirmed" if ok else "stock_zero",
        "evidence": f"구조화 데이터 availability={availability(offer)}, 페이지 재고 수량 inStock={quantity}(조회 기본 지점 기준)",
        "image": images[0] if isinstance(images, list) else images, "title": product.get("name", ""),
        "shipping": f"구조화 데이터 배송비 {int(float(rate['value'])):,}₫ 표기(적용 조건 미확인)" if rate.get("value") else "",
        "detail": detail,
    }


def parse_concung(url: str) -> dict:
    raw = fetch(url)
    product = ld_product(raw)
    match = re.search(r'"offers":(\{[^}]*\})', raw)
    offer = json.loads(match.group(1)) if match else {}
    stopped = "NGỪNG KINH DOANH" in page_text(raw)
    stock = availability(offer)
    status = "discontinued" if stopped else ("confirmed" if stock == "InStock" else "out_of_stock")
    return {
        "price": offer.get("price", ""), "regular": "", "status": status,
        "evidence": "페이지에 'NGỪNG KINH DOANH'(판매 중단) 표시" if stopped else f"구조화 데이터 availability={stock}, 가격·구매 버튼 표시",
        "image": product.get("image", ""), "title": product.get("name", ""),
    }


def parse_mochisweets(url: str) -> dict:
    raw = fetch(url)
    price_block = re.search(r'class="price"[^>]*>(.*?)</p>', raw, re.S)
    numbers = re.findall(r"\d[\d.]*", page_text(price_block.group(1))) if price_block else []
    image = re.search(r'src="([^"]+)" class="attachment-shop_single', raw)
    ok = "single_add_to_cart_button" in raw
    sold_out = page_text(raw).count("Hết hàng")
    evidence = "가격·'Thêm vào giỏ hàng'(장바구니) 버튼 표시" if ok else "장바구니 버튼 없음·'Hết hàng' 표시"
    if ok and sold_out:
        evidence += f"; 일부 맛 옵션 'Hết hàng' {sold_out}건"
    title = re.search(r"<title>(.*?)</title>", raw, re.S)
    return {
        "price": int(numbers[0].replace(".", "")) if numbers else "", "regular": "", "status": "confirmed" if ok else "out_of_stock",
        "evidence": evidence, "image": image.group(1) if image else "", "title": html.unescape(title.group(1).strip()) if title else "",
    }


def parse_kamereo(url: str) -> dict:
    raw = fetch(url)
    product = ld_product(raw)
    offer = first_offer(product)
    shown = re.search(r'<meta property="price" content="(\d+)"', raw)
    stock = availability(offer)
    return {
        "price": int(shown.group(1)) if shown else "", "regular": "", "status": "confirmed" if stock == "InStock" else "out_of_stock",
        "evidence": f"구조화 데이터 availability={stock}; 화면 가격 {shown.group(1) if shown else '?'}₫ / 구조화 데이터 가격 {offer.get('price')}₫(VAT 8% 차이로 보임)",
        "image": (product.get("image") or [""])[0], "title": product.get("name", ""),
    }


def json_after(raw: str, key: str, start: int = 0):
    index = raw.find(key, start)
    if index < 0:
        return None
    try:
        return DECODER.raw_decode(raw, index + len(key))[0]
    except ValueError:
        return None


def parse_tiktok(product_id: str) -> dict:
    raw = fetch("https://shop-vn.tiktok.com/pdp/" + product_id)
    anchor = raw.find(f'"product_id":"{product_id}"')
    images = json_after(raw, '"url_list":', anchor) if anchor >= 0 else None
    sold = re.search(r'"sold_count":"(\d+)"', raw)
    button = re.search(r'"pdp_button_area_id":"([a-z_]+)"', raw)
    return {
        "status": json_after(raw, '"product_info":{"status":'), "title": (json_after(raw, '"title":', anchor) or "") if anchor >= 0 else "",
        "image": images[0] if images else "", "skus": json_after(raw, '"skus":') or [], "shop": json_after(raw, '"shop_name":') or "",
        "sold": sold.group(1) if sold else "", "button": button.group(1) if button else "",
    }


PARSERS = {"haravan": parse_haravan, "coop": parse_coop, "kingfood": parse_kingfood, "concung": parse_concung,
           "mochisweets": parse_mochisweets, "kamereo": parse_kamereo}
WEIGHT_OPTIONS = {"Nửa ký": 500, "1 ký": 1000, "Thùng 2 ký": 2000, "500gr": 500, "1 kg": 1000}


def unit_prices(price, pack, grams) -> tuple[object, object, str]:
    per_piece = round(price / pack) if price and pack else ""
    per_100g = round(price / grams * 100) if price and grams else ""
    basis = []
    if per_piece != "":
        basis.append(f"개당={price}÷{pack}개")
    if per_100g != "":
        basis.append(f"100g당={price}÷{grams}g×100")
    return per_piece, per_100g, "; ".join(basis)


def listing_row(fields: tuple, result: dict, checked: str) -> dict:
    lid, pid, sku, seller, channel, region, _parser, url, option, pack, grams, legacy, note = fields
    price = result.get("price") or ""
    per_piece, per_100g, basis = unit_prices(price, pack, grams)
    image = result.get("image") or ""
    return {
        "listing_id": lid, "product_id": pid, "sku_option": sku, "seller": seller, "sales_channel": channel,
        "sales_region": region, "product_url": url, "option_name": option, "page_title": result.get("title", ""),
        "current_price": price, "regular_price": result.get("regular", ""), "currency": "VND",
        "price_condition": "정상가·할인가 함께 표시" if result.get("regular") else "회원·쿠폰·묶음 조건 표시 없음(조회 화면 기준)",
        "shipping_fee": result.get("shipping") or "미확인(별도)", "stock_status": STATUS_KO[result["status"]],
        "status_evidence": result.get("evidence", ""), "pack_count_used": pack or "", "net_weight_g_used": grams or "",
        "price_per_piece": per_piece, "price_per_100g": per_100g, "calc_basis": basis, "image_url": image,
        "image_check": IMAGE_FLAGS.get(url, "판매 페이지 대표 이미지(파일명 기준, 육안 대조 미실시)") if image else "사진 미확인",
        "checked_at": checked, "legacy_ids": legacy, "notes": note,
        "_status": result["status"], "_props": result.get("props") or {}, "_detail": result.get("detail") or {},
    }


def grams_from(text: str):
    match = re.search(r"(\d+(?:[.,]\d+)?)\s*(kg|ký|g|gr)\b", text or "", re.I)
    if not match:
        return WEIGHT_OPTIONS.get(text)
    value = float(match.group(1).replace(",", "."))
    return round(value * 1000) if match.group(2).lower() in ("kg", "ký") else round(value)


def tiktok_rows(pid: str, tiktok_id: str, legacy: str, start: int, page: dict | None = None) -> list[tuple[dict, bool]]:
    """TikTok 상품 한 개를 옵션(중량)별 판매처 행으로 만든다."""
    page = page or parse_tiktok(tiktok_id)
    checked = now()
    rows, seen = [], set()
    for sku in page["skus"]:
        props = [p.get("prop_value") for p in sku.get("sku_sale_props", [])]
        price_info = sku.get("price") or {}
        sale = int(price_info.get("sale_price_decimal") or 0)
        origin = int(price_info.get("origin_price_decimal") or 0)
        option = props[-1] if props else ""
        if (option, sale) in seen:
            continue  # 맛만 다르고 값이 같은 옵션은 한 행으로 묶는다
        seen.add((option, sale))
        ok = page["status"] == 1 and (sku.get("stock") or 0) > 0
        fields = (f"CT{start + len(rows):03d}", pid, option or "기본", f"{page['shop']} (TikTok Shop)", "마켓플레이스(TikTok Shop)", REG_U,
                  "tiktok", "https://shop-vn.tiktok.com/pdp/" + tiktok_id, " / ".join(props) + (" (맛 옵션 동일가)" if len(props) > 1 else ""),
                  None, grams_from(option), legacy, "TikTok 표시가는 같은 상품도 조회할 때마다 소폭 달라짐 — 신뢰도 낮음")
        result = {"price": sale, "regular": origin if origin > sale else "", "status": "confirmed" if ok else "out_of_stock",
                  "evidence": f"상품 status={page['status']}, 옵션 재고 {sku.get('stock')}, 판매처 표시 누적판매 {page['sold']}",
                  "image": page["image"], "title": page["title"]}
        row = listing_row(fields, result, checked)
        row["image_check"] = "판매 페이지 대표 이미지(서명된 임시 URL일 수 있음, 육안 대조 미실시)" if page["image"] else "사진 미확인"
        rows.append((row, ok))
    return rows


def collect_listings() -> tuple[list[dict], list[dict]]:
    confirmed, pending = [], []
    for number, fields in enumerate(LISTINGS, 1):
        if number % 10 == 1 or number == len(LISTINGS):
            progress(f"상품 페이지 확인 {number}/{len(LISTINGS)}")
        result = PARSERS[fields[6]](fields[7])
        row = listing_row(fields, result, now())
        (confirmed if result["status"] == "confirmed" else pending).append(row)
        time.sleep(0.5)
    serial = 1
    for pid, tiktok_id, legacy in TIKTOK:
        for row, ok in tiktok_rows(pid, tiktok_id, legacy, serial):
            (confirmed if ok else pending).append(row)
            serial += 1
    return confirmed, pending


# ---------- SerpApi(구글 색인) 후보 발굴 ----------

SERP_TERMS = [
    "bánh mochi", "mochi daifuku", "kem mochi", "mochi dâu", "mochi trái cây", "bánh mochi kem lạnh",
    "hộp mochi", "set mochi quà tặng", "mochi nhân đậu đỏ", "mochi Đài Loan", "mochi Nhật Bản", "bánh gạo nếp Hàn Quốc",
]
SERP_SITES = {"tiktok": "shop-vn.tiktok.com", "shopee": "shopee.vn", "lazada": "lazada.vn"}
SERP_NEGATIVE = '-gối -nệm -đệm -chiếu -"đồ chơi" -khuôn'
FOOD_WORDS = re.compile(r"mochi|daifuku|tteok|bánh nếp|bánh gạo nếp", re.I)
# 단어 경계를 둬서 'Táo'(대추) 안의 'áo'(옷) 같은 오탐을 막는다
NONFOOD_WORDS = re.compile(
    r"gối|nệm|\bđệm\b|chiếu|thú nhồi|đồ chơi|móc khóa|squishy|búp bê|ốp lưng|mỹ phẩm|\bson\b|phấn|\bdép\b|\báo\b|túi xách|sticker|"
    r"\bnến\b|mô hình|bánh giả|\blen\b|sổ tay|washi|slangy|artbox|art box|cushion|\bkhăn\b|hamster|thiệp", re.I)
PACKAGING_WORDS = re.compile(r"hộp nhựa|hộp đựng|đựng bánh|túi giấy|hộp mica|\bđế\b", re.I)
INGREDIENT_WORDS = re.compile(r"\bbột\b|nguyên li[eêệ]u|premix|tự làm|set làm|khuôn|vỏ bánh|đá bào|bingsu", re.I)
OUT_WORDS = re.compile(r"tteokbokki|topokki|tokbokki|hotteok|bánh quy|cookie|thạch|\bkẹo\b|bánh mì|bánh bông lan|bánh cuộn|bánh con cá|bống bang", re.I)
GLUTINOUS_WORDS = re.compile(r"bánh bao chỉ|bánh cốm|bánh dẻo|gạo nếp|\bnếp\b|đậu đỏ", re.I)
KNOWN_BRANDS = ["Royal Family", "MCLUNE", "Sachi", "Yuki", "Daifuku", "Mochi Mashu", "Yukimi", "Lotte", "Bourbon", "Mayumi",
                "Qidea", "An Gia", "Bình Vinh", "Penguin", "Seiki", "Tsujisei", "Minh Nhật", "Aice", "Joyday", "Mochi Sweets", "Celano"]


def serp_search(api_key: str, query: str) -> list[dict]:
    params = {"engine": "google", "q": query, "gl": "vn", "hl": "vi", "google_domain": "google.com.vn", "num": 100, "api_key": api_key}
    try:
        with urllib.request.urlopen(f"{API_URL}?{urlencode(params)}", timeout=60) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        raise SerpApiError(f"SerpApi HTTP 오류 {error.code}") from None
    except (urllib.error.URLError, TimeoutError, ValueError) as error:
        raise SerpApiError(f"SerpApi 연결 실패: {error}") from None
    if payload.get("error"):
        if "hasn't returned any results" in payload["error"]:
            return []
        raise SerpApiError(f"SerpApi 오류: {payload['error']}")
    return payload.get("organic_results") or []


def item_key(platform: str, url: str) -> str:
    patterns = {
        "tiktok": r"(?:/pdp/|/product/)(?:[^/?]*/)?(\d{15,})",
        "shopee": r"-i\.(\d+)\.(\d+)|/product/(\d+)/(\d+)",
        "lazada": r"-i(\d+)(?:-s\d+)?\.html|/products/[^?]*?i(\d+)",
    }
    match = re.search(patterns[platform], url)
    return ".".join(group for group in match.groups() if group) if match else ""


def scope(title: str) -> str:
    if NONFOOD_WORDS.search(title):
        return "비식품"
    if PACKAGING_WORDS.search(title):
        return "포장재"
    if INGREDIENT_WORDS.search(title):
        return "원재료"
    if OUT_WORDS.search(title):
        return "범위 밖"
    if FOOD_WORDS.search(title):
        return "후보"
    # 구글 결과에 섞인 무관 상품은 버리고, 찹쌀 디저트로 보이는 것만 사람이 판단하게 남긴다
    return "범위 판단 필요" if GLUTINOUS_WORDS.search(title) else "범위 밖(모찌 아님)"


def load_previous_serpapi(out: Path) -> list[dict]:
    """직전 실행 결과 CSV에 남은 SerpApi 후보를 다시 모은다(추가 검색 없이 재분류할 때 사용)."""
    found: dict[tuple[str, str], dict] = {}

    def keep(platform, url, title, reason, legacy_id):
        platform = platform.lower()
        key = item_key(platform, url) if platform in SERP_SITES else ""
        if not key or (platform, key) in found:
            return
        query = reason.split("검색어: ", 1)[1] if "검색어: " in reason else ""
        price = re.search(r"검색 결과 표시가 (.+?), 현재가 아님", reason)
        found[(platform, key)] = {"platform": platform, "key": key, "url": url, "title": title, "query": query,
                                  "snippet_price": price.group(1) if price else "", "legacy": legacy_id}

    def rows(name):
        path = out / name
        if not path.exists():
            return []
        with path.open(encoding="utf-8-sig", newline="") as handle:
            return list(csv.DictReader(handle))

    for row in rows("competitor_review_queue.csv"):
        if "검색어: " in row["reason"]:
            keep(row["seller"], row["url"], row["candidate_name"], row["reason"], row["legacy_ids"])
    for row in rows("competitor_exclusions.csv"):
        if "SerpApi" in row["reason"]:
            keep(row["seller"], row["url"], row["candidate_name"], row["reason"], row["legacy_ids"])
    for row in rows("competitor_listings.csv"):
        if "SerpApi" in row["notes"]:
            keep("tiktok", row["product_url"], row["page_title"], "", row["legacy_ids"])
    return list(found.values())


def snippet_price(result: dict) -> str:
    extensions = ((result.get("rich_snippet") or {}).get("bottom") or {}).get("detected_extensions") or {}
    if extensions.get("price"):
        return f"{extensions['price']} {extensions.get('currency', '')}".strip()
    match = re.search(r"(?:₫|đ|VND)\s?[\d.,]{4,}|[\d.,]{4,}\s?(?:₫|đ|VND)", result.get("snippet", ""))
    return match.group(0) if match else ""


def discover_serpapi(limit: int, legacy: dict[str, dict], known_tiktok: set[str]):
    """구글 색인 결과에서 개별 상품 링크만 골라 플랫폼별로 처리한다."""
    api_key = load_api_key()
    if not api_key:
        raise SerpApiError("SERPAPI_API_KEY 환경변수가 없습니다. 키를 설정한 터미널에서 다시 실행하세요.")
    legacy_keys = {}
    for lid, row in legacy.items():
        for platform in SERP_SITES:
            key = item_key(platform, row.get("source_url", ""))
            if key:
                legacy_keys[(platform, key)] = lid
    seen: dict[tuple[str, str], dict] = {}
    log, searches = [], 0
    for platform, site in SERP_SITES.items():
        for term in SERP_TERMS:
            if searches >= limit:
                break
            query = f"{term} site:{site}" + ("" if platform == "tiktok" else f" {SERP_NEGATIVE}")
            progress(f"SerpApi 검색 {searches + 1}/{limit}: [{platform}] {term}")
            results = serp_search(api_key, query)
            searches += 1
            entry = {"platform": platform, "query": query, "results": len(results), "product_links": 0, "new": 0, "duplicate": 0}
            for result in results:
                url = result.get("link", "")
                key = item_key(platform, url)
                if not key:
                    continue  # 검색·카테고리·글 페이지는 상품을 특정하지 못하므로 버린다
                entry["product_links"] += 1
                if (platform, key) in seen or (platform == "tiktok" and key in known_tiktok):
                    entry["duplicate"] += 1
                    continue
                entry["new"] += 1
                seen[(platform, key)] = {"platform": platform, "key": key, "url": url, "title": html.unescape(result.get("title", "")),
                                         "snippet_price": snippet_price(result), "query": query,
                                         "legacy": legacy_keys.get((platform, key), "")}
            log.append(entry)
            time.sleep(1)
    return list(seen.values()), log, searches


def tiktok_product(pid: str, title: str) -> tuple[str, ...]:
    brand = next((name for name in KNOWN_BRANDS if name.lower() in title.lower()), "판매자 표기(브랜드 미확인)")
    ice = re.search(r"\bkem mochi\b|mochi kem\b(?! lạnh)", title, re.I)
    return (brand, title[:120], "TikTok 판매 상품(제목 원문) — 한국어명 미작성", D, R_ICE if ice else R_MOCHI,
            "TikTok 판매 모찌(제목 기준 자동 분류·검수 필요)", "", "", "", "")


def apply_serpapi(candidates: list[dict], confirmed: list[dict], pending: list[dict]) -> tuple[list[dict], list[dict]]:
    """TikTok은 판매 확인 후 확정 목록에, Shopee·Lazada는 확인 대상에, 범위 밖은 제외 목록에 보낸다."""
    review, excluded = [], []
    serial = 1 + sum(row["listing_id"].startswith("CT") for row in confirmed + pending)
    product_serial = 1
    tiktok_total = sum(item["platform"] == "tiktok" for item in candidates)
    tiktok_done = 0
    for item in candidates:
        verdict = scope(item["title"])
        if item["platform"] == "tiktok":
            tiktok_done += 1
            progress(f"SerpApi TikTok 후보 확인 {tiktok_done}/{tiktok_total}")
            page = parse_tiktok(item["key"])
            if not page["title"] and not page["skus"]:
                review.append(("접근 제한", item, "상품 데이터 없음", "SerpApi 색인 TikTok 링크이나 공개 페이지에서 상품 데이터를 읽지 못함"))
                continue
            title = page["title"]
            item = {**item, "title": title}
            verdict = scope(title)
            if verdict == "후보" and page["skus"]:
                pid = f"CS{product_serial:03d}"
                PRODUCTS[pid] = tiktok_product(pid, title)
                rows = tiktok_rows(pid, item["key"], item["legacy"], serial, page)
                if any(ok for _row, ok in rows):
                    product_serial += 1
                    for row, ok in rows:
                        row["notes"] = (row["notes"] + "; SerpApi 구글 색인으로 발굴. 다른 판매처의 같은 제품과 통합 여부 미검수").lstrip("; ")
                        (confirmed if ok else pending).append(row)
                    serial += len(rows)
                    continue
                del PRODUCTS[pid]
                status = {2: "품절", 3: "판매 중단(상품 삭제)"}.get(page["status"], f"상태 {page['status']}")
                review.append(("품절·판매 중단", item, status, "SerpApi 색인 TikTok 상품. 공개 페이지 확인 결과 판매 중 옵션 없음"))
                continue
            if verdict == "후보":
                review.append(("접근 제한", item, "상품 데이터 없음", "SerpApi 색인 TikTok 링크이나 공개 페이지에서 상품 데이터를 읽지 못함"))
                continue
        if verdict not in ("후보", "범위 판단 필요"):
            excluded.append((verdict, item))
        elif verdict == "범위 판단 필요":
            review.append(("범위 판단 필요", item, "판정 불가", "제목에 모찌 단어는 없으나 찹쌀 디저트로 보여 경쟁 범위 판단 필요"))
        else:
            review.append(("판매 여부 확인 필요", item, "판매 상태 판정 불가",
                           f"SerpApi 구글 색인 후보. {item['platform'].title()} 상품 페이지 접근 제한으로 판매·가격 미확인"
                           + (f" (검색 결과 표시가 {item['snippet_price']}, 현재가 아님)" if item["snippet_price"] else "")))
    return review, excluded


def build_products(confirmed: list[dict]) -> list[dict]:
    rows = []
    for pid in sorted({row["product_id"] for row in confirmed}):
        brand, local, korean, level, reason, kind, flavor, origin, maker, storage = PRODUCTS[pid]
        linked = [row for row in confirmed if row["product_id"] == pid]
        for row in linked:  # 기준표에 없는 원산지·보관은 판매처 표기에서만 보충한다
            if not origin and row["_props"].get("Xuất xứ"):
                origin = f"{row['_props']['Xuất xứ']} (Co.op 표기)"
            if not origin and row["_detail"].get("source"):
                origin = f"{row['_detail']['source']} (Kingfood 표기)"
            if not storage and row["_props"].get("Bảo quản"):
                storage = f"{row['_props']['Bảo quản'][:60]} (Co.op 표기)"
        image = next((row for row in linked if row["image_url"] and not row["image_check"].startswith("불일치")), None)
        options = list(dict.fromkeys(row["sku_option"] for row in linked))
        rows.append({
            "product_id": pid, "brand": brand, "product_name_local": local, "product_name_ko": f"{korean} (원문 번역)",
            "competition_level": level, "inclusion_reason": reason, "product_type": kind, "flavor_filling": flavor,
            "sku_count": len(options), "sku_options": " | ".join(options), "storage": storage, "origin_country": origin or "미확인",
            "maker_importer": maker, "confirmed_listing_count": len(linked), "seller_count": len({row["seller"] for row in linked}),
            "image_url": image["image_url"] if image else "", "image_page_url": image["product_url"] if image else "",
            "image_match": image["image_check"] if image else "사진 미확인(연결된 판매처 이미지가 모두 불일치 의심)",
            "image_checked_at": image["checked_at"][:10] if image else "", "image_rights": "사용권 확인 필요(판매처 게시 이미지)",
            "classification_note": "한정선 제품 규격·가격 미제공으로 경쟁 분류는 잠정",
            "legacy_ids": "; ".join(sorted({row["legacy_ids"] for row in linked if row["legacy_ids"]})),
        })
    return rows


def queue_type(status: str) -> str:
    if status in ("out_of_stock", "unavailable", "discontinued", "removed"):
        return "품절·판매 중단"
    if status == "access_error":
        return "접근 제한"
    return "판매 여부 확인 필요"


def build_review(pending: list[dict], products: list[dict], legacy: dict[str, dict], serp: list[tuple] = ()) -> list[dict]:
    rows = []
    confirmed_pids = {row["product_id"] for row in products}

    def add(kind, pid, brand, name, seller, url, price, status, reason, checked, legacy_ids, action):
        rows.append({"queue_id": f"RQ{len(rows) + 1:03d}", "queue_type": kind, "product_id": pid, "product_confirmed_elsewhere": "예" if pid in confirmed_pids else "아니오",
                     "brand": brand, "candidate_name": name, "seller": seller, "url": url, "observed_price_vnd": price,
                     "observed_status": status, "reason": reason, "checked_at": checked, "legacy_ids": legacy_ids, "next_action": action})

    for row in pending:
        brand = PRODUCTS[row["product_id"]][0]
        add(queue_type(row["_status"]), row["product_id"], brand, row["page_title"] or PRODUCTS[row["product_id"]][1], row["seller"],
            row["product_url"], row["current_price"], row["stock_status"], row["status_evidence"], row["checked_at"], row["legacy_ids"],
            "재입고·판매 재개 시 확정 목록으로 이동")
    for lid, page in TIKTOK_LEGACY.items():
        info = parse_tiktok(page)
        status = {1: "판매 중", 2: "품절", 3: "판매 중단(상품 삭제)"}.get(info["status"], f"상태 {info['status']}")
        source = legacy.get(lid, {})
        add("품절·판매 중단" if info["status"] in (2, 3) else "판매 여부 확인 필요", "", source.get("brand", ""), info["title"] or source.get("product_name_vi", ""),
            f"{info['shop']} (TikTok Shop)", "https://shop-vn.tiktok.com/pdp/" + page, "", status,
            f"버튼 상태 {info['button']}, 판매처 표시 누적판매 {info['sold']}. 옵션형·대용량 상품이라 기존 제품과 SKU 대응 미확정", now(), lid, "재판매 여부 재확인")
    for lid, (kind, reason) in LEGACY_REVIEW.items():
        source = legacy.get(lid, {})
        add(kind, "", source.get("brand", ""), source.get("product_name_vi", ""), source.get("seller") or source.get("seller_name") or source.get("platform", ""),
            source.get("source_url", ""), source.get("current_price_vnd") or source.get("price_min_vnd", ""), "이번 조회에서 판매 상태 판정 불가",
            reason, now()[:10], lid, "공개 접근 가능한 다른 판매처에서 같은 제품 탐색 또는 브라우저 직접 확인")
    for kind, pid, brand, name, seller, url, reason, action in LEADS:
        add(kind, pid, brand, name, seller, url, "", "판매 상태 판정 불가", reason, now()[:10], "", action)
    for kind, item, status, reason in serp:
        add(kind, "", "", item["title"], item["platform"].title(), item["url"], "", status, f"{reason}. 검색어: {item['query']}",
            now()[:10], item["legacy"], "브라우저로 판매·가격 확인 후 판매 확인되면 확정 목록으로 이동")
    for product in products:
        if product["image_match"].startswith(("확인 필요", "사진 미확인")):
            add("사진 미확인", product["product_id"], product["brand"], product["product_name_local"], "", product["image_page_url"], "",
                "제품은 판매 확인", product["image_match"], product["image_checked_at"], "", "판매처 이미지와 실제 포장 대조")
    add("동일 제품 확인 필요", "CP027", "Sachi Mochi / V&V", "Mochi vị dưa lưới 200g", "Sakuko Store · Saigon Co.op", CO + "banh-mochi-dua-luoi-v-v-200g--s250518987", "",
        "두 판매처 모두 판매 확인", "제조사 주소·맛·중량 일치로 같은 제품으로 연결했으나 포장 사진 대조 전", now()[:10], "", "포장 사진 대조")
    add("동일 제품 확인 필요", "CP015;CP016;CP017;CP018;CP019;CP020", "Daifuku(판매처 표기)", "Daifuku 200g 6종", FARM, FM + "banh-mochi-dua-luoi-daifuku-goi-200g-i0020739", "",
        "판매 확인", "Sachi Mochi(Kubota Seika) 200g와 맛 구성이 겹치나 제조사 표기가 없어 별도 제품으로 둠. 일부 원산지 '베트남' 표기 상충", now()[:10], "", "포장 뒷면(제조사) 확인")
    return rows


def build_exclusions(legacy: dict[str, dict], serp: list[tuple] = ()) -> list[dict]:
    rows = []
    for kind, item in serp:
        rows.append({"exclusion_id": "", "exclusion_type": kind, "candidate_name": item["title"], "seller": item["platform"].title(),
                     "url": item["url"], "reason": f"SerpApi 색인 결과 제목 기준 {kind}. 검색어: {item['query']}",
                     "legacy_ids": item["legacy"], "checked_at": now()[:10]})
    for kind, name, seller, url, reason, legacy_id in EXCLUSIONS:
        rows.append({"exclusion_id": f"EX{len(rows) + 1:03d}", "exclusion_type": kind, "candidate_name": name, "seller": seller,
                     "url": url, "reason": reason, "legacy_ids": legacy_id, "checked_at": now()[:10]})
    for lid, (kind, reason) in LEGACY_EXCLUDE.items():
        source = legacy.get(lid, {})
        rows.append({"exclusion_id": f"EX{len(rows) + 1:03d}", "exclusion_type": kind, "candidate_name": source.get("product_name_vi", ""),
                     "seller": source.get("seller") or source.get("seller_name") or source.get("platform", ""), "url": source.get("source_url", ""),
                     "reason": reason, "legacy_ids": lid, "checked_at": now()[:10]})
    for number, row in enumerate(rows, 1):
        row["exclusion_id"] = f"EX{number:03d}"
    return rows


def build_marketing(confirmed_pids: set[str]) -> list[dict]:
    rows = []
    for pid, brand, seller, kind, observed, interpreted, unknown, url, posted in MARKETING:
        rows.append({"evidence_id": f"ME{len(rows) + 1:03d}", "product_id": pid, "product_confirmed": "예" if pid in confirmed_pids else ("해당 없음" if not pid else "아니오"),
                     "brand": brand, "seller": seller, "evidence_type": kind, "observation": observed, "interpretation": interpreted,
                     "unverified": unknown, "source_url": url, "posted_at": posted or "게시일 미표시", "checked_at": now()[:10]})
    return rows


def read_legacy() -> dict[str, dict]:
    rows: dict[str, dict] = {}
    for path in (FIRST, SECOND):
        with path.open(encoding="utf-8-sig", newline="") as handle:
            for row in csv.DictReader(handle):
                rows[row["listing_id"]] = row
    return rows


def safe(value):
    # 엑셀 수식 주입 방지
    return "'" + value if isinstance(value, str) and value[:1] in ("=", "+", "-", "@") else value


def write_csv(path: Path, columns: list[str], rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows({key: safe(value) for key, value in row.items()} for row in rows)


LISTING_COLUMNS = [
    "listing_id", "product_id", "sku_option", "seller", "sales_channel", "sales_region", "product_url", "option_name", "page_title",
    "current_price", "regular_price", "currency", "price_condition", "shipping_fee", "stock_status", "status_evidence",
    "pack_count_used", "net_weight_g_used", "price_per_piece", "price_per_100g", "calc_basis", "image_url", "image_check",
    "checked_at", "legacy_ids", "notes",
]
PRODUCT_COLUMNS = [
    "product_id", "brand", "product_name_local", "product_name_ko", "competition_level", "inclusion_reason", "product_type",
    "flavor_filling", "sku_count", "sku_options", "storage", "origin_country", "maker_importer", "confirmed_listing_count",
    "seller_count", "image_url", "image_page_url", "image_match", "image_checked_at", "image_rights", "classification_note", "legacy_ids",
]
REVIEW_COLUMNS = ["queue_id", "queue_type", "product_id", "product_confirmed_elsewhere", "brand", "candidate_name", "seller", "url",
                  "observed_price_vnd", "observed_status", "reason", "checked_at", "legacy_ids", "next_action"]
EXCLUSION_COLUMNS = ["exclusion_id", "exclusion_type", "candidate_name", "seller", "url", "reason", "legacy_ids", "checked_at"]
MARKETING_COLUMNS = ["evidence_id", "product_id", "product_confirmed", "brand", "seller", "evidence_type", "observation",
                     "interpretation", "unverified", "source_url", "posted_at", "checked_at"]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", default=str(DATA / "research_2026-10-26"), help="결과 폴더")
    parser.add_argument("--serpapi", action="store_true", help="SerpApi 구글 색인으로 TikTok·Shopee·Lazada 후보 추가")
    parser.add_argument("--serpapi-limit", type=int, default=len(SERP_TERMS) * len(SERP_SITES), help="SerpApi 최대 검색 횟수")
    parser.add_argument("--reuse-serpapi", action="store_true", help="검색하지 않고 직전 결과 CSV의 SerpApi 후보를 다시 분류")
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    legacy = read_legacy()
    serp_found, serp_log, searches = [], [], 0
    if args.reuse_serpapi:  # 결과 파일을 덮어쓰기 전에 읽어 둔다
        serp_found = load_previous_serpapi(out)
        args.serpapi = True
        progress(f"직전 결과에서 SerpApi 후보 {len(serp_found)}건을 다시 분류합니다(추가 검색 없음)")
    elif args.serpapi:  # 키가 없으면 페이지를 읽기 전에 멈춘다
        known = {tiktok_id for _pid, tiktok_id, _legacy in TIKTOK} | set(TIKTOK_LEGACY.values())
        try:
            serp_found, serp_log, searches = discover_serpapi(args.serpapi_limit, legacy, known)
        except SerpApiError as error:
            sys.exit(f"중단: {error}")
    confirmed, pending = collect_listings()
    serp_review, serp_excluded = apply_serpapi(serp_found, confirmed, pending) if args.serpapi else ([], [])
    products = build_products(confirmed)
    review = build_review(pending, products, legacy, serp_review)
    exclusions = build_exclusions(legacy, serp_excluded)
    marketing = build_marketing({row["product_id"] for row in products})

    write_csv(out / "competitor_products.csv", PRODUCT_COLUMNS, products)
    write_csv(out / "competitor_listings.csv", LISTING_COLUMNS, confirmed)
    write_csv(out / "competitor_review_queue.csv", REVIEW_COLUMNS, review)
    write_csv(out / "competitor_exclusions.csv", EXCLUSION_COLUMNS, exclusions)
    write_csv(out / "competitor_marketing_evidence.csv", MARKETING_COLUMNS, marketing)

    mapped = {lid for row in confirmed + pending for lid in re.findall(r"(?:VN|MP)\d{3}", row["legacy_ids"])}
    mapped |= set(TIKTOK_LEGACY) | set(LEGACY_REVIEW) | set(LEGACY_EXCLUDE)
    print(f"확정 제품 {len(products)} · SKU {sum(p['sku_count'] for p in products)} · 판매처 연결 {len(confirmed)}"
          f" · 확인 대상 {len(review)} · 제외 {len(exclusions)} · 마케팅 근거 {len(marketing)}")
    print(f"기존 1·2차 {len(legacy)}행 중 처리 {len(mapped & set(legacy))}행, 미처리 {sorted(set(legacy) - mapped)}")
    if args.serpapi:
        new_products = sum(row["product_id"].startswith("CS") for row in products)
        print(f"SerpApi 검색 {searches}회 · 상품 링크 후보 {len(serp_found)}건 · TikTok 신규 확정 제품 {new_products}개"
              f" · 확인 대상 {len(serp_review)}건 · 제외 {len(serp_excluded)}건")
        for entry in serp_log:
            print(f"  [{entry['platform']}] {entry['query']} → 결과 {entry['results']} · 상품 링크 {entry['product_links']}"
                  f" · 신규 {entry['new']} · 중복 {entry['duplicate']}")


if __name__ == "__main__":
    main()
