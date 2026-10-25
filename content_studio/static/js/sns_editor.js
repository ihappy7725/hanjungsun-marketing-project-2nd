// 포스터·카드뉴스 편집기, 미리보기, PNG 내보내기 [희주]
// sns.js가 import합니다. 가운데 영역만 그리고, 저장은 sns.js가 넘겨준 onSave로 합니다.
// 문서 형식은 designs.py 위쪽 설명과 같습니다: x·y·w·h는 페이지 대비 %, size는 원본 크기 기준 px.
import {
  FONT_GROUPS, LOCAL_PREFIX, fontFamily, getLocalFonts, loadFont, loadFontsFor, loadLocalFonts, localFontsSupported,
} from "./sns_fonts.js";

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
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIDE = 4096;
// [추가] 메뉴의 이모지 16종 (designs.py EMOJIS와 같은 목록)
const EMOJIS = ["❤️", "⭐", "✨", "🌸", "🎁", "🎀", "🎉", "🔥", "😊", "👍", "🍡", "🍰", "🍵", "🍃", "🥭", "🍓"];
const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';

const measure = document.createElement("canvas").getContext("2d");
let selectedId = null;  // 저장 후 다시 그려도 선택을 유지합니다. (모듈 안 변수)
let pageIndex = 0;      // 카드뉴스에서 보고 있는 장. 저장 후 다시 그려도 같은 장에 남습니다.

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

