// 포스터·카드뉴스 편집기, 미리보기, PNG 내보내기 [희주]
// sns.js가 import합니다. 가운데 영역만 그리고, 저장은 sns.js가 넘겨준 onSave로 합니다.
// 문서 형식은 designs.py 위쪽 설명과 같습니다: x·y·w·h는 페이지 대비 %, size는 원본 크기 기준 px.
import {
  FONT_GROUPS, LOCAL_PREFIX, fontFamily, getLocalFonts, loadFont, loadFontsFor, loadLocalFonts, localFontsSupported,
} from "./sns_fonts.js";
import { openRemoveBg } from "./sns_image.js";

export const SIZES = { "1:1": [1080, 1080], "4:5": [1080, 1350], "9:16": [1080, 1920], "16:9": [1920, 1080] };
const LOCAL_ACTION = "__local__";  // 글꼴 목록의 "내 PC 글꼴 불러오기…"
const LINE = 1.2;     // 줄 간격 (글자 크기의 배수)
const MIN_SIZE = 2;   // 요소 최소 너비·높이 (%)
const MAX_VIEW = 0.7; // 미리보기 최대 높이 (창 높이 대비)
const UPLOAD_API = "/content_studio/media/api/upload";  // routes_media.py
const REVIEW_API = "/content_studio/media/api/review";
const BRIEF_API = "/content_studio/media/api/design-brief";
const ASSISTANT_API = "/content_studio/media/api/design-assistant";
const FIGMA_API = "/content_studio/media/api/figma-preview";
const FIGMA_DESIGN_API = "/content_studio/media/api/figma/designs";  // 플러그인 창구 (주소 확인에도 씀)
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIDE = 4096;
// [추가] 메뉴의 이모지 16종 (designs.py EMOJIS와 같은 목록)
const EMOJIS = ["❤️", "⭐", "✨", "🌸", "🎁", "🎀", "🎉", "🔥", "😊", "👍", "🍡", "🍰", "🍵", "🍃", "🥭", "🍓"];
const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';

const MOVE_STEP = 1;    // 방향키 한 번에 옮기는 거리 (%) · Shift와 함께 누르면 BIG_STEP
const BIG_STEP = 5;
const ROLE_NAMES = { title: "제목", subtitle: "부제", body: "본문", checks: "체크 항목", quote: "감성 문구", badge: "배지",
  brand: "로고", page_no: "쪽 번호", photo: "제품 사진", deco: "장식 원", card: "본문 바탕", overlay: "사진 위 바탕", bar: "위쪽 줄" };
const TYPE_NAMES = { text: "글", image: "사진", shape: "도형", sticker: "이모지" };

const measure = document.createElement("canvas").getContext("2d");
// 베트남어 성조처럼 여러 코드로 된 글자를 한 글자로 셉니다. (지원하지 않는 브라우저는 코드 단위)
const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
let selectedId = null;  // 저장 후 다시 그려도 선택을 유지합니다. (모듈 안 변수)
let pageIndex = 0;      // 카드뉴스에서 보고 있는 장. 저장 후 다시 그려도 같은 장에 남습니다.
let focusAfterRender = false;  // 키보드로 고치다 저장하면, 다시 그린 뒤 선택한 요소로 초점을 돌려줍니다.
let promptCache = null;  // 오른쪽 프롬프트 칸. 저장 후 다시 그려도 같은 작업이면 입력·AI 제안을 유지합니다.

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function sizeOf(doc) {
  return SIZES[doc.ratio] || SIZES["4:5"];
}

function fontOf(item) {
  return `${item.weight || 400} ${item.size}px ${fontFamily(item.font)}`;
}

function padOf(item) {
  return item.bg ? item.size * 0.4 : 0;
}

function graphemes(text) {
  return segmenter ? Array.from(segmenter.segment(text), (part) => part.segment) : Array.from(text);
}

// 화면과 내보내기가 같은 줄바꿈을 쓰도록 글자 폭을 재서 줄을 나눕니다.
// 상자보다 긴 한 단어(띄어쓰기 없는 한국어·해시태그·URL 등)는 글자 단위로 나눕니다.
function wrapLines(ctx, item, maxWidth) {
  ctx.font = fontOf(item);
  const lines = [];
  for (const paragraph of String(item.text || "").split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width <= maxWidth) {
        line = next;
        continue;
      }
      if (line) lines.push(line);
      line = "";
      for (const char of graphemes(word)) {
        if (line && ctx.measureText(line + char).width > maxWidth) {
          lines.push(line);
          line = char;
        } else {
          line += char;
        }
      }
    }
    lines.push(line);
  }
  return lines;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function stickerSize(item, W, H) {
  return Math.min(item.w / 100 * W, item.h / 100 * H) * 0.85;
}

// 배경 위에서 읽히는 글자색 (새 텍스트 기본값)
function contrastOf(hex) {
  const value = /^#[0-9a-f]{6}$/i.test(hex || "") ? hex : "#ffffff";
  const [r, g, b] = [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16) / 255);
  return 0.299 * r + 0.587 * g + 0.114 * b > 0.55 ? "#222222" : "#ffffff";
}

function imageSize(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve([img.naturalWidth, img.naturalHeight]); URL.revokeObjectURL(url); };
    img.onerror = () => { resolve(null); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

function field(label, input) {
  const box = el("label", "studio-editor-field");
  box.append(el("span", "", label), input);
  return box;
}

function button(text, onClick, className = "btn") {
  const node = el("button", className, text);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

function option(value, text, disabled = false) {
  const node = el("option", "", text);
  node.value = value;
  node.disabled = disabled;
  return node;
}

function selectBox(className, choices, value, onChange) {
  const select = el("select", className);
  for (const [key, text] of choices) select.append(option(key, text));
  select.value = value;
  select.addEventListener("change", () => onChange(select.value));
  return select;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ ok: false }));
  if (!data.ok) throw new Error(data.error || "서버에 연결하지 못했습니다.");
  return data;
}

