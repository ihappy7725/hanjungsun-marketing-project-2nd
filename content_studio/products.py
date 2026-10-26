"""제품 기본 정보 (+ 신메뉴 표시). [유진]

희주 파일은 import만 합니다. 필드는 추가만 하고 이름을 바꾸지 않습니다.
지금은 시연 데이터입니다(demo=True). 베트남어 이름은 포장 태그에 적힌 이름입니다.
- color: 콘텐츠 색 이름 (sns.css의 tone-* 와 같은 이름)
- image: static/images/sns/ 안의 대표 사진 파일 이름 (단면 사진, 없으면 None)
- images: 같은 폴더의 사진들 {cut: 단면, pack: 포장}. 영상 제품 사진 칸의 기본값은 cut입니다.
- COMMON_IMAGES: 맛과 상관없는 공통 사진 {whole: 겉모습(동그란 하얀 찹쌀떡), giftset_wrapped: 보자기 선물세트,
  giftset_open: 열린 선물세트}. 영상 탭이 컷 종류에 맞춰 골라 Higgsfield에 보냅니다(routes_sns.py _photo_set).
- new_menu: 첫 화면 "신메뉴" 추천에 쓰는 표시
"""

COMMON_IMAGES = {
    "whole": "product_whole.jpg",
    "giftset_wrapped": "product_giftset_wrapped.jpg",
    "giftset_open": "product_giftset_open.jpg",
}

PRODUCTS = [
    {
        "id": "mango_yogurt",
        "name_ko": "망고 요거트 찹쌀떡",
        "name_vi": "Chapssal-tteok Xoài",
        "color": "gold",
        "image": "product_mango_yogurt_cut.jpg",
        "images": {"cut": "product_mango_yogurt_cut.jpg", "pack": "product_mango_yogurt_pack.jpg"},
        "new_menu": False,
        "demo": True,
    },
    {
        "id": "honey_red_dragonfruit",
        "name_ko": "꿀 레드용과 찹쌀떡",
        "name_vi": "Chapssal-tteok Thanh Long Mật Ong",
        "color": "red",
        "image": "product_honey_dragonfruit_cut.jpg",
        "images": {"cut": "product_honey_dragonfruit_cut.jpg", "pack": "product_honey_dragonfruit_pack.jpg"},
        "new_menu": True,
        "demo": True,
    },
    {
        "id": "mangosteen_yogurt",
        "name_ko": "망고스틴 요거트 찹쌀떡",
        "name_vi": "Chapssal-tteok Măng Cụt",
        "color": "hero",
        "image": "product_mangosteen_yogurt_cut.jpg",
        "images": {"cut": "product_mangosteen_yogurt_cut.jpg", "pack": "product_mangosteen_yogurt_pack.jpg"},
        "new_menu": False,
        "demo": True,
    },
    {
        "id": "durian",
        "name_ko": "두리안 찹쌀떡",
        "name_vi": "Chapssal-tteok Sầu Riêng",
        "color": "green",
        "image": "product_durian_cut.jpg",
        "images": {"cut": "product_durian_cut.jpg", "pack": "product_durian_pack.jpg"},
        "new_menu": False,
        "demo": True,
    },
]


def get_product(product_id):
    """id로 제품 하나를 찾습니다. 없으면 None."""
    return next((product for product in PRODUCTS if product["id"] == product_id), None)
