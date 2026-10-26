// 메인·첫 화면(작업 목록·미리보기 팝업·추천)·대화·되돌리기 [유진]
// type="module"로 불러오므로 전역 변수·함수가 생기지 않습니다.
import { renderVideo } from "./sns_video.js";
// 포스터·카드뉴스 편집기 [희주]. 묶어서 불러와, currentPage()가 아직 없어도 오류 없이 동작합니다.
import * as editor from "./sns_editor.js";

// ---------- 시연 데이터 (DEMO) ----------
// 메인 탭 "지금 만들면 좋은 콘텐츠" 추천은 아직 시연 데이터입니다. 작업 목록은 저장된 작업(/api/gallery)만 보여 줍니다.
// points: 추천 카드 개조식 2줄 [핵심 주제, 한정선 셀링포인트] (마케터 검토 전 문구)
// 셀링포인트는 제품 사진·제품 설명에서 확인되는 것만 씁니다(단면 색, 보자기 포장, 4가지 맛).
const DEMO_EVENTS = [
  { name: "베트남 스승의 날", date: "2026-11-20", points: ["감사한 선생님께 전하는 정성", "보자기 포장 그대로 건네기 좋은 선물"] },
  { name: "크리스마스", date: "2026-12-25", points: ["따뜻한 연말, 소중한 사람과 달콤한 시간", "4가지 맛을 함께 나눠 먹는 연말 디저트"] },
];
// 대표 메뉴 홍보 카드: 실제 메뉴(products.py). 기념일이 없을 때도 늘 만들 수 있는 기본 콘텐츠입니다.
const DEMO_STAPLE = {
  product_id: "mango_yogurt", name: "망고 요거트 찹쌀떡",
  points: ["상큼한 망고 × 부드러운 요거트", "쫀득한 찹쌀떡 속 상큼한 과일 크림"],
};
const DEMO_NEW_MENU = {
  product_id: "honey_red_dragonfruit", name: "꿀 레드용과 찹쌀떡",
  points: ["꿀 머금은 레드용과의 새콤달콤한 첫맛", "선명한 자홍빛 과육이 보이는 단면"],
};

const KIND_LABELS = { poster: "포스터", cardnews: "카드뉴스", video: "영상" };
const WORK_KINDS = ["video", "poster", "cardnews"];  // 작업 화면이 연결된 탭
const DESIGN_KINDS = ["poster", "cardnews"];          // 희주 편집기(sns_editor.js)로 그리는 탭
const RECS = 4;  // 메인 탭 추천 카드 수

// ---------- 화면 요소 ----------
const page = document.querySelector(".studio-page");
// main: 메인 탭(추천 + 세 탭 작업 목록). 작업 화면은 포스터·카드뉴스·영상 탭에서만 엽니다.
const kind = page?.dataset.tab === "main" ? "main" : KIND_LABELS[page?.dataset.tab] ? page.dataset.tab : "poster";
const API = page?.dataset.api;
const PRODUCTS = JSON.parse(page?.dataset.products || "[]");  // [{id, name_ko}] 포스터·카드뉴스 첫 화면 제품 고르기
const $ = (role) => page.querySelector(`[data-role="${role}"]`);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
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

