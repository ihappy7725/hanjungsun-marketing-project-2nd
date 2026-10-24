// 첫 화면·대화·이전 작업·되돌리기 [유진]
// type="module"로 불러오므로 전역 변수·함수가 생기지 않습니다.
import { renderVideo } from "./sns_video.js";

// ---------- 시연 데이터 (DEMO) ----------
// 영상 탭 "내 영상"은 저장된 작업(/api/gallery)이 없을 때만 시연 카드를 보여줍니다.
// 포스터·카드뉴스 내 작업과 세 탭 추천은 아직 시연 데이터입니다.
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
const WORK_KINDS = ["video"];  // 작업 화면이 연결된 탭 (포스터·카드뉴스는 희주 편집기 연결 후)
const MAX_RECS = 6;

// ---------- 화면 요소 ----------
const page = document.querySelector(".studio-page");
const kind = KIND_LABELS[page?.dataset.tab] ? page.dataset.tab : "poster";
const API = page?.dataset.api;
const $ = (role) => page.querySelector(`[data-role="${role}"]`);

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
  notice.hidden = !message;
}

function daysUntil(dateText) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(`${dateText}T00:00:00`) - today) / 86400000);
}

function shortDate(iso) {
  const date = new Date(iso);
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
    body: options.body && JSON.stringify(options.body),
  });
  const data = await response.json().catch(() => ({ ok: false, error: "서버 응답을 읽지 못했습니다." }));
  if (!data.ok) throw new Error(data.error || "요청에 실패했습니다.");
  return data;
}