// 화면과 내보내기가 같은 줄바꿈을 쓰도록 글자 폭을 재서 줄을 나눕니다.
function wrapLines(ctx, item, maxWidth) {
  ctx.font = fontOf(item);
  const lines = [];
  for (const paragraph of String(item.text || "").split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = next;
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

// 지금 편집기에서 보고 있는 장 번호(0부터). sns.js가 대화로 고치기 요청에 page로 보냅니다.
export function currentPage() {
  return pageIndex;
}

// ---------- 편집기 ----------
// root 안에 포스터·카드뉴스 문서(README 8장 형식)를 그립니다. onSave(newDoc)는 Promise를 돌려줍니다.
// 카드뉴스처럼 여러 장이면 위쪽 장 번호 버튼으로 장을 옮깁니다.
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
  stage.style.width = `${W}px`;
  stage.style.height = `${H}px`;
  view.append(stage);
  wrap.append(pagesBar, bar, view, translations, review);
  root.replaceChildren(wrap);
  renderExternal();

  const find = (id) => page.elements.find((item) => item.id === id);
  if (selectedId && !find(selectedId)) selectedId = null;

  async function save() {
    if (!onSave) return;
    try {
      await onSave(structuredClone(draft));
    } catch {
      // 안내 문구는 sns.js가 보여줍니다.
    }
  }

  // ---------- 그리기 ----------
  function drawItem(item) {
    const node = el("div", "studio-editor-item");
    node.dataset.id = item.id;
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
    stage.style.background = page.bg;
    stage.replaceChildren(...page.elements.map(drawItem).filter(Boolean));
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

  function renderExternal() {
    const panel = el("details", "studio-editor-external");
    panel.open = Boolean(draft.external_figma);
    panel.append(el("summary", "", "Figma에서 편집 · 외부 미리보기"),
      el("p", "studio-hint", "Figma에서 편집한 프레임의 ‘선택 항목 링크’를 연결하세요. 자동 전송은 아직 연결되지 않았습니다. 원래 초안 PNG/JPG 받기는 위 버튼을 사용하세요."));
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
    input.addEventListener("input", () => { open.hidden = input.value !== draft.external_figma?.url || !currentLink; });
    panel.append(field("Figma 선택 항목 링크", input), store, open, refresh, msg);
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
    wrap.append(panel);
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
  function field(label, input) {
    const box = el("label", "studio-editor-field");
    box.append(el("span", "", label), input);
    return box;
  }

  function colorInput(value, onChange) {
    const input = el("input");
    input.type = "color";
    input.value = value || "#000000";
    input.addEventListener("change", () => onChange(input.value));
    return input;
  }

  function button(text, onClick, className = "btn") {
    const node = el("button", className, text);
    node.type = "button";
    node.addEventListener("click", onClick);
    return node;
  }

  const status = el("span", "studio-hint");

  function option(value, text, disabled = false) {
    const node = el("option", "", text);
    node.value = value;
    node.disabled = disabled;
    return node;
  }

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

  function selectBox(className, choices, value, onChange) {
    const select = el("select", className);
    for (const [key, text] of choices) select.append(option(key, text));
    select.value = value;
    select.addEventListener("change", () => onChange(select.value));
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
    tools.push(addSelect());

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
    tools.push(button("프롬프트 · AI 초안", openPrompt));
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

  async function postJson(url, body) {
    const res = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({ ok: false }));
    if (!data.ok) throw new Error(data.error || "서버에 연결하지 못했습니다.");
    return data;
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
  function openPrompt() {
    const dialog = el("dialog", "studio-editor-prompt");
    const close = button("×", () => dialog.close(), "close");
    close.setAttribute("aria-label", "닫기");
    const previous = draft.assistant?.options || {};
    const wish = el("textarea");
    wish.rows = 4;
    wish.maxLength = 1500;
    wish.value = previous.request || "";
    wish.placeholder = "제품명, 확인된 제품 정보와 원하는 내용을 적어 주세요. 예: 망고스틴 찹쌀떡 신메뉴 소개";
    const purpose = selectBox("", [["신메뉴 소개", "신메뉴 소개"], ["브랜드 소개", "브랜드 소개"], ["제품 정보", "제품 정보"], ["행사 안내", "행사 안내"], ["선물 제안", "선물 제안"]], previous.purpose || "신메뉴 소개", () => {});
    const audience = el("input");
    audience.value = previous.audience || "";
    audience.maxLength = 1500;
    audience.placeholder = "예: 다낭의 20~30대 디저트 소비자";
    const mood = selectBox("", ["깔끔한 정보형", "사진 중심", "따뜻한 감성", "발랄하고 귀여운", "차분하고 고급스러운"].map((v) => [v, v]), previous.mood || "깔끔한 정보형", () => {});
    const density = selectBox("", ["짧게", "보통", "설명 중심"].map((v) => [v, v]), previous.density || "짧게", () => {});
    const pages = selectBox("", [3, 4, 5, 6].map((v) => [String(v), `${v}장`]), String(previous.pages || draft.pages.length), () => {});
    if (!pages.value) pages.value = "5";
    const msg = el("p", "studio-hint");
    msg.setAttribute("role", "status");
    const result = el("textarea", "studio-editor-prompt-result");
    result.rows = 10;
    result.maxLength = 12000;
    result.setAttribute("aria-label", "제작 프롬프트 — 수정 후 AI에 반영할 수 있습니다");
    result.hidden = true;
    const candidates = el("div", "studio-editor-candidates");
    let proposals = [], selected = 0;
    const settingsBox = el("fieldset", "studio-editor-brief");
    settingsBox.append(el("legend", "", "제작 조건"), field("제품·요청", wish), field("목적", purpose),
      field("대상", audience), field("분위기", mood), field("글의 양", density));
    if (draft.kind === "cardnews") settingsBox.append(field("장수", pages));
    const options = () => ({ request: wish.value, purpose: purpose.value, audience: audience.value,
      mood: mood.value, density: density.value, pages: draft.kind === "poster" ? 1 : Number(pages.value),
      custom_prompt: result.hidden ? "" : result.value });
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
      if (!proposals[selected] || !onSave) return;
      if (result.value !== proposals[selected].prompt) { msg.textContent = "수정한 프롬프트를 디자인에 반영하려면 AI 제안을 다시 생성해 주세요."; return; }
      apply.disabled = true;
      try {
        await onSave(proposals[selected].design);
        dialog.close();
      } catch { msg.textContent = "초안을 저장하지 못했습니다. 기존 작업은 유지됩니다."; }
      finally { apply.disabled = false; }
    }, "btn dark");
    apply.hidden = true;
    function showCandidates() {
      candidates.replaceChildren(...proposals.map((item, index) => {
        const card = el("section", "studio-editor-candidate");
        const choose = button(`${index === selected ? "✓ " : ""}${item.name}`, () => {
          selected = index;
          result.value = item.prompt;
          showCandidates();
        }, index === selected ? "btn dark" : "btn");
        choose.setAttribute("aria-pressed", String(index === selected));
        card.append(choose);
        item.pages.forEach((words, pageNumber) => {
          const vi = el("p", "", `${pageNumber + 1}장 · ${words.title_vi}\n${words.body_vi}`);
          vi.lang = "vi";
          card.append(vi, el("p", "studio-hint", `${words.title_ko}\n${words.body_ko}`));
        });
        return card;
      }));
    }
    function invalidate() {
      proposals = [];
      candidates.replaceChildren();
      apply.hidden = true;
      result.value = "";
      result.hidden = copy.hidden = true;
      msg.textContent = "조건을 바꿨습니다. 프롬프트 또는 AI 제안을 다시 만들어 주세요.";
    }
    settingsBox.addEventListener("input", invalidate);
    const brief = button("기본 프롬프트 보기 (무료)", async () => {
      brief.disabled = make.disabled = settingsBox.disabled = true;
      try {
        const data = await postJson(BRIEF_API, { design: draft, options: { ...options(), custom_prompt: "" } });
        proposals = [];
        candidates.replaceChildren();
        apply.hidden = true;
        result.value = data.prompt;
        result.hidden = copy.hidden = false;
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
        const data = await postJson(ASSISTANT_API, { design: draft, options: options(), confirm_paid: true });
        if (!wrap.isConnected) return;
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
    dialog.append(close, el("h2", "", `${draft.kind === "poster" ? "포스터" : "카드뉴스"} 전문 프롬프트 · AI 초안`),
      el("p", "studio-hint", "베트남어 문구 + 한국어 뜻. 스타일은 검토용 제안이며 확정된 브랜드 지침은 없습니다."),
      el("p", "studio-hint", "시험 예산 약 $5 · 유료 버튼을 누를 때마다 비용이 발생합니다. 총액 자동 차단은 연결되지 않았으니 OpenAI 사용 내역을 확인하세요. 사진 생성 비용은 발생하지 않습니다."),
      settingsBox, brief, make, msg, candidates, result, copy, apply);
    dialog.addEventListener("close", () => dialog.remove());
    wrap.append(dialog);
    dialog.showModal();
    wish.focus();
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

  // ---------- 두 번 눌러 글자 수정 ----------
  // 첫 번째 누름에서 다시 그려져 눌린 요소가 바뀔 수 있으므로, 선택된 요소를 기준으로 찾습니다.
  stage.addEventListener("dblclick", () => {
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
    box.addEventListener("keydown", (key) => {
      key.stopPropagation();  // 수정 중 Ctrl+Z는 글자 되돌리기로 둡니다.
      if (key.key === "Escape") {
        cancelled = true;
        box.blur();
      }
    });
    box.addEventListener("blur", () => {
      editing = false;
      const text = box.innerText.replace(/\n$/, "");
      const changed = !cancelled && text !== item.text;
      if (changed) item.text = text;
      draw();
      if (changed) save();
    }, { once: true });
  });

  renderPages();
  draw();
  updateBar();
  fit();
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

// 문서 한 장을 원본 크기(예: 4:5 = 1080×1350)로 그려 PNG/JPG로 내려받습니다.
export async function exportImage(doc, type = "png", pageIndex = 0) {
  const [W, H] = sizeOf(doc);
  const page = doc.pages[pageIndex];
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  await loadFontsFor(page);
  if (document.fonts) await document.fonts.ready;

  ctx.fillStyle = page.bg || "#ffffff";  // JPG는 투명이 없어 배경을 먼저 채웁니다.
  ctx.fillRect(0, 0, W, H);
  for (const item of [...page.elements].sort((a, b) => (a.z || 0) - (b.z || 0))) {
    await paint(ctx, item, W, H);
  }

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
