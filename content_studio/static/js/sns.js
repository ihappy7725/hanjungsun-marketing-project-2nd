// 메인·첫 화면(작업 목록·미리보기 팝업·추천)·대화·되돌리기 [유진]
// type="module"로 불러오므로 전역 변수·함수가 생기지 않습니다.
import { renderVideo } from "./sns_video.js";
// 포스터·카드뉴스 편집기 [희주]. 묶어서 불러와, currentPage()가 아직 없어도 오류 없이 동작합니다.
import * as editor from "./sns_editor.js";

const KIND_LABELS = { poster: "포스터", cardnews: "카드뉴스", video: "영상" };
const WORK_KINDS = ["video", "poster", "cardnews"];  // 작업 화면이 연결된 탭
const DESIGN_KINDS = ["poster", "cardnews"];          // 희주 편집기(sns_editor.js)로 그리는 탭

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

// 기존 인증은 조용히 재사용합니다. 유료 기능을 쓸 수 있고 인증이 없을 때만 안내합니다.
let connectionRequest;
let loginPromptShown = false;
async function loadConnection() {
  if (connectionRequest) return connectionRequest;
  connectionRequest = refreshConnection();
  try { return await connectionRequest; }
  finally { connectionRequest = null; }
}

async function refreshConnection() {
  try {
    const data = await api("/higgsfield/status");
    page.dataset.generationEnabled = String(Boolean(data.generation_enabled));
    page.dataset.generationReason = data.reason || "생성 예산이 아직 확정되지 않았어요.";
    page.dataset.higgsfieldConnected = String(Boolean(data.connected));
    page.dispatchEvent(new CustomEvent("studio:higgsfield-status", { detail: data }));
    return data;
  } catch (error) {
    page.dataset.generationEnabled = "false";
    page.dataset.generationReason = "연결 상태를 확인하지 못했어요.";
    page.dataset.higgsfieldConnected = "false";
    page.dispatchEvent(new CustomEvent("studio:higgsfield-status", { detail: {
      connected: false, generation_enabled: false, reason: page.dataset.generationReason,
    } }));
    return null;
  }
}

async function ensureConnection() {
  const data = await loadConnection();
  if (!data?.generation_enabled || !data.login_required || loginPromptShown || $("work-screen").hidden) return;
  loginPromptShown = true;
  const dialog = el("dialog", "studio-login-dialog");
  const title = el("h2", "", "Higgsfield 로그인이 필요해요");
  title.id = "studio-login-title";
  dialog.setAttribute("aria-labelledby", title.id);
  const note = el("p", "studio-hint", "처음 한 번 로그인하면 기존 구독으로 제작할 수 있어요.");
  note.setAttribute("role", "status");
  const login = el("button", "btn dark", "로그인");
  const later = el("button", "btn", "편집 먼저 하기");
  login.type = later.type = "button";
  later.addEventListener("click", () => dialog.close());
  login.addEventListener("click", async () => {
    login.disabled = true;
    note.textContent = "로그인 화면을 여는 중…";
    try {
      // 다른 창에서 이미 인증했다면 로그인 화면을 다시 열지 않습니다.
      if ((await loadConnection())?.connected) { dialog.close(); return; }
      const data = await api("/higgsfield/connect", { method: "POST", body: {} });
      const destination = new URL(data.authorization_url);
      if (destination.origin !== "https://clerk.higgsfield.ai" || destination.pathname !== "/oauth/authorize") {
        throw new Error("로그인 주소를 확인하지 못했습니다.");
      }
      location.assign(destination.href);
    } catch (error) {
      note.textContent = error.message;
      login.disabled = false;
    }
  });
  const actions = el("div", "actions");
  actions.append(later, login);
  dialog.append(title, note, actions);
  dialog.addEventListener("close", () => { dialog.remove(); loginPromptShown = false; }, { once: true });
  page.append(dialog);
  dialog.showModal();
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
const listView = { kind: "", newest: true, query: "", items: [] };
const EMPTY_NOTE = $("gallery-empty")?.textContent || "";

function renderList() {
  const query = listView.query.trim().toLowerCase();
  const items = listView.items
    .filter((item) => (!listView.kind || item.kind === listView.kind) && (!query || item.title.toLowerCase().includes(query)))
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1) * (listView.newest ? 1 : -1));
  const head = el("div", "studio-row is-head");
  head.append(...["종류", "제목", "제품", "상태", "수정일"].map((text) => el("span", "", text)));
  $("gallery").replaceChildren(head, ...items.map(workRow));
  const total = listView.items.length;
  $("gallery-count").textContent = !total ? "" : items.length === total ? `${total}개` : `${total}개 중 ${items.length}개`;
  $("gallery-empty").textContent = total ? "조건에 맞는 작업이 없습니다." : EMPTY_NOTE;
  $("gallery-empty").hidden = items.length > 0;
  $("gallery").hidden = items.length === 0;
}