// ---------- 프롬프트 · AI 초안 (제작 조건 → 기본 프롬프트 → AI 제안 3개 → 적용) ----------
// 편집기 오른쪽 칸(promptPanel)과 첫 화면(renderStart)이 같이 씁니다. 저장은 onApply(design)가 하고, 실패하면 throw합니다.
// extra: 제작 조건 맨 앞에 넣을 칸(첫 화면의 제품 고르기). isActive: 화면이 아직 열려 있는지.
// empty: 결과가 없을 때만 보일 안내(첫 화면 오른쪽 빈 틀).
// productId: 고른 제품 id를 돌려주는 함수(첫 화면). 요청에 함께 보내 서버가 제품 목록으로 확인합니다.
// initial: 처음 채울 조건(첫 화면에서 규격을 바꿔 다시 그릴 때). status: 처음 보일 안내.
// 돌려주는 값: intro(제목·안내) · controls(조건·버튼) · results(제안·프롬프트) 묶음과, 순서대로 합친 nodes.
function promptForm(doc, { onApply, isActive = () => true, extra = null, empty = null, productId = null,
  initial = null, status = "" } = {}) {
  const previous = initial || doc.assistant?.options || {};
  const wish = el("textarea");
  wish.rows = 4;
  wish.maxLength = 1500;
  wish.value = previous.request || "";
  wish.placeholder = productId
    ? "확인된 제품 정보와 원하는 내용을 적어 주세요. 위에서 고른 제품은 자동으로 들어가요. 예: 신메뉴 소개"
    : "제품명, 확인된 제품 정보와 원하는 내용을 적어 주세요. 예: 망고스틴 찹쌀떡 신메뉴 소개";
  const purpose = selectBox("", [["신메뉴 소개", "신메뉴 소개"], ["브랜드 소개", "브랜드 소개"], ["제품 정보", "제품 정보"], ["행사 안내", "행사 안내"], ["선물 제안", "선물 제안"]], previous.purpose || "신메뉴 소개", () => {});
  const audience = el("input");
  audience.value = previous.audience || "";
  audience.maxLength = 1500;
  audience.placeholder = "예: 다낭의 20~30대 디저트 소비자";
  const mood = selectBox("", ["깔끔한 정보형", "사진 중심", "따뜻한 감성", "발랄하고 귀여운", "차분하고 고급스러운"].map((v) => [v, v]), previous.mood || "깔끔한 정보형", () => {});
  const density = selectBox("", ["짧게", "보통", "설명 중심"].map((v) => [v, v]), previous.density || "짧게", () => {});
  const pages = selectBox("", [3, 4, 5, 6].map((v) => [String(v), `${v}장`]), String(previous.pages || doc.pages.length), () => {});
  if (!pages.value) pages.value = "5";
  const msg = el("p", "studio-hint", status);
  msg.setAttribute("role", "status");
  const result = el("textarea", "studio-editor-prompt-result");
  result.rows = 10;
  result.maxLength = 12000;
  result.setAttribute("aria-label", "제작 프롬프트 — 수정 후 AI에 반영할 수 있습니다");
  result.hidden = true;
  const candidates = el("div", "studio-editor-candidates");
  let proposals = [], selected = 0;
  const settingsBox = el("fieldset", "studio-editor-brief");
  const wide = (node) => { node.classList.add("is-wide"); return node; };  // 두 칸을 다 쓰는 칸
  settingsBox.append(el("legend", "", "제작 조건"));
  if (extra) settingsBox.append(wide(extra));
  settingsBox.append(wide(field(productId ? "요청" : "제품·요청", wish)), wide(field("대상", audience)),
    field("목적", purpose), field("분위기", mood), field("글의 양", density));
  if (doc.kind === "cardnews") settingsBox.append(field("장수", pages));
  const syncEmpty = () => { if (empty) empty.hidden = proposals.length > 0 || !result.hidden; };
  const options = () => ({ request: wish.value, purpose: purpose.value, audience: audience.value,
    mood: mood.value, density: density.value, pages: doc.kind === "poster" ? 1 : Number(pages.value),
    custom_prompt: result.hidden ? "" : result.value, ...(productId && { product_id: productId() }) });
  const copy = button("복사", async () => {
    try {
      await navigator.clipboard.writeText(result.value);
      msg.textContent = "프롬프트를 복사했습니다. 외부 도구에서 사용할 수 있습니다.";
    } catch {
      result.select();
      msg.textContent = "Ctrl+C를 눌러 복사해 주세요.";
    }
  });
  copy.hidden = true;
  const apply = button("선택한 초안 적용", async () => {
    if (!proposals[selected] || !onApply) return;
    if (result.value !== proposals[selected].prompt) { msg.textContent = "수정한 프롬프트를 디자인에 반영하려면 AI 제안을 다시 생성해 주세요."; return; }
    apply.disabled = true;
    try {
      await onApply(proposals[selected].design);
    } catch { msg.textContent = "초안을 저장하지 못했습니다. 기존 작업은 유지됩니다."; }
    finally { apply.disabled = false; }
  }, "btn dark");
  apply.hidden = true;
  // 제안 카드: 실제 모양 미리보기 + 문구(베트남어·한국어 뜻). 카드 아무 곳이나 누르면 고릅니다.
  function showCandidates() {
    candidates.replaceChildren(...proposals.map((item, index) => {
      const isSelected = index === selected;
      const card = el("section", `studio-editor-candidate${isSelected ? " is-selected" : ""}`);
      card.addEventListener("click", (event) => {
        if (event.target.closest("summary") || selected === index) return;
        selected = index;
        result.value = item.prompt;
        showCandidates();
      });
      const choose = button(`${isSelected ? "✓ " : ""}${item.name}`, () => {}, isSelected ? "btn dark" : "btn");
      choose.setAttribute("aria-pressed", String(isSelected));
      const words = el("details", "studio-editor-candidate-words");
      words.open = item.pages.length === 1;
      words.append(el("summary", "", item.pages.length > 1 ? `문구 보기 · ${item.pages.length}장` : "문구 보기"));
      item.pages.forEach((page, pageNumber) => {
        const vi = el("p", "", `${item.pages.length > 1 ? `${pageNumber + 1}장 · ` : ""}${page.title_vi}\n${page.body_vi}`);
        vi.lang = "vi";
        words.append(vi, el("p", "studio-hint", `${page.title_ko}\n${page.body_ko}`));
      });
      card.append(choose, item.design ? renderThumb(item.design) : "", words);
      return card;
    }));
    syncEmpty();
  }
  function invalidate() {
    proposals = [];
    candidates.replaceChildren();
    apply.hidden = true;
    result.value = "";
    result.hidden = copy.hidden = true;
    syncEmpty();
    msg.textContent = "조건을 바꿨습니다. 프롬프트 또는 AI 제안을 다시 만들어 주세요.";
  }
  settingsBox.addEventListener("input", invalidate);
  const brief = button("기본 프롬프트 보기 (무료)", async () => {
    brief.disabled = make.disabled = settingsBox.disabled = true;
    try {
      const data = await postJson(BRIEF_API, { design: doc, options: { ...options(), custom_prompt: "" } });
      proposals = [];
      candidates.replaceChildren();
      apply.hidden = true;
      result.value = data.prompt;
      result.hidden = copy.hidden = false;
      syncEmpty();
      msg.textContent = `${data.rules_ready ? "현지 지침 포함." : "현지 검수 기준 준비 중."} ${data.ai_ready ? "AI 연결 설정 있음." : "유료 AI는 PM1의 API 키 설정 후 사용할 수 있습니다."}`;
    } catch (error) { msg.textContent = error.message; }
    finally { brief.disabled = make.disabled = settingsBox.disabled = false; }
  });
  const make = button("AI 제안 3개 생성 (유료)", async () => {
    if (!wish.value.trim()) { msg.textContent = "제품과 원하는 내용을 입력해 주세요."; return; }
    make.disabled = brief.disabled = apply.disabled = settingsBox.disabled = result.disabled = true;
    candidates.inert = true;
    msg.textContent = "AI 제안을 만드는 중… 자동 재시도하지 않습니다.";
    try {
      const data = await postJson(ASSISTANT_API, { design: doc, options: options(), confirm_paid: true });
      if (!isActive()) return;
      proposals = data.proposals;
      selected = 0;
      result.value = proposals[0].prompt;
      result.hidden = copy.hidden = apply.hidden = false;
      showCandidates();
      candidates.scrollIntoView({ block: "nearest" });
      msg.textContent = `${data.rules_ready ? "현지 지침 포함." : "현지 검수 기준 준비 중."} ${data.model} · 입력 ${data.usage.input_tokens || 0} / 출력 ${data.usage.output_tokens || 0} 토큰. 제안을 고르고 적용하세요.`;
    } catch (error) { msg.textContent = error.message; }
    finally {
      make.disabled = brief.disabled = apply.disabled = settingsBox.disabled = result.disabled = false;
      candidates.inert = false;
    }
  }, "btn dark");
  const label = doc.kind === "poster" ? "포스터" : "카드뉴스";
  const actions = el("div", "studio-editor-actions");
  actions.append(brief, make);
  const resultActions = el("div", "studio-editor-actions");
  resultActions.append(apply, copy);
  const styleNote = doc.kind === "poster"
    ? "포스터 스타일 설명은 참고 가이드예요. 배치·색은 기본 틀 그대로 적용돼요."
    : "스타일은 검토용 제안이에요.";
  const intro = [el("h2", "", `${label} AI 초안`),
    el("p", "studio-hint", `베트남어 문구와 한국어 뜻을 함께 만들어요. ${styleNote}`),
    el("p", "studio-editor-cost", "유료 버튼은 누를 때마다 OpenAI 비용이 나가요 (시험 예산 약 $5, 자동 차단 없음). 사진 생성 비용은 없어요.")];
  const controls = [settingsBox, actions, msg];
  const results = [candidates, resultActions, result];
  syncEmpty();
  return { intro, controls, results, nodes: [...intro, ...controls, ...results], focus: () => wish.focus(), options };
}

