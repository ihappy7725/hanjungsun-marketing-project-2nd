// 포스터·카드뉴스 편집기, 미리보기, PNG 내보내기 [희주]
// sns.js가 import합니다. 가운데 영역만 그리고, 저장은 sns.js가 넘겨준 onSave로 합니다.
// 문서 형식은 designs.py 위쪽 설명과 같습니다: x·y·w·h는 페이지 대비 %, size는 원본 크기 기준 px.
import {
  FONT_GROUPS, LOCAL_PREFIX, fontFamily, getLocalFonts, loadFont, loadFontsFor, loadLocalFonts, localFontsSupported,
} from "./sns_fonts.js";
import { openRemoveBg } from "./sns_image.js";

// 3:4 · 4:3은 Higgsfield 그림 시안 비율 (designs.py SIZES와 같음)
export const SIZES = { "1:1": [1080, 1080], "4:5": [1080, 1350], "9:16": [1080, 1920], "16:9": [1920, 1080],
  "3:4": [1080, 1440], "4:3": [1440, 1080] };
const LOCAL_ACTION = "__local__";  // 글꼴 목록의 "내 PC 글꼴 불러오기…"
const LINE = 1.2;     // 줄 간격 (글자 크기의 배수)
const MIN_SIZE = 2;   // 요소 최소 너비·높이 (%)
const MAX_VIEW = 0.7; // 미리보기 최대 높이 (창 높이 대비)
const UPLOAD_API = "/content_studio/media/api/upload";  // routes_media.py
const REVIEW_API = "/content_studio/media/api/review";
const ASSISTANT_API = "/content_studio/media/api/design-assistant";  // 시안 3개의 장별 그림 프롬프트 (gpt-4o-mini)
// 시안 그림 (유진 routes_sns.py, Higgsfield): 견적(무료) · 생성(크레딧) · 상태(무료)
const IMAGE_QUOTE_API = "/content_studio/api/design-images/quote";
const IMAGE_API = "/content_studio/api/design-images";
const IMAGE_STATUS_API = "/content_studio/api/design-images/status";
const IMAGE_POLL_MS = 4000;  // 상태 확인 간격
const IMAGE_DONE = "completed";  // higgsfield.py DONE, FAILED
const IMAGE_FAILED = ["failed", "nsfw", "canceled", "cancelled"];
const ARTWORK_ROLE = "artwork";  // designs.py ARTWORK_ROLE: 그림 시안 장 전체를 덮는 그림. 고르거나 옮기지 않습니다.
const IMAGE_MODE = "image";      // designs.py IMAGE_MODE: 그림 시안 문서
// 포스터 로고: 베이스 템플릿 그림은 아래 가운데(맨 아래 10%)를 비워 두고, 그 자리에 브랜드 로고를 얹습니다 (2026-10-27 유진 요청).
// 그림 시안 포스터의 확정 문서·시안 카드 미리보기·PNG/JPG 내보내기에 들어가고, 편집기에서는 고르거나 옮기지 않습니다.
const LOGO_ROLE = "logo";
const LOGO_SRC = "/content_studio/static/images/sns/brand_logo.png";  // 투명 배경
const LOGO_W = 13;            // 장 너비 대비 % (요청: 12~15%)
const LOGO_ASPECT = 41 / 94;  // brand_logo.png 세로/가로. 그림은 contain이라 파일이 바뀌어도 찌그러지지 않습니다.
const LOGO_BOTTOM = 3;        // 아래 여백 % (장 높이 대비)
const FIGMA_API = "/content_studio/media/api/figma-preview";
const FIGMA_DESIGN_API = "/content_studio/media/api/figma/designs";  // 플러그인 창구 (주소 확인에도 씀)
const BG_QUOTE_API = "/content_studio/media/api/design-bg/quote";  // AI 배경 그림 견적 (무료)
const BG_API = "/content_studio/media/api/design-bg";              // AI 배경 그림 만들기 (유료, OpenAI 이미지 모델)
const BG_ROLE = "background";  // designs.py BG_ROLE: 장 전체를 덮는 배경 그림. 고르거나 옮기지 않고 바탕처럼 둡니다.
const RATIO_API = "/content_studio/media/api/design-ratio";        // 비율 바꾸기 (무료)
// designs.py DESIGN_RATIOS: 3:4 · 4:3 · 9:16 · 16:9 · 1:1 + 4:5(이미 만든 작업용)
const DESIGN_RATIOS = { poster: ["3:4", "4:3", "9:16", "16:9", "1:1", "4:5"], cardnews: ["3:4", "4:3", "9:16", "16:9", "1:1", "4:5"] };
const CARD_PAGES = [3, 6];  // 카드뉴스 장수 (designs.py MIN_PAGES, MAX_PAGES)
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIDE = 4096;
// [추가] 메뉴의 이모지 16종 (designs.py EMOJIS와 같은 목록)
const EMOJIS = ["❤️", "⭐", "✨", "🌸", "🎁", "🎀", "🎉", "🔥", "😊", "👍", "🍡", "🍰", "🍵", "🍃", "🥭", "🍓"];
const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';

const MOVE_STEP = 1;    // 방향키 한 번에 옮기는 거리 (%) · Shift와 함께 누르면 BIG_STEP
const BIG_STEP = 5;
const ROLE_NAMES = { title: "제목", subtitle: "부제", body: "본문", checks: "체크 항목", quote: "감성 문구", badge: "배지",
  brand: "로고", page_no: "쪽 번호", photo: "제품 사진", deco: "장식 원", card: "본문 바탕", overlay: "사진 위 바탕", bar: "위쪽 줄",
  label: "머리말", number: "번호", point: "목록 항목", dot: "번호 원", cta: "행동 유도", swipe: "넘겨 보기", frame: "테두리",
  line: "줄", blob: "장식 원", ring: "사진 테두리", tag: "스티커 원", tag_text: "스티커 글", band: "제목 띠", block: "색 면",
  photo_back: "사진 받침", quote_mark: "따옴표", connector: "이어지는 장식" };
const TYPE_NAMES = { text: "글", image: "사진", shape: "도형", sticker: "이모지" };

const measure = document.createElement("canvas").getContext("2d");
// 베트남어 성조처럼 여러 코드로 된 글자를 한 글자로 셉니다. (지원하지 않는 브라우저는 코드 단위)
const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
let selectedId = null;  // 저장 후 다시 그려도 선택을 유지합니다. (모듈 안 변수)
let pageIndex = 0;      // 카드뉴스에서 보고 있는 장. 저장 후 다시 그려도 같은 장에 남습니다.
let focusAfterRender = false;  // 키보드로 고치다 저장하면, 다시 그린 뒤 선택한 요소로 초점을 돌려줍니다.
// AI 배경 그림: 만드는 동안 저장으로 편집기가 다시 그려져도, 결과는 가장 최근 편집기(applyBackground)에 깝니다.
let applyBackground = null;
let bgBusy = false;    // 만드는 중 (한 번에 한 장)
let bgLocked = false;  // 응답을 못 받음 → 비용이 나갔을 수 있어 이 화면에서는 다시 누를 수 없게 막습니다.