function bindListTools() {
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
  // [수정하기]로 들어가야 할 수 있는 일(포스터·카드뉴스는 Figma 보내기 포함)을 버튼 바로 위에 알려 줍니다.
  const guide = el("p", "studio-preview-guide", item.kind === "video"
    ? "수정하기를 누르면 장면·프롬프트를 고치고 미리보기 이미지·영상을 만들 수 있어요."
    : "수정하기를 누르면 편집 화면에서 시안 고치기 · AI 초안 · 문구 검수 · Figma로 보내기를 할 수 있어요.");
  dialog.append(el("h2", "", item.title),
    el("p", "studio-hint", `${KIND_LABELS[item.kind]} · ${productNames(item.product_id)} · ${statusOf(item)} · ${shortDate(item.updated_at)}`),
    body, guide, actions);
  dialog.addEventListener("close", () => dialog.remove());
  page.append(dialog);
  dialog.showModal();
}

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
const VIDEO_FIRST_PLACEHOLDER = "예: 망고 요거트 찹쌀떡의 단면을 보여주는 따뜻한 분위기의 영상을 만들어 줘.";
const REVISE_PLACEHOLDER = "예: 제품을 더 가까이 보여 줘. 마지막 장면은 선물 포장으로 바꿔 줘.";
const RATIO_LABELS = { "4:5": "피드 4:5", "9:16": "스토리 9:16", "16:9": "가로 16:9", "1:1": "정사각형 1:1" };

function setUrl(chatId) {
  const url = new URL(location.href);
  url.searchParams.set("tab", kind);
  if (chatId) url.searchParams.set("chat", chatId);
  else url.searchParams.delete("chat");
  url.searchParams.delete("start");  // 추천 요청은 한 번만 (새로고침해도 다시 만들지 않게)
  url.searchParams.delete("new");
  history.replaceState(null, "", url);
}

function showScreen(name) {
  $("home-screen").hidden = name !== "home";
  $("work-screen").hidden = name !== "work";
  $("new").hidden = kind === "main";
  page.classList.toggle("is-working", name === "work");
  if (name === "work") ensureConnection();
}

function goHome() {
  if (work.busy) return;
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
  if (work.busy) return;
  if (!WORK_KINDS.includes(kind)) return notify(`새 ${KIND_LABELS[kind]} 작업 화면은 다음 단계에서 연결됩니다.`);
  resetWork();
  showScreen("work");
  setUrl(null);
  notify("");
  // 새 작업은 요청부터 시작하며 이전 작업 목록은 접습니다.
  $("history").hidden = true;
  $("history-toggle").setAttribute("aria-expanded", "false");
  $("work-screen").classList.remove("has-history");
  Object.assign(settings, { title: "", user_refs: [], ref_video: null });  // 제목·레퍼런스는 작업마다 새로
  startForm = null;
  $("chat-input").value = "";
  $("advanced-settings").open = false;
  feedback("", "");
  renderWork();
  if (kind === "video") $("chat-input").focus();
}