// 수정일: 2026/10/26
function shortDate(iso) {
  const date = new Date(iso);
  const two = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}/${two(date.getMonth() + 1)}/${two(date.getDate())}`;
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

// ---------- 첫 화면 · 작업 목록 ----------
// 메인 탭은 세 탭 작업을 최신순으로 함께, 각 탭은 그 탭 작업만. 줄을 누르면 미리보기 팝업 → [수정하기]로 작업 화면.
const JOB_STATUS = { completed: "완성", queued: "만드는 중", in_progress: "만드는 중", processing: "만드는 중",
  failed: "실패", nsfw: "거절됨", canceled: "취소됨", cancelled: "취소됨" };

// "honey_red_dragonfruit,durian" → "꿀 레드용과·두리안" (4종 모두면 "전체 제품")
function productNames(ids) {
  const list = String(ids || "").split(",").filter(Boolean);
  if (list.length && list.length === PRODUCTS.length) return "전체 제품";
  const names = list.map((id) => PRODUCTS.find((item) => item.id === id)?.name_ko.replace(" 찹쌀떡", "")).filter(Boolean);
  return names.join("·") || "—";
}

// 상태: 영상은 Higgsfield 작업 상태(없으면 초안), 카드뉴스는 장수, 포스터는 편집 중
function statusOf(item) {
  if (item.kind === "video") return JOB_STATUS[item.job_status] || "초안";
  return item.kind === "cardnews" ? `${item.design?.pages?.length || 0}장` : "편집 중";
}

function workRow(item) {
  const row = el("button", "studio-row");
  row.type = "button";
  const title = el("span", "studio-row-title", item.title);
  title.title = item.title;
  row.append(el("span", `studio-kind is-${item.kind}`, KIND_LABELS[item.kind]), title,
    el("span", "", productNames(item.product_id)), el("span", "", statusOf(item)), el("span", "", shortDate(item.updated_at)));
  row.addEventListener("click", () => openPreview(item));
  return row;
}

// 목록 도구(메인만 종류 필터 · 정렬 · 제목 검색). 받아 온 목록을 화면에서만 거릅니다.
const VIEW_KEY = "content_studio.list_view";
const listView = { kind: "", newest: true, query: "", items: [], view: (() => {
  try { return localStorage.getItem(VIEW_KEY) === "grid" ? "grid" : "list"; } catch { return "list"; }
})() };
const EMPTY_NOTE = $("gallery-empty")?.textContent || "";

function renderList() {
  const query = listView.query.trim().toLowerCase();
  const items = listView.items
    .filter((item) => (!listView.kind || item.kind === listView.kind) && (!query || item.title.toLowerCase().includes(query)))
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1) * (listView.newest ? 1 : -1));
  const grid = listView.view === "grid";
  $("gallery").classList.toggle("is-grid", grid);
  if (grid) {
    $("gallery").replaceChildren(...items.map(workTile));
  } else {
    const head = el("div", "studio-row is-head");
    head.append(...["종류", "제목", "제품", "상태", "수정일"].map((text) => el("span", "", text)));
    $("gallery").replaceChildren(head, ...items.map(workRow));
  }
  for (const button of $("list-view")?.children || []) {
    button.classList.toggle("dark", button.dataset.value === listView.view);
    button.setAttribute("aria-pressed", String(button.dataset.value === listView.view));
  }
  const total = listView.items.length;
  $("gallery-count").textContent = !total ? "" : items.length === total ? `${total}개` : `${total}개 중 ${items.length}개`;
  $("gallery-empty").textContent = total ? "조건에 맞는 작업이 없습니다." : EMPTY_NOTE;
  $("gallery-empty").hidden = items.length > 0;
  $("gallery").hidden = items.length === 0;
}

// 썸네일 카드: 위 미리보기(같은 높이 틀) + 종류 배지, 아래 제목 · 제품 · 상태 · 수정일. 누르면 미리보기 팝업.
// 미리보기: 포스터·카드뉴스는 첫 장(희주 renderThumb), 영상은 컷 미리보기 이미지 → 완성 영상 첫 장면 → 장면 글 순서.
function workTile(item) {
  const tile = el("button", "studio-tile");
  tile.type = "button";
  const thumb = el("div", "studio-tile-thumb");
  if (item.kind === "video") {
    if (item.thumb_url) {
      const img = el("img");
      img.src = item.thumb_url;
      img.alt = "";
      img.loading = "lazy";
      thumb.append(img);
    } else if (item.video_url) {
      const video = el("video");
      video.src = `${item.video_url}#t=0.1`;
      video.muted = true;
      video.preload = "metadata";
      thumb.append(video);
    } else {
      const list = el("ol", "studio-scenes");
      for (const scene of (item.scenes || []).slice(0, 4)) list.append(el("li", "", scene.ko));
      thumb.append(list);
      thumb.classList.add("is-text");
    }
  } else if (item.design) {
    thumb.append(editor.renderThumb(item.design));
    if (item.kind === "cardnews") thumb.append(el("span", "studio-tile-pages", `${item.design.pages.length}장`));
  }
  thumb.append(el("span", `studio-kind is-${item.kind}`, KIND_LABELS[item.kind]));
  const title = el("p", "studio-tile-title", item.title);
  title.title = item.title;
  tile.append(thumb, title,
    el("p", "studio-tile-meta", `${productNames(item.product_id)} · ${statusOf(item)} · ${shortDate(item.updated_at)}`));
  tile.addEventListener("click", () => openPreview(item));
  return tile;
}

function bindListTools() {
  for (const button of $("list-view")?.children || []) {
    button.addEventListener("click", () => {
      listView.view = button.dataset.value;
      try { localStorage.setItem(VIEW_KEY, listView.view); } catch { /* 기억만 안 함 */ }
      renderList();
    });
  }
  for (const button of $("list-kind")?.children || []) {
    button.addEventListener("click", () => {
      listView.kind = button.dataset.value;
      for (const other of $("list-kind").children) {
        other.classList.toggle("dark", other === button);
        other.setAttribute("aria-pressed", String(other === button));
      }
      renderList();
    });
  }
  $("list-sort").addEventListener("click", () => {
    listView.newest = !listView.newest;
    $("list-sort").textContent = listView.newest ? "최신순 ↓" : "오래된 순 ↑";
    renderList();
  });
  $("list-search").addEventListener("input", (event) => {
    listView.query = event.target.value;
    renderList();
  });
}

async function loadGallery() {
  try {
    const { items } = await api(kind === "main" ? "/gallery" : `/gallery?kind=${kind}`);
    listView.items = items;
    renderList();
  } catch (error) {
    $("gallery").replaceChildren();
    notify(`작업 목록을 불러오지 못했습니다. (${error.message})`);
  }
}

