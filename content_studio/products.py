"""제품 기본 정보 (+ 신메뉴 표시). [유진]

희주 파일은 import만 합니다. 필드는 추가만 하고 이름을 바꾸지 않습니다.
지금은 시연 데이터입니다(demo=True). 베트남어 이름은 원어민 검수 전입니다.
- color: 콘텐츠 색 이름 (sns.css의 tone-* 와 같은 이름)
- image: static/images/sns/ 안의 파일 이름 (없으면 None)
- new_menu: 첫 화면 "신메뉴" 추천에 쓰는 표시
"""

PRODUCTS = [
    {
        "id": "chapssaltteok",
        "name_ko": "찹쌀떡",
        "name_vi": "Bánh mochi Hàn Quốc",
        "color": "gold",
        "image": None,
        "new_menu": False,
        "demo": True,
    },
    {
        "id": "mangosteen_chapssaltteok",
        "name_ko": "망고스틴 찹쌀떡",
        "name_vi": "Bánh mochi măng cụt",
        "color": "hero",
        "image": None,
        "new_menu": True,
        "demo": True,
    },
]


def get_product(product_id):
    """id로 제품 하나를 찾습니다. 없으면 None."""
    return next((product for product in PRODUCTS if product["id"] == product_id), None)
