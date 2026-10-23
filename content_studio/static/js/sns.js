// 첫 화면·대화·이전 작업·되돌리기 [유진]
// type="module"로 불러오므로 전역 변수·함수가 생기지 않습니다.

// ---------- 시연 데이터 (DEMO) ----------
// 2단계에서 GET /content_studio/api/gallery?kind= · /api/recommendations?kind= 응답으로 바꿉니다.
const DEMO_GALLERY = {
  poster: [
    { id: "p1", title: "망고스틴 찹쌀떡 출시", updated: "10월 21일", ratio: "4:5", tone: "hero", sub: "신메뉴 · 다낭 매장" },
    { id: "p2", title: "베트남 여성의 날 선물", updated: "10월 15일", ratio: "4:5", tone: "red", sub: "20/10 · 선물 세트" },
    { id: "p3", title: "주말 시식 행사", updated: "10월 9일", ratio: "1:1", tone: "gold", sub: "토·일 오후 2시" },
  ],
  cardnews: [
    { id: "c1", title: "찹쌀떡 맛있게 먹는 법", updated: "10월 20일", ratio: "4:5", tone: "green", sub: "표지", pages: 5 },
    { id: "c2", title: "한정선 이야기", updated: "10월 12일", ratio: "1:1", tone: "hero", sub: "표지", pages: 4 },
  ],
  video: [
    {
      id: "v1", title: "한입 먹는 순간", updated: "10월 22일", ratio: "9:16", tone: "hero", duration: 5, status: "시연",
      scenes: [{ time: "0-2s", ko: "찹쌀떡 클로즈업" }, { time: "2-4s", ko: "반으로 가르기" }, { time: "4-5s", ko: "로고" }],
    },
    {
      id: "v2", title: "다낭 매장 분위기", updated: "10월 16일", ratio: "16:9", tone: "green", duration: 10, status: "시연",
      scenes: [{ time: "0-3s", ko: "매장 외관" }, { time: "3-6s", ko: "진열대" }, { time: "6-10s", ko: "손님 미소" }],
    },
  ],
};

const DEMO_EVENTS = [
  { name: "베트남 스승의 날", date: "2026-11-20", tone: "red" },
  { name: "크리스마스", date: "2026-12-25", tone: "green" },
];
const DEMO_SEASON = { name: "감", note: "이번 달 제철", tone: "gold" };
const DEMO_NEW_MENU = { name: "망고스틴 찹쌀떡", note: "신메뉴", tone: "hero" };

const KIND_LABELS = { poster: "포스터", cardnews: "카드뉴스", video: "영상" };
const MAX_RECS = 6;

// ---------- 화면 요소 ----------
const page = document.querySelector(".studio-page");
const kind = KIND_LABELS[page?.dataset.tab] ? page.dataset.tab : "poster";
const $ = (role) => page.querySelector(`[data-role="${role}"]`);
const gallery = DEMO_GALLERY[kind];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function thumb({ ratio, tone, title, sub }, badge) {
  const box = el("div", `studio-thumb tone-${tone}`);
  box.dataset.ratio = ratio;
  if (badge) box.append(badge);
  box.append(el("strong", "", title));
  if (sub) box.append(el("small", "", sub));
  return box;
}

function notify(message) {
  const notice = $("notice");
  notice.textContent = message;
  notice.hidden = false;
}

function daysUntil(dateText) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(`${dateText}T00:00:00`) - today) / 86400000);
}

// ---------- 내 작업 ----------
function galleryCard(item) {
  const card = el("button", "studio-card");
  card.type = "button";

  if (kind === "video") {
    const box = thumb(item, el("span", "badge", `${item.duration}초 · ${item.status}`));
    const list = el("ul", "studio-scenes");
    for (const scene of item.scenes) {
      const li = el("li");
      li.append(el("b", "", scene.time), scene.ko);
      list.append(li);
    }
    box.append(list);
    card.append(box);
  } else {
    const badge = kind === "cardnews" ? el("span", "badge", `${item.pages}장`) : null;
    card.append(thumb(item, badge));
  }

  const body = el("div", "studio-card-body");
  body.append(el("p", "studio-card-title", item.title), el("p", "studio-card-meta", `${item.updated} · ${item.ratio}`));
  card.append(body);

  card.addEventListener("click", () => notify(`"${item.title}" 작업 화면은 다음 단계에서 연결됩니다.`));
  return card;
}