// 미리보기 팝업: 포스터·카드뉴스는 모든 장(희주 renderThumb), 영상은 완성 영상(없으면 장면 구성) + [수정하기]
// 작업 삭제 확인 창. 지우면 모든 버전·대화가 함께 지워지고, 크레딧 사용 기록은 남습니다(하루 한도 계산용).
function confirmDelete(item, preview) {
  const ask = el("dialog", "studio-confirm-dialog");
  const yes = el("button", "btn dark", "삭제");
  yes.type = "button";
  const no = el("button", "btn", "취소");
  no.type = "button";
  const buttons = el("div", "actions");
  buttons.append(yes, no);
  ask.append(el("p", "studio-confirm-title", `「${item.title}」 작업을 삭제할까요?`),
    el("p", "studio-hint", "모든 버전이 함께 지워지고 되돌릴 수 없어요. (크레딧 사용 기록은 남아요)"), buttons);
  const done = () => { ask.close(); ask.remove(); };  // 닫으면 바로 지움
  no.addEventListener("click", done);
  yes.addEventListener("click", async () => {
    yes.disabled = no.disabled = true;
    try {
      await api(`/chats/${item.id}`, { method: "DELETE" });
      done();
      preview.close();
      notify("작업을 삭제했습니다.");
      loadGallery();
    } catch (error) {
      notify(`삭제하지 못했습니다. (${error.message})`);
      yes.disabled = no.disabled = false;
    }
  });
  ask.addEventListener("close", () => ask.remove());  // Esc로 닫을 때
  page.append(ask);
  ask.showModal();
}

function openPreview(item) {
  const dialog = el("dialog", "studio-preview-dialog");
  const body = el("div", "studio-preview-body");
  if (item.kind === "video") {
    if (item.video_url) {
      const video = el("video", "studio-preview-video");
      video.src = item.video_url;
      video.controls = true;
      video.playsInline = true;
      body.append(video);
    } else {
      const list = el("ol", "studio-scenes");
      for (const scene of item.scenes || []) {
        const li = el("li");
        li.append(el("b", "", scene.time), scene.ko);
        list.append(li);
      }
      body.append(el("p", "studio-hint", "아직 만든 영상이 없어요 · 장면 구성"), list);
    }
  } else if (item.design) {
    item.design.pages.forEach((_, index) => body.append(editor.renderThumb(item.design, index)));
  }
  const edit = el("button", "btn dark", "수정하기 →");
  edit.type = "button";
  edit.addEventListener("click", () => {
    if (kind !== item.kind) {
      location.href = `${location.pathname}?tab=${item.kind}&chat=${item.id}`;
      return;
    }
    dialog.close();
    openChat(item.id);
  });
  const close = el("button", "btn", "닫기");
  close.type = "button";
  close.addEventListener("click", () => dialog.close());
  const actions = el("div", "actions");
  actions.append(edit, close);
  // 오른쪽 위 [삭제]: 확인 창을 한 번 거친 뒤 기존 삭제 API로 지웁니다.
  const remove = el("button", "btn studio-preview-delete", "삭제");
  remove.type = "button";
  remove.addEventListener("click", () => confirmDelete(item, dialog));
  // [수정하기]로 들어가야 할 수 있는 일(포스터·카드뉴스는 Figma 보내기 포함)을 버튼 바로 위에 알려 줍니다.
  const guide = el("p", "studio-preview-guide", item.kind === "video"
    ? "수정하기를 누르면 장면·프롬프트를 고치고 미리보기 이미지·영상을 만들 수 있어요."
    : "수정하기를 누르면 편집 화면에서 시안 고치기 · AI 초안 · 문구 검수 · Figma로 보내기를 할 수 있어요.");
  dialog.append(remove, el("h2", "", item.title),
    el("p", "studio-hint", `${KIND_LABELS[item.kind]} · ${productNames(item.product_id)} · ${statusOf(item)} · ${shortDate(item.updated_at)}`),
    body, guide, actions);
  dialog.addEventListener("close", () => dialog.remove());
  page.append(dialog);
  dialog.showModal();
}

// ---------- 메인 탭 · 지금 만들면 좋은 콘텐츠 ----------
// 신메뉴 출시 → 다가오는 기념일 → 대표 메뉴 순서로 4개. 종류는 카드의 [포스터] [카드뉴스] [영상] 버튼으로 고릅니다.
function recommendations() {
  const recs = [{
    type: "new",
    mark: "NEW",
    title: `${DEMO_NEW_MENU.name} 출시`,
    product_id: DEMO_NEW_MENU.product_id,
    points: DEMO_NEW_MENU.points,
  }];
  for (const event of DEMO_EVENTS) {
    const days = daysUntil(event.date);
    if (days < 0) continue;
    recs.push({
      type: "dday",
      mark: days === 0 ? "D-DAY" : `D-${days}`,
      title: event.name,
      date: event.date.slice(5).replace("-", "/"),
      points: event.points,
      event: event.name,
    });
  }
  recs.push({
    type: "season",  // 표시 색(초록)은 예전 제철 카드 스타일을 그대로 씁니다.
    mark: "대표",
    title: `${DEMO_STAPLE.name} 대표 메뉴`,  // 제품을 정해서 보내므로 누르면 묻지 않고 바로 초안
    product_id: DEMO_STAPLE.product_id,
    points: DEMO_STAPLE.points,
  });
  return recs.slice(0, RECS);
}