async function openChat(chatId) {
  if (work.busy) return;
  try {
    const data = await api(`/chats/${chatId}`);
    if (data.chat.kind !== kind) return notify("다른 탭의 작업입니다.");
    resetWork();
    showScreen("work");
    notify("");
    applyState(chatId, data);
    loadHistory();
  } catch (error) {
    goHome();
    notify(`작업을 열지 못했습니다. (${error.message})`);
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
    button.textContent = RATIO_LABELS[button.dataset.value];
    button.setAttribute("aria-pressed", String(isCurrent));
    button.disabled = ratioLocked;
    button.title = ratioLocked ? "비율은 새로 만들 때 정해요" : "";
  }
  $("set-duration").closest("label").hidden = kind !== "video";
  $("set-sound").hidden = kind !== "video";
  $("work-screen").classList.toggle("is-start", !doc);
  $("video-setup").hidden = kind !== "video";
  $("design-assistant").hidden = !DESIGN_KINDS.includes(kind);
  $("assistant-hint").textContent = doc ? "원하는 부분을 고치며 완성해 보세요." : "제품과 원하는 내용만 알려 주세요.";
  $("settings-summary").textContent = `${current.ratio}${kind === "video" ? ` · ${current.duration}초` : ""}`;
  $("canvas-title").textContent = `${KIND_LABELS[kind]} ${doc ? "다듬기" : "미리보기"}`;
  $("save-state").textContent = work.busy ? "내용을 반영하는 중…" : doc ? "작업 저장됨" : "내용을 입력하면 시작돼요";
  for (const step of page.querySelectorAll("[data-step]")) {
    const active = step.dataset.step === (doc ? "edit" : "request");
    if (active) step.setAttribute("aria-current", "step");
    else step.removeAttribute("aria-current");
    step.classList.toggle("is-done", Boolean(doc) && step.dataset.step === "request");
  }
  // 제품 고르기: 영상만. 초안 뒤에는 그 작업의 제품을 보여 주고 잠급니다.
  const chosen = doc ? PRODUCTS.filter((item) => (doc.products || [doc.product]).includes(item.name_ko)).map((item) => item.id)
    : settings.product_ids;
  // 영상 초안 뒤 제품은 고정하고 작업 이름은 왼쪽에서 고칩니다.
  $("product-field").hidden = kind !== "video" || Boolean(doc);
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
  $("set-sound").setAttribute("aria-pressed", String(Boolean(current.sound)));
  $("undo").disabled = !work.canUndo || work.busy;
  $("redo").disabled = !work.canRedo || work.busy;
  $("send").disabled = work.busy;
  $("send").textContent = work.busy ? "정리하는 중…" : doc ? "수정 요청하기 ↑" : "내용 정리하기 ↑";
  $("new").disabled = $("go-home").disabled = work.busy;
  $("request-label").textContent = doc ? "어떤 부분을 바꿀까요?" : "어떤 영상을 만들까요?";
  $("examples").hidden = Boolean(doc);

  // 이미지는 편집기가 왼쪽 요청 패널을 관리합니다. 공통 대화 입력은 영상에 씁니다.
  $("chat-form").hidden = DESIGN_KINDS.includes(kind);
  $("command-panel").hidden = DESIGN_KINDS.includes(kind) && !$("feedback-text").textContent;
  // 영상 초안 뒤에만 접을 수 있습니다(첫 생성 화면은 늘 펼침).
  $("command-toggle").hidden = !doc || DESIGN_KINDS.includes(kind);
  showCommand(Boolean(doc) && commandCollapsed && kind === "video");
  if (!doc && DESIGN_KINDS.includes(kind)) {
    editor.renderStart($("canvas"), {
      kind,
      ratio: settings.ratio,
      products: PRODUCTS,
      assistantRoot: $("design-assistant"),
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
    const empty = el("div", "studio-video-empty");
    const frame = el("div", "studio-video-empty-frame");
    frame.style.aspectRatio = current.ratio.replace(":", " / ");
    frame.append(el("span", "studio-video-empty-play", "▷"), el("span", "", `${current.duration}초 · ${current.ratio}`));
    empty.append(frame, el("h3", "", "이곳에서 영상이 완성돼요"),
      el("p", "", "왼쪽에 원하는 내용을 적으면 먼저 장면 구성을 보여 드려요."),
      el("p", "studio-hint", "내용을 확인한 뒤 이미지를 만들거나 영상 생성을 시작할 수 있어요."));
    $("canvas").replaceChildren(empty);
    return;
  }
  if (kind === "video") {
    renderVideo($("canvas"), doc, { onSave: saveDesign, onCommand: (text) => send(text), onUploadRef: uploadRef });
  }
  else editor.renderDesign($("canvas"), doc, {
    onSave: saveDesign,
    assistantRoot: $("design-assistant"),
    onGenerated: (data) => { applyState(work.chatId, data); notify(data.warning || data.error || ""); loadHistory(); },
  });
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
  $("command-panel").hidden = DESIGN_KINDS.includes(kind) && !text;
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
  $("send").disabled = $("new").disabled = $("go-home").disabled = true;
  $("send").textContent = "정리하는 중…";
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
    const recheck = data.design.reviewed ? "" : " — 바뀐 내용을 확인해 주세요";
    if (isNew) feedback("ok", `✓ ${data.design.scenes.length}개 장면을 준비했어요. 오른쪽에서 확인하고 영상을 만들어 보세요.`);
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
  if (work.busy) return;
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
  $("command-toggle").textContent = collapsed ? "수정 요청 펼치기 ▾" : "수정 요청 접기 ▴";
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
  page.addEventListener("toggle", (event) => {
    if (event.target.matches(".studio-editor-image-options[open]")) ensureConnection();
  }, true);
  $("go-home").addEventListener("click", goHome);
  $("history-toggle").addEventListener("click", () => {
    $("history").hidden = !$("history").hidden;
    $("history-toggle").setAttribute("aria-expanded", String(!$("history").hidden));
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
      if (work.busy) return;
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
    if (work.busy || !input.value.trim()) return;
    send(input.value);
    input.value = "";
    fitInput();
  });
  // 한글 입력 중(조합 중) Enter는 글자 확정만 하고 보내지 않습니다.
  $("chat-input").addEventListener("input", fitInput);
  for (const button of page.querySelectorAll("[data-example]")) {
    button.addEventListener("click", () => {
      $("chat-input").value = button.dataset.example;
      fitInput();
      $("chat-input").focus();
    });
  }
  $("ref-add").addEventListener("click", () => $("ref-file").click());
  $("command-toggle").addEventListener("click", toggleCommand);
  $("ref-file").addEventListener("change", (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (file) addRef(file);
  });
  // Enter = 보내기, Shift+Enter = 줄바꿈. 한글 입력 중(조합 중) Enter는 글자 확정만 합니다.
  $("chat-input").addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    $("chat-form").requestSubmit();
  });

  // Ctrl+Z / Ctrl+Shift+Z: 입력칸에 쓰는 중에는 글자 되돌리기로 둡니다.
  document.addEventListener("keydown", (event) => {
    if ($("work-screen").hidden || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
    if (event.target.closest("input, textarea, [contenteditable='true']")) return;
    event.preventDefault();
    move(event.shiftKey ? "redo" : "undo");
  });
}

// ---------- 시작 ----------
if (page) {
  page.dataset.generationEnabled = "false";
  page.dataset.generationReason = "생성 예산이 아직 확정되지 않았어요.";
  page.dataset.higgsfieldConnected = "false";
  loadConnection();
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
    if (DESIGN_KINDS.includes(kind)) {
      startForm = { request: start.text, product_id: start.product_id, ratio: settings.ratio };
      renderWork();
    } else {
      settings.product_ids = start.product_id ? [start.product_id] : [];
      $("chat-input").value = start.text;
      renderWork();
    }
  } else if (params.get("new") === "1" && WORK_KINDS.includes(kind)) startNew();
  else loadGallery();
}