function renderGallery() {
  $("gallery").replaceChildren(...gallery.map(galleryCard));
  $("gallery-count").textContent = gallery.length ? `${gallery.length}개` : "";
  $("gallery-empty").hidden = gallery.length > 0;
  $("gallery").hidden = gallery.length === 0;
}

// ---------- 추천 ----------
function recommendations() {
  const label = KIND_LABELS[kind];
  const recs = [];
  for (const event of DEMO_EVENTS) {
    const days = daysUntil(event.date);
    if (days < 0) continue;
    recs.push({
      badge: ["badge dday", days === 0 ? "D-DAY" : `D-${days}`],
      title: `${event.name} ${label}`,
      note: `${event.date.slice(5).replace("-", "/")} 기념일`,
      tone: event.tone,
      thumbTitle: event.name,
    });
  }
  recs.push({
    badge: ["badge season", "제철"],
    title: `제철 ${DEMO_SEASON.name} × 찹쌀떡 ${label}`,
    note: DEMO_SEASON.note,
    tone: DEMO_SEASON.tone,
    thumbTitle: DEMO_SEASON.name,
  });
  recs.push({
    badge: ["badge", "NEW"],
    title: `${DEMO_NEW_MENU.name} 출시 ${label}`,
    note: DEMO_NEW_MENU.note,
    tone: DEMO_NEW_MENU.tone,
    thumbTitle: DEMO_NEW_MENU.name,
  });
  return recs.slice(0, MAX_RECS);
}

function recCard(rec) {
  const card = el("button", "studio-rec");
  card.type = "button";
  const ratio = kind === "video" ? "9:16" : "4:5";
  card.append(thumb({ ratio, tone: rec.tone, title: rec.thumbTitle }));

  const text = el("div", "studio-rec-text");
  text.append(el("span", rec.badge[0], rec.badge[1]), el("p", "studio-rec-title", rec.title), el("p", "", rec.note));
  card.append(text);

  card.addEventListener("click", () => notify(`"${rec.title}" 요청으로 바로 만들기는 다음 단계에서 연결됩니다.`));
  return card;
}

// ---------- 내 작업 넘겨 보기: 마우스 휠 · 끌기 ----------
function enableRailScroll(rail) {
  // 휠: 세로 휠을 가로로 바꿉니다. 목록 끝에 닿으면 원래대로 페이지가 위아래로 움직입니다.
  rail.addEventListener("wheel", (event) => {
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;  // 터치패드 가로 밀기는 브라우저 기본 동작
    const max = rail.scrollWidth - rail.clientWidth;
    const atStart = rail.scrollLeft <= 0 && event.deltaY < 0;
    const atEnd = rail.scrollLeft >= max - 1 && event.deltaY > 0;
    if (max <= 0 || atStart || atEnd) return;
    event.preventDefault();
    rail.scrollLeft += event.deltaY;
  }, { passive: false });

  // 끌기: 5px 넘게 움직이면 끌기로 보고, 손을 뗀 직후의 카드 클릭은 무시합니다.
  let drag = null;
  let skipClick = false;
  rail.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    drag = { x: event.clientX, left: rail.scrollLeft, moved: false };
  });
  window.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 5) return;
    drag.moved = true;
    rail.classList.add("is-dragging");
    rail.scrollLeft = drag.left - dx;
  });
  window.addEventListener("pointerup", () => {
    if (drag?.moved) {
      skipClick = true;
      setTimeout(() => { skipClick = false; });
    }
    rail.classList.remove("is-dragging");
    drag = null;
  });
  rail.addEventListener("click", (event) => {
    if (!skipClick) return;
    event.stopPropagation();
    event.preventDefault();
  }, true);
}

// ---------- 시작 ----------
if (page) {
  renderGallery();
  enableRailScroll($("gallery"));
  $("recs").replaceChildren(...recommendations().map(recCard));

  $("new").addEventListener("click", () => notify(`새 ${KIND_LABELS[kind]} 작업 화면은 다음 단계에서 연결됩니다.`));
}