// ---------- 첫 화면 · 내 작업 ----------
function galleryCard(item) {
  const card = el("button", "studio-card");
  card.type = "button";

  if (kind === "video") {
    const box = thumb(item, el("span", "badge", `${item.duration}초${item.status ? ` · ${item.status}` : ""}`));
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

  card.addEventListener("click", () => {
    if (item.chatId) openChat(item.chatId);
    else notify(`"${item.title}"은(는) 시연 카드입니다. 실제 작업은 [새로 만들기]나 추천으로 만들어 보세요.`);
  });
  return card;
}

function renderGallery(items) {
  $("gallery").replaceChildren(...items.map(galleryCard));
  $("gallery-count").textContent = items.length ? `${items.length}개` : "";
  $("gallery-empty").hidden = items.length > 0;
  $("gallery").hidden = items.length === 0;
}

async function loadGallery() {
  if (kind !== "video") return renderGallery(DEMO_GALLERY[kind]);
  try {
    const { items } = await api(`/gallery?kind=${kind}`);
    if (!items.length) return renderGallery(DEMO_GALLERY.video);
    renderGallery(items.map((item) => ({
      chatId: item.id,
      title: item.title,
      updated: shortDate(item.updated_at),
      ratio: item.ratio,
      duration: item.duration,
      status: item.video_url ? "완성" : item.demo ? "시연" : "",
      tone: "hero",
      scenes: item.scenes,
    })));
  } catch (error) {
    renderGallery(DEMO_GALLERY.video);
    notify(`내 영상을 불러오지 못해 시연 카드를 보여줍니다. (${error.message})`);
  }
}

// ---------- 첫 화면 · 추천 ----------
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
      event: event.name,
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

  card.addEventListener("click", () => {
    if (!WORK_KINDS.includes(kind)) return notify(`"${rec.title}" 요청으로 바로 만들기는 다음 단계에서 연결됩니다.`);
    startNew();
    send(rec.title, { event: rec.event });
  });
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

// ---------- 작업 화면 ----------
const work = { chatId: null, doc: null, canUndo: false, canRedo: false, pending: null, busy: false };
const settings = { ratio: "9:16", duration: 5, sound: false };  // 첫 초안을 만들 때 쓰는 규격

function setUrl(chatId) {
  const url = new URL(location.href);
  url.searchParams.set("tab", kind);
  if (chatId) url.searchParams.set("chat", chatId);
  else url.searchParams.delete("chat");
  history.replaceState(null, "", url);
}

function showScreen(name) {
  $("home-screen").hidden = name !== "home";
  $("work-screen").hidden = name !== "work";
  $("new").hidden = name !== "home";
}

function goHome() {
  showScreen("home");
  setUrl(null);
  notify("");
  loadGallery();
}

function resetWork() {
  Object.assign(work, { chatId: null, doc: null, canUndo: false, canRedo: false, pending: null });
  $("chat-log").replaceChildren();
  $("chat-choices").replaceChildren();
}

function startNew() {
  if (!WORK_KINDS.includes(kind)) return notify(`새 ${KIND_LABELS[kind]} 작업 화면은 다음 단계에서 연결됩니다.`);
  resetWork();
  showScreen("work");
  setUrl(null);
  notify("");
  addBubble("assistant", "어떤 영상을 만들까요? 제품·기념일·분위기를 말해 주세요. 위에서 규격(비율·길이·소리)을 먼저 고를 수 있어요.");
  renderWork();
  $("chat-input").focus();
}

async function openChat(chatId) {
  try {
    const data = await api(`/chats/${chatId}`);
    if (data.chat.kind !== kind) return notify("다른 탭의 작업입니다.");
    resetWork();
    showScreen("work");
    notify("");
    for (const message of data.messages) addBubble(message.role, message.text);
    applyState(chatId, data);
    loadHistory();
  } catch (error) {
    notify(`작업을 열지 못했습니다. (${error.message})`);
    goHome();
  }
}

function applyState(chatId, data) {
  work.chatId = chatId;
  work.doc = data.design;
  work.canUndo = data.can_undo;
  work.canRedo = data.can_redo;
  setUrl(chatId);
  renderWork();
}

function renderWork() {
  const doc = work.doc;
  const current = doc ? { ratio: doc.ratio, duration: doc.duration, sound: doc.sound } : settings;
  for (const button of $("set-ratio").children) button.classList.toggle("dark", button.dataset.value === current.ratio);
  for (const button of $("set-duration").children) button.classList.toggle("dark", Number(button.dataset.value) === current.duration);
  $("set-sound").textContent = current.sound ? "소리 켬" : "소리 끔";
  $("set-sound").classList.toggle("dark", current.sound);
  $("undo").disabled = !work.canUndo || work.busy;
  $("redo").disabled = !work.canRedo || work.busy;

  if (!doc) {
    $("canvas").replaceChildren(el("p", "empty-note", "오른쪽 대화로 요청하면 여기에 장면 구성과 프롬프트 초안이 나타납니다."));
    return;
  }
  renderVideo($("canvas"), doc, { onSave: saveDesign });
}

async function saveDesign(doc) {
  try {
    const data = await api(`/chats/${work.chatId}/design`, { method: "PUT", body: { design: doc } });
    applyState(work.chatId, data);
    notify("직접 고친 내용을 새 버전으로 저장했습니다.");
  } catch (error) {
    notify(`저장하지 못했습니다. (${error.message})`);
    throw error;
  }
}

// ---------- 대화 ----------
function addBubble(role, text) {
  const bubble = el("p", `studio-bubble is-${role}`, text);
  $("chat-log").append(bubble);
  $("chat-log").scrollTop = $("chat-log").scrollHeight;
}

// 제품을 되물으면 답의 "(찹쌀떡 / 망고스틴 찹쌀떡)" 목록으로 고르기 버튼을 만듭니다.
function showProductChoices(reply) {
  const names = (reply.match(/\(([^)]+)\)/)?.[1] || "").split(" / ").filter(Boolean);
  $("chat-choices").replaceChildren(...names.map((name) => {
    const button = el("button", "btn", name);
    button.type = "button";
    button.addEventListener("click", () => send(`${name} ${work.pending.text}`, work.pending.extra));
    return button;
  }));
}

