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

const measure = document.createElement("canvas").getContext("2d");
let selectedId = null;  // 저장 후 다시 그려도 선택을 유지합니다. (모듈 안 변수)

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

// ---------- 편집기 ----------
// root 안에 포스터 문서(README 8장 형식)를 그립니다. onSave(newDoc)는 Promise를 돌려줍니다.
export function renderDesign(root, doc, { onSave } = {}) {
  const draft = structuredClone(doc);
  const page = draft.pages[0];
  const [W, H] = sizeOf(draft);
  let scale = 1;
  let action = null;   // 끌기·크기 조절 중인 정보
  let editing = false; // 글자 수정 중에는 다시 그리지 않습니다.

  const wrap = el("div", "studio-editor");
  const bar = el("div", "studio-editor-bar");
  const view = el("div", "studio-editor-view");
  const stage = el("div", "studio-editor-stage");
  stage.style.width = `${W}px`;
  stage.style.height = `${H}px`;
  view.append(stage);
  wrap.append(bar, view);
  root.replaceChildren(wrap);

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
    } else {
      return null;  // 아직 그리지 못하는 종류 (스티커 등은 다음 단계)
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

  function updateBar() {
    const item = find(selectedId);
    const tools = [];
    if (draft.demo) tools.push(el("span", "demo", "DEMO · 예시 데이터"));

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
      );
    } else if (item.type === "shape") {
      tools.push(field("색", colorInput(item.fill, (value) => { item.fill = value; draw(); save(); })));
    }
    if (item) {
      tools.push(button("삭제", () => {
        page.elements = page.elements.filter((other) => other.id !== item.id);
        selectedId = null;
        draw();
        updateBar();
        save();
      }));
    }

    tools.push(el("span", "studio-editor-spacer"), status,
      button("PNG 받기", () => download("png")), button("JPG 받기", () => download("jpg")));
    bar.replaceChildren(...tools);
  }

  async function download(type) {
    status.textContent = "이미지를 만드는 중…";
    try {
      await exportImage(draft, type);
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