// ---------- 첫 화면 (작업이 아직 없을 때) ----------
// sns.js(유진)가 포스터·카드뉴스 탭에 작업이 없을 때 부릅니다. 왼쪽 제작 조건 · 오른쪽 AI 초안 미리보기 두 칸이고,
// 고른 초안은 onCreate(design, { product_id })로 새 작업에 저장합니다. (저장 실패 시 onCreate가 throw)
// products: [{id, name_ko}] — 주면 제품 고르기 칸을 맨 앞에 넣습니다.
// form·onFormChange: 입력 중인 조건을 sns.js가 들고 있다가, 규격을 바꿔 다시 그릴 때 form으로 돌려줍니다.
export function renderStart(root, { kind, ratio, products = [], onCreate, form: saved = null, onFormChange } = {}) {
  // 빈 초안: 색은 designs.py 기본 색 조합을 쓰도록 비워 둡니다.
  const base = { kind, ratio, demo: true, pages: [{ elements: [] }] };
  const [W, H] = sizeOf(base);
  const label = kind === "poster" ? "포스터" : "카드뉴스";
  const wrap = el("div", "studio-editor studio-editor-start");
  const side = el("div", "studio-editor-start-form");
  const main = el("section", "studio-editor-start-result");

  // 결과가 나오기 전 오른쪽: 고른 비율의 빈 틀 + 다음에 할 일
  const empty = el("div", "studio-editor-empty");
  const frame = el("div", "studio-editor-empty-frame", ratio);
  frame.style.aspectRatio = `${W} / ${H}`;
  empty.append(frame, el("p", "", `왼쪽 조건을 고르고 [AI 제안 3개 생성]을 누르면 여기에 ${label} 초안 3개가 나타나요.`),
    el("p", "studio-hint", "마음에 드는 초안을 골라 적용하면 바로 편집 화면으로 넘어가요."));

  const savedProduct = products.some((item) => item.id === saved?.product_id) ? saved.product_id : products[0]?.id;
  const product = products.length ? selectBox("", products.map((item) => [item.id, item.name_ko]), savedProduct, () => {}) : null;
  const form = promptForm(base, {
    isActive: () => wrap.isConnected,
    extra: product && field("제품", product),
    empty,
    productId: product && (() => product.value),
    initial: saved,
    status: saved && saved.ratio !== ratio ? "규격을 바꿨어요. 입력한 조건은 그대로예요. 프롬프트 또는 AI 제안을 다시 만들어 주세요." : "",
    onApply: (design) => onCreate(design, { product_id: product ? product.value : null }),
  });
  // 조건을 고칠 때마다 sns.js에 알려, 규격을 바꿔 다시 그려도 입력이 남게 합니다.
  if (onFormChange) side.addEventListener("input", () => onFormChange({ ...form.options(), ratio }));
  side.append(...form.intro, ...form.controls);
  main.append(el("h3", "", "AI 초안 미리보기"), empty, ...form.results);
  wrap.append(side, main);
  root.replaceChildren(wrap);
}

// 지금 편집기에서 보고 있는 장 번호(0부터). sns.js가 대화로 고치기 요청에 page로 보냅니다.
export function currentPage() {
  return pageIndex;
}