async function send(text, extra = {}) {
  text = text.trim();
  if (!text || work.busy) return;
  work.busy = true;
  $("chat-choices").replaceChildren();
  addBubble("user", text);
  const body = { text, kind, chat_id: work.chatId, ...settings, ...extra };
  try {
    const data = await api("/messages", { method: "POST", body });
    addBubble("assistant", data.reply);
    if (data.ask === "product") {
      work.pending = { text, extra };
      showProductChoices(data.reply);
    } else {
      work.pending = null;
      applyState(data.chat_id, data);
      loadHistory();
    }
  } catch (error) {
    addBubble("assistant", `요청하지 못했습니다. (${error.message})`);
  } finally {
    work.busy = false;
    renderWork();
  }
}

// 규격 버튼: 초안 전에는 첫 규격을 고르고, 초안 뒤에는 같은 말을 대화로 보냅니다.
function changeSetting(key, value, phrase) {
  if (!work.doc) {
    settings[key] = value;
    return renderWork();
  }
  if (work.doc[key] !== value) send(phrase);
}

async function move(step) {
  if (!work.chatId || work.busy) return;
  try {
    const data = await api(`/chats/${work.chatId}/design/${step}`, { method: "POST" });
    applyState(work.chatId, data);
  } catch (error) {
    notify(`${step === "undo" ? "되돌리지" : "다시하지"} 못했습니다. (${error.message})`);
  }
}

// ---------- 이전 작업 ----------
async function loadHistory() {
  if ($("history").hidden) return;
  try {
    const { chats } = await api(`/chats?kind=${kind}`);
    const list = $("history-list");
    if (!chats.length) return list.replaceChildren(el("li", "studio-hint", "아직 저장된 작업이 없습니다."));
    list.replaceChildren(...chats.map((chat) => {
      const li = el("li");
      const button = el("button", `studio-history-item${chat.id === work.chatId ? " is-current" : ""}`);
      button.type = "button";
      button.append(el("span", "", chat.title), el("small", "", shortDate(chat.updated_at)));
      button.addEventListener("click", () => openChat(chat.id));
      li.append(button);
      return li;
    }));
  } catch (error) {
    $("history-list").replaceChildren(el("li", "studio-hint", `불러오지 못했습니다. (${error.message})`));
  }
}

function bindWork() {
  $("go-home").addEventListener("click", goHome);
  $("history-toggle").addEventListener("click", () => {
    $("history").hidden = !$("history").hidden;
    $("work-screen").classList.toggle("has-history", !$("history").hidden);
    loadHistory();
  });
  $("undo").addEventListener("click", () => move("undo"));
  $("redo").addEventListener("click", () => move("redo"));

  const phrases = { "9:16": "세로로", "16:9": "가로로", "1:1": "정사각형으로" };
  for (const button of $("set-ratio").children) {
    button.addEventListener("click", () => changeSetting("ratio", button.dataset.value, phrases[button.dataset.value]));
  }
  for (const button of $("set-duration").children) {
    const value = Number(button.dataset.value);
    button.addEventListener("click", () => changeSetting("duration", value, `${value}초로`));
  }
  $("set-sound").addEventListener("click", () => {
    const next = !(work.doc ? work.doc.sound : settings.sound);
    changeSetting("sound", next, next ? "소리 켜줘" : "소리 꺼줘");
  });

  $("chat-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = $("chat-input");
    send(input.value);
    input.value = "";
  });
  // Enter로 보내기, Shift+Enter로 줄바꿈
  $("chat-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      $("chat-form").requestSubmit();
    }
  });

  // Ctrl+Z / Ctrl+Shift+Z: 입력칸에 쓰는 중에는 글자 되돌리기로 둡니다.
  document.addEventListener("keydown", (event) => {
    if ($("work-screen").hidden || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
    if (event.target.closest("input, textarea")) return;
    event.preventDefault();
    move(event.shiftKey ? "redo" : "undo");
  });
}

// ---------- 시작 ----------
if (page) {
  enableRailScroll($("gallery"));
  $("recs").replaceChildren(...recommendations().map(recCard));
  $("new").addEventListener("click", startNew);
  bindWork();

  const chatId = Number(new URL(location.href).searchParams.get("chat"));
  if (chatId && WORK_KINDS.includes(kind)) openChat(chatId);
  else loadGallery();
}
