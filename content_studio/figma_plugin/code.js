// Figma 플러그인 본체 [희주] README 3-4
// Figma 안에서 실행되는 파일이라 우리 JS 규칙(type="module", 전역 금지)의 예외입니다.
// ui.html이 받아 온 요소 JSON(designs.py 형식)을 고칠 수 있는 Figma 레이어로 만듭니다.
// x·y·w·h는 페이지 대비 %, size·radius는 원본 크기(px) 기준입니다. 그리는 방법은 sns_editor.js의 paint()와 맞춥니다.

const LINE = 1.2;     // 줄 간격 (sns_editor.js와 같음)
const PAGE_GAP = 80;  // 카드뉴스 장 사이 간격(px)
const FALLBACK_FAMILY = "Inter";

// sns_fonts.js의 key → Figma 글꼴 이름. 목록에 없으면 key를 Google Fonts 이름으로 바꿔 시도합니다.
const FAMILY = {
  "sans": "Inter",
  "serif": "Noto Serif",
  "noto-sans-kr": "Noto Sans KR",
  "nanum-gothic": "Nanum Gothic",
  "gothic-a1": "Gothic A1",
  "ibm-plex-sans-kr": "IBM Plex Sans KR",
  "noto-serif-kr": "Noto Serif KR",
  "nanum-myeongjo": "Nanum Myeongjo",
  "black-and-white-picture": "Black And White Picture",
  "be-vietnam-pro": "Be Vietnam Pro",
};
const STYLE = { 100: "Thin", 200: "ExtraLight", 300: "Light", 400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold", 800: "ExtraBold", 900: "Black" };

figma.showUI(__html__, { width: 360, height: 470 });

function familyOf(key) {
  if (typeof key === "string" && key.startsWith("local:")) return key.slice(6);
  if (FAMILY[key]) return FAMILY[key];
  if (!key) return FALLBACK_FAMILY;
  return key.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function rgb(hex) {
  const value = /^#[0-9a-f]{6}$/i.test(hex || "") ? hex : "#000000";
  return {
    r: parseInt(value.slice(1, 3), 16) / 255,
    g: parseInt(value.slice(3, 5), 16) / 255,
    b: parseInt(value.slice(5, 7), 16) / 255,
  };
}

function solid(hex) {
  return [{ type: "SOLID", color: rgb(hex) }];
}

// 글꼴을 찾을 때까지 차례로 불러 봅니다. 바뀐 글꼴은 끝나고 알려 줍니다.
const loadedFonts = new Map();
async function fontFor(key, weight, notices) {
  const family = familyOf(key);
  const style = STYLE[Math.round((weight || 400) / 100) * 100] || "Regular";
  const cacheKey = `${family}|${style}`;
  if (loadedFonts.has(cacheKey)) return loadedFonts.get(cacheKey);
  const tries = [
    { family, style },
    { family, style: weight >= 600 ? "Bold" : "Regular" },
    { family: FALLBACK_FAMILY, style },
    { family: FALLBACK_FAMILY, style: "Regular" },
  ];
  for (const font of tries) {
    try {
      await figma.loadFontAsync(font);
      if (font.family !== family || font.style !== style) notices.add(`${family} ${style} → ${font.family} ${font.style}`);
      loadedFonts.set(cacheKey, font);
      return font;
    } catch (error) {
      // 이 Figma에 없는 글꼴: 다음 후보로
    }
  }
  throw new Error("기본 글꼴(Inter)도 불러오지 못했습니다.");
}

function place(node, box) {
  node.x = box.x;
  node.y = box.y;
  node.resize(Math.max(1, box.w), Math.max(1, box.h));
}

async function makeText(item, box, ctx) {
  const nodes = [];
  const pad = item.bg ? item.size * 0.4 : 0;
  if (item.bg) {
    const back = figma.createRectangle();
    back.name = `${item.role || item.id} 배경`;
    place(back, box);
    back.cornerRadius = item.size * 0.5;
    back.fills = solid(item.bg);
    nodes.push(back);
  }
  const text = figma.createText();
  text.name = item.role || item.id;
  text.fontName = await fontFor(item.font, item.weight, ctx.notices);
  text.characters = String(item.text || "");
  text.fontSize = item.size;
  text.lineHeight = { value: item.size * LINE, unit: "PIXELS" };
  text.fills = solid(item.color);
  text.textAlignHorizontal = { center: "CENTER", right: "RIGHT" }[item.align] || "LEFT";
  text.textAlignVertical = "CENTER";
  text.textAutoResize = "NONE";
  if (item.spacing) text.letterSpacing = { value: item.spacing, unit: "PIXELS" };
  place(text, { x: box.x + pad, y: box.y, w: box.w - pad * 2, h: box.h });
  nodes.push(text);
  return nodes;
}

async function makeSticker(item, box, ctx) {
  const text = figma.createText();
  text.name = "sticker";
  text.fontName = await fontFor("sans", 400, ctx.notices);
  text.characters = item.emoji || "⭐";
  text.fontSize = Math.min(box.w, box.h) * 0.85;
  text.textAlignHorizontal = "CENTER";
  text.textAlignVertical = "CENTER";
  text.textAutoResize = "NONE";
  place(text, box);
  return [text];
}

function makeShape(item, box) {
  const shape = item.shape === "circle" ? figma.createEllipse() : figma.createRectangle();
  shape.name = item.role || item.id;
  place(shape, box);
  if (item.shape !== "circle") shape.cornerRadius = item.radius || 0;
  shape.fills = item.fill ? solid(item.fill) : [];  // fill이 없으면 테두리만 있는 도형
  if (item.stroke) {
    shape.strokes = solid(item.stroke);
    shape.strokeWeight = item.stroke_w || 2;
    shape.strokeAlign = "INSIDE";  // 편집기의 border(상자 안쪽)와 같게
  }
  return [shape];
}

// 편집기의 CSS rotate처럼 상자 가운데를 기준으로 시계 방향으로 돌립니다.
function rotate(node, degrees) {
  const r = degrees * Math.PI / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  node.relativeTransform = [
    [c, -s, cx - (c * node.width / 2 - s * node.height / 2)],
    [s, c, cy - (s * node.width / 2 + c * node.height / 2)],
  ];
}

function makeImage(item, box, ctx) {
  if (!item.src) return [];  // 빈 사진 자리는 만들지 않습니다. (내보내기와 같음)
  const rect = figma.createRectangle();
  rect.name = item.role || item.id;
  place(rect, box);
  rect.cornerRadius = item.radius || 0;
  const bytes = ctx.images[item.src];
  if (bytes) {
    // 화면의 object-fit: cover와 같게 채웁니다.
    rect.fills = [{ type: "IMAGE", imageHash: figma.createImage(bytes).hash, scaleMode: "FILL" }];
  } else {
    rect.name += " (사진 없음)";
    rect.fills = solid("#dddddd");
  }
  return [rect];
}

async function makePage(page, index, data, ctx) {
  const frame = figma.createFrame();
  const total = data.design.pages.length;
  const demo = data.design.demo ? " [DEMO · 예시 데이터]" : "";
  frame.name = `${data.title || "디자인"}${total > 1 ? ` · ${index + 1}장` : ""}${demo}`;
  frame.resize(data.width, data.height);
  frame.fills = solid(page.bg || "#ffffff");
  frame.clipsContent = true;

  const elements = (page.elements || []).slice().sort((a, b) => (a.z || 0) - (b.z || 0));
  for (const item of elements) {
    const box = {
      x: item.x / 100 * data.width,
      y: item.y / 100 * data.height,
      w: item.w / 100 * data.width,
      h: item.h / 100 * data.height,
    };
    let nodes = [];
    if (item.type === "text") nodes = await makeText(item, box, ctx);
    else if (item.type === "sticker") nodes = await makeSticker(item, box, ctx);
    else if (item.type === "shape") nodes = makeShape(item, box);
    else if (item.type === "image") nodes = makeImage(item, box, ctx);
    for (const node of nodes) {
      frame.appendChild(node);
      if (item.rotate) rotate(node, item.rotate);
      if (item.opacity !== undefined) node.opacity = Math.min(1, Math.max(0, Number(item.opacity)));
    }
    if (nodes.length > 1) figma.group(nodes, frame).name = item.role || item.id;
  }
  return frame;
}

async function importDesign(data, images, missing) {
  const ctx = { images, notices: new Set() };
  const center = figma.viewport.center;
  const pages = data.design.pages || [];
  const totalWidth = pages.length * data.width + (pages.length - 1) * PAGE_GAP;
  const frames = [];
  for (let index = 0; index < pages.length; index += 1) {
    const frame = await makePage(pages[index], index, data, ctx);
    frame.x = center.x - totalWidth / 2 + index * (data.width + PAGE_GAP);
    frame.y = center.y - data.height / 2;
    figma.currentPage.appendChild(frame);
    frames.push(frame);
  }
  figma.currentPage.selection = frames;
  figma.viewport.scrollAndZoomIntoView(frames);

  const notes = [`${frames.length}장을 만들었습니다.`];
  if (data.design.demo) notes.push("DEMO · 예시 데이터입니다.");
  if (ctx.notices.size) notes.push(`글꼴 대체: ${[...ctx.notices].join(", ")}`);
  if (missing.length) notes.push(`사진 ${missing.length}개를 받지 못해 회색 칸으로 두었습니다.`);
  return { message: notes.join(" "), link: frameLink(frames[0]) };
}

// 대시보드가 Figma 창을 바로 띄울 수 있게 첫 프레임 주소를 만듭니다.
// figma.fileKey는 manifest의 enablePrivatePluginApi가 있어야 하고, 받지 못하면 null을 돌려줍니다.
function frameLink(frame) {
  let fileKey = null;
  try {
    fileKey = figma.fileKey;
  } catch (error) {
    // 이 플러그인에 허락되지 않은 기능: 링크 직접 넣기로 대신합니다.
  }
  if (!frame || !fileKey) return null;
  return `https://www.figma.com/design/${fileKey}/?node-id=${frame.id.replace(":", "-")}`;
}

figma.ui.onmessage = async (message) => {
  if (message.type !== "import") return;
  try {
    const result = await importDesign(message.data, message.images || {}, message.missing || []);
    figma.ui.postMessage({ type: "done", message: result.message, link: result.link, chatId: message.data.id });
    figma.notify(result.message);
  } catch (error) {
    figma.ui.postMessage({ type: "error", message: `가져오지 못했습니다: ${error.message}` });
  }
};
