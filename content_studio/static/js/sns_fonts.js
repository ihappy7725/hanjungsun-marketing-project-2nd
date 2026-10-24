// 글꼴 목록 · 내 PC 글꼴 [희주]
// sns_editor.js가 import합니다. README 3-5
// 문서의 font 칸에는 아래 key 또는 "local:글꼴이름"이 들어갑니다. 웹글꼴은 처음 쓸 때만 Google Fonts에서 불러옵니다.
// 모두 Google Fonts의 SIL OFL 글꼴입니다. vi: 베트남어 성조 지원 (Google Fonts의 vietnamese 글자 범위로 확인).

const SANS = "sans-serif";
const SERIF = "serif";
const CURSIVE = "cursive";

// [key, 화면 이름, Google Fonts 이름, 받을 굵기, 대체 글꼴, 베트남어 지원]
const GROUPS = [
  ["기본", [
    ["sans", "기본 고딕", null, [], 'system-ui, "Segoe UI", Arial, sans-serif', true],
    ["serif", "기본 명조", null, [], 'Georgia, "Times New Roman", serif', true],
  ]],
  ["고딕", [
    ["noto-sans-kr", "Noto Sans KR", "Noto Sans KR", [400, 700], SANS, true],
    ["nanum-gothic", "나눔고딕", "Nanum Gothic", [400, 700], SANS],
    ["gothic-a1", "Gothic A1", "Gothic A1", [400, 700], SANS, true],
    ["ibm-plex-sans-kr", "IBM Plex Sans KR", "IBM Plex Sans KR", [400, 700], SANS],
    ["gowun-dodum", "고운돋움", "Gowun Dodum", [400], SANS, true],
    ["orbit", "Orbit", "Orbit", [400], SANS],
    ["sunflower", "Sunflower", "Sunflower", [500, 700], SANS],
  ]],
  ["명조", [
    ["noto-serif-kr", "Noto Serif KR", "Noto Serif KR", [400, 700], SERIF, true],
    ["nanum-myeongjo", "나눔명조", "Nanum Myeongjo", [400, 700], SERIF],
    ["gowun-batang", "고운바탕", "Gowun Batang", [400, 700], SERIF, true],
    ["hahmlet", "함렛", "Hahmlet", [400, 700], SERIF, true],
    ["song-myung", "송명", "Song Myung", [400], SERIF],
    ["diphylleia", "Diphylleia", "Diphylleia", [400], SERIF],
  ]],
  ["제목·굵은", [
    ["black-han-sans", "검은고딕", "Black Han Sans", [400], SANS],
    ["do-hyeon", "도현", "Do Hyeon", [400], SANS],
    ["jua", "주아", "Jua", [400], SANS],
    ["gugi", "구기", "Gugi", [400], SANS],
    ["bagel-fat-one", "Bagel Fat One", "Bagel Fat One", [400], SANS],
    ["gasoek-one", "가석", "Gasoek One", [400], SANS],
    ["dongle", "동글", "Dongle", [400, 700], SANS, true],
    ["black-and-white-picture", "흑백사진", "Black And White Picture", [400], SANS],
  ]],
  ["손글씨·귀여운", [
    ["nanum-pen-script", "나눔펜", "Nanum Pen Script", [400], CURSIVE],
    ["nanum-brush-script", "나눔붓", "Nanum Brush Script", [400], CURSIVE],
    ["gaegu", "개구", "Gaegu", [400, 700], CURSIVE],
    ["hi-melody", "하이멜로디", "Hi Melody", [400], CURSIVE],
    ["gamja-flower", "감자꽃", "Gamja Flower", [400], CURSIVE],
    ["poor-story", "서툰이야기", "Poor Story", [400], CURSIVE],
    ["yeon-sung", "연성", "Yeon Sung", [400], CURSIVE],
    ["cute-font", "귀여운체", "Cute Font", [400], CURSIVE],
    ["single-day", "싱글데이", "Single Day", [400], CURSIVE],
  ]],
  ["베트남어·영문", [
    ["be-vietnam-pro", "Be Vietnam Pro", "Be Vietnam Pro", [400, 700], SANS, true],
    ["montserrat", "Montserrat", "Montserrat", [400, 700], SANS, true],
    ["roboto", "Roboto", "Roboto", [400, 700], SANS, true],
    ["inter", "Inter", "Inter", [400, 700], SANS, true],
    ["lexend", "Lexend", "Lexend", [400, 700], SANS, true],
    ["nunito", "Nunito", "Nunito", [400, 700], SANS, true],
    ["quicksand", "Quicksand", "Quicksand", [400, 700], SANS, true],
    ["oswald", "Oswald", "Oswald", [400, 700], SANS, true],
    ["playfair-display", "Playfair Display", "Playfair Display", [400, 700], SERIF, true],
    ["lora", "Lora", "Lora", [400, 700], SERIF, true],
    ["noto-serif", "Noto Serif", "Noto Serif", [400, 700], SERIF, true],
    ["dancing-script", "Dancing Script", "Dancing Script", [400, 700], CURSIVE, true],
    ["pacifico", "Pacifico", "Pacifico", [400], CURSIVE, true],
    ["bungee", "Bungee", "Bungee", [400], SANS, true],
  ]],
];