// 추천 카드: 제목 [D-26 · 대표 · NEW] → 개조식 2줄(주제 · 셀링포인트) → [포스터] [카드뉴스] [영상].
// 버튼을 누르면 그 탭으로 옮겨 "제목 + 종류" 요청으로 바로 초안을 만듭니다(주소의 start, 시작할 때 한 번만).
function recCard(rec) {
  const card = el("div", `studio-rec is-${rec.type}`);
  const title = el("p", "studio-rec-title", rec.title);
  const mark = el("span", "studio-rec-mark", rec.mark);
  if (rec.date) mark.title = `${rec.date} 기념일`;
  title.append(mark);
  const points = el("ul", "studio-rec-points");
  points.append(...rec.points.map((point) => el("li", "", point)));
  const kinds = el("div", "studio-rec-go");
  for (const target of ["poster", "cardnews", "video"]) {  // 탭 순서
    const button = el("button", "btn", KIND_LABELS[target]);
    button.type = "button";
    button.title = `${rec.title} ${KIND_LABELS[target]} 만들기`;
    button.addEventListener("click", () => {
      const start = { text: `${rec.title} ${KIND_LABELS[target]}`, event: rec.event, product_id: rec.product_id };
      location.href = `${location.pathname}?tab=${target}&start=${encodeURIComponent(JSON.stringify(start))}`;
    });
    kinds.append(button);
  }
  card.append(title, points, kinds);
  return card;
}

// 추천에서 넘어온 요청(주소 start). 틀린 값이면 null.
function startRequest(params) {
  try {
    const start = JSON.parse(params.get("start") || "null");
    return start && typeof start.text === "string" && start.text.trim() ? start : null;
  } catch {
    return null;
  }
}

// ---------- 작업 화면 ----------
const work = { chatId: null, doc: null, canUndo: false, canRedo: false, pending: null, busy: false };
// product_ids: 영상 설정 줄의 [제품] 고르기(전체·여러 개). 비우면 입력 문장에서 제품 이름을 찾고, 없으면 되묻습니다.
// title: 영상 제목(직접 입력). 비우면 서버가 "기념일 - 제품" 규칙 제목을 씁니다.
// user_refs·ref_video: 처음 만들 때 올린 레퍼런스 이미지(최대 4장)·참고 영상(1개). 초안 뒤에는 작업 문서에 저장합니다.
const settings = { ratio: DESIGN_KINDS.includes(kind) ? "4:5" : "9:16", duration: 5, sound: false, product_ids: [], title: "",
  user_refs: [], ref_video: null };
const USER_REFS_MAX = 4;
// 포스터·카드뉴스 첫 화면에서 입력 중인 조건(희주 renderStart). 규격을 바꿔 다시 그려도 남고, 새로 만들기에서 비웁니다.
let startForm = null;

// 영상 입력창 문구: 처음 만들 때와 초안 뒤
const VIDEO_FIRST_PLACEHOLDER = [
  "생성할 영상의 컨셉·스토리·분위기를 입력해 주세요.",
  "예) 신메뉴 두리안 찹쌀떡 출시 기념 영상.",
  "스토리: 포장을 푸는 손 → 반으로 갈라 진한 두리안 크림 단면 공개 → 한입 베어 물고 만족스러운 표정 → 제품 히어로 컷.",
  "분위기: 고급스럽고 차분한 톤, 따뜻한 조명, 느린 카메라 움직임.",
].join("\n");
const REVISE_PLACEHOLDER = "추가 수정 요청 사항을 입력해 주세요";
const DESIGN_REVISE_PLACEHOLDER = 'AI에게 고칠 점을 말해 주세요. 예: "제목 더 크게", "크리스마스 느낌으로 바꿔줘"';  // 첫 초안을 만들 때 쓰는 규격 (길이·소리는 영상만)

function setUrl(chatId) {
  const url = new URL(location.href);
  url.searchParams.set("tab", kind);
  if (chatId) url.searchParams.set("chat", chatId);
  else url.searchParams.delete("chat");
  url.searchParams.delete("start");  // 추천 요청은 한 번만 (새로고침해도 다시 만들지 않게)
  history.replaceState(null, "", url);
}

function showScreen(name) {
  $("home-screen").hidden = name !== "home";
  $("work-screen").hidden = name !== "work";
  $("new").hidden = name !== "home" || kind === "main";  // 메인 탭은 추천·탭 버튼으로 시작
}