// ---------- 그림 시안 비율 다시 그리기 (유진 reratio API, 2026-10-27) ----------
// 그리는 동안 저장·되돌리기로 편집기가 다시 그려져도 이어서 확인하고, 끝나면 가장 최근 편집기(applyReratio)가 저장합니다.
const CHAT_API = "/content_studio/api/chats";  // 유진 routes_sns.py: /<작업ID>/reratio/quote · /<작업ID>/reratio
const IMAGE_RATIO_CHOICES = ["3:4", "4:3", "9:16", "16:9", "1:1"];  // 그림 시안 비율 버튼 (새로 만들기와 같음)
let reratio = null;          // 그리는 중: { chatId, ratio, jobs: [{request_id, status, url} | {status: NOT_SENT}] (장 순서) }
let reratioLocked = false;   // 요청은 들어갔는데 결과를 못 받음(202) → 이 화면에서는 다시 누를 수 없게
let applyReratio = null;     // (job, done) — 가장 최근 편집기의 진행 표시·저장

async function pollReratio() {
  const job = reratio;
  if (!job) return;
  const waiting = job.jobs.filter((one) => one.request_id && one.status !== IMAGE_DONE && !IMAGE_FAILED.includes(one.status));
  if (waiting.length) {
    try {
      const res = await fetch(`${IMAGE_STATUS_API}?ids=${waiting.map((one) => one.request_id).join(",")}`);
      const data = await res.json().catch(() => ({ ok: false }));
      if (!data.ok) throw new Error(data.error || "상태를 확인하지 못했어요.");
      for (const one of waiting) {
        const now = data.jobs?.[one.request_id];
        if (now) Object.assign(one, { status: now.status, url: now.url || null });
      }
      job.note = "";
    } catch (error) {
      job.note = `${error.message} 잠시 뒤 다시 확인해요.`;
    }
    const still = job.jobs.some((one) => one.request_id && one.status !== IMAGE_DONE && !IMAGE_FAILED.includes(one.status));
    if (still) {
      applyReratio?.(job, false);
      setTimeout(pollReratio, IMAGE_POLL_MS);
      return;
    }
  }
  reratio = null;
  applyReratio?.(job, true);
}

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
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${item.spacing || 0}px`;  // 글자 간격 (지원하는 브라우저)
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

// ---------- 그림 시안 카드 · 비용 줄 · 검수 결과 (renderChoices · renderDesign이 같이 씀) ----------
const NOT_SENT = "not_sent";  // 생성 API가 중간에 멈춰 보내지 못한 장 (응답 jobs의 null)
const pageDone = (page) => page.job?.status === IMAGE_DONE && Boolean(page.job.url);
const pageFailed = (page) => IMAGE_FAILED.includes(page.job?.status);

// 그림 시안 카드: 이름 · 스타일 · 진행(완료 n/장수) · 장별 그림 칸 · 넣은 문구(베트남어·한국어 뜻).
// 카드 아무 곳이나 누르면 onPick (문구 펼치기는 제외).
// withLogo: 포스터(베이스 템플릿)는 확정 문서와 같은 자리에 로고를 얹어 미리 보여 줍니다.
function imageCard(item, isSelected, onPick, ratio, withLogo = false) {
  const [W, H] = SIZES[ratio] || SIZES["4:5"];
  const card = el("section", `studio-editor-candidate${isSelected ? " is-selected" : ""}`);
  card.addEventListener("click", (event) => {
    if (event.target.closest("summary") || isSelected) return;
    onPick();
  });
  const choose = button(`${isSelected ? "✓ " : ""}${item.name}`, () => {}, isSelected ? "btn dark" : "btn");
  choose.setAttribute("aria-pressed", String(isSelected));
  const total = item.pages.length;
  const done = item.pages.filter(pageDone).length;
  const failed = item.pages.filter(pageFailed).length;
  const progress = done === total ? "완성" : `${done}/${total}장 완료${failed ? ` · 실패 ${failed}장` : ""}`;
  const strip = el("div", `studio-editor-image-strip${total > 1 ? " is-pages" : ""}`);
  item.pages.forEach((page, index) => {
    const frame = el("div", "studio-editor-image-frame");
    frame.style.aspectRatio = `${W} / ${H}`;
    if (pageDone(page)) {
      const img = el("img");
      img.src = page.job.url;
      img.alt = `${item.name} ${total > 1 ? `${index + 1}장` : ""} 그림`;
      frame.append(img);
      if (withLogo) {
        const box = logoBox(ratio);
        const logo = el("img", "studio-editor-image-logo");
        logo.src = LOGO_SRC;
        logo.alt = "";
        Object.assign(logo.style, { left: `${box.x}%`, top: `${box.y}%`, width: `${box.w}%`, height: `${box.h}%` });
        frame.append(logo);
      }
    } else {
      const unsent = page.job?.status === NOT_SENT;
      frame.classList.toggle("is-failed", pageFailed(page) || unsent);
      frame.append(el("span", "", pageFailed(page) ? "그리지 못함" : unsent ? "보내지 못함" : "그리는 중…"));
    }
    if (total > 1) frame.append(el("span", "studio-editor-image-no", String(index + 1)));
    strip.append(frame);
  });
  const words = el("details", "studio-editor-candidate-words");
  words.append(el("summary", "", total > 1 ? `넣은 문구 보기 · ${total}장` : "넣은 문구 보기"),
    el("p", "studio-hint", item.concept_ko));
  item.pages.forEach((page, index) => {
    for (const text of page.texts) {
      const vi = el("p", "", `${total > 1 ? `${index + 1}장 · ` : ""}${text.vi}`);
      vi.lang = "vi";
      words.append(vi, el("p", "studio-hint", text.ko));
    }
  });
  // 프롬프트 전문 (생성 응답의 prompts, 닫힌 채 시작)
  const prompts = item.pages.map((page) => page.prompt_en).filter(Boolean);
  const full = el("details", "studio-editor-candidate-words studio-editor-candidate-prompt");
  full.append(el("summary", "", "프롬프트 전문"),
    ...prompts.map((text, index) => el("pre", "", `${prompts.length > 1 ? `${index + 1}장\n` : ""}${text}`)));
  full.hidden = !prompts.length;
  card.append(choose, el("p", "studio-hint", `스타일 · ${item.style_label} · ${progress}`), strip, words, full);
  return card;
}

// 크레딧 확인 팝업 (sns_video.js confirmDialog와 같은 모양: base.css dialog). 실행 버튼이면 true, [취소]·Esc면 false.
// 시안 만들기(renderChoices)와 비율 다시 그리기(renderDesign)가 같이 씁니다. q: 유진 견적 API의 quote.
function creditDialog(parent, q, { title, run: runLabel = "만들기", detail = "", note = "" } = {}) {
  const fmt = (value) => Number(value || 0).toLocaleString("ko-KR");
  return new Promise((resolve) => {
    const dialog = el("dialog");
    const lines = el("ul");
    lines.append(
      el("li", "", `이번에 쓰일 크레딧: ${fmt(q.credits)}`),
      el("li", "", `계정 남은 크레딧: ${fmt(q.balance)} → 실행 후 약 ${fmt(q.balance - q.credits)}`),
      el("li", "", `오늘 대시보드 사용: ${fmt(q.today_used)} / ${fmt(q.daily_limit)}`),
    );
    if (note) lines.append(el("li", "", note));
    const run = el("button", "btn dark", runLabel);
    run.type = "button";
    run.disabled = !q.allowed;
    const cancel = el("button", "btn", "취소");
    cancel.type = "button";
    const row = el("div", "actions");
    row.append(run, cancel);
    dialog.append(el("h2", "", title), detail ? el("p", "studio-hint", detail) : "", lines);
    if (!q.allowed) dialog.append(el("p", "badge dday", q.reason || "지금은 실행할 수 없어요."));
    dialog.append(row);
    const close = (answer) => { dialog.close(); dialog.remove(); resolve(answer); };
    run.addEventListener("click", () => close(true));
    cancel.addEventListener("click", () => close(false));
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(false); });
    parent.append(dialog);
    dialog.showModal();
  });
}

// 로고 자리 (장 % 단위): 아래 가운데, 너비 LOGO_W%. 비율마다 높이(%)가 달라 비율 다시 그리기 뒤에도 다시 계산합니다.
function logoBox(ratio) {
  const [W, H] = SIZES[ratio] || SIZES["3:4"];
  const h = round2(LOGO_W * LOGO_ASPECT * W / H);
  return { x: round2((100 - LOGO_W) / 2), y: round2(100 - LOGO_BOTTOM - h), w: LOGO_W, h };
}

function logoElement(index, ratio) {
  return { id: `p${index + 1}-${LOGO_ROLE}`, role: LOGO_ROLE, type: "image", ...logoBox(ratio), z: 1, src: LOGO_SRC,
    radius: 0, fit: "contain" };
}

// 확정한 그림 시안 → 문서 (designs.py IMAGE_MODE 설명과 같은 형식)
// Higgsfield로 실제 생성한 그림이라 demo: false (DEMO 배지는 진짜 시연 데이터에만, 2026-10-27 유진 요청)
// 포스터(베이스 템플릿)는 레이아웃을 남기고 장마다 로고를 얹습니다. pages[].prompt는 비율 다시 그리기가 다시 씁니다.
function imageDesign(kind, ratio, item) {
  const poster = kind === "poster";
  return {
    kind, ratio, demo: false, mode: IMAGE_MODE, style: item.style || null,
    assistant: { name: item.name, prompt: item.concept_ko,
      notice: `AI 그림 시안 · ${item.style_label} · 그림 속 글자와 제품 정보는 꼭 확인해 주세요.` },
    pages: item.pages.map((page, index) => ({
      layout: IMAGE_MODE, bg: "#ffffff", prompt: page.prompt_en, texts: page.texts,
      elements: [{ id: `p${index + 1}-${ARTWORK_ROLE}`, role: ARTWORK_ROLE, type: "image",
        x: 0, y: 0, w: 100, h: 100, z: 0, src: page.job?.url || "", radius: 0 },
      ...(poster ? [logoElement(index, ratio)] : [])],
    })),
  };
}

// 광고 표현 검수 결과를 node에 그립니다. (편집기 [광고 표현 검수])
function fillReview(node, data) {
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
  nodes.push(el("p", "studio-hint", data.disclaimer), button("닫기", () => { node.hidden = true; }));
  node.replaceChildren(...nodes);
  node.hidden = false;
}

// ---------- 새로 만들기: 그림 시안 3개 고르기 (2026-10-26 유진 결정: 시안을 그림 모델로 통째로) ----------
// sns.js(유진)가 포스터·카드뉴스 새로 만들기 [보내기]에서 부릅니다.
//   ① 견적(유진 design-images/quote, 무료) → 크레딧 확인 팝업(영상 탭과 같은 dialog) [만들기] / [취소 → onBack]
//   ② 그림 프롬프트(희주 design-assistant, gpt-4o-mini) → 그림 생성(유진 design-images, Higgsfield 크레딧)
//   ③ 상태(유진 design-images/status)를 몇 초마다 확인해 시안 카드에 그림을 채움 (카드뉴스는 장마다 진행 표시)
//   ④ [이 시안으로 확정] → onCreate(design, { product_id, product_ids }) (저장은 sns.js POST /api/chats, 실패하면 throw)
// style: 스타일 버튼 값(designs.py STYLE_HINTS key, AI 추천은 ""). pages: 카드뉴스 장수(3~6).
// productIds: 여러 제품(라인업). 유진 API가 product_id 하나만 받는 동안 첫 제품을 product_id로도 보냅니다.
// refs: 레퍼런스 이미지 [{file_id, url}] (없으면 []). 견적·생성 API에 ref_images로 그대로 넘깁니다.
// onBack: 조건 바꾸기 화면으로 돌아가기 (팝업 [취소] · [← 조건 바꾸기]). 없으면 [← 조건 바꾸기]를 숨깁니다.
// 포스터·카드뉴스 모두 도우미가 장면 프롬프트를 쓰고 prompts로 생성을 요청합니다. (포스터 템플릿 방식은 2026-10-27 되돌림)
// 응답 prompts(서버가 다듬어 실제로 보낸 전문)는 "프롬프트 전문"과 확정 문서의 pages[].prompt로 씁니다.
export function renderChoices(root, { kind, ratio, productId = null, productIds = null, style = "", pages = 5,
  request = "", refs = [], onCreate, onBack = null } = {}) {
  const ids = (Array.isArray(productIds) && productIds.length ? productIds : [productId]).filter(Boolean);
  const target = { kind, ratio, product_id: ids[0] || null, product_ids: ids, pages: kind === "poster" ? 1 : pages,
    ref_images: Array.isArray(refs) ? refs : [] };
  const label = kind === "poster" ? "포스터" : "카드뉴스";
  const wrap = el("div", "studio-editor studio-editor-choices");
  const msg = el("p", "studio-hint");
  msg.setAttribute("role", "status");
  const cards = el("div", "studio-editor-candidates");
  const actions = el("div", "studio-editor-actions");
  let quote = null;
  let proposals = [];  // [{name, concept_ko, style, style_label, pages: [{prompt_en, texts, job}]}]
  let selected = 0;
  let busy = false;
  let locked = false;  // 요청은 들어갔는데 결과를 못 받음 → 비용이 나갔을 수 있어 다시 만들지 못하게
  let sent = false;    // 그림 요청을 보냄 (프롬프트를 다시 쓰지 않음)
  let pollError = false;  // 상태 확인 오류 글을 띄웠는지 (다음 확인이 되면 지움)
  const count = (value) => Number(value || 0).toLocaleString("ko-KR");

  const back = button("← 조건 바꾸기", goBack);
  back.hidden = !onBack;
  const confirm = button("이 시안으로 확정", confirmChoice, "btn dark");
  const retry = button("다시 시도", loadQuote);  // 견적·프롬프트·생성이 실패했을 때 (견적부터 다시)
  // [시안 다시 생성]: 지금 조건 그대로 크레딧 팝업 → 새로 3개 (그림이 다 끝난 뒤에만 보임)
  const again = button("시안 다시 생성", () => {
    if (busy || locked) return;
    clearTimeout(timer);
    proposals = [];
    sent = false;
    selected = 0;
    cards.replaceChildren();
    updateActions();  // 이전 시안의 [확정]·[다시 생성] 버튼도 숨김
    loadQuote();
  });
  confirm.hidden = again.hidden = retry.hidden = true;
  actions.append(confirm, again, retry);
  const head = el("div", "studio-editor-choices-head");
  head.append(back, el("h2", "", `${label} 시안 고르기`));
  wrap.append(head, msg, cards, actions);
  root.replaceChildren(wrap);
  let timer = null;

  // [← 조건 바꾸기]: 그림을 이미 요청했으면 만든 시안이 사라진다고 한 번 확인합니다.
  function goBack() {
    if (!onBack || busy) return;
    if (sent && !window.confirm("만든 시안은 사라져요. (크레딧은 이미 사용했어요) 조건 바꾸기로 돌아갈까요?")) return;
    clearTimeout(timer);
    onBack();
  }

  // 팝업을 띄우고, [만들기]면 생성 · [취소]면 조건 바꾸기로 (onBack이 없으면 다시 시도 버튼만)
  async function ask() {
    if (!wrap.isConnected) return;
    const asked = await creditDialog(wrap, quote, {
      title: `${label} 시안 만들기`, run: "만들기",
      detail: `${quote.model || "그림 모델"} · 시안 ${quote.proposals}개 × ${quote.pages}장 = ${quote.count}장 (장당 ${count(quote.unit)})`,
    });
    if (asked) return generate();
    if (onBack) return onBack();
    msg.textContent = "만들기를 취소했어요.";
    retry.hidden = false;
  }

  function show() {
    cards.replaceChildren(...proposals.map((item, index) => imageCard(item, index === selected, () => {
      selected = index;
      show();
      updateActions();
    }, ratio, kind === "poster")));
  }

  function updateActions() {
    const running = proposals.some((item) => item.pages.some((page) => page.job && !pageDone(page) && !pageFailed(page)
      && page.job.status !== NOT_SENT));
    const ready = proposals[selected]?.pages.every(pageDone);
    confirm.hidden = !sent;
    confirm.disabled = busy || !ready;
    confirm.title = ready ? "" : "이 시안의 그림이 다 그려지면 확정할 수 있어요";
    again.hidden = !sent || running;
    again.disabled = busy || locked;
    retry.disabled = busy;
  }

  // ① 견적 → 크레딧 확인 팝업
  async function loadQuote() {
    if (busy) return;
    retry.hidden = true;
    msg.textContent = "비용과 남은 크레딧을 확인하는 중…";
    try {
      quote = (await postJson(IMAGE_QUOTE_API, target)).quote;
      if (!wrap.isConnected) return;
      msg.textContent = "";
      ask();
    } catch (error) {
      msg.textContent = error.message;  // 예: Higgsfield 로그인 필요 (유진 PC에서만 생성돼요)
      retry.hidden = false;
    }
  }

  // ② 프롬프트 → 그림 생성
  async function generate() {
    if (busy || locked || !quote?.allowed) return;
    busy = true;
    retry.hidden = true;
    let reask = false;  // 409(비용 바뀜·한도) → 새 견적으로 팝업을 다시
    try {
      msg.textContent = "";  // 진행 안내 글은 두지 않습니다 (2026-10-27 유진 요청). 일부 실패는 카드의 "실패" 표시로.
      if (!proposals.length) {  // 견적이 바뀌어 다시 누를 때는 이미 쓴 프롬프트를 그대로 씁니다.
        const data = await postJson(ASSISTANT_API, {
          design: { kind, ratio, demo: true, pages: [{ elements: [] }] }, confirm_paid: true,
          options: { request, product_id: target.product_id, product_ids: ids, style: style || "", pages: target.pages },
        });
        if (!wrap.isConnected) return;
        proposals = data.proposals.map((item) => ({ ...item, pages: item.pages.map((page) => ({ ...page, job: null })) }));
      }
      const res = await fetch(IMAGE_API, {  // 포스터·카드뉴스 모두 [[장면 프롬프트] × 장] × 3안
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...target, prompts: proposals.map((item) => item.pages.map((page) => page.prompt_en)),
          credits: quote.credits }),
      });
      const data = await res.json().catch(() => ({ ok: false, submitted: res.ok || res.status === 202 }));
      if (!wrap.isConnected) return;
      if (res.status === 409 && data.quote) {  // 비용이 바뀌었거나 한도 초과 → 새 견적으로 팝업을 다시
        quote = data.quote;
        msg.textContent = `${data.error} 비용을 다시 확인해 주세요.`;
        reask = true;
        return;
      }
      if (Array.isArray(data.jobs)) {
        data.jobs.forEach((jobs, p) => (jobs || []).forEach((job, i) => {
          const page = proposals[p]?.pages[i];
          if (page) page.job = job ? { request_id: job.request_id, status: job.status, url: null } : { status: NOT_SENT };
        }));
      }
      // 실제로 보낸 프롬프트 전문 → 카드의 "프롬프트 전문"과 확정 문서의 pages[].prompt (비율 다시 그리기가 다시 씀)
      if (Array.isArray(data.prompts)) {
        data.prompts.forEach((list, p) => (list || []).forEach((text, i) => {
          const page = proposals[p]?.pages[i];
          if (page && typeof text === "string") page.prompt_en = text;
        }));
      }
      if (data.submitted) locked = true;
      if (!data.ok && !data.submitted) throw new Error(data.error || "그림을 요청하지 못했어요.");
      sent = true;
      msg.textContent = data.submitted ? data.error : "";  // 202: 다시 누르지 말라는 안내만 남깁니다.
      show();
      poll();
    } catch (error) {
      msg.textContent = error.message;
      retry.hidden = locked;
    } finally {
      busy = false;
      if (wrap.isConnected) updateActions();
    }
    if (reask) ask();
  }

  // ③ 상태 확인 (몇 초마다, 다시 만들지 않음)
  async function poll() {
    if (!wrap.isConnected) return;
    const waiting = proposals.flatMap((item) => item.pages.map((page) => page.job))
      .filter((job) => job?.request_id && job.status !== IMAGE_DONE && !IMAGE_FAILED.includes(job.status));
    if (!waiting.length) return finish();
    try {
      const res = await fetch(`${IMAGE_STATUS_API}?ids=${waiting.map((job) => job.request_id).join(",")}`);
      const data = await res.json().catch(() => ({ ok: false }));
      if (!data.ok) throw new Error(data.error || "상태를 확인하지 못했어요.");
      for (const job of waiting) {
        const now = data.jobs?.[job.request_id];
        if (now) Object.assign(job, { status: now.status, url: now.url || null });
      }
      if (pollError) msg.textContent = "";
      pollError = false;
      show();
      updateActions();
    } catch (error) {
      msg.textContent = `${error.message} 잠시 뒤 다시 확인해요.`;
      pollError = true;
    }
    if (wrap.isConnected) timer = setTimeout(poll, IMAGE_POLL_MS);
  }

  function finish() {  // 다 받음: 안내 글 없이 버튼만 (일부 실패는 카드에 표시)
    updateActions();
  }

  // ④ 확정
  async function confirmChoice() {
    const item = proposals[selected];
    if (busy || !item || !item.pages.every(pageDone) || !onCreate) return;
    busy = true;
    updateActions();
    msg.textContent = "고른 시안을 저장하는 중…";
    try {
      clearTimeout(timer);
      await onCreate(imageDesign(kind, ratio, item), { product_id: target.product_id, product_ids: ids });
    } catch {
      msg.textContent = "시안을 저장하지 못했어요. 다시 눌러 주세요.";
      if (wrap.isConnected) poll();
    } finally {
      busy = false;
      if (wrap.isConnected) updateActions();
    }
  }

  loadQuote();
}

// 지금 편집기에서 보고 있는 장 번호(0부터). sns.js가 대화로 고치기 요청에 page로 보냅니다.
export function currentPage() {
  return pageIndex;
}

// ---------- 편집기 ----------
// root 안에 포스터·카드뉴스 문서(README 8장 형식)를 그립니다. onSave(newDoc)는 Promise를 돌려줍니다.
// 배치: 가운데 초안(끌어서·두 번 눌러 고치기) · 오른쪽 고정 칸(비율·장·↶ ↷·내보내기·검수·꾸미기·선택한 요소·문구·Figma).
// 말로 고치기는 아래 입력창(sns.js 유진)이 맡습니다.
// onUndo·onRedo·canUndo·canRedo: sns.js가 넘기는 되돌리기·다시하기. 없으면 오른쪽 칸의 ↶ ↷를 숨깁니다.
export function renderDesign(root, doc, { onSave, onUndo, onRedo, canUndo = false, canRedo = false } = {}) {
  const draft = structuredClone(doc);
  if (pageIndex >= draft.pages.length) pageIndex = 0;
  let page = draft.pages[pageIndex];
  const [W, H] = sizeOf(draft);
  let scale = 1;
  let action = null;   // 끌기·크기 조절 중인 정보
  let editing = false; // 글자 수정 중에는 다시 그리지 않습니다.
  let ratioBusy = false;

  const wrap = el("div", "studio-editor studio-editor-work");
  const pagesBar = el("div", "studio-editor-pages");
  const view = el("div", "studio-editor-view");
  const stage = el("div", "studio-editor-stage");
  const review = el("div", "studio-editor-review");  // 광고 표현 검수 결과
  const imageDoc = draft.mode === IMAGE_MODE;  // 그림 시안: 그림 한 장으로 다룸 (비율은 다시 그리기, AI 배경 그림·꾸미기 없음)
  // 문구 · 한국어 뜻: 그림 시안은 펼친 채 회색 글자로, 예전 틀 방식은 눌러서 펼치는 칸
  const translations = el(imageDoc ? "section" : "details", "studio-editor-translations");
  translations.open = false;
  review.hidden = true;
  stage.setAttribute("role", "group");
  stage.setAttribute("aria-label",
    "편집 화면. Tab으로 요소 고르기, Enter로 글 고치기(Ctrl+Enter로 마치기), 방향키로 옮기기(Shift와 함께 크게), Esc로 선택 풀기");
  stage.style.width = `${W}px`;
  stage.style.height = `${H}px`;
  view.append(stage);
  const center = el("div", "studio-editor-center");  // 가운데 초안
  const side = el("aside", "studio-editor-panel");   // 오른쪽 고정 칸 (updateBar가 채움)
  side.setAttribute("aria-label", "편집 기능");
  center.append(view);
  wrap.append(center, side);
  root.replaceChildren(wrap);
  let externalPanel = null;  // Figma 칸 (renderExternal). 그림 시안에는 두지 않습니다.
  if (!imageDoc) {
    renderExternal();
    window.addEventListener("focus", syncFigma);
    syncFigma();
  }

  const find = (id) => page.elements.find((item) => item.id === id);
  // 바탕처럼 두는 그림(고르거나 옮기지 않음): AI 배경 그림 · 그림 시안 그림 · 포스터 로고
  const isBacking = (item) => item.role === BG_ROLE || item.role === ARTWORK_ROLE || item.role === LOGO_ROLE;
  const pickable = (id) => { const item = id && find(id); return item && !isBacking(item) ? item : null; };
  if (selectedId && !pickable(selectedId)) selectedId = null;

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
      transform: item.rotate ? `rotate(${item.rotate}deg)` : "",
      opacity: item.opacity ?? "",
    });

    if (item.type === "text") {
      const pad = padOf(item);
      node.classList.add("is-text");
      Object.assign(node.style, {
        font: fontOf(item),
        lineHeight: LINE,
        letterSpacing: item.spacing ? `${item.spacing}px` : "",
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
        if (item.fit === "contain") img.style.objectFit = "contain";  // 로고: 자르지 않고 칸 안에 맞춤
        node.append(img);
      } else {
        node.classList.add("is-empty");
        node.style.color = page.accent;
        node.append(el("span", "", "제품 사진 자리"));
      }
    } else if (item.type === "shape") {
      node.style.background = item.fill || "transparent";  // fill이 없으면 테두리만 있는 도형
      node.style.border = item.stroke ? `${item.stroke_w || 2}px solid ${item.stroke}` : "";
      node.style.borderRadius = item.shape === "circle" ? "50%" : `${item.radius || 0}px`;
    } else if (item.type === "sticker") {
      node.classList.add("is-sticker");
      node.style.fontSize = `${stickerSize(item, W, H)}px`;
      node.style.fontFamily = EMOJI_FONT;
      node.append(el("span", "", item.emoji || "⭐"));
    } else {
      return null;  // 아직 그리지 못하는 종류
    }

    if (isBacking(item)) {  // 바탕처럼: Tab·화면 읽기에서 빼고, 눌러도 고르지 않습니다.
      node.classList.add("is-background");
      node.tabIndex = -1;
      node.removeAttribute("role");
      node.removeAttribute("aria-pressed");
      node.setAttribute("aria-hidden", "true");
      node.style.cursor = "default";
    } else if (item.id === selectedId) {
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
    const heading = `${pageIndex + 1}장 문구 · 한국어 뜻`;
    translations.replaceChildren(imageDoc ? el("h3", "", heading) : el("summary", "", heading));
    if (draft.assistant) translations.append(el("p", "studio-hint", draft.assistant.notice));
    // 그림 시안: 그림 속에 넣은 문구 원문(page.texts). 그림 속 글자가 이 원문과 같은지 확인합니다. (회색 글자)
    for (const text of page.texts || []) {
      const row = el("div", "studio-editor-translation");
      const vi = el("p", "studio-hint", text.vi);
      vi.lang = "vi";
      row.append(vi, el("p", "studio-hint", text.ko));
      translations.append(row);
    }
    if (page.texts?.length) translations.append(el("p", "is-warn", "그림 속 글자가 위 원문과 같은지 꼭 확인해 주세요."));
    const items = page.elements.filter((item) => item.type === "text" && item.text_ko);
    if (!items.length && !page.texts?.length) {
      translations.append(el("p", "studio-hint", "AI 시안을 확정하면 베트남어 문구와 한국어 뜻을 함께 보여줍니다."));
    }
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
    if (externalPanel?.isConnected) externalPanel.replaceWith(panel);  // 처음에는 updateBar가 오른쪽 칸 맨 아래에 붙입니다.
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

  // ---------- 장 (카드뉴스): 장 번호 · 이 장 복사해서 추가 · 이 장 삭제 ----------
  function renderPages() {
    const nodes = draft.pages.map((_, index) => {
      const node = button(String(index + 1), () => goPage(index), index === pageIndex ? "btn dark" : "btn");
      if (index === pageIndex) node.setAttribute("aria-current", "page");
      node.setAttribute("aria-label", `${index + 1}장`);
      return node;
    });
    if (draft.kind === "cardnews") {
      const add = button("＋ 장 추가", addPage);
      add.title = "지금 장을 복사해 바로 뒤에 넣어요";
      add.disabled = draft.pages.length >= CARD_PAGES[1];
      const remove = button("이 장 삭제", removePage);
      remove.disabled = draft.pages.length <= CARD_PAGES[0];
      nodes.push(add, remove);
    }
    pagesBar.replaceChildren(...nodes);
  }

  function goPage(index) {
    if (index !== pageIndex) openPage(index);
  }

  function openPage(index) {
    pageIndex = index;
    page = draft.pages[index];
    selectedId = null;
    draw();
    updateBar();
    loadFontsFor(page).then(() => { if (wrap.isConnected && page === draft.pages[index]) draw(); });
  }

  function addPage() {
    if (draft.pages.length >= CARD_PAGES[1]) return;
    const copied = structuredClone(page);
    const stamp = Date.now().toString(36);
    copied.elements.forEach((item, index) => { item.id = `${item.id}-${stamp}${index}`; });  // 장마다 id가 겹치지 않게
    draft.pages.splice(pageIndex + 1, 0, copied);
    openPage(pageIndex + 1);
    save();
  }

  function removePage() {
    if (draft.pages.length <= CARD_PAGES[0]) return;
    draft.pages.splice(pageIndex, 1);
    openPage(Math.min(pageIndex, draft.pages.length - 1));
    save();
  }

  // ---------- 그림 시안 비율 다시 그리기 (크레딧) ----------
  // 견적(reratio/quote) → 크레딧 팝업 [다시 그리기] → reratio → design-images/status 확인(pollReratio)
  // → 다 되면 ratio·장별 그림 주소를 바꾼 새 문서를 onSave로 저장 (새 버전이라 ↶로 원래 비율로 돌아감)
  async function changeImageRatio(value) {
    if (value === draft.ratio || ratioBusy || reratio || reratioLocked || !onSave) return;
    const chatId = Number(new URL(location.href).searchParams.get("chat"));
    if (!chatId) { status.textContent = "작업을 저장한 뒤 비율을 바꿀 수 있어요."; return; }
    ratioBusy = true;
    updateBar();
    status.textContent = "비용과 남은 크레딧을 확인하는 중…";
    try {
      let { quote } = await postJson(`${CHAT_API}/${chatId}/reratio/quote`, { ratio: value });
      for (;;) {
        if (!wrap.isConnected) return;
        status.textContent = "";
        const asked = await creditDialog(wrap, quote, {
          title: `${value} 비율로 다시 그리기`, run: "다시 그리기",
          detail: `${quote.model || "그림 모델"} · ${quote.pages}장 다시 그리기 (장당 ${quote.unit}) · 지금 그림과 장별 프롬프트를 참고해요`,
        });
        if (!asked) return;
        status.textContent = `${value} 비율로 다시 그리기를 요청하는 중…`;
        const res = await fetch(`${CHAT_API}/${chatId}/reratio`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ratio: value, credits: quote.credits }),
        });
        const data = await res.json().catch(() => ({ ok: false, submitted: res.ok || res.status === 202 }));
        if (res.status === 409 && data.quote) {  // 비용이 바뀌었거나 한도 초과 → 새 견적으로 팝업을 다시
          quote = data.quote;
          continue;
        }
        if (data.submitted) reratioLocked = true;
        if (!data.ok && !data.submitted) throw new Error(data.error || "다시 그리기를 요청하지 못했어요.");
        const jobs = (data.jobs || []).map((job) => (job ? { request_id: job.request_id, status: job.status, url: null }
          : { status: NOT_SENT }));
        if (!jobs.some((job) => job.request_id)) {  // 작업 ID를 하나도 못 받음 → 확인할 것이 없음
          status.textContent = data.error || "다시 그리기 결과를 받지 못했어요. 다시 누르지 마세요.";
          return;
        }
        reratio = { chatId, ratio: value, pages: draft.pages.length, jobs, warning: data.warning || data.error || "" };
        pollReratio();
        return;
      }
    } catch (error) {
      status.textContent = error.message;
    } finally {
      ratioBusy = false;
      if (wrap.isConnected) updateBar();
    }
  }

  // 진행 표시 · 끝나면 저장. 일부 장을 못 그렸으면 저장하지 않고 알립니다.
  function placeReratio(job, done) {
    if (!wrap.isConnected || Number(new URL(location.href).searchParams.get("chat")) !== job.chatId) return;
    const drawn = job.jobs.filter((one) => one.status === IMAGE_DONE && one.url).length;
    const total = job.pages;
    if (!done) {
      status.textContent = `${job.ratio} 비율로 다시 그리는 중… ${drawn}/${total}장${job.note ? ` · ${job.note}` : ""}`;
      updateBar();
      return;
    }
    updateBar();
    if (drawn < total || job.jobs.length !== draft.pages.length) {
      status.textContent = `${total - drawn}장을 그리지 못해 저장하지 않았어요. (그린 장만큼 크레딧은 사용됐어요)`
        + (job.warning ? ` ${job.warning}` : "");
      return;
    }
    const next = structuredClone(draft);
    next.ratio = job.ratio;
    next.demo = false;  // 실제 생성한 그림
    next.pages.forEach((one, index) => {
      const art = one.elements.find((item) => item.role === ARTWORK_ROLE);
      if (art) art.src = job.jobs[index].url;
      for (const logo of one.elements.filter((item) => item.role === LOGO_ROLE)) Object.assign(logo, logoBox(job.ratio));
    });
    status.textContent = `${job.ratio} 비율로 다시 그렸어요. 저장하는 중…`;
    onSave(next).catch(() => { status.textContent = "다시 그린 그림을 저장하지 못했어요. 다시 시도해 주세요."; });
  }

  // ---------- 비율 바꾸기 (무료) ----------
  // 서버(designs.py change_ratio)가 새 비율에 맞춘 문서를 돌려주고, 저장하면 sns.js가 새 문서로 다시 그립니다.
  async function changeRatio(value) {
    if (value === draft.ratio || ratioBusy || !onSave) return;
    ratioBusy = true;
    updateBar();
    status.textContent = "비율을 바꾸는 중…";
    try {
      const data = await postJson(RATIO_API, { design: draft, ratio: value });
      await onSave(data.design);
    } catch (error) {
      status.textContent = error.message || "비율을 바꾸지 못했어요.";
    } finally {
      ratioBusy = false;
      if (wrap.isConnected) updateBar();
    }
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

  // ---------- 오른쪽 고정 칸 ----------
  // 고르기·장 옮기기·저장 때마다 다시 채웁니다. 검수 결과·문구·Figma 칸은 같은 노드를 다시 붙여 펼친 상태를 유지합니다.
  function section(title, nodes, className = "") {  // title이 비면 제목 없이 버튼 줄만
    const box = el("section", `studio-editor-panel-section ${className}`.trim());
    const row = el("div", "studio-editor-panel-row");
    row.append(...nodes.filter(Boolean));
    if (title) box.append(el("h3", "", title));
    box.append(row);
    return box;
  }

  function updateBar() {
    const item = pickable(selectedId);
    const head = el("div", "studio-editor-panel-head");
    head.append(status);

    const ratios = (DESIGN_RATIOS[draft.kind] || [draft.ratio]).map((value) => {
      const node = button(value, () => changeRatio(value), value === draft.ratio ? "btn dark" : "btn");
      node.setAttribute("aria-pressed", String(value === draft.ratio));
      node.disabled = ratioBusy;
      return node;
    });

    const history = [];
    if (onUndo) {
      const undo = button("↶ 되돌리기", onUndo);
      undo.title = "Ctrl+Z";
      undo.disabled = !canUndo;
      history.push(undo);
    }
    if (onRedo) {
      const redo = button("↷ 다시하기", onRedo);
      redo.title = "Ctrl+Shift+Z";
      redo.disabled = !canRedo;
      history.push(redo);
    }

    const multi = draft.pages.length > 1;
    const redrawing = imageDoc && Boolean(reratio);  // 비율 다시 그리는 중: 비율 버튼·내보내기 잠금
    const exports = [button(multi ? "이 장 PNG" : "PNG", () => download("png")),
      button(multi ? "이 장 JPG" : "JPG", () => download("jpg")), multi && button("모든 장 PNG", downloadAll)];
    for (const node of exports) if (node) node.disabled = redrawing;

    if (imageDoc) {  // 그림 시안: 비율(다시 그리기) · 장 · 되돌리기 · 내보내기 · 검수 · 문구 (2026-10-27 유진 요청으로 정리)
      const choices = IMAGE_RATIO_CHOICES.includes(draft.ratio) ? IMAGE_RATIO_CHOICES : [draft.ratio, ...IMAGE_RATIO_CHOICES];
      const ratioButtons = choices.map((value) => {
        const current = value === draft.ratio;
        const node = button(value, () => changeImageRatio(value), current ? "btn dark" : "btn");
        node.setAttribute("aria-pressed", String(current));
        node.disabled = !current && (ratioBusy || redrawing || reratioLocked);
        node.title = current ? "지금 비율" : `${value}로 다시 그리기 (크레딧 사용)`;
        return node;
      });
      const nodes = [head, section(`비율 · ${draft.ratio}`, ratioButtons)];
      if (multi) {
        renderPages();
        nodes.push(section(`장 · ${pageIndex + 1}/${draft.pages.length}`, [pagesBar]));
      }
      if (history.length) nodes.push(section("", history));
      nodes.push(section("내보내기", exports), section("", [button("광고 표현 검수", runReview)]), review);
      if (item) nodes.push(section(`선택한 요소 · ${ROLE_NAMES[item.role] || TYPE_NAMES[item.type] || "요소"}`, itemTools(item), "is-selected"));
      side.replaceChildren(...nodes, translations);
      return;
    }

    const make = button("🖼 AI 배경 그림 (유료)", makeBackground);
    make.disabled = bgBusy || bgLocked;
    const decorate = [addSelect(), field("배경색", colorInput(page.bg, (value) => { page.bg = value; draw(); save(); })),
      make, page.elements.some((one) => one.role === BG_ROLE) && button("배경 그림 빼기", () => {
        page.elements = page.elements.filter((one) => one.role !== BG_ROLE);
        draw();
        updateBar();
        save();
      }),
      button("✂️ 배경 제거", openRemoveBg)];  // 기존 배경 제거 창(sns_image.js)을 엽니다.

    const nodes = [head, section("비율", ratios)];
    if (draft.kind === "cardnews" || multi) {
      renderPages();
      nodes.push(section(`장 · ${pageIndex + 1}/${draft.pages.length}`, [pagesBar]));
    }
    if (history.length) nodes.push(section("되돌리기", history));
    nodes.push(section("내보내기", exports), section("검수", [button("광고 표현 검수", runReview)]), review,
      section("꾸미기", decorate));
    nodes.push(item
      ? section(`선택한 요소 · ${ROLE_NAMES[item.role] || TYPE_NAMES[item.type] || "요소"}`, itemTools(item), "is-selected")
      : el("p", "studio-hint", "초안에서 요소를 누르면 여기서 글꼴·크기·색을 바꿀 수 있어요."));
    side.replaceChildren(...nodes, translations, ...(externalPanel ? [externalPanel] : []));
  }

  // 선택한 요소 도구: 종류별 칸 + 순서 · 삭제
  function itemTools(item) {
    const tools = [];
    if (item.type === "text") {
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
      // 테두리만 있는 도형(fill 없음)은 테두리 색을 바꿉니다.
      const outline = !item.fill && item.stroke;
      tools.push(field("색", colorInput(outline ? item.stroke : item.fill, (value) => {
        if (outline) item.stroke = value; else item.fill = value;
        draw();
        save();
      })));
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
    tools.push(
      button("맨 앞", () => reorder(item, "top")),
      button("앞으로", () => reorder(item, "up")),
      button("뒤로", () => reorder(item, "down")),
      button("맨 뒤", () => reorder(item, "bottom")),
      button("삭제", () => {
        page.elements = page.elements.filter((other) => other.id !== item.id);
        selectedId = null;
        draw();
        updateBar();
        save();
      }),
    );
    return tools;
  }

  // ---------- AI 배경 그림 (OpenAI 이미지 모델 · 유료) ----------
  // 무료 견적 → 확인 창 → 1장 만들기. 그림에는 글자를 넣지 않고, 지금 글 요소는 그대로 위에 남습니다.
  // 만든 그림은 장 맨 아래 요소로 깔고 기존 저장 경로(onSave)로 저장합니다.
  async function makeBackground() {
    if (bgBusy || bgLocked) return;
    const chatId = Number(new URL(location.href).searchParams.get("chat"));
    if (!chatId) { status.textContent = "작업을 저장한 뒤 배경 그림을 만들 수 있어요."; return; }
    const wish = window.prompt("원하는 장면·분위기를 적어 주세요. (비워 두면 기본 연출)\n예: 크리스마스 테이블, 따뜻한 조명", "");
    if (wish === null) return;
    const target = { chat_id: chatId, page: pageIndex, request: wish.trim() };
    bgBusy = true;
    updateBar();
    status.textContent = "비용을 확인하는 중…";
    try {
      const { quote } = await postJson(BG_QUOTE_API, target);
      if (!quote.allowed) { status.textContent = quote.reason; return; }
      const ok = window.confirm([
        `배경 그림 ${quote.count}장을 만들까요? (유료)`,
        `· ${quote.model} · 품질 ${quote.quality} · ${quote.size}`,
        `· 제품 참고 사진 ${quote.photos}장`,
        `· 예상 비용 약 $${quote.usd.toFixed(3)} (추정. 실제 청구액은 OpenAI 사용 내역 기준)`,
        `· 오늘 ${quote.today_count}/${quote.daily_limit}장 사용`,
        "그림에는 글자를 넣지 않고, 지금 글은 그대로 위에 남아요.",
      ].join("\n"));
      if (!ok) { status.textContent = ""; return; }
      status.textContent = "배경 그림을 만드는 중… (1분 넘게 걸릴 수 있어요. 자동 재시도하지 않아요)";
      const res = await fetch(BG_API, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...target, confirm_paid: true, usd: quote.usd }),
      });
      const data = await res.json().catch(() => ({ ok: false, submitted: res.ok || res.status === 202 }));
      if (data.submitted) bgLocked = true;
      if (!data.ok) throw new Error(data.error || "배경 그림을 만들지 못했어요. 배경은 그대로 두었어요.");
      const usd = `${data.cost.estimated ? "약 " : ""}$${Number(data.cost.usd).toFixed(3)}`;
      (applyBackground || placeBackground)({ chat: chatId, ...data }, `이번 ${usd} · 오늘 ${data.today_count}/${data.daily_limit}장`);
    } catch (error) {
      status.textContent = error.message;
    } finally {
      bgBusy = false;
      if (wrap.isConnected) updateBar();
    }
  }

  // 결과를 이 편집기의 장에 깝니다. (만드는 동안 다시 그려졌으면 makeBackground가 최신 편집기의 이 함수를 부릅니다)
  function placeBackground(result, note) {
    const into = draft.pages[result.page];
    if (!wrap.isConnected || !into || Number(new URL(location.href).searchParams.get("chat")) !== result.chat) return;
    into.elements = [result.element, ...into.elements.filter((one) => one.role !== BG_ROLE)];
    if (into === page) draw();
    updateBar();
    status.textContent = `${result.page + 1}장에 배경 그림을 깔았어요. ${note}`;
    save();
  }
  applyBackground = placeBackground;

  async function download(type) {
    if (imageDoc && reratio) return;  // 비율 다시 그리는 중에는 내보내기 잠금
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
      fillReview(review, await postJson(REVIEW_API, { design: draft }));
    } catch (error) {
      review.replaceChildren(el("p", "is-error", error.message), button("닫기", () => { review.hidden = true; }));
    }
  }

  // 장마다 PNG 한 장씩 받습니다. 브라우저가 "여러 파일 다운로드"를 물으면 허용해 주세요.
  async function downloadAll() {
    if (imageDoc && reratio) return;
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
    const item = node && pickable(node.dataset.id);
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
    // 공통 화면 배율(base.css --ui-zoom)이 걸리면 마우스 이동량(화면 px)과 편집 화면 크기(CSS px)가 달라서 보정합니다.
    const zoom = view.getBoundingClientRect().width / view.offsetWidth || 1;  // stage는 scale 변형이 있어 변형 없는 view로 잼
    const dx = (event.clientX - action.sx) / zoom / scale / W * 100;
    const dy = (event.clientY - action.sy) / zoom / scale / H * 100;
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
    if (!node || node.dataset.id === selectedId || !pickable(node.dataset.id)) return;
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

  draw();
  updateBar();  // 오른쪽 칸 (장 번호도 여기서 그림)
  if (imageDoc) {
    applyReratio = placeReratio;
    if (reratio) placeReratio(reratio, false);  // 그리는 중에 다시 그려진 편집기도 진행 표시를 이어 받음
  }
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

function shapePath(ctx, item, x, y, w, h) {
  if (item.shape === "circle") {
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, Math.max(0, w / 2), Math.max(0, h / 2), 0, 0, Math.PI * 2);
  } else {
    roundedRect(ctx, x, y, w, h, item.radius || 0);
  }
}

// 화면(CSS)과 같게: 상자 가운데를 기준으로 기울이고(rotate), 투명도(opacity)를 적용한 뒤 그립니다.
async function paint(ctx, item, W, H) {
  const x = item.x / 100 * W;
  const y = item.y / 100 * H;
  const w = item.w / 100 * W;
  const h = item.h / 100 * H;
  ctx.save();
  try {
    if (item.opacity !== undefined) ctx.globalAlpha = clamp(Number(item.opacity), 0, 1);
    if (item.rotate) {
      ctx.translate(x + w / 2, y + h / 2);
      ctx.rotate(item.rotate * Math.PI / 180);
      ctx.translate(-(x + w / 2), -(y + h / 2));
    }
    await paintItem(ctx, item, x, y, w, h, W, H);
  } finally {
    ctx.restore();
  }
}

async function paintItem(ctx, item, x, y, w, h, W, H) {
  if (item.type === "shape") {
    if (item.fill) {
      ctx.fillStyle = item.fill;
      shapePath(ctx, item, x, y, w, h);
      ctx.fill();
    }
    if (item.stroke) {
      // 화면의 border(상자 안쪽)와 같게 선 두께의 절반만큼 안으로 들여 그립니다.
      const line = item.stroke_w || 2;
      ctx.strokeStyle = item.stroke;
      ctx.lineWidth = line;
      shapePath(ctx, { ...item, radius: Math.max(0, (item.radius || 0) - line / 2) },
        x + line / 2, y + line / 2, w - line, h - line);
      ctx.stroke();
    }
  } else if (item.type === "image") {
    if (!item.src) return;  // 빈 사진 자리는 내보내지 않습니다.
    const img = await loadImage(item.src);
    if (item.fit === "contain") {  // 로고: 화면의 object-fit: contain과 같게 자르지 않고 가운데에 맞춤
      const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
      const dw = img.naturalWidth * scale;
      const dh = img.naturalHeight * scale;
      ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      return;
    }
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