// ---------- 편집기 ----------
// root 안에 포스터·카드뉴스 문서(README 8장 형식)를 그립니다. onSave(newDoc)는 Promise를 돌려줍니다.
// 카드뉴스처럼 여러 장이면 포스터 왼쪽 장 번호 버튼으로 장을 옮깁니다.
// 배치: 위쪽 도구 줄 · 왼쪽(장 번호 + 포스터) · 오른쪽(프롬프트 · 문구 · 검수 · Figma)
export function renderDesign(root, doc, { onSave } = {}) {
  const draft = structuredClone(doc);
  if (pageIndex >= draft.pages.length) pageIndex = 0;
  let page = draft.pages[pageIndex];
  const [W, H] = sizeOf(draft);
  let scale = 1;
  let action = null;   // 끌기·크기 조절 중인 정보
  let editing = false; // 글자 수정 중에는 다시 그리지 않습니다.

  const wrap = el("div", "studio-editor");
  const pagesBar = el("div", "studio-editor-pages");
  const bar = el("div", "studio-editor-bar");
  const view = el("div", "studio-editor-view");
  const stage = el("div", "studio-editor-stage");
  const review = el("div", "studio-editor-review");  // 광고 표현 검수 결과
  const translations = el("details", "studio-editor-translations");
  translations.open = true;
  review.hidden = true;
  stage.setAttribute("role", "group");
  stage.setAttribute("aria-label",
    "편집 화면. Tab으로 요소 고르기, Enter로 글 고치기(Ctrl+Enter로 마치기), 방향키로 옮기기(Shift와 함께 크게), Esc로 선택 풀기");
  stage.style.width = `${W}px`;
  stage.style.height = `${H}px`;
  view.append(stage);
  const left = el("div", "studio-editor-left");   // 장 번호(세로) + 포스터
  const side = el("aside", "studio-editor-side"); // 프롬프트 · 문구 · 검수 · Figma
  const body = el("div", "studio-editor-body");
  left.append(pagesBar, view);
  side.append(promptPanel(), translations, review);
  body.append(left, side);
  wrap.append(bar, body);
  root.replaceChildren(wrap);
  let externalPanel = null;  // Figma 칸 (renderExternal)
  renderExternal();
  window.addEventListener("focus", syncFigma);
  syncFigma();

  const find = (id) => page.elements.find((item) => item.id === id);
  if (selectedId && !find(selectedId)) selectedId = null;

  async function save() {
    if (!onSave) return;
    focusAfterRender = stage.contains(document.activeElement);
    try {
      await onSave(structuredClone(draft));
    } catch {
      // 안내 문구는 sns.js가 보여줍니다.
    } finally {
      focusAfterRender = false;
    }
  }

  // ---------- 그리기 ----------
  function itemLabel(item) {
    const name = ROLE_NAMES[item.role] || TYPE_NAMES[item.type] || "요소";
    if (item.type === "text") return `${name} 글: ${String(item.text || "").slice(0, 40)}`;
    if (item.type === "sticker") return `이모지 ${item.emoji || ""}`;
    if (item.type === "image" && !item.src) return "제품 사진 자리";
    return name;
  }

  let refocusing = false;  // 코드로 초점을 옮길 때는 focusin에서 다시 고르지 않습니다.
  function focusItem(id) {
    const node = id && stage.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (!node) return;
    refocusing = true;
    node.focus({ preventScroll: true });
    refocusing = false;
  }

  function drawItem(item) {
    const node = el("div", "studio-editor-item");
    node.dataset.id = item.id;
    node.tabIndex = 0;
    node.setAttribute("role", "button");
    node.setAttribute("aria-label", itemLabel(item));
    node.setAttribute("aria-pressed", String(item.id === selectedId));
    Object.assign(node.style, {
      left: `${item.x}%`, top: `${item.y}%`, width: `${item.w}%`, height: `${item.h}%`, zIndex: item.z || 0,
    });

    if (item.type === "text") {
      const pad = padOf(item);
      node.classList.add("is-text");
      Object.assign(node.style, {
        font: fontOf(item),
        lineHeight: LINE,
        color: item.color,
        textAlign: item.align || "left",
        padding: `0 ${pad}px`,
        background: item.bg || "",
        borderRadius: item.bg ? `${item.size * 0.5}px` : "",
      });
      node.append(el("div", "studio-editor-text", wrapLines(measure, item, item.w / 100 * W - pad * 2).join("\n")));
    } else if (item.type === "image") {
      node.style.borderRadius = `${item.radius || 0}px`;
      if (item.src) {
        const img = el("img");
        img.src = item.src;
        img.alt = "";
        node.append(img);
      } else {
        node.classList.add("is-empty");
        node.style.color = page.accent;
        node.append(el("span", "", "제품 사진 자리"));
      }
    } else if (item.type === "shape") {
      node.style.background = item.fill;
      node.style.borderRadius = item.shape === "circle" ? "50%" : `${item.radius || 0}px`;
    } else if (item.type === "sticker") {
      node.classList.add("is-sticker");
      node.style.fontSize = `${stickerSize(item, W, H)}px`;
      node.style.fontFamily = EMOJI_FONT;
      node.append(el("span", "", item.emoji || "⭐"));
    } else {
      return null;  // 아직 그리지 못하는 종류
    }

    if (item.id === selectedId) {
      node.classList.add("is-selected");
      node.append(el("span", "studio-editor-handle"));
    }
    return node;
  }

  function draw() {
    if (editing) return;
    // 다시 그리면 요소가 새로 생기므로, 편집 화면 안에 있던 키보드 초점을 같은 요소로 돌려줍니다.
    const focused = stage.contains(document.activeElement) ? document.activeElement.dataset.id : null;
    stage.style.background = page.bg;
    stage.replaceChildren(...page.elements.map(drawItem).filter(Boolean));
    if (focused) focusItem(selectedId || focused);
    renderTranslations();
  }

  function renderTranslations() {
    translations.replaceChildren(el("summary", "", `${pageIndex + 1}장 문구 · 한국어 뜻`));
    if (draft.assistant) translations.append(el("p", "studio-hint", draft.assistant.notice));
    const items = page.elements.filter((item) => item.type === "text" && item.text_ko);
    if (!items.length) translations.append(el("p", "studio-hint", "AI 제안을 적용하면 베트남어 문구와 한국어 뜻을 함께 보여줍니다."));
    for (const item of items) {
      const row = el("div", "studio-editor-translation");
      const vi = el("p", "", item.text);
      vi.lang = "vi";
      row.append(vi, el("p", "", item.text_ko));
      if (item.translation_source !== item.text) row.append(el("p", "is-warn", "문구가 바뀌었습니다. 한국어 뜻을 다시 확인해 주세요."));
      translations.append(row);
    }
  }

  function figmaLink(value) {
    try {
      const url = new URL(value);
      if (url.protocol === "https:" && ["figma.com", "www.figma.com"].includes(url.host)
          && !url.username && !url.password && /^\/(design|file)\/[a-zA-Z0-9]+\//.test(url.pathname)
          && /^\d+[-:]\d+$/.test(url.searchParams.get("node-id") || "")) return url.href;
    } catch { /* 잘못된 링크는 열거나 저장하지 않습니다. */ }
    return null;
  }

  // Figma 공식 임베드 주소 (보기 전용). 편집 화면은 Figma가 다른 사이트 안에 띄우는 것을 막습니다.
  function figmaEmbed(link) {
    const url = new URL(link);
    url.host = "embed.figma.com";
    url.pathname = url.pathname.replace(/^\/file\//, "/design/");
    url.searchParams.set("embed-host", "hanjeongseon");
    return url.href;
  }

  // 플러그인이 주소를 남기면 다시 그리므로, 지금 패널을 기억해 두고 바꿔 끼웁니다.
  function renderExternal() {
    const panel = el("details", "studio-editor-external");
    panel.open = Boolean(draft.external_figma);
    const steps = el("ol", "studio-editor-external-steps");
    steps.append(el("li", "", "Figma에서 플러그인 ‘한정선 디자인 가져오기’를 켜고 이 디자인을 가져옵니다."),
      el("li", "", "대시보드로 돌아오면 아래에 Figma 창이 자동으로 열립니다."),
      el("li", "", "고치려면 ‘Figma에서 편집’을 눌러 새 탭에서 작업합니다."));
    panel.append(el("summary", "", "Figma에서 편집 · 외부 미리보기"), steps,
      el("p", "studio-hint", "원래 초안 PNG/JPG 받기는 위 버튼을 사용하세요."));
    const input = el("input");
    input.type = "url";
    input.placeholder = "https://www.figma.com/design/…?node-id=…";
    input.value = draft.external_figma?.url || "";
    const msg = el("p", "studio-hint");
    msg.setAttribute("role", "status");
    const open = el("a", "btn", "Figma에서 편집");
    open.target = "_blank";
    open.rel = "noopener noreferrer";
    const currentLink = figmaLink(draft.external_figma?.url);
    open.hidden = !currentLink;
    if (currentLink) open.href = currentLink;
    const store = button("편집 링크 저장", async () => {
      const url = figmaLink(input.value);
      if (!url) { msg.textContent = "Figma 프레임의 선택 항목 링크를 확인해 주세요."; return; }
      if (!onSave) return;
      store.disabled = true;
      const next = structuredClone(draft);
      next.external_figma = url === draft.external_figma?.url ? { ...draft.external_figma } : { url };
      try { await onSave(next); } catch { msg.textContent = "저장하지 못했습니다. 다시 시도해 주세요."; }
      finally { store.disabled = false; }
    });
    const refresh = button("미리보기 새로고침", async () => {
      const url = figmaLink(input.value);
      if (!url) { msg.textContent = "Figma 선택 항목 링크를 먼저 넣어 주세요."; return; }
      refresh.disabled = store.disabled = true;
      msg.textContent = "Figma 결과를 불러오는 중…";
      try {
        const result = await postJson(FIGMA_API, { url });
        if (!wrap.isConnected || !onSave) return;
        const next = structuredClone(draft);
        next.external_figma = { url, preview_url: result.preview_url, refreshed_at: result.refreshed_at };
        await onSave(next);
      } catch (error) { msg.textContent = error.message; }
      finally { refresh.disabled = store.disabled = false; }
    });
    // 링크가 있으면 Figma 창(보기 전용)을 바로 펼칩니다.
    const frame = el("iframe", "studio-editor-external-frame");
    frame.title = "Figma 창 (보기 전용)";
    frame.allowFullscreen = true;
    frame.hidden = !currentLink;
    if (currentLink) frame.src = figmaEmbed(currentLink);
    const show = button(currentLink ? "Figma 창 닫기" : "Figma 창 보기", () => {
      frame.hidden = !frame.hidden;
      show.textContent = frame.hidden ? "Figma 창 보기" : "Figma 창 닫기";
    });
    show.hidden = !currentLink;
    input.addEventListener("input", () => { open.hidden = show.hidden = input.value !== draft.external_figma?.url || !currentLink; });
    const linkField = field("Figma 선택 항목 링크", input);
    linkField.classList.add("is-wide");
    const row = el("div", "studio-editor-external-row");
    row.append(show, open, refresh);
    // 자동 연결이 안 될 때만 쓰는 예비 칸
    const manual = el("details", "studio-editor-external-manual");
    const manualRow = el("div", "studio-editor-external-row");
    manualRow.append(linkField, store);
    manual.append(el("summary", "", "링크 직접 넣기 (자동 연결이 안 될 때)"), manualRow);
    panel.append(row, msg, frame, manual);
    if (currentLink) panel.append(el("p", "studio-hint", "Figma 창은 보기 전용입니다. Figma에 로그인되어 있고 파일 보기 권한이 있어야 보입니다."));
    const external = draft.external_figma;
    if (currentLink && external?.preview_url?.startsWith("https://")) {
      const img = el("img");
      img.src = external.preview_url;
      img.alt = "Figma에서 마지막으로 새로고침한 결과";
      img.referrerPolicy = "no-referrer";
      img.addEventListener("error", () => { img.hidden = true; msg.textContent = "이미지를 불러오지 못했습니다. 미리보기를 새로고침해 주세요."; });
      const date = new Date(external.refreshed_at);
      panel.append(el("p", "studio-hint", `외부 편집 결과 · 마지막 반영: ${Number.isNaN(date.getTime()) ? "확인 필요" : date.toLocaleString("ko-KR")}`), img,
        el("p", "studio-hint", "위 편집기와 다운로드는 대시보드 원본입니다. 외부 수정 결과가 원본 요소에 자동 반영되지는 않습니다."));
    }
    if (externalPanel) externalPanel.replaceWith(panel);
    else side.append(panel);
    externalPanel = panel;
  }

  // Figma 플러그인이 서버에 남긴 주소(external_figma)를 확인합니다. Figma에서 돌아와 창이 다시 활성화될 때마다 봅니다.
  // 서버에는 이미 새 버전으로 저장돼 있으므로 여기서는 다시 저장하지 않고 화면만 바꿉니다.
  async function syncFigma() {
    if (!wrap.isConnected) return window.removeEventListener("focus", syncFigma);
    const chatId = Number(new URL(location.href).searchParams.get("chat"));
    if (!chatId) return;
    try {
      const data = await (await fetch(`${FIGMA_DESIGN_API}/${chatId}`)).json();
      const link = data.ok && data.design.kind === draft.kind ? data.design.external_figma : null;
      if (!wrap.isConnected || !figmaLink(link?.url) || link.url === draft.external_figma?.url) return;
      draft.external_figma = link;
      renderExternal();
    } catch { /* 확인하지 못하면 지금 화면을 그대로 둡니다. */ }
  }

  function fit() {
    if (!wrap.isConnected) return observer.disconnect();
    const width = view.clientWidth;
    scale = Math.min(width / W, (window.innerHeight * MAX_VIEW) / H);
    view.style.height = `${H * scale}px`;
    stage.style.left = `${(width - W * scale) / 2}px`;
    stage.style.transform = `scale(${scale})`;
  }
  const observer = new ResizeObserver(fit);
  observer.observe(view);

  // ---------- 장 번호 (카드뉴스) ----------
  function renderPages() {
    pagesBar.hidden = draft.pages.length < 2;
    pagesBar.replaceChildren(el("span", "", "장"), ...draft.pages.map((_, index) => {
      const node = button(String(index + 1), () => goPage(index), index === pageIndex ? "btn dark" : "btn");
      if (index === pageIndex) node.setAttribute("aria-current", "page");
      return node;
    }));
  }

  function goPage(index) {
    if (index === pageIndex) return;
    pageIndex = index;
    page = draft.pages[index];
    selectedId = null;
    renderPages();
    draw();
    updateBar();
    loadFontsFor(page).then(() => { if (wrap.isConnected && page === draft.pages[index]) draw(); });
  }

  // ---------- 요소 추가 · 순서 · 사진 ----------
  function nextZ() {
    return Math.max(0, ...page.elements.map((item) => item.z || 0)) + 1;
  }

  function centered(w, h) {
    return { x: round2((100 - w) / 2), y: round2((100 - h) / 2), w: round2(w), h: round2(h) };
  }

  // 정사각형으로 보이는 높이(%)
  function square(w) {
    return w * W / H;
  }

  // 사진을 골라 서버에 올리고 주소를 돌려줍니다. 취소하거나 실패하면 null.
  function pickPhoto() {
    return new Promise((resolve) => {
      const input = el("input");
      input.type = "file";
      input.accept = PHOTO_TYPES.join(",");
      input.addEventListener("cancel", () => resolve(null));
      input.addEventListener("change", async () => {
        const file = input.files[0];
        if (!file) return resolve(null);
        if (!PHOTO_TYPES.includes(file.type)) {
          status.textContent = "JPEG·PNG·WEBP 이미지만 올릴 수 있습니다.";
          return resolve(null);
        }
        const size = await imageSize(file);
        if (size && (size[0] > MAX_SIDE || size[1] > MAX_SIDE)) {
          status.textContent = `가로·세로가 각각 ${MAX_SIDE}px 이하인 사진만 올릴 수 있습니다. (지금 ${size[0]}×${size[1]})`;
          return resolve(null);
        }
        status.textContent = "사진을 올리는 중…";
        try {
          const form = new FormData();
          form.append("image", file);
          const res = await fetch(UPLOAD_API, { method: "POST", body: form });
          const data = await res.json().catch(() => ({ ok: false }));
          if (!data.ok) throw new Error(data.error || "사진을 올리지 못했습니다.");
          status.textContent = "";
          resolve(data.url);
        } catch (error) {
          status.textContent = error.message;
          resolve(null);
        }
      });
      input.click();
    });
  }

  async function addItem(value) {
    let item;
    if (value === "text") {
      const size = 48;
      item = {
        type: "text", role: "body", text: "두 번 눌러 고치기", font: "sans", size, weight: 400,
        color: contrastOf(page.bg), align: "center", ...centered(60, size * 1.3 / H * 100),
      };
    } else if (value === "rect") {
      item = { type: "shape", role: "shape", shape: "rect", fill: page.accent || contrastOf(page.bg), radius: 0, ...centered(30, 20) };
    } else if (value === "circle") {
      item = { type: "shape", role: "shape", shape: "circle", fill: page.accent || contrastOf(page.bg), ...centered(24, square(24)) };
    } else if (value.startsWith("emoji:")) {
      item = { type: "sticker", role: "sticker", emoji: value.slice("emoji:".length), ...centered(14, square(14)) };
    } else if (value === "photo") {
      const src = await pickPhoto();
      if (!src) return;
      item = { type: "image", role: "photo", src, radius: 24, ...centered(50, square(50)) };
    } else {
      return;
    }
    item.id = `${item.type}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    item.z = nextZ();
    page.elements.push(item);
    selectedId = item.id;
    draw();
    updateBar();
    save();
  }

  // where: top(맨 앞) · up(앞으로) · down(뒤로) · bottom(맨 뒤). 순서를 1부터 다시 매깁니다.
  function reorder(item, where) {
    const list = [...page.elements].sort((a, b) => (a.z || 0) - (b.z || 0));
    const from = list.indexOf(item);
    const to = where === "top" ? list.length - 1
      : where === "bottom" ? 0
        : clamp(from + (where === "up" ? 1 : -1), 0, list.length - 1);
    if (from === to) return;
    list.splice(from, 1);
    list.splice(to, 0, item);
    list.forEach((other, index) => { other.z = index + 1; });
    draw();
    save();
  }

  // ---------- 편집 막대 ----------
  function colorInput(value, onChange) {
    const input = el("input");
    input.type = "color";
    input.value = value || "#000000";
    input.addEventListener("change", () => onChange(input.value));
    return input;
  }

  const status = el("span", "studio-hint");

  // 글꼴 목록: 묶음별 웹글꼴 + 맨 아래 내 PC 글꼴 (README 3-5)
  function fontSelect(item) {
    const current = item.font || "sans";
    const select = el("select", "studio-editor-font");
    for (const group of FONT_GROUPS) {
      const box = el("optgroup");
      box.label = group.label;
      for (const font of group.fonts) {
        box.append(option(font.key, font.vi && font.google ? `${font.name} · 🇻🇳 성조 지원` : font.name));
      }
      select.append(box);
    }

    const local = el("optgroup");
    local.label = "내 PC 글꼴 (이 PC에서만 보임)";
    const names = new Set(getLocalFonts());
    if (current.startsWith(LOCAL_PREFIX)) names.add(current.slice(LOCAL_PREFIX.length));
    for (const name of names) local.append(option(LOCAL_PREFIX + name, name));
    if (!getLocalFonts().length) {
      local.append(localFontsSupported()
        ? option(LOCAL_ACTION, "내 PC 글꼴 불러오기…")
        : option(LOCAL_ACTION, "내 PC 글꼴 (크롬·엣지에서만)", true));
    }
    select.append(local);
    select.value = current;
    if (select.value !== current) select.value = "sans";

    select.addEventListener("change", async () => {
      const key = select.value;
      if (key === LOCAL_ACTION) {
        select.value = current;
        status.textContent = "내 PC 글꼴을 불러오는 중…";
        try {
          await loadLocalFonts();
          status.textContent = "내 PC 글꼴은 이 PC에서만 보입니다. 상업적 사용은 글꼴마다 확인해 주세요.";
          updateBar();
        } catch (error) {
          status.textContent = error.message;
        }
        return;
      }
      status.textContent = "글꼴을 불러오는 중…";
      await loadFont(key, item.weight || 400);
      status.textContent = "";
      item.font = key;
      draw();
      save();
    });
    return select;
  }

  // [추가] 메뉴: 고르면 바로 추가하고 다시 "＋ 추가"로 돌아갑니다.
  function addSelect() {
    const select = selectBox("studio-editor-add",
      [["", "＋ 추가"], ["text", "텍스트"], ["photo", "사진"], ["rect", "사각형"], ["circle", "원"]], "", () => {});
    const box = el("optgroup");
    box.label = "이모지";
    for (const emoji of EMOJIS) box.append(option(`emoji:${emoji}`, emoji));
    select.append(box);
    select.addEventListener("change", () => {
      const value = select.value;
      select.value = "";
      addItem(value);
    });
    return select;
  }

  function updateBar() {
    const item = find(selectedId);
    const tools = [];
    if (draft.demo) tools.push(el("span", "demo", "DEMO · 예시 데이터"));
    tools.push(addSelect(), button("✂️ 배경 제거", openRemoveBg));  // 기존 배경 제거 창(sns_image.js)을 엽니다.

    if (!item) {
      tools.push(field("배경색", colorInput(page.bg, (value) => { page.bg = value; draw(); save(); })));
    } else if (item.type === "text") {
      const size = el("input");
      size.type = "number";
      size.min = "8";
      size.step = "2";
      size.value = item.size;
      size.addEventListener("change", () => {
        const value = Number(size.value);
        if (!(value >= 8)) return;
        item.size = value;
        draw();
        save();
      });
      tools.push(
        field("글꼴", fontSelect(item)),
        field("크기", size),
        field("글자색", colorInput(item.color, (value) => { item.color = value; draw(); save(); })),
        button(Number(item.weight) >= 700 ? "굵게 끄기" : "굵게", () => {
          item.weight = Number(item.weight) >= 700 ? 400 : 700;
          draw();
          updateBar();
          save();
          loadFont(item.font, item.weight).then(draw);  // 굵은 글꼴 파일을 받은 뒤 다시 그립니다.
        }),
        field("정렬", selectBox("", [["left", "왼쪽"], ["center", "가운데"], ["right", "오른쪽"]], item.align || "left",
          (value) => { item.align = value; draw(); save(); })),
      );
    } else if (item.type === "shape") {
      tools.push(field("색", colorInput(item.fill, (value) => { item.fill = value; draw(); save(); })));
    } else if (item.type === "image") {
      tools.push(button("사진 바꾸기", async () => {
        const src = await pickPhoto();
        if (!src) return;
        item.src = src;
        draw();
        save();
      }));
    } else if (item.type === "sticker") {
      tools.push(field("이모지", selectBox("", EMOJIS.map((emoji) => [emoji, emoji]), item.emoji,
        (value) => { item.emoji = value; draw(); save(); })));
    }
    if (item) {
      tools.push(
        button("맨 앞", () => reorder(item, "top")),
        button("앞으로", () => reorder(item, "up")),
        button("뒤로", () => reorder(item, "down")),
        button("맨 뒤", () => reorder(item, "bottom")),
      );
      tools.push(button("삭제", () => {
        page.elements = page.elements.filter((other) => other.id !== item.id);
        selectedId = null;
        draw();
        updateBar();
        save();
      }));
    }

    const multi = draft.pages.length > 1;
    tools.push(el("span", "studio-editor-spacer"), status, button("검수", runReview));
    tools.push(
      button(multi ? "이 장 PNG" : "PNG 받기", () => download("png")),
      button(multi ? "이 장 JPG" : "JPG 받기", () => download("jpg")));
    if (multi) tools.push(button("모든 장 PNG", downloadAll));
    bar.replaceChildren(...tools);
  }

  async function download(type) {
    status.textContent = "이미지를 만드는 중…";
    try {
      await exportImage(draft, type, pageIndex);
      status.textContent = "";
    } catch (error) {
      status.textContent = `내려받지 못했습니다. (${error.message})`;
    }
  }

  // ---------- 광고 표현 검수 (README 6장) ----------
  // 모든 장의 글을 현지 시장 분석 탭 기준으로 검사합니다. 참고 안내이며 법적 판단이 아닙니다.
  async function runReview() {
    review.hidden = false;
    review.replaceChildren(el("p", "", "검수하는 중…"));
    try {
      renderReview(await postJson(REVIEW_API, { design: draft }));
    } catch (error) {
      review.replaceChildren(el("p", "is-error", error.message), button("닫기", () => { review.hidden = true; }));
    }
  }

  function renderReview(data) {
    const nodes = [el("h3", "", "광고 표현 검수")];
    const guide = data.guidelines || {};
    nodes.push(el("p", "studio-hint", `현지 시장 분석 자료 · 상태: ${guide.status === "confirmed" ? "확정" : "검토 중"} · 검토일: ${guide.reviewed_at || "미등록"}`));
    for (const rule of guide.prompt_rules || []) nodes.push(el("p", "", rule));
    for (const item of [...(guide.visual_cautions || []), ...(guide.required_notices || [])]) {
      if (item.rule) nodes.push(el("p", "is-warn", item.rule));
    }
    for (const source of guide.sources || []) {
      if (!/^https?:\/\//.test(source.url || "")) continue;
      const link = el("a", "", source.title || "기준 출처");
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      nodes.push(link);
    }
    if (!data.ready) {
      nodes.push(el("p", "is-warn",
        "검수 기준이 아직 준비되지 않았습니다. (현지 시장 분석 탭에서 준비 중) 걸린 표현이 없어도 '문제 없음'이 아닙니다."));
    } else if (!data.findings.length) {
      nodes.push(el("p", "", `걸린 표현이 없습니다. (글 ${data.checked}개 확인)`));
    } else {
      const list = el("ul", "studio-editor-findings");
      for (const finding of data.findings) {
        const block = finding.severity === "block";
        const li = el("li", block ? "is-block" : "is-warn");
        const head = el("p");
        head.append(el("b", "", block ? "사용 금지" : "주의"), ` ${finding.matched.map((m) => m.keyword).join(", ")}`);
        li.append(head, el("p", "studio-hint", `문구: ${finding.text}`));
        if (finding.reason) li.append(el("p", "", `이유: ${finding.reason}`));
        if (finding.suggestion) li.append(el("p", "", `바꿔 쓰기: ${finding.suggestion}`));
        if (!finding.verified) li.append(el("p", "studio-hint", "원문 조항 미확인"));
        for (const source of finding.sources || []) {
          if (!/^https?:\/\//.test(source.url || "")) continue;
          const link = el("a", "", source.title || source.url);
          link.href = source.url;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          li.append(link);
        }
        list.append(li);
      }
      nodes.push(list);
    }
    nodes.push(el("p", "studio-hint", data.disclaimer), button("닫기", () => { review.hidden = true; }));
    review.replaceChildren(...nodes);
  }

  // 기존 작업 안에서 AI 제안을 적용하므로 유진 담당 생성·저장 경로는 바꾸지 않습니다.
  // 같은 작업(chat · 종류)이면 만들어 둔 칸을 다시 붙이고, 칸이 쓰는 문서와 저장 함수만 최신으로 바꿉니다.
  function promptPanel() {
    const key = `${new URL(location.href).searchParams.get("chat")}:${draft.kind}`;
    if (promptCache?.key === key) {
      for (const name of Object.keys(promptCache.doc)) delete promptCache.doc[name];
      Object.assign(promptCache.doc, structuredClone(draft));
      promptCache.onSave = onSave;
      return promptCache.panel;
    }
    const formDoc = structuredClone(draft);
    const panel = el("section", "studio-editor-prompt studio-editor-prompt-panel");
    const form = promptForm(formDoc, {
      isActive: () => panel.isConnected,
      onApply: async (design) => { if (promptCache?.onSave) await promptCache.onSave(design); },
    });
    panel.append(...form.nodes);
    promptCache = { key, panel, doc: formDoc, onSave };
    return panel;
  }

  // 장마다 PNG 한 장씩 받습니다. 브라우저가 "여러 파일 다운로드"를 물으면 허용해 주세요.
  async function downloadAll() {
    try {
      for (let index = 0; index < draft.pages.length; index += 1) {
        status.textContent = `${index + 1}/${draft.pages.length}장 만드는 중…`;
        await exportImage(draft, "png", index);
        await new Promise((resolve) => { setTimeout(resolve, 300); });
      }
      status.textContent = "";
    } catch (error) {
      status.textContent = `내려받지 못했습니다. (${error.message})`;
    }
  }

  // ---------- 선택 · 끌어서 이동 · 모서리로 크기 조절 ----------
  stage.addEventListener("pointerdown", (event) => {
    if (editing || event.button !== 0) return;
    const node = event.target.closest(".studio-editor-item");
    const item = node && find(node.dataset.id);
    const resize = event.target.classList.contains("studio-editor-handle");
    if (selectedId !== (item?.id ?? null)) {
      selectedId = item?.id ?? null;
      draw();
      updateBar();
    }
    if (!item) return;
    event.preventDefault();
    stage.setPointerCapture(event.pointerId);
    action = { item, resize, sx: event.clientX, sy: event.clientY, start: { ...item }, moved: false };
  });

  stage.addEventListener("pointermove", (event) => {
    if (!action) return;
    const dx = (event.clientX - action.sx) / scale / W * 100;
    const dy = (event.clientY - action.sy) / scale / H * 100;
    if (!action.moved && Math.hypot(event.clientX - action.sx, event.clientY - action.sy) < 3) return;
    action.moved = true;
    const { item, start } = action;
    if (action.resize) {
      item.w = Math.round(Math.max(MIN_SIZE, start.w + dx) * 100) / 100;
      item.h = Math.round(Math.max(MIN_SIZE, start.h + dy) * 100) / 100;
    } else {
      item.x = Math.round(clamp(start.x + dx, MIN_SIZE - item.w, 100 - MIN_SIZE) * 100) / 100;
      item.y = Math.round(clamp(start.y + dy, MIN_SIZE - item.h, 100 - MIN_SIZE) * 100) / 100;
    }
    draw();
  });

  function endAction() {
    if (!action) return;
    const { moved } = action;
    action = null;
    if (moved) save();
  }
  stage.addEventListener("pointerup", endAction);
  stage.addEventListener("pointercancel", endAction);

  // ---------- 키보드로 고르기 · 옮기기 ----------
  // Tab으로 요소에 가면 고르고, 방향키로 옮기고, Enter로 글을 고치고, Esc로 선택을 풉니다.
  stage.addEventListener("focusin", (event) => {
    if (editing || refocusing) return;
    const node = event.target.closest(".studio-editor-item");
    if (!node || node.dataset.id === selectedId) return;
    selectedId = node.dataset.id;
    draw();
    updateBar();
  });

  let moveTimer = null;  // 방향키를 누를 때마다 저장하지 않고, 멈춘 뒤 한 번 저장합니다.
  stage.addEventListener("keydown", (event) => {
    if (editing || !event.target.closest(".studio-editor-item")) return;
    const item = find(selectedId);
    if (event.key === "Escape") {
      if (!item) return;
      event.preventDefault();
      selectedId = null;
      draw();
      updateBar();
      return;
    }
    if (!item) return;
    if (event.key === "Enter" && item.type === "text") {
      event.preventDefault();
      startEdit();
      return;
    }
    const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const move = moves[event.key];
    if (!move || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    const step = event.shiftKey ? BIG_STEP : MOVE_STEP;
    item.x = round2(clamp(item.x + move[0] * step, MIN_SIZE - item.w, 100 - MIN_SIZE));
    item.y = round2(clamp(item.y + move[1] * step, MIN_SIZE - item.h, 100 - MIN_SIZE));
    draw();
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => { if (wrap.isConnected) save(); }, 600);
  });

  // ---------- 두 번 눌러(또는 Enter) 글자 수정 ----------
  // 첫 번째 누름에서 다시 그려져 눌린 요소가 바뀔 수 있으므로, 선택된 요소를 기준으로 찾습니다.
  // Ctrl+Enter·Tab·바깥 누르기 = 마치기, Esc = 취소
  function startEdit() {
    const item = find(selectedId);
    const node = item?.type === "text" && stage.querySelector(`[data-id="${CSS.escape(item.id)}"]`);
    if (!node) return;
    const box = node.querySelector(".studio-editor-text");
    editing = true;
    box.textContent = item.text;
    box.contentEditable = "true";
    box.focus();
    getSelection().selectAllChildren(box);

    let cancelled = false;
    let byKey = false;  // 키로 마치면 그 요소로 초점을 돌려줍니다.
    box.addEventListener("keydown", (key) => {
      key.stopPropagation();  // 수정 중 Ctrl+Z는 글자 되돌리기로 둡니다.
      if (key.key === "Escape" || (key.key === "Enter" && (key.ctrlKey || key.metaKey))) {
        key.preventDefault();
        cancelled = key.key === "Escape";
        byKey = true;
        box.blur();
      }
    });
    box.addEventListener("blur", () => {
      editing = false;
      const text = box.innerText.replace(/\n$/, "");
      const changed = !cancelled && text !== item.text;
      if (changed) item.text = text;
      draw();
      if (byKey) focusItem(item.id);
      if (changed) save();
    }, { once: true });
  }
  stage.addEventListener("dblclick", startEdit);

  renderPages();
  draw();
  updateBar();
  fit();
  if (focusAfterRender) focusItem(selectedId);
  // 웹글꼴을 받은 뒤 글자 폭이 달라지므로 다시 그립니다.
  loadFontsFor(page).then(() => { if (wrap.isConnected) draw(); });
}

// ---------- 내보내기 ----------
function roundedRect(ctx, x, y, w, h, radius) {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("사진을 불러오지 못했습니다."));
    img.src = src;
  });
}

async function paint(ctx, item, W, H) {
  const x = item.x / 100 * W;
  const y = item.y / 100 * H;
  const w = item.w / 100 * W;
  const h = item.h / 100 * H;

  if (item.type === "shape") {
    ctx.fillStyle = item.fill;
    if (item.shape === "circle") {
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    } else {
      roundedRect(ctx, x, y, w, h, item.radius || 0);
    }
    ctx.fill();
  } else if (item.type === "image") {
    if (!item.src) return;  // 빈 사진 자리는 내보내지 않습니다.
    const img = await loadImage(item.src);
    // 화면의 object-fit: cover와 같게 가운데를 잘라 채웁니다.
    const ratio = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const sw = w / ratio;
    const sh = h / ratio;
    ctx.save();
    roundedRect(ctx, x, y, w, h, item.radius || 0);
    ctx.clip();
    ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
    ctx.restore();
  } else if (item.type === "text") {
    const pad = padOf(item);
    if (item.bg) {
      ctx.fillStyle = item.bg;
      roundedRect(ctx, x, y, w, h, item.size * 0.5);
      ctx.fill();
    }
    const lines = wrapLines(ctx, item, w - pad * 2);
    const lineH = item.size * LINE;
    const top = y + (h - lines.length * lineH) / 2;
    const align = item.align || "left";
    const tx = align === "center" ? x + w / 2 : align === "right" ? x + w - pad : x + pad;
    ctx.fillStyle = item.color;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    lines.forEach((line, index) => ctx.fillText(line, tx, top + lineH * (index + 0.5)));
  } else if (item.type === "sticker") {
    ctx.font = `${stickerSize(item, W, H)}px ${EMOJI_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(item.emoji || "⭐", x + w / 2, y + h / 2);
  }
}

// 문서 한 장을 canvas에 그립니다. scale: 원본 대비 배율(썸네일은 작게).
// lenient: 사진을 못 불러와도 멈추지 않고 나머지를 그립니다(썸네일용). 내려받기는 실패를 알려야 해서 false.
async function drawPage(doc, pageIndex = 0, scale = 1, lenient = false) {
  const [W, H] = sizeOf(doc);
  const page = doc.pages[pageIndex];
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  await loadFontsFor(page);
  if (document.fonts) await document.fonts.ready;

  ctx.fillStyle = page.bg || "#ffffff";  // JPG는 투명이 없어 배경을 먼저 채웁니다.
  ctx.fillRect(0, 0, W, H);
  for (const item of [...page.elements].sort((a, b) => (a.z || 0) - (b.z || 0))) {
    try {
      await paint(ctx, item, W, H);
    } catch (error) {
      if (!lenient) throw error;
    }
  }
  return canvas;
}

// 썸네일: 문서 한 장을 작게 그린 canvas. 바로 돌려주고, 글꼴·사진을 받은 뒤 그림을 채웁니다.
// sns.js(유진) 첫 화면 내 작업 카드와 AI 제안 카드가 씁니다.
const THUMB_SCALE = 0.4;
export function renderThumb(doc, pageIndex = 0) {
  const canvas = el("canvas", "studio-editor-thumb");
  const [W, H] = sizeOf(doc || {});
  canvas.width = Math.round(W * THUMB_SCALE);
  canvas.height = Math.round(H * THUMB_SCALE);
  canvas.style.aspectRatio = `${W} / ${H}`;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "디자인 미리보기");
  if (!doc?.pages?.[pageIndex]) return canvas;
  drawPage(doc, pageIndex, THUMB_SCALE, true)
    .then((drawn) => canvas.getContext("2d").drawImage(drawn, 0, 0))
    .catch(() => canvas.classList.add("is-broken"));
  return canvas;
}

// 문서 한 장을 원본 크기(예: 4:5 = 1080×1350)로 그려 PNG/JPG로 내려받습니다.
export async function exportImage(doc, type = "png", pageIndex = 0) {
  const canvas = await drawPage(doc, pageIndex);

  const mime = type === "jpg" ? "image/jpeg" : "image/png";
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("이미지를 만들지 못했습니다."))), mime, 0.92);
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${doc.kind || "poster"}_${doc.ratio.replace(":", "x")}${doc.pages.length > 1 ? `_${pageIndex + 1}` : ""}.${type}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