function goHome() {
  showScreen("home");
  setUrl(null);
  notify("");
  loadGallery();
}

function resetWork() {
  Object.assign(work, { chatId: null, doc: null, canUndo: false, canRedo: false, pending: null });
  feedback("", "");
}

function startNew() {
  if (!WORK_KINDS.includes(kind)) return notify(`새 ${KIND_LABELS[kind]} 작업 화면은 다음 단계에서 연결됩니다.`);
  resetWork();
  showScreen("work");
  setUrl(null);
  notify("");
  // 새 작업이라 이전 작업 칸은 닫습니다(☰ 이전 작업으로 다시 열 수 있음). 첫 안내는 입력창 문구(VIDEO_FIRST_PLACEHOLDER)로 합니다.
  $("history").hidden = true;
  $("work-screen").classList.remove("has-history");
  Object.assign(settings, { title: "", user_refs: [], ref_video: null });  // 제목·레퍼런스는 작업마다 새로
    startForm = null;
  feedback("", "");
  renderWork();
  if (kind === "video") $("chat-input").focus();
}

async function openChat(chatId) {
  try {
    const data = await api(`/chats/${chatId}`);
    if (data.chat.kind !== kind) return notify("다른 탭의 작업입니다.");
    resetWork();
    showScreen("work");
    notify("");
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
  // 비율 버튼은 탭이 지원하는 것만 보이고(data-kinds), 길이·소리는 영상 전용입니다.
  // 포스터·카드뉴스는 대화로 비율을 바꾸지 못해(designs.py revise_design) 초안 뒤에는 지금 비율만 "비율 4:5" 글자로 보여 줍니다.
  const ratioLocked = Boolean(doc) && DESIGN_KINDS.includes(kind);
  for (const button of $("set-ratio").children) {
    const isCurrent = button.dataset.value === current.ratio;
    button.hidden = !(button.dataset.kinds || "video poster").split(" ").includes(kind) || (ratioLocked && !isCurrent);
    button.classList.toggle("dark", isCurrent && !ratioLocked);
    button.classList.toggle("is-fixed", ratioLocked && isCurrent);
    button.textContent = ratioLocked && isCurrent ? `비율 ${button.dataset.value}` : button.dataset.value;
    button.disabled = ratioLocked;
    button.title = ratioLocked ? "비율은 새로 만들 때 정해요" : "";
  }
  $("set-duration").closest("label").hidden = kind !== "video";
  $("set-sound").hidden = true;  // 소리는 버튼 대신 입력창에 "소리 켜줘"로 바꿉니다.
  // 세 탭 모두 [← 첫 화면]·[☰ 이전 작업] 버튼과 이전 작업 칸 없이 씁니다(첫 화면은 위쪽 탭 버튼으로).
  $("go-home").hidden = $("history-toggle").hidden = true;
  $("history").hidden = true;
  $("work-screen").classList.remove("has-history");
  // 위쪽 가운데 정렬(is-centered): (영상 제목) → (제품)·비율·(길이)·되돌리기 한 줄. 영상 첫 생성 화면(is-start)은 그 아래 바로 입력창.
  // 되돌리기·다시하기는 초안 뒤에만.
  $("work-screen").classList.add("is-centered");
  $("work-screen").classList.toggle("is-start", kind === "video" && !doc);
  // 묶음 칸째 숨겨야 빈 칸 간격 없이 가운데에 맞습니다(.actions는 display가 정해져 있어 style로).
  $("undo").parentElement.style.display = doc ? "" : "none";
  // 제품 고르기: 영상만. 초안 뒤에는 그 작업의 제품을 보여 주고 잠급니다.
  const chosen = doc ? PRODUCTS.filter((item) => (doc.products || [doc.product]).includes(item.name_ko)).map((item) => item.id)
    : settings.product_ids;
  // 영상 초안 뒤에는 제품을 바꿀 수 없어 버튼을 숨기고, 제목 왼쪽 · 비율·초·↶ ↷ 오른쪽 한 줄로(is-video-edit, sns.css)
  $("set-product").hidden = kind !== "video" || Boolean(doc);
  $("work-screen").classList.toggle("is-video-edit", kind === "video" && Boolean(doc));
  // 영상 제목: 초안 전에는 입력값, 초안 뒤에는 그 작업 제목으로 고정해 보여 주고, 누르면 고칠 수 있습니다(이름 바꾸기).
  const title = $("set-title");
  title.hidden = kind !== "video";
  const titleFixed = kind === "video" && Boolean(doc);
  title.classList.toggle("is-fixed", titleFixed);
  title.title = titleFixed ? "눌러서 제목 고치기" : "";
  if (document.activeElement !== title) {
    title.value = doc ? (doc.title || "") : settings.title;
    title.readOnly = titleFixed;
  }
  for (const button of $("set-product").children) {
    const all = button.dataset.value === "all";
    button.classList.toggle("dark", all ? chosen.length === PRODUCTS.length : chosen.includes(button.dataset.value));
    button.setAttribute("aria-pressed", String(button.classList.contains("dark")));
    button.disabled = Boolean(doc);
  }
  if (kind === "video") $("chat-input").placeholder = doc ? REVISE_PLACEHOLDER : VIDEO_FIRST_PLACEHOLDER;
  fitInput();
  renderRefs();
  $("set-duration").value = current.duration;
  $("set-sound").textContent = current.sound ? "소리 켬" : "소리 끔";
  $("set-sound").classList.toggle("dark", current.sound);
  $("undo").disabled = !work.canUndo || work.busy;
  $("redo").disabled = !work.canRedo || work.busy;

  // 포스터·카드뉴스는 초안이 생기기 전에는 아래 입력줄을 숨기고, 가운데 첫 화면에서 AI 초안을 만듭니다.
  // 초안 뒤에는 영상처럼 아래 입력창으로 AI에게 말로 고칩니다(결과 안내 줄은 비어 있으면 숨김).
  $("chat-form").hidden = DESIGN_KINDS.includes(kind) && !doc;
  if (DESIGN_KINDS.includes(kind)) $("chat-input").placeholder = DESIGN_REVISE_PLACEHOLDER;
  // 초안 뒤에만 접을 수 있습니다(첫 생성 화면은 늘 펼침).
  $("command-toggle").hidden = !doc;
  showCommand(Boolean(doc) && commandCollapsed);
  // 포스터·카드뉴스 초안 화면: 비율·↶ ↷는 희주 편집기 오른쪽 고정 칸으로 옮겨 가므로 위 툴바 줄을 통째로 숨깁니다.
  page.querySelector(".studio-toolbar").hidden = DESIGN_KINDS.includes(kind) && Boolean(doc);
  if (!doc && DESIGN_KINDS.includes(kind)) {
    editor.renderStart($("canvas"), {
      kind,
      ratio: settings.ratio,
      products: PRODUCTS,
            form: startForm,
      onFormChange: (value) => { startForm = value; },

      onCreate: async (design, { product_id }) => {
        // 실패하면 throw → 희주 화면이 "저장하지 못했습니다" 안내
        const data = await api("/chats", { method: "POST", body: { kind, design, product_id } });
        applyState(data.chat_id, data);
        loadHistory();
        renderWork();
      },
    });
    return;
  }
  if (!doc) {
    $("canvas").replaceChildren();
    return;
  }
  if (kind === "video") {
    renderVideo($("canvas"), doc, { onSave: saveDesign, onCommand: (text) => send(text), onUploadRef: uploadRef });
  }
  else {
    // 되돌리기·다시하기는 희주 편집기 오른쪽 칸에서 씁니다(값이 없으면 그 칸의 ↶ ↷는 숨김). 단축키는 아래 bindWork 그대로.
    editor.renderDesign($("canvas"), doc, {
      onSave: saveDesign,
      onUndo: () => move("undo"),
      onRedo: () => move("redo"),
      canUndo: work.canUndo && !work.busy,
      canRedo: work.canRedo && !work.busy,
    });
  }
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

// ---------- 한 줄 입력 · 한 줄 안내 ----------
// type: ok(반영) · ask(정보 필요) · warn(못 알아들음·오류) · info(안내)
function feedback(type, text) {
  $("feedback").className = `studio-feedback${type ? ` is-${type}` : ""}`;
  $("feedback-text").textContent = text;
  $("chat-choices").replaceChildren();
}

// 제품을 되물으면 답의 "(망고 요거트 찹쌀떡 / …)" 목록으로 고르기 버튼을 만듭니다.
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
  const isNew = !work.chatId;
  feedback("info", "반영하는 중…");
  const body = { text, kind, chat_id: work.chatId, ...settings, ...extra };
  // 카드뉴스에서 보고 있는 장(0부터). 희주 편집기에 currentPage()가 생기면 보냅니다. 없으면 서버가 1장 기준으로 고칩니다.
  if (!isNew && DESIGN_KINDS.includes(kind) && typeof editor.currentPage === "function") body.page = editor.currentPage();
  try {
    const data = await api("/messages", { method: "POST", body });
    if (data.ask === "product") {
      work.pending = { text, extra };
      feedback("ask", data.reply);
      showProductChoices(data.reply);
      return;
    }
    work.pending = null;
    applyState(data.chat_id, data);
    loadHistory();
    if (DESIGN_KINDS.includes(kind)) {
      if (isNew && kind === "poster") feedback("ok", "✓ 포스터 초안을 만들었어요 — 가운데에서 글자를 끌어 옮기고 고칠 수 있어요");
      else if (isNew) feedback("ok", `✓ 카드뉴스 ${data.design.pages.length}장 초안을 만들었어요 — 위 장 번호로 장을 옮기며 고칠 수 있어요`);
      else if (data.changes.length) feedback("ok", `✓ 반영: ${data.changes.join(" · ")}`);
      else feedback("warn", data.reply);
      return;
    }
    const recheck = data.design.reviewed ? "" : " — 프롬프트 다시 검토 필요";
    if (isNew) feedback("ok", `✓ ${data.design.scenes.length}컷 초안을 만들었어요 — 장면·자막·프롬프트를 검토해 주세요`);
    else if (data.changes.length) feedback("ok", `✓ 반영: ${data.changes.join(" · ")}${recheck}`);
    else feedback("warn", data.reply);
  } catch (error) {
    feedback("warn", `요청하지 못했습니다. (${error.message})`);
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
// ---------- 레퍼런스 (영상) ----------
// 분위기·구도·색감 참고용 이미지(희주 업로드 API)와 참고 영상(/api/ref-video). 제품 모양은 제품 사진을 따릅니다.
function currentRefs() {
  const doc = work.doc;
  return doc ? { user_refs: doc.user_refs || [], ref_video: doc.ref_video || null } : settings;
}

// 입력창 옆 레퍼런스는 첫 생성 화면에서만. 초안 뒤에는 ③ 영상 만들기의 레퍼런스 칸(sns_video.js)에서 넣고 뺍니다.
function renderRefs() {
  const show = kind === "video" && !work.doc;
  $("ref-add").hidden = !show;
  const { user_refs: images, ref_video: video } = currentRefs();
  $("refs").hidden = !show || (!images.length && !video);
  if (!show) return;
  const item = (node, label, remove) => {
    const box = el("span", "studio-ref");
    const x = el("button", "studio-ref-remove", "×");
    x.type = "button";
    x.title = `${label} 빼기`;
    x.addEventListener("click", remove);
    box.append(node, x);
    return box;
  };
  const nodes = images.map((ref, index) => {
    const img = el("img");
    img.src = ref.url;
    img.alt = "레퍼런스 이미지";
    return item(img, "레퍼런스 이미지", () => changeRefs({ user_refs: images.filter((_, i) => i !== index) }));
  });
  if (video) {
    const clip = el("video");
    clip.src = video.url;
    clip.muted = true;
    clip.preload = "metadata";
    nodes.push(item(clip, "참고 영상", () => changeRefs({ ref_video: null })));
  }
  $("refs").replaceChildren(...nodes);
}

// 초안 전에는 설정에, 초안 뒤에는 작업 문서에 저장(새 버전, 되돌리기 가능)
async function changeRefs(patch) {
  if (!work.doc) {
    Object.assign(settings, patch);
    return renderRefs();
  }
  const { phrase_pairs: _, ...doc } = work.doc;
  await saveDesign({ ...doc, ...patch });
}

async function addRef(file) {
  const isVideo = file.type.startsWith("video/");
  const refs = currentRefs();
  if (!isVideo && refs.user_refs.length >= USER_REFS_MAX) return feedback("warn", `레퍼런스 이미지는 ${USER_REFS_MAX}장까지 올릴 수 있어요.`);
  feedback("info", isVideo ? "참고 영상을 올리는 중…" : "레퍼런스 이미지를 올리는 중…");
  try {
    const ref = await uploadRef(file);
    await changeRefs(isVideo ? { ref_video: ref } : { user_refs: [...refs.user_refs, ref] });
    feedback("ok", isVideo ? "✓ 참고 영상을 넣었어요 (분위기·카메라 움직임 참고)" : "✓ 레퍼런스 이미지를 넣었어요 (분위기·구도·색감 참고)");
  } catch (error) {
    feedback("warn", `올리지 못했습니다. (${error.message})`);
  }
}

// ---------- 아래 수정 요청 입력 영역 접기 ----------
// 접은 상태는 이 브라우저에만 기억합니다(저장이 막힌 환경이면 기억만 안 함).
const COMMAND_KEY = "content_studio.command_collapsed";
let commandCollapsed = (() => {
  try { return localStorage.getItem(COMMAND_KEY) === "1"; } catch { return false; }
})();

function showCommand(collapsed) {
  $("chat-form").closest(".studio-command").classList.toggle("is-collapsed", collapsed);
  $("command-toggle").textContent = collapsed ? "펼치기 ▴" : "접기 ▾";
  $("command-toggle").setAttribute("aria-expanded", String(!collapsed));
}

function toggleCommand() {
  commandCollapsed = !commandCollapsed;
  try { localStorage.setItem(COMMAND_KEY, commandCollapsed ? "1" : ""); } catch { /* 기억만 안 함 */ }
  showCommand(commandCollapsed);
  if (!commandCollapsed) $("chat-input").focus();
}

// 레퍼런스 파일 올리기 → {file_id, url}. 이미지는 희주 업로드 API, 영상은 /api/ref-video
async function uploadRef(file) {
  const isVideo = file.type.startsWith("video/");
  const form = new FormData();
  form.append(isVideo ? "video" : "image", file);
  const url = isVideo ? `${API}/ref-video` : API.replace(/api$/, "media/api/upload");
  const response = await fetch(url, { method: "POST", body: form });
  const data = await response.json().catch(() => ({ ok: false, error: "서버 응답을 읽지 못했습니다." }));
  if (!data.ok) throw new Error(data.error || "올리지 못했습니다.");
  return { file_id: data.file_id, url: data.url };
}

// 영상 입력창은 글 길이에 맞춰 높이가 늘어납니다(최소 3줄·최대 8줄은 sns.css). 스크롤 막대 없이 보이게 합니다.
function fitInput() {
  const input = $("chat-input");
  if (kind !== "video") return;
  input.style.height = "auto";
  input.style.height = `${input.scrollHeight + 2}px`;  // 위아래 테두리 1px씩
}

async function renameWork(title) {
  try {
    const data = await api(`/chats/${work.chatId}`, { method: "PATCH", body: { title } });
    work.doc = data.design;
    renderWork();
    loadHistory();
    feedback("ok", `✓ 제목을 "${data.chat.title}"(으)로 바꿨어요`);
  } catch (error) {
    feedback("warn", `제목을 바꾸지 못했습니다. (${error.message})`);
  }
}

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

  const phrases = { "9:16": "세로로", "16:9": "가로로", "1:1": "정사각형으로", "4:5": "4:5로" };
  for (const button of $("set-ratio").children) {
    button.addEventListener("click", () => changeSetting("ratio", button.dataset.value, phrases[button.dataset.value]));
  }
  // 영상 제목: 초안 전에는 설정에 담고, 초안 뒤에는 Enter·칸을 떠날 때 이름 바꾸기
  $("set-title").addEventListener("input", (event) => { if (!work.doc) settings.title = event.target.value; });
  $("set-title").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); event.target.blur(); } });
  $("set-title").addEventListener("change", (event) => { if (work.doc && kind === "video") renameWork(event.target.value); });
  // 초안 뒤 고정된 제목: 누르면 고치기, 칸을 떠나면 다시 고정
  $("set-title").addEventListener("click", (event) => {
    if (!event.target.readOnly) return;
    event.target.readOnly = false;
    event.target.select();
  });
  $("set-title").addEventListener("blur", (event) => { if (work.doc && kind === "video") event.target.readOnly = true; });
  // [전체]는 4종 모두 켜기/끄기, 나머지는 여러 개를 함께 고릅니다.
  for (const button of $("set-product").children) {
    button.addEventListener("click", () => {
      const ids = PRODUCTS.map((item) => item.id), value = button.dataset.value;
      if (value === "all") settings.product_ids = settings.product_ids.length === ids.length ? [] : ids;
      else if (settings.product_ids.includes(value)) settings.product_ids = settings.product_ids.filter((id) => id !== value);
      else settings.product_ids = ids.filter((id) => id === value || settings.product_ids.includes(id));
      renderWork();
    });
  }
  $("set-duration").addEventListener("change", (event) => {
    const value = Math.min(30, Math.max(5, Math.round(Number(event.target.value)) || 5));
    event.target.value = value;
    changeSetting("duration", value, `${value}초로`);
  });
  $("set-sound").addEventListener("click", () => {
    const next = !(work.doc ? work.doc.sound : settings.sound);
    changeSetting("sound", next, next ? "소리 켜줘" : "소리 꺼줘");
  });

  $("chat-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = $("chat-input");
    send(input.value);
    input.value = "";
    fitInput();
  });
  // 한글 입력 중(조합 중) Enter는 글자 확정만 하고 보내지 않습니다.
  $("chat-input").addEventListener("input", fitInput);
  $("ref-add").addEventListener("click", () => $("ref-file").click());
  $("command-toggle").addEventListener("click", toggleCommand);
  $("ref-file").addEventListener("change", (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (file) addRef(file);
  });
  // Enter = 보내기, Shift+Enter = 줄바꿈. 한글 입력 중(조합 중) Enter는 글자 확정만 합니다.
  $("chat-input").addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    if (!event.isComposing) $("chat-form").requestSubmit();
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
  // 되돌리기·다시하기를 제품·비율·길이 줄 끝에 둡니다(가운데 한 줄).
  page.querySelector(".studio-options").append($("undo").parentElement);
  if (kind === "main") $("recs").replaceChildren(...recommendations().map(recCard));
  bindListTools();
  $("new").hidden = kind === "main";
  $("new").addEventListener("click", startNew);
  bindWork();

  const params = new URL(location.href).searchParams;
  const chatId = Number(params.get("chat"));
  const start = startRequest(params);
  if (chatId && WORK_KINDS.includes(kind)) openChat(chatId);
  else if (start && WORK_KINDS.includes(kind)) {
    startNew();
    send(start.text, { event: start.event, ...(start.product_id && { product_ids: [start.product_id] }) });
  } else loadGallery();
}