export const LOCAL_PREFIX = "local:";

export const FONT_GROUPS = GROUPS.map(([label, fonts]) => ({
  label,
  fonts: fonts.map(([key, name, google, weights, fallback, vi = false]) => ({ key, name, google, weights, fallback, vi })),
}));

const BY_KEY = new Map(FONT_GROUPS.flatMap((group) => group.fonts.map((font) => [font.key, font])));
const requested = new Set();  // 이미 <link>를 붙인 Google Fonts
let localFamilies = null;     // 불러온 내 PC 글꼴 이름 목록

function quote(name) {
  return `"${String(name).replace(/["\\]/g, "")}"`;
}

// 문서의 font 값 → CSS font-family
export function fontFamily(key) {
  if (typeof key === "string" && key.startsWith(LOCAL_PREFIX)) {
    return `${quote(key.slice(LOCAL_PREFIX.length))}, ${BY_KEY.get("sans").fallback}`;
  }
  const font = BY_KEY.get(key) || BY_KEY.get("sans");
  return font.google ? `${quote(font.google)}, ${font.fallback}` : font.fallback;
}

export function fontName(key) {
  if (typeof key === "string" && key.startsWith(LOCAL_PREFIX)) return key.slice(LOCAL_PREFIX.length);
  return (BY_KEY.get(key) || BY_KEY.get("sans")).name;
}

function requestGoogleFont(font) {
  if (requested.has(font.key)) return;
  requested.add(font.key);
  const family = font.google.replace(/ /g, "+");
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${family}:wght@${font.weights.join(";")}&display=swap`;
  document.head.append(link);
}

// 글꼴을 다 받을 때까지 기다립니다. 실패해도 대체 글꼴로 그리도록 오류를 내지 않습니다.
export async function loadFont(key, weight = 400) {
  const font = BY_KEY.get(key);
  if (!font?.google || !document.fonts) return;
  requestGoogleFont(font);
  try {
    await document.fonts.load(`${weight} 40px ${quote(font.google)}`, "가Aắ");
  } catch {
    // 네트워크 문제 등: 대체 글꼴로 그립니다.
  }
}

// 페이지에 쓰인 글자 요소의 글꼴을 모두 불러옵니다.
export function loadFontsFor(page) {
  const texts = (page?.elements || []).filter((item) => item.type === "text");
  return Promise.all(texts.map((item) => loadFont(item.font, item.weight || 400)));
}

export function localFontsSupported() {
  return typeof window.queryLocalFonts === "function";
}

export function getLocalFonts() {
  return localFamilies || [];
}

// 내 PC 글꼴 (크롬·엣지). 권한을 거절하거나 지원하지 않으면 오류를 냅니다.
export async function loadLocalFonts() {
  if (localFamilies) return localFamilies;
  if (!localFontsSupported()) throw new Error("이 브라우저는 내 PC 글꼴을 지원하지 않습니다. (크롬·엣지에서 사용해 주세요)");
  let list;
  try {
    list = await window.queryLocalFonts();
  } catch {
    throw new Error("내 PC 글꼴 권한이 허용되지 않았습니다.");
  }
  localFamilies = [...new Set(list.map((font) => font.family))].sort((a, b) => a.localeCompare(b, "ko"));
  return localFamilies;
}
