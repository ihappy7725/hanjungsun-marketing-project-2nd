import { initTrends } from "./trends.js";
// 현지 시장 분석 화면 스크립트 [상준]
// type="module"로 불러오므로 전역 변수·함수가 생기지 않습니다. (README 7장)
// 서버(routes.py)가 넣어 준 실제 데이터만 그립니다. 값이 없으면 만들지 않고 "수집 전"으로 표시합니다.

const page = document.querySelector(".market-analysis-page");
const data = JSON.parse(page.querySelector('[data-ma="dashboard"]').textContent);
const country = data.countries.find((c) => c.code === data.country) || data.countries[0];
const DANANG = /da\s*nang|đà\s*nẵng|다낭/i;
const MONTHS = ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"];
const PAGE_SIZE = 5;
const SEGMENT_ORDER = [
  "모찌 아이스크림",
  "크림·코팅 모찌",
  "과일맛 모찌",
  "전통·차·팥 모찌",
  "혼합·선물세트",
  "대용량·도매형",
];

const state = {
  tab: page.dataset.tab,
  period: 90,
  risingKey: data.trend.categories.find((c) => c.rising.data)?.key || data.trend.categories[0].key,
  fruitTerm: data.trend.fruit.data?.terms[0]?.term || null,
  geoKey: data.trend.geo.find((g) => g.data)?.key || data.trend.geo[0].key,
  segment: "",
  search: "",
  origin: "",
  level: "",
  seller: "",
  ctab: "list",  // 경쟁사 탭 안의 하위 탭
  coreOnly: false,
  sort: "price_asc",
  page: 1,
};

// ---------- 공통 조각 ----------

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const num = (value, digits = 0) =>
  value === null || value === undefined || value === "" ? "—"
    : Number(value).toLocaleString("ko-KR", { maximumFractionDigits: digits });

const vnd = (value) => (value === null || value === undefined ? "—" : `${num(value)} ₫`);

const priceRange = (min, max) => {
  if (min === null || min === undefined) return "—";
  return max && max !== min ? `${num(min)}~${num(max)} ₫` : vnd(min);
};

const evidenceClass = (value) => value === "개별 상품 확인" ? "is-verified"
  : value === "과거 자료" ? "is-history"
    : value === "확인 필요" ? "is-review" : "is-indexed";

const pct = (value) =>
  value === null || value === undefined ? "—" : `${value > 0 ? "+" : ""}${num(value, 1)}%`;

const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

function panel({ title, body, head = "", wide = false }) {
  return `
    <article class="panel${wide ? " ma-wide" : ""}">
      <div class="panelhead">
        <div><h2>${esc(title)}</h2></div>
        ${head}
      </div>
      ${body}
    </article>`;
}

function sourceLine({ source, asOf, asOfLabel = "기준일", region }) {
  return `
    <p class="footnote ma-source">
      출처 ${esc(source)} · ${esc(asOfLabel)} ${esc(asOf || "—")} · 지역 ${esc(region || "표시 없음")}
    </p>`;
}

function empty() {
  return '<div class="ma-empty">등록된 데이터가 없습니다.</div>';
}

function bars(rows, { max = 100, highlight = () => false, onKey = null, active = null } = {}) {
  return `
    <ol class="ma-bars">
      ${rows.map((r, i) => {
        const width = r.value === null || r.value === undefined ? 0 : Math.max(0, Math.min(100, (r.value / max) * 100));
        const tag = onKey ? "button" : "div";
        const attrs = onKey ? ` type="button" data-${onKey}="${esc(r.key)}"` : "";
        const cls = [highlight(r) ? "is-highlight" : "", active !== null && r.key === active ? "is-active" : ""].join(" ");
        return `
          <li class="${cls}">
            <${tag} class="ma-bar"${attrs}>
              <span class="ma-bar-rank">${i + 1}</span>
              <span class="ma-bar-label">${esc(r.label)}</span>
              <span class="ma-bar-track"><span style="width:${width}%"></span></span>
              <span class="ma-bar-value">${r.text ?? num(r.value, 1)}</span>
            </${tag}>
          </li>`;
      }).join("")}
    </ol>`;
}

function sparkline(values) {
  const points = values
    .map((v, i) => (typeof v === "number" ? [i, v] : null))
    .filter(Boolean);
  if (points.length < 2) return "";
  const lastIndex = values.length - 1 || 1;
  const coords = points.map(([i, v]) => `${((i / lastIndex) * 120).toFixed(1)},${(30 - (v / 100) * 28).toFixed(1)}`);
  return `<svg class="ma-spark" viewBox="0 0 120 32" aria-hidden="true"><polyline points="${coords.join(" ")}"/></svg>`;
}

// ---------- 국가 선택 바 ----------


// ---------- 1. 트렌드 분석 ----------

function periodSlice(timeline, days) {
  const last = new Date(timeline.dates[timeline.dates.length - 1]);
  const from = last.getTime() - days * 864e5;
  const keep = timeline.dates.map((d) => new Date(d).getTime() > from);
  return timeline.series.map((s) => s.values.filter((_, i) => keep[i]));
}

// 자기 기준 변화율: 선택 기간 후반 평균 ÷ 전반 평균 − 1
function selfChange(values) {
  const valid = values.filter((v) => typeof v === "number");
  if (valid.length < 2) return null;
  const half = Math.floor(valid.length / 2);
  const before = mean(valid.slice(0, half));
  const after = mean(valid.slice(-half));
  return before ? (after / before - 1) * 100 : null;
}

function renderTrend() {
  if (data.country === "VN") { initTrends(); return; }
  const t = data.trend;
  const view = page.querySelector('[data-view="trend"]');
  const mochi = t.categories.find((c) => c.key === "mochi");
  const mochiChange = mochi.timeline.data ? selfChange(periodSlice(mochi.timeline.data, state.period)[0]) : null;
  const topRising = mochi.rising.data?.[0];
  const topFruit = t.fruit.data?.terms[0];

  const summary = `
    <div class="kpis ma-kpis3">
      <div class="kpi">
        <div class="label">떡·모찌 관심도 변화 <span>최근 ${state.period}일</span></div>
        <div class="value">${mochi.timeline.data ? pct(mochiChange) : '<span class="badge">수집 전</span>'}</div>
      </div>
      <div class="kpi">
        <div class="label">급상승 1위 검색어 <span>떡·모찌</span></div>
        <div class="value ma-kpi-text">${topRising ? `<span lang="vi">${esc(topRising.query)}</span><small>${esc(topRising.value)}</small>` : '<span class="badge">수집 전</span>'}</div>
      </div>
      <div class="kpi">
        <div class="label">과일 한정판 1순위 <span>평균 관심도</span></div>
        <div class="value ma-kpi-text">${topFruit ? `<span lang="vi">${esc(topFruit.term)}</span><small>${num(topFruit.average, 1)}</small>` : '<span class="badge">수집 전</span>'}</div>
      </div>
    </div>`;

  const periodButtons = `
    <div class="ma-seg" role="group" aria-label="기간">
      ${[7, 30, 90].map((d) => `<button type="button" class="btn${state.period === d ? " dark" : ""}" data-period="${d}">${d}일</button>`).join("")}
    </div>`;

  view.innerHTML = `
    ${summary}
    <div class="grid">
      ${panel({ title: "카테고리 관심도 추이", head: periodButtons, body: categoryBody() })}
      ${panel({ title: "급상승 검색 키워드", head: risingSelect(), body: risingBody() })}
    </div>
    <div class="grid section-space">
      ${panel({ title: "월별 검색 계절성", body: seasonalityBody() })}
      ${panel({ title: "현지 과일 맛 트렌드", body: fruitBody() })}
    </div>
    <div class="section-space">
      ${panel({ title: "지역별 관심도", head: geoButtons(), body: geoBody(), wide: true })}
    </div>
    <p class="statusline">관심도는 Google Trends 상대 지수(0~100)이며 실제 검색 횟수가 아닙니다.</p>`;
}

function categoryBody() {
  const cats = data.trend.categories;
  const loaded = cats.filter((c) => c.timeline.data);
  if (!loaded.length) return empty(cats.map((c) => c.timeline.file), "Google Trends에서 '지난 90일' 시간별 관심도를 카테고리마다 CSV로 내려받아 저장합니다.");
  const rows = cats.map((c) => {
    if (!c.timeline.data) {
      return `<tr><td><strong>${esc(c.label)}</strong><small>${esc(c.purpose)}</small></td><td colspan="3"><span class="badge">수집 전</span> <code>${esc(c.timeline.file)}</code></td></tr>`;
    }
    const sliced = periodSlice(c.timeline.data, state.period)[0];
    const series = c.timeline.data.series[0];
    const change = selfChange(sliced);
    return `
      <tr>
        <td><strong>${esc(c.label)}</strong><small lang="vi">${esc(series.term)}</small></td>
        <td class="ma-num ${change > 0 ? "is-up" : change < 0 ? "is-down" : ""}">${pct(change)}</td>
        <td>${sparkline(sliced)}</td>
        <td><small>${esc(series.region)}</small></td>
      </tr>`;
  }).join("");
  const asOf = loaded.map((c) => c.timeline.as_of).sort().pop();
  return `
    <div class="table-wrap"><table>
      <thead><tr><th>카테고리 · 검색어</th><th>변화율</th><th>추이</th><th>지역</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="statusline">변화율 = 선택 기간 후반 평균 ÷ 전반 평균 − 1 (자기 기준 비교, 카테고리끼리 크기 비교 아님)</p>
    ${sourceLine({ source: data.trend.source, asOf, asOfLabel: "파일 저장일", region: "CSV 머리줄 기준" })}`;
}

function risingSelect() {
  return `
    <select data-rising aria-label="카테고리">
      ${data.trend.categories.map((c) => `<option value="${esc(c.key)}"${c.key === state.risingKey ? " selected" : ""}>${esc(c.label)}</option>`).join("")}
    </select>`;
}

function risingBody() {
  const cat = data.trend.categories.find((c) => c.key === state.risingKey);
  if (!cat.rising.data?.length) return empty(cat.rising.file, "Trends 화면 '관련 검색어'의 CSV 내보내기를 그대로 저장합니다.");
  return `
    <ol class="ma-rank">
      ${cat.rising.data.map((r) => `<li><span lang="vi">${esc(r.query)}</span><span class="badge">${esc(r.value)}</span></li>`).join("")}
    </ol>
    ${sourceLine({ source: data.trend.source, asOf: cat.rising.as_of, asOfLabel: "파일 저장일", region: "Trends 조회 조건 기준" })}`;
}

function fruitBody() {
  const fruit = data.trend.fruit;
  if (!fruit.data) return empty(fruit.file, "과일 5종을 한 번에 비교한 시간별 관심도 CSV입니다. (Trends 비교 한도 5개)");
  const rows = fruit.data.terms.map((f) => ({ key: f.term, label: f.term, value: f.average }));
  return `
    ${bars(rows, { onKey: "fruit", active: state.fruitTerm })}
    <p class="statusline">과일을 누르면 '월별 검색 계절성'의 한정판 시기가 그 과일로 바뀝니다. 제철 정보는 수집 전입니다.</p>
    ${sourceLine({ source: data.trend.source, asOf: fruit.as_of, asOfLabel: "파일 저장일", region: fruit.data.terms[0]?.region })}`;
}

function seasonalityBody() {
  const blocks = data.trend.seasonality.map((s) => {
    if (!s.data) {
      return `<section class="ma-season"><h3>${esc(s.label)}</h3><p class="ma-action">${esc(s.action)}</p>${empty(s.file)}</section>`;
    }
    let terms = s.data.terms;
    if (s.key === "fruit") {
      const picked = terms.find((t) => t.term === state.fruitTerm);
      terms = picked ? [picked] : terms.slice(0, 1);
    }
    // 같은 CSV 안의 검색어는 같은 기준으로 비교된 값이라 월별 평균을 합쳐 막대 하나로 봅니다
    const monthly = MONTHS.map((_, m) => mean(terms.map((t) => t.monthly[m]).filter((v) => typeof v === "number")));
    const max = Math.max(...monthly.filter((v) => v !== null), 1);
    const peaks = terms.map((t) => `<span lang="vi">${esc(t.term)}</span> ${t.peak_month ? `${t.peak_month}월` : "—"}`).join(" · ");
    return `
      <section class="ma-season">
        <h3>${esc(s.label)}</h3>
        <p class="ma-action">${esc(s.action)}</p>
        <div class="ma-columns" role="img" aria-label="${esc(s.label)} 월별 평균 관심도">
          ${monthly.map((v, m) => `<span style="height:${v === null ? 0 : (v / max) * 100}%" title="${MONTHS[m]} ${num(v, 1)}"></span>`).join("")}
        </div>
        <div class="ma-months">${MONTHS.map((m) => `<span>${m.replace("월", "")}</span>`).join("")}</div>
        <p class="statusline">피크 달: ${peaks} · 기간 ${esc(s.data.period.join(" ~ "))}</p>
        ${sourceLine({ source: data.trend.source, asOf: s.as_of, asOfLabel: "파일 저장일", region: terms[0]?.region })}
      </section>`;
  });
  return `<div class="ma-seasons">${blocks.join("")}</div>`;
}

function geoButtons() {
  return `
    <div class="ma-seg" role="group" aria-label="무엇에 대한 관심?">
      ${data.trend.geo.map((g) => `<button type="button" class="btn${g.key === state.geoKey ? " dark" : ""}" data-geo="${esc(g.key)}">${esc(g.label)}</button>`).join("")}
    </div>`;
}

function geoBody() {
  const geo = data.trend.geo.find((g) => g.key === state.geoKey);
  if (!geo.data) return empty(geo.file, "Trends 화면 '하위 지역별 관심도'의 CSV 내보내기를 그대로 저장합니다.");
  const regions = geo.data.regions;
  const rank = regions.findIndex((r) => DANANG.test(r.region));
  const danang = rank >= 0
    ? `다낭은 ${regions.length}개 지역 중 <b>${rank + 1}위</b> · 관심도 <b>${num(regions[rank].value)}</b>`
    : "이 파일에는 다낭 값이 없습니다 (Trends가 값이 적은 지역은 비워서 줍니다).";
  return `
    <p class="ma-highlight">${danang}</p>
    ${bars(regions.map((r) => ({ key: r.region, label: r.region, value: r.value })), { highlight: (r) => DANANG.test(r.label) })}
    <p class="statusline">값은 지역 전체 검색 중 이 주제의 비율이며, 가장 높은 지역이 100입니다. 인구가 많다고 높게 나오지 않습니다.</p>
    ${sourceLine({ source: data.trend.source, asOf: geo.as_of, asOfLabel: "파일 저장일", region: `베트남 성·도시별 (${geo.data.region})` })}`;
}

// ---------- 2. 경쟁제품 분석 ----------

// 원산지 표기(판매처마다 영어·한글·괄호 설명이 섞임)를 국가명 한글로 묶습니다. 상세 창에는 원래 표기를 그대로 보여 줍니다
const ORIGIN_KO = { japan: "일본", taiwan: "대만", vietnam: "베트남", indonesia: "인도네시아", korea: "한국", china: "중국", thailand: "태국" };
function originCountry(origin) {
  const text = String(origin || "").trim();
  if (!text || text.startsWith("확인 필요") || text === "미확인") return "미확인";
  const english = text.toLowerCase().match(/[a-z]+/);
  if (english && ORIGIN_KO[english[0]]) return ORIGIN_KO[english[0]];
  return text.replace(/\s*\(.*\)$/, "");
}

function filteredCompetitors() {
  const q = state.search.trim().toLowerCase();
  const rows = data.competitors.items.filter((i) =>
    (!state.segment || i.segment === state.segment)
    && (!state.origin || (data.competitors.source === "research" ? originCountry(i.origin) : i.origin) === state.origin)
    && (!state.level || i.competition_level === state.level)
    && (!state.seller || (i.listings || []).some((l) => l.seller === state.seller))
    && (!state.coreOnly || i.is_core)
    && (!q || `${i.brand} ${i.product} ${i.product_ko || ""}`.toLowerCase().includes(q)));
  const key = "price_min_vnd";
  const dir = state.sort === "price_asc" ? 1 : -1;
  // 값이 비어 있는 제품은 정렬 방향과 관계없이 맨 아래로 보냅니다
  return rows.sort((a, b) => (a[key] === null) - (b[key] === null) || (a[key] - b[key]) * dir);
}

// 재조사 결과(research 폴더)가 있으면 의사결정용 화면, 없으면 예전 조사표 화면을 그립니다
function renderCompetitor() {
  return data.competitors.source === "research" ? renderCompetitorResearch() : renderCompetitorLegacy();
}

const range = (spread, unit = "₫") => spread
  ? (spread.min === spread.max ? `${num(spread.min)} ${unit}` : `${num(spread.min)}~${num(spread.max)} ${unit}`) : "—";
const koName = (text) => String(text || "").replace(/\s*\(원문 번역\)$/, "");

// 가격 막대: 최소~최대 범위와 중간값 표시 (scale = 화면 안 최댓값)
function priceBar(spread, scale) {
  if (!spread || !scale) return '<div class="ma-pbar is-empty"></div>';
  const left = (spread.min / scale) * 100;
  const width = Math.max(((spread.max - spread.min) / scale) * 100, 1.2);
  const mid = (spread.median / scale) * 100;
  return `<div class="ma-pbar" role="img" aria-label="${esc(range(spread))}, 중간 ${esc(num(spread.median))}₫">
    <i class="ma-pbar-range" style="left:${left}%;width:${width}%"></i><i class="ma-pbar-mid" style="left:${mid}%"></i></div>`;
}

// 경쟁제품 탭: 전체 목록 · 마케팅 · 주요 경쟁제품
const COMPETITOR_TABS = [["list", "전체 목록"], ["marketing", "마케팅"], ["rivals", "주요 경쟁제품"]];

function competitorRivals(c) {
  return `<section class="ma-rival-basis" aria-label="주요 경쟁제품 선정 기준">
    <strong>선정 기준</strong>
    <span>제품 형태 유사성</span>
    <span>베트남 판매 확인</span>
    <span>유통·매장 영향력</span>
    <span>가격·선물시장 비교 가치</span>
  </section>
  <div class="ma-priority">${c.priority.map((p, n) => `
    <button type="button" class="ma-pcard" data-rdetail="${esc(p.product_id)}">
      <span class="ma-pcard-rank">${n + 1}</span>
      <strong>${esc(p.brand)}</strong>
      <small class="ma-pcard-product"><b>대표 제품</b>${esc(koName(p.product_ko))}</small>
      <p><b>선정 근거</b>${esc(p.why)}</p>
      <dl><div><dt>경쟁 유형</dt><dd>${esc(p.segment)}</dd></div><div><dt>판매가</dt><dd>${range(p.price)}</dd></div></dl>
    </button>`).join("")}</div>`;
}

function competitorPrice(c) {
  const scale = Math.max(...c.segments.map((g) => g.per100?.max || 0));
  const ladder = `
    <h3 class="ma-ci-h3">유형별 가격</h3>
    <div class="table-wrap"><table class="ma-table ma-ladder">
      <thead><tr><th>유형</th><th>제품</th><th>100g당</th><th class="ma-ladder-bar"></th><th>개당</th></tr></thead>
      <tbody>${c.segments.map((g) => `<tr>
        <td><button type="button" class="linkbtn" data-segment-go="${esc(g.name)}">${esc(g.name)}</button></td>
        <td>${num(g.product_count)}개</td>
        <td>${range(g.per100)}</td>
        <td class="ma-ladder-bar">${priceBar(g.per100, scale)}</td>
        <td>${range(g.per_piece)}</td>
      </tr>`).join("")}</tbody></table></div>`;
  const gifts = `
    <h3 class="ma-ci-h3">선물 구성</h3>
    <div class="table-wrap"><table class="ma-table">
      <thead><tr><th>구성</th><th>브랜드 · 제품</th><th>가격</th><th>개당</th></tr></thead>
      <tbody>${c.gifts.map((g) => `<tr>
        <td><strong>${num(g.pack_count)}개입</strong></td>
        <td><button type="button" class="linkbtn ma-product" data-rdetail="${esc(g.product_id)}"><strong>${esc(g.brand)}</strong><small>${esc(koName(g.product_ko))}</small></button></td>
        <td>${vnd(g.price)}</td><td>${vnd(g.per_piece)}</td></tr>`).join("")}</tbody></table></div>`;
  const spreads = `
    <h3 class="ma-ci-h3">같은 제품, 판매처별 가격 차이</h3>
    <div class="table-wrap"><table class="ma-table">
      <thead><tr><th>제품(같은 중량)</th><th>최저</th><th>최고</th><th>차이</th></tr></thead>
      <tbody>${c.spreads.map((r) => `<tr>
        <td><button type="button" class="linkbtn ma-product" data-rdetail="${esc(r.product_id)}"><strong>${esc(r.brand)}</strong><small>${esc(koName(r.product_ko))} ${num(r.weight)}g</small></button></td>
        <td>${vnd(r.low)}<small>${esc(r.low_seller)}</small></td><td>${vnd(r.high)}<small>${esc(r.high_seller)}</small></td>
        <td><strong>${num(r.gap_pct)}%</strong></td></tr>`).join("")}</tbody></table></div>`;
  return `${ladder}<div class="ma-two"><div>${gifts}</div><div>${spreads}</div></div>`;
}

// 마케팅 탭: 근거(competitor_marketing_evidence.csv)를 '마케팅 방식' 5가지로 묶습니다.
// 사례 문장은 원문을 한국어로 요약한 것이고, 원문·링크는 브랜드를 누르면 봅니다. take = 분석 의견(해석)
const MARKETING_TACTICS = [
  { key: "gift", title: "선물·포장", what: "상자 그림·색에 의미를 부여하고 한 상자에 넣는 제품 수를 다양화한 선물 구성",
    ids: ["ME001", "ME002", "ME010", "ME014", "ME015"],
    cases: [["Mochi Sweets", "상자의 은행나무 그림에 '번영·평안' 의미를 붙이고 3·6·9·12·18개입으로 구성. 18개입 Luxury 690,000₫"],
      ["Royal Family", "빨간 선물상자(132g×2 86,000₫, 514g 216,000₫)로 명절 선물 구성"]],
    take: "보자기·보름달 같은 한국 상징과 제품 수가 다른 여러 상자를 활용한 선물 수요 대응" },
  { key: "season", title: "명절·시즌 공략", what: "추석·설·성탄 전 예약 할인과 한정판 운영",
    ids: ["ME008", "ME009", "ME021"],
    cases: [["Sakuko(일본 브랜드 기획전)", "추석 예약: 5상자 15% ~ 50상자 40% 단계 할인 — 기업·단체 대량 주문 겨냥"],
      ["Tsujisei", "30개입을 '새해에 행운을 주는 선물'로 소개"], ["Baoz Dimsum", "성탄 한정 눈사람 모찌(2025년 12월)"]],
    take: "설·추석 2~3개월 전 기업·단체 대상 대량 예약 할인 준비" },
  { key: "price", title: "가격·묶음 혜택", what: "할인가 표시, 대용량·여러 맛 묶음으로 가성비를 강조",
    ids: ["ME013", "ME017", "ME018", "ME020"],
    cases: [["MCLUNE", "1kg·500g, 7가지 맛을 같은 가격에 + 정가 대비 할인가 표시(TikTok Shop)"],
      ["Lotte Yukimi · 대만 바오즈 모찌", "정가 대비 약 8~10% 할인가 표시"], ["Royal Family", "2개 묶음 할인 상품은 판매 중단"]],
    take: "저가·대용량 경쟁은 대만·온라인 제품이 이미 차지 — 한정선은 할인보다 선물 가치로 차별화" },
  { key: "channel", title: "매장·판매 채널 확보", what: "매장망·유통 채널 확대를 통한 구매 접근성 강화",
    ids: ["ME004", "ME005", "ME007", "ME011", "ME012", "ME022"],
    cases: [["Mochi Sweets", "호찌민 4·하노이 4·다낭 Vincom·호이안·하이퐁 매장 + 보냉백 옵션·전화 주문"],
      ["Royal Family", "유아용품점 Con Cưng(전국 1,215개 매장 표기)에서 아이 간식으로 판매"],
      ["Kamereo", "업소용 냉동 다이후쿠를 음식점에 B2B 공급(현재 품절)"]],
    take: "다낭 Mochi Sweets 매장과의 직접 경쟁을 고려한 관광지 매장·보냉 배송 설계" },
  { key: "trend", title: "원재료·트렌드형 제품", what: "새로운 섭취 방식과 고급 원재료를 활용한 화제성 강화",
    ids: ["ME003", "ME006", "ME016", "ME019"],
    cases: [["Minh Nhật", "생크림 소스에 '찍어 먹는 모찌' 85g 23,000₫, 냉장 유통기한 7일"],
      ["Mochi Sweets", "제비집·식용 금 모찌 3개입 145,000₫를 '건강 선물'로(현재 품절), 일본 정통성 강조"],
      ["Lotte Yukimi", "판매처가 '열풍·유행 따라잡기' 문구로 소개"]],
    take: "과일·찹쌀 조합 한정 맛과 '한국 정통 찹쌀떡' 이야기로 화제성 확보" },
];
// 브랜드가 아니라 판매처가 쓴 문구인 근거 (브랜드 마케팅과 구분해 표시)
const SELLER_COPY = new Set(["ME008", "ME015", "ME016"]);

function competitorMarketing(c) {
  const byId = new Map(c.marketing.map((m) => [m.evidence_id, m]));
  return `
    <div class="ma-tactics">${MARKETING_TACTICS.map((t, n) => {
      const items = t.ids.map((id) => byId.get(id)).filter(Boolean);
      const brands = [...new Map(items.map((m) => [m.brand, m])).values()];
      const chip = (m) => {
        return `<button type="button" class="ma-tactic-brand" data-tactic="${t.key}" data-tactic-brand="${esc(m.brand)}">${esc(m.brand)}</button>`;
      };
      return `
      <article class="ma-tactic${n === 0 ? " is-lead" : ""}">
        <header><span class="ma-tactic-no">${n + 1}</span><div><h3>${esc(t.title)}</h3><p>${esc(t.what)}</p></div></header>
        <div class="ma-tactic-brands">${brands.map(chip).join("")}</div>
        <ul class="ma-tactic-cases">${t.cases.map(([who, text]) => `<li><b>${esc(who)}</b>${esc(text)}</li>`).join("")}</ul>
        <p class="ma-tactic-take"><b>해석</b>${esc(t.take)}</p>
      </article>`;
    }).join("")}</div>`;
}

function marketingEvidenceLabel(label = "") {
  const labels = {
    "선물 포장 이야기": "선물·포장",
    "선물·고가 구성": "프리미엄 선물",
  };
  return labels[label] || label;
}

// 브랜드를 누르면 해당 마케팅 사례를 한국어 요약과 상품 페이지로 보여 줍니다
function openMarketingEvidence(tacticKey, brand) {
  const tactic = MARKETING_TACTICS.find((t) => t.key === tacticKey);
  if (!tactic) return;
  const rows = data.competitors.marketing.filter((m) => tactic.ids.includes(m.evidence_id) && m.brand === brand);
  page.querySelector('[data-ma="detail-body"]').innerHTML = `
    <h2>${esc(brand)}</h2>
    ${rows.map((m) => {
      const fact = koreanMarketingFact(m.observation);
      return `<section class="ma-tactic-evidence">
        <p><span class="badge">${esc(marketingEvidenceLabel(m.evidence_type))}</span>${SELLER_COPY.has(m.evidence_id) ? ' <span class="badge">판매처 광고</span>' : ""}</p>
        ${m.interpretation ? `<p><b>핵심 내용</b> ${esc(m.interpretation)}</p>` : ""}
        ${fact ? `<p><b>확인된 특징</b> ${esc(fact)}</p>` : ""}
        ${m.unverified ? `<p class="ma-mkt-unknown"><b>추가 확인 사항</b> ${esc(m.unverified)}</p>` : ""}
        <p><a href="${esc(m.source_url)}" target="_blank" rel="noopener">상품 페이지 보기</a></p>
      </section>`;
    }).join("")}`;
  page.querySelector('[data-ma="detail"]').showModal();
}

function competitorList(c) {
  // 미확인은 맨 뒤로
  const origins = [...new Set(c.items.map((i) => originCountry(i.origin)))].sort((a, b) => (a === "미확인") - (b === "미확인") || a.localeCompare(b, "ko"));
  const option = (value, current, label = value) => `<option value="${esc(value)}"${value === current ? " selected" : ""}>${esc(label)}</option>`;
  const rows = filteredCompetitors();
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  state.page = Math.min(state.page, pages);
  const shown = rows.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
  return `
    <div class="ma-toolbar ma-ci-toolbar">
      <label class="ma-ci-search"><span aria-hidden="true">⌕</span><input type="search" data-search placeholder="브랜드 · 제품 검색" value="${esc(state.search)}" aria-label="브랜드 · 제품 검색"></label>
      <select data-segment-select aria-label="유형">${option("", state.segment, "유형 전체")}${c.segments.map((g) => option(g.name, state.segment)).join("")}</select>
      <select data-origin aria-label="원산지">${option("", state.origin, "원산지 전체")}${origins.map((o) => option(o, state.origin)).join("")}</select>
      <select data-sort aria-label="정렬">${option("price_asc", state.sort, "판매가 낮은 순")}${option("price_desc", state.sort, "판매가 높은 순")}</select>
    </div>
    <div class="table-wrap"><table class="ma-table ma-competitor-list">
      <thead><tr><th>브랜드 · 제품</th><th>구분 · 유형</th><th>구성(SKU)</th><th>판매가</th></tr></thead>
      <tbody>${shown.map((i) => `<tr>
        <td><button type="button" class="linkbtn ma-product" data-rdetail="${esc(i.product_id)}"><strong>${esc(i.brand)}${i.is_core ? ' <span class="badge">우선</span>' : ""}</strong><small>${esc(koName(i.product_ko))}</small><small lang="vi">${esc(i.product)}</small></button></td>
        <td>${esc(i.competition_level)}<small>${esc(i.segment)}</small></td>
        <td>${esc(i.sku_options || "—")}</td>
        <td>${priceRange(i.price_min_vnd, i.price_max_vnd)}</td>
      </tr>`).join("") || '<tr><td colspan="4">조건에 맞는 제품이 없습니다.</td></tr>'}</tbody>
    </table></div>
    <div class="ma-pager">
      <button type="button" class="btn" data-page="${state.page - 1}"${state.page <= 1 ? " disabled" : ""}>이전</button>
      <span>${state.page} / ${pages} · ${rows.length}개</span>
      <button type="button" class="btn" data-page="${state.page + 1}"${state.page >= pages ? " disabled" : ""}>다음</button>
    </div>`;
}

function renderCompetitorResearch() {
  const c = data.competitors;
  const view = page.querySelector('[data-view="competitor"]');
  const tab = COMPETITOR_TABS.some(([key]) => key === state.ctab) ? state.ctab : "rivals";
  const bodies = { rivals: competitorRivals, marketing: competitorMarketing, list: competitorList };
  view.innerHTML = `<div class="ma-research">
    <article class="panel ma-wide ma-ci-panel">
      <div class="ma-ci-tabs" role="tablist">${COMPETITOR_TABS.map(([key, label]) => `
        <button type="button" role="tab" data-ctab="${key}" aria-selected="${key === tab}">${esc(label)}</button>`).join("")}</div>
      <div class="ma-ci-body">${bodies[tab](c)}</div>
    </article>
  </div>`;
}

function koreanMarketingFact(observation = "") {
  const fact = observation
    .replace(/'[^']*'/g, "")
    .replace(/\s*[—–]\s*/g, " · ")
    .replace(/:\s*·/g, ":")
    .replace(/\s+,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/[,:·]\s*$/, "");
  return /^\S+(?:\s+\S+)?\s+설명$/.test(fact) ? "" : fact;
}

function baseProductName(name = "") {
  return name
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+[—–-]\s+.*$/, "")
    .replace(/\s*\/\s*.*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function openResearchDetail(productId) {
  const i = data.competitors.items.find((x) => x.product_id === productId);
  if (!i) return;
  const info = [
    ["경쟁 구분", `${i.competition_level} · ${i.segment}`], ["원산지", i.origin], ["맛 · 소", i.flavor_ko],
    ["제조 · 수입", i.maker], ["구성(SKU)", i.sku_options],
    ["판매가", priceRange(i.price_min_vnd, i.price_max_vnd)],
  ];
  const marketing = i.marketing.map((m) => ({ ...m, fact: koreanMarketingFact(m.observation) }));
  // 흰 바탕 창: 제목 띠 · 핵심 정보 · 판매처 가격과 한국어 마케팅 요약을 좌우로 배치
  page.querySelector('[data-ma="detail-body"]').innerHTML = `
    <header class="ma-rd-head">
      <div class="ma-rd-brand">${esc(i.brand)}</div>
      <div><strong>상품명:</strong> <span lang="vi">${esc(baseProductName(i.product))}</span></div>
    </header>
    <p class="ma-rd-why">${esc(i.takeaway || i.reason)}</p>
    <dl class="ma-rd-info">${info.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v || "—")}</dd></div>`).join("")}</dl>
    <div class="ma-rd-columns">
      <section class="ma-rd-prices">
        <h3 class="ma-rd-h3">판매처별 가격 <small>${num(i.listings.length)}곳</small></h3>
        <table class="ma-table ma-rd-table">
          <thead><tr><th>판매처 · 옵션</th><th>가격</th></tr></thead>
          <tbody>${i.listings.map((l) => `<tr>
            <td><a class="ma-product-page-link" href="${esc(l.source_url)}" target="_blank" rel="noopener"><strong>${esc(l.seller)}</strong><small>${esc(l.option || l.sku)}</small></a></td>
            <td><strong>${vnd(l.current_price_vnd)}</strong>${l.regular_price_vnd ? `<small>정상가 ${vnd(l.regular_price_vnd)}</small>` : ""}</td>
          </tr>`).join("")}</tbody>
        </table>
      </section>
      ${marketing.length ? `<aside class="ma-rd-marketing">
        <h3 class="ma-rd-h3">마케팅 특징 <small>${num(marketing.length)}건</small></h3>
        <div class="ma-rd-mkt">${marketing.map((m) => `
          <article>
            <h4>${esc(marketingEvidenceLabel(m.evidence_type))}</h4>
            ${m.interpretation ? `<p>${esc(m.interpretation)}</p>` : ""}
            ${m.fact ? `<small>${esc(m.fact)}</small>` : ""}
            <a href="${esc(m.source_url)}" target="_blank" rel="noopener">상품 페이지 보기</a>
          </article>`).join("")}</div>
      </aside>` : ""}
    </div>`;
  page.querySelector('[data-ma="detail"]').showModal();
}

function renderCompetitorLegacy() {
  const c = data.competitors;
  const view = page.querySelector('[data-view="competitor"]');
  if (!c.items.length) {
    view.innerHTML = panel({
      title: "경쟁 제품", wide: true,
      body: empty(c.file, "Shopee · Lazada · TikTok Shop 판매량순 상위 20~30개를 월 1회 조사해 이 파일에 한 줄씩 적습니다. 엑셀에서는 'CSV UTF-8'로 저장합니다."),
    }) + ``;
    return;
  }

  const normalizedPrices = c.items.map((i) => i.price_per_100g_min).filter((v) => v !== null);
  const summary = c.summary || {};
  const foundSegments = [...new Set(c.items.map((i) => i.segment).filter(Boolean))];
  const segments = SEGMENT_ORDER.filter((segment) => foundSegments.includes(segment))
    .concat(foundSegments.filter((segment) => !SEGMENT_ORDER.includes(segment)));
  const origins = [...new Set(c.items.map((i) => i.origin).filter(Boolean))];
  const rows = filteredCompetitors();
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  state.page = Math.min(state.page, pages);
  const shown = rows.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);

  const segmentButton = (segment) => {
    const middlePrice = median(segment.items.map((i) => i.price_per_100g_min).filter((v) => v !== null));
    return `<button type="button" class="ma-segment${state.segment === segment.key ? " is-active" : ""}" data-segment="${esc(segment.key)}">
      <b>${esc(segment.label)}</b><small>${segment.items.length}개 · 100g당 중간가격 ${vnd(middlePrice === null ? null : Math.round(middlePrice))}</small></button>`;
  };
  const allSegmentButton = segmentButton({ key: "", label: "전체 경쟁 제품", items: c.items });
  const segmentButtons = segments
    .map((s) => ({ key: s, label: s, items: c.items.filter((i) => i.segment === s) }))
    .map((s) => {
      return segmentButton(s);
    }).join("");

  view.innerHTML = `
    <div class="kpis ma-kpis4">
      <div class="kpi"><div class="label">고유 경쟁 제품 <span>${esc(c.as_of || "")}</span></div><div class="value">${summary.product_count || c.items.length}<small>개</small></div></div>
      <div class="kpi"><div class="label">판매처 조사</div><div class="value">${summary.listing_count || 0}<small>건</small></div></div>
      <div class="kpi"><div class="label">확인한 판매 채널</div><div class="value">${summary.channel_count || 0}<small>개</small></div></div>
      <div class="kpi"><div class="label">100g당 중간가격</div><div class="value">${normalizedPrices.length ? num(Math.round(median(normalizedPrices))) : "—"}<small>₫</small></div></div>
    </div>
    <div class="ma-segment-all">${allSegmentButton}</div>
    <div class="ma-segments">${segmentButtons}</div>
    ${panel({
      title: "경쟁 제품 목록", wide: true,
      head: `
        <div class="ma-toolbar">
          <input type="search" data-search placeholder="브랜드 · 제품 검색" value="${esc(state.search)}" aria-label="검색">
          <select data-origin aria-label="원산지"><option value="">원산지 전체</option>${origins.map((o) => `<option${o === state.origin ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>
          <select data-sort aria-label="정렬">
            <option value="price_asc"${state.sort === "price_asc" ? " selected" : ""}>판매가 낮은 순</option>
            <option value="price_desc"${state.sort === "price_desc" ? " selected" : ""}>판매가 높은 순</option>
          </select>
        </div>`,
      body: `
        <div class="table-wrap"><table class="ma-table ma-competitor-list-legacy">
          <thead><tr><th>사진</th><th>브랜드 · 제품</th><th>세그먼트</th><th>구성</th><th>판매가 범위</th><th>검증</th></tr></thead>
          <tbody>${shown.map((i) => `
            <tr>
              <td>${i.image_url ? `<img class="ma-product-thumb" src="${esc(i.image_url)}" alt="">` : '<span class="ma-product-placeholder">사진<br>확인 필요</span>'}</td>
              <td><button type="button" class="linkbtn ma-product" data-detail="${esc(c.items.indexOf(i))}"><strong>${esc(i.brand)}</strong><small lang="vi">${esc(i.product)}</small></button></td>
              <td>${esc(i.segment || "—")}</td>
              <td>${i.pack_count ? `${num(i.pack_count)}개입` : "—"}${i.net_weight_g ? ` · 총 ${num(i.net_weight_g)}g` : ""}</td>
              <td>${priceRange(i.price_min_vnd, i.price_max_vnd)}</td>
              <td><span class="ma-evidence ${evidenceClass(i.evidence_status)}">${esc(i.evidence_status)}</span></td>
            </tr>`).join("") || '<tr><td colspan="6">조건에 맞는 제품이 없습니다.</td></tr>'}</tbody>
        </table></div>
        <div class="ma-pager">
          <button type="button" class="btn" data-page="${state.page - 1}"${state.page <= 1 ? " disabled" : ""}>이전</button>
          <span>${state.page} / ${pages} · ${rows.length}개</span>
          <button type="button" class="btn" data-page="${state.page + 1}"${state.page >= pages ? " disabled" : ""}>다음</button>
        </div>
        ${sourceLine({ source: "상품 페이지 · 플랫폼 검색 결과 · 매장 조사", asOf: c.as_of, asOfLabel: "최근 확인일", region: "베트남" })}`,
    })}`;
}

function openDetail(index) {
  const i = data.competitors.items[index];
  if (!i) return;
  const dialog = page.querySelector('[data-ma="detail"]');
  const info = [
    ["세그먼트", i.segment], ["원산지", i.origin],
    ["구성", `${i.pack_count ? `${num(i.pack_count)}개입` : ""}${i.net_weight_g ? ` · 총 ${num(i.net_weight_g)}g` : ""}`],
    ["판매가 범위", priceRange(i.price_min_vnd, i.price_max_vnd)],
    ["100g당 가격", priceRange(i.price_per_100g_min, i.price_per_100g_max)],
    ["판매처", `${num(i.channel_count)}개 채널 · ${num(i.seller_count)}개 판매자`],
    ["검증 상태", i.evidence_status], ["최근 확인일", i.surveyed_at],
  ];
  const marketing = data.competitors.marketing_labels
    .map(([key, label]) => `<div><dt>${esc(label)}</dt><dd>${esc(i[key] || "기록 없음")}</dd></div>`).join("");
  page.querySelector('[data-ma="detail-body"]').innerHTML = `
    <div class="ma-product-hero">
      ${i.image_url ? `<a href="${esc(i.image_source_url || i.source_url)}" target="_blank" rel="noopener"><img src="${esc(i.image_url)}" alt="${esc(`${i.brand} ${i.product}`)}"></a>` : '<div class="ma-product-image-empty">제품 이미지 확인 필요</div>'}
      <div><h2>${esc(i.brand)} <small lang="vi">${esc(i.product)}</small></h2><p class="statusline">${esc(i.flavors || "맛 정보 없음")}</p></div>
    </div>
    <dl class="ma-info">${info.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v || "—")}</dd></div>`).join("")}</dl>
    <h3>판매처별 가격과 근거</h3>
    <div class="table-wrap"><table class="ma-table ma-listing-table">
      <thead><tr><th>플랫폼·판매자</th><th>가격</th><th>평점·판매</th><th>상태</th><th>출처</th></tr></thead>
      <tbody>${i.listings.map((listing) => `<tr>
        <td><strong>${esc(listing.platform || "—")}</strong><small>${esc(listing.seller || "판매자 미확인")}</small></td>
        <td>${priceRange(listing.current_price_vnd, listing.price_max_vnd)}${listing.discount_percent !== null ? `<small>${num(listing.discount_percent)}% 할인</small>` : ""}</td>
        <td>${listing.product_rating !== null ? `${num(listing.product_rating, 1)}점` : "—"}<small>${listing.sold_count !== null ? `${num(listing.sold_count)}개 판매 표시` : "판매량 미확인"}</small></td>
        <td><span class="ma-evidence ${evidenceClass(listing.verification_level === "historical_indexed_product_page" ? "과거 자료" : i.evidence_status)}">${esc(listing.stock_status || "상태 미확인")}</span></td>
        <td><a href="${esc(listing.source_url)}" target="_blank" rel="noopener">원문</a><small>${esc(listing.checked_at || "확인일 없음")}</small></td>
      </tr>`).join("")}</tbody>
    </table></div>
    <h3>마케팅 기법</h3>
    <dl class="ma-info">${marketing}</dl>
    <dl class="ma-info">
      <div><dt>입점 채널</dt><dd>${esc(i.channels || "—")}</dd></div>
      <div><dt>소비자 반응 (리뷰 키워드)</dt><dd lang="vi">${esc(i.review_keywords || "—")}</dd></div>
      <div><dt>한정선이 참고할 점</dt><dd>${esc(i.takeaway || "—")}</dd></div>
      <div><dt>한정선 가정 가격 비교</dt><dd>한정선 중량·한 상자에 들어 있는 제품 수·판매가 확정 후 계산</dd></div>
    </dl>
    <p class="footnote">제품 사진과 가격은 각 원문 출처 기준입니다. 과거 자료는 현재 가격 비교에서 별도로 확인해야 합니다.</p>`;
  dialog.showModal();
}

// ---------- 3. 국가 · 문화 ----------

// 가이드라인 항목은 글자 또는 {name, label, meaning, reason ...} 형태라 보이는 값만 이어 붙입니다
function labelOf(item) {
  if (typeof item !== "object" || item === null) return esc(item);
  const main = item.name || item.label || item.value || item.rule || item.keyword || item.id || "";
  const sub = item.meaning || item.reason || item.note || item.use || "";
  return `${esc(main)}${sub ? ` <small>${esc(sub)}</small>` : ""}`;
}

function listOrEmpty(items, file) {
  return items?.length ? `<ul class="ma-list">${items.map((i) => `<li>${labelOf(i)}</li>`).join("")}</ul>` : empty(file);
}

// 국가·문화 탭: 마케팅 담당자가 바로 쓰는 현지 문화 요약 (2024년 이후 발행·갱신이 확인된 자료만)
// 원본은 content_guidelines_<국가>.json의 culture_dashboard. 출처·발행일은 데이터에만 두고 화면에는 기준 시점만 표시합니다.
const CULTURE_IMG = (file) => `/market_analysis/static/images/culture/${file}`;
// 색 견본은 기호로 표시합니다(화면 색 값은 base.css 변수만 사용)
const COLOR_SWATCH = { "빨강": "🟥", "노랑·금색": "🟨", "분홍": "🌸", "검정": "⬛", "흰색": "⬜", "짙은 파랑": "🟦" };
const DONUT_COLORS = ["var(--teal)", "var(--orange)", "var(--beige)", "var(--navy)"];
let cultureModalBody = "";

function openCultureModal() {
  if (!cultureModalBody) return;
  page.querySelector('[data-ma="detail-body"]').innerHTML = cultureModalBody;
  page.querySelector('[data-ma="detail"]').showModal();
}

function renderCulture() {
  const { basic, guidelines = {} } = data.culture;
  const d = guidelines?.culture_dashboard;
  const view = page.querySelector('[data-view="culture"]');
  const section = (title, sub, body, action = "") => `
    <section class="ma-cg-section"><header class="ma-cg-head${action ? " is-between" : ""}"><div><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ""}</div>${action}</header>${body}</section>`;
  const formatIndicatorValue = (x) => {
    if (x.label === "인구" || (x.unit === "명" && Number(x.value) >= 1e8)) {
      return `약 ${Math.round(Number(x.value) / 1e8)}억 명`;
    }
    const cleanUnit = String(x.unit || "").replace(/\s*\([^)]*\)/g, "").trim();
    return `${num(x.value, cleanUnit === "%" ? 1 : 0)}${cleanUnit ? ` ${cleanUnit}` : ""}`;
  };
  const basicRow = `<dl class="ma-cg-basic">
    <div><dt>언어</dt><dd>${esc(country.language ? String(country.language).toUpperCase() : "미확인")}</dd></div>
    <div><dt>시간대</dt><dd>${esc(country.timezone || "미확인")}</dd></div>
    <div><dt>통화</dt><dd>${esc(country.currency || "미확인")}</dd></div>
    ${(basic?.indicators || []).map(x => `<div><dt>${esc(x.label)}</dt><dd>${esc(formatIndicatorValue(x))}</dd></div>`).join("")}
  </dl>`;
  if (!d) {
    view.innerHTML = `<div class="ma-cg">${section("베트남 기본 정보", "", basicRow)}${empty()}</div>`;
    return;
  }
  const rows = (items) => (items?.length ? `<ul class="ma-cg-rows">${items.map(x => `
    <li><strong>${esc(x.title)}</strong><p>${esc(x.fact)}</p></li>`).join("")}</ul>` : empty());

  // 숫자로 보는 디지털 이용 (DataReportal)
  // 아이콘: 6개 항목 모두 우측에 통일된 단색 아이콘(SVG)을 표시합니다
  const INLINE_ICONS = {
    "인터넷 이용자": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>`,
    "SNS 이용 계정": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  };
  const icon = (name, label = "") => (/^[a-z]+$/.test(name || "")
    ? `<span class="ma-cg-icon is-svg" style="--icon:url('${esc(CULTURE_IMG(`sns/${name}.svg`))}')" aria-hidden="true"></span>`
    : INLINE_ICONS[label]
      ? `<span class="ma-cg-icon is-line" aria-hidden="true">${INLINE_ICONS[label]}</span>`
      : "");
  const facts = (d.consumer_facts || []).map(x => `
    <li>${icon(x.icon, x.label)}<span class="ma-cg-stat">${esc(x.value)}</span><strong>${esc(x.label)}</strong><span class="ma-cg-dim">${esc(x.note)}</span></li>`).join("");

  // 색: 선물 포장에 권하는 색 / 피하는 색
  const prefs = d.color_preferences || {};
  const colorRow = (x) => `<li><span class="ma-cg-chip" aria-hidden="true">${COLOR_SWATCH[x.color] || "◻"}</span><strong>${esc(x.color)}</strong><span class="ma-cg-dim">${esc(x.meaning)}</span></li>`;
  // 옆 사진 카드(베트남 상징물)와 높이를 맞추려고 두 상자를 위아래로 쌓습니다(.ma-cg-stack)
  const colors = `<div class="ma-cg-two ma-cg-stack">
    <div class="ma-cg-box is-good"><h3>권하는 색</h3><ul class="ma-cg-list">${(prefs.prefer || []).map(colorRow).join("") || empty()}</ul></div>
    <div class="ma-cg-box is-bad"><h3>피하는 색</h3><ul class="ma-cg-list">${(prefs.avoid || []).map(colorRow).join("") || empty()}</ul></div></div>`;

  // 상징물: 사진 카드. 사진 출처(CC BY 등 이용 조건상 필수)는 사진 위가 아니라 카드 아래 한 줄로 모읍니다
  const credit = new Map((d.symbol_images || []).map(img => [img.file, img.credit]));
  const symbols = (d.tet_symbols || []).map(x => `
    <article class="ma-cg-photo">
      <figure><img src="${esc(CULTURE_IMG(x.image))}" alt="${esc(x.name)}" loading="lazy"></figure>
      <div class="ma-cg-photo-body"><div><strong>${esc(x.name)}</strong><span class="ma-cg-tag">${esc(x.region)}</span></div><p>${esc(x.fact)}</p></div>
    </article>`).join("");
  const credits = (d.tet_symbols || []).map(x => credit.get(x.image)).filter(Boolean);
  const symbolBody = `<div class="ma-cg-photos">${symbols || empty()}</div>
    ${credits.length ? `<p class="ma-cg-note">사진: ${credits.map(esc).join(" · ")}</p>` : ""}`;

  // 숫자: 큰 숫자
  const numbers = d.numbers || {};
  const numberRow = (x, kind) => `<li class="ma-cg-num ${kind}"><span class="ma-cg-digit">${esc(x.number)}</span><div><strong>${esc(x.word)}</strong><p>${esc(x.meaning)}</p></div></li>`;
  const numberBody = `<div class="ma-cg-two">
    <div class="ma-cg-box is-good"><h3>선호하는 숫자</h3><ul class="ma-cg-nums">${(numbers.prefer || []).map(x => numberRow(x, "is-good")).join("") || empty()}</ul></div>
    <div class="ma-cg-box is-bad"><h3>피하는 숫자</h3><ul class="ma-cg-nums">${(numbers.avoid || []).map(x => numberRow(x, "is-bad")).join("") || empty()}</ul></div></div>`;

  // 광고 표현 주의 (조항·출처 표시 없음)
  const adItems = (items) => `<ul class="ma-cg-rows">${items.map(x => `
    <li><strong>${esc(x.title)}</strong>${x.tag ? `<span class="ma-cg-tag is-warn">${esc(x.tag)}</span>` : ""}<p>${esc(x.fact)}</p></li>`).join("")}</ul>`;
  const avoidList = `<div class="ma-cg-cols">${adItems((d.rules || []).map(r => ({ title: r[0], tag: r[1], fact: `피할 예 · ${r[2]}` })))}</div>`;
  const checkList = adItems((d.notices || []).map(n => ({ title: n[0], fact: n[1] })));
  // 광고 올리기 전 확인 + 피할 표현: 담당자가 가장 중요하게 보는 영역이라 한 섹션으로 묶어 강조합니다
  const adWarning = `
    <section class="ma-cg-section ma-cg-alert"><header class="ma-cg-head"><h2>⚠️ 광고 올리기 전 꼭 확인</h2><p>최종 판단: 현지 검수자</p></header>
      <h3 class="ma-cg-alert-h3">✅ 올리기 전 확인</h3><div class="ma-cg-cols">${checkList}</div>
      <h3 class="ma-cg-alert-h3">🚫 피할 표현 <span class="ma-cg-dim">증빙 없는 최상급·비교·건강 효과 주장 주의</span></h3>${avoidList}
      <p class="ma-cg-source">출처: 베트남 국회 (통합 광고법 · 2025 개정 광고법)</p>
    </section>`;

  // 온라인 구매 채널 (Metric 데이터 기사): 숫자 카드 + 도넛 차트·점유율 목록
  const ec = d.ecommerce_facts || {};
  // "공식몰 집중"은 화면에서만 뺍니다(옆 카드와 높이 맞춤). 데이터·AI 인사이트에는 남아 있습니다
  const ecNotes = (ec.notes || [])
    .filter(n => n.title !== "공식몰 집중")
    .map(n => ({ ...n, fact: String(n.fact || "").replace(/^\d{4}년\s*/, "") }));
  const ecCards = (ec.cards || []).map(x => `
    <li><span class="ma-cg-stat">${esc(x.value)}</span><strong>${esc(x.label)}</strong><span class="ma-cg-dim">${esc(x.note)}</span></li>`).join("");
  const shareItems = ec.shares?.items || [];
  const shareTotal = shareItems.reduce((sum, item) => sum + (Number(item.share) || 0), 0) || 100;
  let cumulative = 0;
  const donutSegments = shareItems.map((x, idx) => {
    const val = Number(x.share) || 0;
    const pctLen = (val / shareTotal) * 100;
    const offset = 25 - cumulative;
    cumulative += pctLen;
    const color = DONUT_COLORS[idx % DONUT_COLORS.length];
    return `<circle class="ma-cg-donut-seg" cx="21" cy="21" r="15.9154943" data-donut-name="${esc(x.name)}" data-donut-val="${esc(x.share)}%" data-donut-color="${color}" style="stroke:${color};stroke-dasharray:${pctLen.toFixed(2)} ${(100 - pctLen).toFixed(2)};stroke-dashoffset:${offset.toFixed(2)}"></circle>`;
  }).join("");
  const shareList = shareItems.map((x, idx) => {
    const color = DONUT_COLORS[idx % DONUT_COLORS.length];
    const width = Math.max(0, Math.min(100, Number(x.share) || 0));
    return `<div class="ma-cg-share-row"><dt><i class="ma-cg-swatch" style="background:${color}"></i>${esc(x.name)}</dt><span class="ma-cg-share-track"><span style="width:${width}%;background:${color}"></span></span><dd>${esc(x.share)}%</dd></div>`;
  }).join("");
  const noteRows = ecNotes.map(n => `<div class="is-total"><dt>${esc(n.title)}</dt><dd>${esc(n.fact)}</dd></div>`).join("");
  const top2Share = shareItems.slice(0, 2).reduce((sum, item) => sum + (Number(item.share) || 0), 0);
  const donutBlock = shareItems.length ? `
    <h3 class="ma-cg-h3">플랫폼 점유율 (거래액 기준)</h3>
    <div class="ma-cg-donut-wrap">
      <div class="ma-cg-donut">
        <svg viewBox="0 0 42 42" class="ma-cg-donut-svg" role="img" aria-label="플랫폼 점유율 도넛 차트">
          <circle class="ma-cg-donut-track" cx="21" cy="21" r="15.9154943"></circle>
          ${donutSegments}
        </svg>
        <div class="ma-cg-donut-center"><span>상위 2개</span><strong>${num(top2Share, 1)}%</strong></div>
        <div class="ma-cg-donut-tip" data-ma="donut-tip" hidden></div>
      </div>
      <dl class="ma-cg-donut-list">${shareList}${noteRows}</dl>
    </div>` : (ecNotes.length ? rows(ecNotes) : "");
  const ecBody = `<ul class="ma-cg-stats">${ecCards || empty()}</ul>
    ${donutBlock}
    <p class="ma-cg-source">출처: Metric (VnEconomy · VietnamNet)</p>`;

  // 디저트 소비 문화: 한국인 이용자가 처음 봐도 바로 이해할 수 있도록 쉬운 한국어로 풀어서 표시
  const DESSERT_KO = [
    ["🎎", "명절 떡·선물 문화", [
      "설날(뗏)에는 한국의 떡국·송편처럼 지역마다 전통 찹쌀떡을 차례·선물용으로 나눔",
      "북부는 네모·둥근 찹쌀떡을 짝으로 맞추고, 중·남부는 원통형 찹쌀떡·흑설탕 떡 선호",
      "추석(중추절)엔 월병 선물이 필수이며, 최근엔 쫀득한 찹쌀피(스노우스킨) 월병이 유행",
    ]],
    ["🍧", "일상 간식 '체(Chè)'", [
      "한국의 팥빙수·단팥죽처럼 가장 대중적인 베트남 전통 달콤 간식",
      "코코넛 밀크에 찹쌀·콩·과일·젤리를 넣어 오후~저녁 간식으로 즐김",
      "더운 철(4~9월)엔 얼음을 넣어 차갑게, 선선한 철(11~2월)엔 따뜻하게 섭취",
      "지역별 입맛: 북부(담백·덜 단맛) · 중부(진한 맛) · 남부(가장 단맛 선호)",
    ]],
    ["☕", "카페·디저트 페어링", [
      "전국 커피숍 약 50만 곳 — 일상적으로 카페 음료와 디저트를 함께 소비",
      "연유 커피와 달콤한 과일차·말차 음료가 주류",
      "젊은 층(Z세대)은 '말차+코코넛' 같은 새로운 퓨전 맛 조합에 호응이 높음",
    ]],
    ["🥤", "저당·건강 간식 선호", [
      "소비자 82%가 '높은 당 함량' 때문에 단 음료를 줄이는 중",
      "28%는 저당 제품을 고르며, 건강에 좋다면 더 비싸도 구매할 의향이 있음",
      "2027년부터 가당 음료 설탕세 도입 → '덜 단 담백한 찹쌀떡·과일 디저트' 소구에 유리",
    ]],
  ];
  const dessertGroups = DESSERT_KO.map(([emoji, title, items]) => `
    <article class="ma-cg-group"><h3><span aria-hidden="true">${emoji}</span>${esc(title)}</h3>
      <ul>${items.map(item => `<li>${esc(item)}</li>`).join("")}</ul></article>`).join("");

  // 넓은 화면은 2칸 배치(.ma-cg-pair), 좁은 화면은 1칸
  const pair = (left, right) => `<div class="ma-cg-pair">${left}${right}</div>`;
  const snsBody = `<ul class="ma-cg-stats is-fill">${facts || empty()}</ul><p class="ma-cg-source">출처: DataReportal</p>`;
  const cultureBtn = `<button type="button" class="ma-cg-open-btn" data-ma="culture-open">베트남 문화 보기 ↗</button>`;
  cultureModalBody = `
    <header class="ma-rd-head">
      <div class="ma-rd-brand">베트남 문화 가이드</div>
      <div>디저트 소비 문화 · 베트남 상징물 · 선물 포장 색 · 선물 예절 · 숫자</div>
    </header>
    <div class="ma-cg ma-cg-modal">
      ${section("디저트 소비 문화", "", `<div class="ma-cg-groups">${dessertGroups || rows(d.dessert_facts)}</div>`)}
      ${pair(section("베트남 상징물", "", symbolBody),
        section("선물 포장 색", "", colors))}
      ${pair(section("선물 예절", "", rows(d.gift_etiquette)), section("숫자", "", numberBody))}
    </div>`;
  view.innerHTML = `<div class="ma-cg">
    ${section("베트남 기본 정보", "", basicRow, cultureBtn)}
    ${pair(section("디지털·SNS 이용", "", snsBody),
      section("온라인 구매 채널", "", ecBody))}
    ${adWarning}
  </div>`;
}

// ---------- 4. AI 인사이트 ----------

// 설계: 필수 입력 3개(목표·실행 기간·주력 채널) → 대시보드 실측 근거 + Open API 베트남 기념일 + 의사결정 카드(D-) 교차 검증 보고서.
// 별도 모달 창 대신 화면 하단에 바로 스크롤 가능한 '한정선 베트남 진출 자료' 보고서 미리보기를 표시하고, A4 PDF 저장을 지원합니다.
const INSIGHT_URL = `/market_analysis/api/insight?country=${encodeURIComponent(data.country)}`;
const insight = {
  options: null,
  form: { goal: "tourist", period: "3m", channels: ["souvenir", "online"] },
  result: null,
  loading: false,
  error: "",
};

function renderInsight() {
  const view = page.querySelector('[data-view="insight"]');
  if (!insight.options) {
    view.innerHTML = `<p class="empty-note">AI 인사이트 설정과 대시보드 근거를 불러오는 중입니다.</p>`;
    fetch(INSIGHT_URL).then((r) => r.json()).then((options) => { insight.options = options; renderInsight(); })
      .catch(() => { view.innerHTML = `<p class="empty-note">AI 인사이트를 불러오지 못했습니다.</p>`; });
    return;
  }
  view.innerHTML = `<div class="ma-ai">${insightForm()}${insightResult()}</div>`;
  bindInsightForm(view);
}

function insightForm() {
  const o = insight.options, f = insight.form;
  const choice = (name, items, selected, type = "radio") => `<div class="ma-ai-choices">${items.map((item) => `
    <label class="ma-ai-choice"><input type="${type}" name="${name}" value="${esc(item.id)}"
      ${(type === "radio" ? selected === item.id : selected.includes(item.id)) ? "checked" : ""}><span>${esc(item.label)}</span></label>`).join("")}</div>`;
  return `<form class="ma-ai-form" data-ma="insight-form">
    <div class="ma-ai-form-top">
      <div class="ma-ai-form-head">
        <h2>AI 인사이트 전략 도출</h2>
        <p>필수 조건 3가지만 선택하면 대시보드의 트렌드·경쟁사·문화·광고법 실측 데이터와 베트남 기념일 Open API 정보를 결합해 아래에 보고서를 바로 생성합니다.</p>
      </div>
      <div class="ma-ai-submit">
        ${o.ai_ready ? "" : `<span class="ma-ai-warn">OPENAI_API_KEY가 설정되지 않아 생성할 수 없습니다.</span>`}
        ${insight.error ? `<span class="ma-ai-warn">${esc(insight.error)}</span>` : ""}
        <button type="submit" ${o.ai_ready && !insight.loading ? "" : "disabled"}>${insight.loading ? "보고서 생성 중…" : "AI 인사이트 생성"}</button>
      </div>
    </div>
    <div class="ma-ai-grid3">
      <fieldset><legend>1. 이번 목표 <b>필수</b></legend>${choice("goal", o.goals, f.goal)}</fieldset>
      <fieldset><legend>2. 실행 기간 <b>필수</b></legend>${choice("period", o.periods, f.period)}</fieldset>
      <fieldset><legend>3. 주력 채널 <b>필수 · 복수 선택</b></legend>${choice("channels", o.channels, f.channels, "checkbox")}</fieldset>
    </div>
  </form>`;
}

function bindInsightForm(view) {
  const form = view.querySelector('[data-ma="insight-form"]');
  const read = () => {
    const fd = new FormData(form);
    insight.form = {
      goal: fd.get("goal") || undefined,
      period: fd.get("period") || undefined,
      channels: fd.getAll("channels"),
    };
  };
  form.addEventListener("change", read);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    read();
    insight.loading = true; insight.error = ""; renderInsight();
    try {
      const response = await fetch(INSIGHT_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(insight.form) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "생성하지 못했습니다.");
      insight.result = body;
    } catch (error) {
      insight.error = error.message;
    }
    insight.loading = false; renderInsight();
    if (insight.result && !insight.error) {
      const preview = view.querySelector('[data-ma="insight-preview"]');
      preview?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
}

function reportHeaderHtml() {
  return `<header class="ma-report-head">
    <div class="ma-report-title-row">
      <div>
        <p class="ma-report-kicker">HANJUNGSUN · VIETNAM MARKET ENTRY BRIEF</p>
        <h1>한정선 베트남 진출 자료</h1>
      </div>
      <img class="ma-report-logo" src="${REPORT_LOGO}" alt="한정선">
    </div>
  </header>`;
}

function insightResult() {
  const out = insight.result;
  if (!out) {
    return `<div class="ma-ai-placeholder">
      <p>위 필수 항목 3가지를 확인한 뒤 <strong>[AI 인사이트 생성]</strong>을 누르면, 이 영역에 스크롤 가능한 <strong>한정선 베트남 진출 자료</strong> 미리보기가 바로 표시됩니다.</p>
    </div>`;
  }
  const input = out.input;
  const evCount = Object.keys(out.evidence || {}).length;
  return `<section class="ma-ai-preview-shell" data-ma="insight-preview">
    <div class="ma-ai-report-bar">
      <div class="ma-ai-report-info">
        <strong>한정선 베트남 진출 자료 미리보기</strong>
        <span class="ma-ai-meta">${esc(input.goal_label)} · ${esc(input.period_label)} · ${esc(input.channel_labels.join(", "))} · 검증 근거 ${evCount}건 반영</span>
      </div>
      <button type="button" class="ma-report-pdf" data-ma="report-pdf">PDF 저장</button>
    </div>
    <div class="ma-ai-preview-scroll">
      <article class="ma-ai-sheet">
        ${reportHeaderHtml(out)}
        <div class="ma-report-body">${insightBlocks(out)}</div>
      </article>
    </div>
    <iframe class="ma-report-print-frame" data-ma="print-frame" title="PDF 인쇄용 프레임" hidden></iframe>
  </section>`;
}

function renderDecisionSummary(out) {
  const cards = out.cards || insight.options?.cards || {};
  const flavor = cards.flavor || {};
  const price = cards.price || {};
  const channel = cards.channel || {};
  const gaps = (flavor.rows || []).filter((r) => r.kind === "gap").map((r) => `${r.name}(관심 ${r.rank}위·경쟁 ${r.supply}개)`);
  const crowded = (flavor.rows || []).filter((r) => r.kind === "crowded").map((r) => `${r.name}(${r.supply}개)`);
  const flavorHtml = flavor.status === "ok"
    ? `<p><b>공략 추천(빈틈)</b> ${esc(gaps.join(", ") || "상위권 탐색 필요")}</p>
       <p class="ma-ai-dcard-sub"><b>과밀 주의</b> ${esc(crowded.join(", ") || "없음")} · 공급 제품 수 기준</p>`
    : `<p class="ma-ai-none">데이터 집계 중</p>`;
  const ov = price.overall;
  const priceHtml = price.status === "ok" && ov
    ? `<p><b>100g당 중앙값</b> ${num(ov.median)}동 <small>(하위25% ${num(ov.p25)} ~ 상위25% ${num(ov.p75)}동)</small></p>
       <p class="ma-ai-dcard-sub">${(price.rows || []).filter((r) => r.median).map((r) => `${esc(r.label)} 중앙 ${num(r.median)}동(${r.count}건)`).join(" · ")}</p>`
    : `<p class="ma-ai-none">데이터 집계 중</p>`;
  const topCh = (channel.rows || []).slice(0, 3);
  const channelHtml = channel.status === "ok" && topCh.length
    ? `<p><b>경쟁 입점 집중</b> ${topCh.map((r) => `${esc(r.channel)} ${r.listings}건(${r.listing_share}%)`).join(" · ")}</p>
       <p class="ma-ai-dcard-sub">이커머스 거래액 점유율: Shopee 56.04% · TikTok Shop 41.31%</p>`
    : `<p class="ma-ai-none">데이터 집계 중</p>`;
  return `<div class="ma-ai-dcards">
    <div class="ma-ai-dcard"><span class="ma-ai-dcard-kicker">맛 기회 분석</span>${flavorHtml}</div>
    <div class="ma-ai-dcard"><span class="ma-ai-dcard-kicker">경쟁 가격 기준선</span>${priceHtml}</div>
    <div class="ma-ai-dcard"><span class="ma-ai-dcard-kicker">유통·채널 지형</span>${channelHtml}</div>
  </div>`;
}

// 화면 미리보기(insightResult)와 PDF 인쇄(reportDocument)가 동일하게 사용하는 대칭형 블록
function insightBlocks(out) {
  const r = out.result, ev = out.evidence || {};
  const block = (no, title, body) => `<section class="ma-ai-block"><header class="ma-ai-block-head"><h3><span>${no}</span>${esc(title)}</h3></header>${body}</section>`;
  const table = (heads, rows, cls = "") => (rows.length ? `<div class="table-wrap"><table class="ma-ai-table ${cls}"><thead><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : `<p class="ma-ai-none">근거 부족 · 내용 없음</p>`);
  const pct = (v) => (v === null || v === undefined ? "-" : `${v > 0 ? "+" : ""}${Number(v).toFixed(1)}%`);
  const swotCell = (key, label) => `<div class="ma-ai-swot-cell is-${key.toLowerCase()}"><h4>${key} · ${label}</h4>${(r.swot[key] || []).length
    ? `<ul>${r.swot[key].map((x) => `<li><span class="ma-ai-swot-main">${esc(x.text)}</span>${x.response ? `<small class="ma-ai-swot-resp">대응 전략 · ${esc(x.response)}</small>` : ""}</li>`).join("")}</ul>`
    : `<p class="ma-ai-none">근거 부족</p>`}</div>`;

  // 베트남 기념일·시즌 마케팅 캘린더 (2026년 기준)
  const holidayData = out.holidays || {};
  const holidayItems = (holidayData.items || []).filter((h) => h.in_period || h.in_prep);
  const holidayShown = (holidayItems.length ? holidayItems : (holidayData.items || []).slice(0, 5)).slice(0, 6);
  const holidayTable = holidayShown.length ? table(
    ["일정 · 기념일", "구분", "현지 선물·소비 수요 특성", "마케팅 리드타임 · 권장 실행안"],
    holidayShown.map((h) => [
      `<strong>${esc(h.date)}</strong><small>${esc(h.name)}</small>`,
      esc(h.kind),
      esc(h.demand),
      `<strong>${esc(h.lead_time)}</strong><small>${esc(h.action)}</small>`,
    ]),
    "is-holiday"
  ) : `<p class="ma-ai-none">기념일 데이터 없음</p>`;

  // 현지 법규·문화 리스크 체크리스트 (r.checks)
  const checkItems = (r.checks && r.checks.length) ? r.checks : [
    { text: "인플루언서·온라인 광고 시 협찬·광고임을 명확히 표기하고 증빙 없는 '1위·최고·질병 예방' 표현 배제" },
    { text: "베트남어·한국어 병기 시 외국어 글자 크기는 베트남어의 3/4 이하로 베트남어 아래에 배치" },
    { text: "실물 라벨에 제품명·원산지·책임 주체를 필수 표기하고 지도(구단선)·국가 상징물 오남용 엄금" },
    { text: "선물 패키지는 빨강·금색·노랑·분홍 및 6·8·9개입을 활용하고 4개입·흑백 단색 포장은 배제" },
  ];
  const checkGrid = `<ul class="ma-ai-checks">${checkItems.map((c) => `<li><strong>필수 점검</strong><span>${esc(c.text)}</span></li>`).join("")}</ul>`;

  // 보고서 하단 외부 데이터·Open API 출처 요약표 (내부 조사표 및 중복 행을 제거하고 이용자가 보기 쉽게 정리)
  const externalGroups = [
    {
      name: "World Bank Open Data (WDI Open API)",
      tags: ["K-거시"],
      summary: "베트남 인구(약 1억 100만 명), 1인당 GDP(4,717 USD), 경제성장률(7.09%), 도시화율(38.8%) 등 국가 거시경제 지표",
    },
    {
      name: esc(holidayData.source || "Calendarific · Nager.Date Open API · Vietnam Tourism"),
      tags: ["K-기념일", "K-선물", "K-색숫자"],
      summary: "베트남 법정 공휴일·상업 기념일 일정 및 명절·기념일 선물 에티켓, 선호 색상·숫자 문화 기준",
    },
    {
      name: "Google Trends (SerpApi Open API)",
      tags: ["T-추이", "T-과일", "T-계절성", "T-관광", "T-지역"],
      summary: "베트남 현지 카테고리·과일 맛 검색 관심도 추이, 최근 5년 월별 계절성 피크, 다낭 여행 및 지역별 검색 지수",
    },
    {
      name: "DataReportal (We Are Social · Meltwater)",
      tags: ["K-채널"],
      summary: "베트남 인터넷·SNS 이용자 규모 및 Facebook(7,900만)·Zalo(7,830만)·TikTok(7,610만)·YouTube(6,210만) 도달 지표",
    },
    {
      name: "Metric (VnEconomy · VietnamNet)",
      tags: ["K-이커머스"],
      summary: "베트남 4대 이커머스 플랫폼 거래액(164억 달러), 식료품 성장률(+60.96%), 플랫폼 점유율(Shopee 56.04% · TikTok Shop 41.31%)",
    },
    {
      name: "Danang Fantasticity (다낭시 관광 통계)",
      tags: ["K-다낭"],
      summary: "다낭 해외 관광객 1위 한국 시장 비중, 한국~다낭 직항 노선(12개 항공사·주 160편) 및 관광 소비 통계",
    },
    {
      name: "B&Company · The Investor · Tuổi Trẻ News",
      tags: ["K-당", "K-명절떡", "K-트렌드"],
      summary: "베트남 소비자 저당·건강 식음료 선호(80%), 설탕세 도입(2027년 8%) 및 찹쌀·스노우스킨 디저트 소비 트렌드",
    },
    {
      name: "베트남 국회 광고법 · 시행령 37/2026 (Viet An Law)",
      tags: ["K-광고법", "K-언어", "K-라벨", "K-지도"],
      summary: "인플루언서·온라인 광고 표기 의무, 베트남어·외국어 병기 글자 크기(3/4 이하), 수입 식품 라벨링 및 국가 상징·지도 표기 법규",
    },
  ];
  const evRows = externalGroups
    .filter((g) => g.tags.some((t) => ev[t]))
    .map((g) => {
      const firstDate = g.tags.map((t) => ev[t]?.date).find((d) => d) || "-";
      return [`<strong>${g.name}</strong><small>기준 · 확인일: ${esc(firstDate)}</small>`, esc(g.summary)];
    });
  const evTable = table(["외부 공인 · Open API 출처", "보고서 반영 데이터 요약"], evRows, "is-evidence");

  return `
    ${block(1, "핵심 전략 결론 · 의사결정 요약", `<p class="ma-ai-conclusion">${esc(r.conclusion)}</p>${renderDecisionSummary(out)}`)}
    ${block(2, "베트남 기념일 · 시즌 마케팅 캘린더", holidayTable)}
    ${block(3, "데이터 기반 핵심 인사이트", table(["사실 및 데이터 근거", "한정선에 주는 시사점", "우선 실행 과제"],
      r.insights.map((x) => [esc(x.fact), esc(x.meaning), esc(x.action)]), "is-3col"))}
    ${block(4, "현지화 과일 라인업 추천", table(["순위", "추천 과일", "검색 관심도 · 계절성 근거", "제품화 · 패키지 아이디어", "권장 출시 시기"],
      r.fruits.map((x) => [x.rank, `<strong>${esc(x.name)}</strong>`,
        `관심도 ${esc(x.interest)} · 전년 대비 ${pct(x.change_rate)} · 피크 ${esc(x.peak_months.join("·"))}월${x.reason ? `<small>${esc(x.reason)}</small>` : ""}`,
        esc(x.idea || "-"), esc(x.launch)]), "is-fruit"))}
    <div class="ma-ai-pair">
      ${block(5, "월별 실행 로드맵", `<ol class="ma-ai-timeline">${r.timeline.map((x) => `<li><strong>${esc(x.label)}</strong><span>${esc(x.action || "-")}</span></li>`).join("")}</ol>`)}
      ${block(6, "경쟁사 대비 포지셔닝", `<div class="ma-ai-pos-box"><p>${esc(r.positioning.text)}</p></div>
        <h4 class="ma-ai-subhead">핵심 마케팅 실행 방식</h4>
        ${table(["방식", "실행 내용"], r.marketing.map((x) => [`<strong>${esc(x.method)}</strong>`, esc(x.content)]), "is-mkt")}`)}
    </div>
    ${block(7, "주력 채널별 실행 전략", table(["주력 채널", "핵심 소구 메시지", "콘텐츠 · 패키징 실행안"],
      r.channels.map((x) => [`<strong>${esc(x.channel)}</strong>`, esc(x.message), esc(x.content_packaging)]), "is-channel"))}
    ${block(8, "SWOT 분석 매트릭스", `<div class="ma-ai-swot">${swotCell("S", "강점 (Strength)")}${swotCell("W", "약점 (Weakness)")}${swotCell("O", "기회 (Opportunity)")}${swotCell("T", "위협 및 대응 (Threat)")}</div>`)}
    ${block(9, "현지 법규 · 문화 리스크 필수 점검", checkGrid)}
    ${block(10, "20년 차 글로벌 마케터를 위한 AI 종합 제언", r.opinions.length ? `<div class="ma-ai-opinions">${r.opinions.map((x, idx) => `<div class="ma-ai-opinion"><p><b>제언 ${idx + 1}</b> ${esc(x.text)}</p></div>`).join("")}</div>`
      : `<p class="ma-ai-none">근거 부족 · 의견 없음</p>`)}
    ${block(11, "외부 데이터 · Open API 출처", evTable)}`;
}

// ---------- AI 인사이트 보고서 (PDF 인쇄용 문서) ----------
// 별도 표지 페이지 없이 첫 페이지 상단에 '한정선 베트남 진출 자료' 헤더를 두고 바로 본문이 이어지도록 구성합니다.
const REPORT_CSS = ["/platform_core/static/css/fonts.css", "/platform_core/static/css/base.css",
  "/market_analysis/static/css/insight_report.css"];
const REPORT_LOGO = "/platform_core/static/images/hanjungsun_logo_wide.png";

function reportDocument(out) {
  const date = String(out.generated_at || "").slice(0, 10);
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
    <title>한정선_베트남_진출_자료_${esc(date)}</title>
    ${REPORT_CSS.map((href) => `<link rel="stylesheet" href="${href}">`).join("")}</head>
  <body class="ma-report">
    <section class="ma-report-page">
      ${reportHeaderHtml(out)}
      <div class="ma-report-body">${insightBlocks(out)}</div>
    </section>
  </body></html>`;
}

// 인쇄 창에서 "PDF로 저장"을 고르면 첫 페이지부터 좌우 대칭이 맞은 A4 PDF로 저장됩니다
function printReport() {
  if (!insight.result) return;
  const frame = page.querySelector('[data-ma="print-frame"]');
  if (!frame) return;
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
  };
  frame.srcdoc = reportDocument(insight.result);
}

// ---------- 탭 · 이벤트 ----------

const renderers = { trend: renderTrend, competitor: renderCompetitor, culture: renderCulture, insight: renderInsight };

function showTab(tab) {
  state.tab = tab;
  page.querySelectorAll("[data-view]").forEach((v) => { v.hidden = v.dataset.view !== tab; });
  page.querySelectorAll(".ma-tabs [data-tab]").forEach((b) => {
    b.setAttribute("aria-selected", String(b.dataset.tab === tab));
  });
  renderers[tab]();
  const url = new URL(window.location.href);
  url.searchParams.set("country", data.country);
  url.searchParams.set("tab", tab);
  history.replaceState(null, "", url);
}

page.addEventListener("click", (event) => {
  const el = event.target.closest("button, a");
  if (!el || !page.contains(el)) return;
  const d = el.dataset;
  if (d.tab && el.closest(".ma-tabs")) return showTab(d.tab);
  if (d.period) { state.period = Number(d.period); return renderTrend(); }
  if (d.fruit !== undefined) { state.fruitTerm = d.fruit; return renderTrend(); }
  if (d.geo) { state.geoKey = d.geo; return renderTrend(); }
  if (d.segment !== undefined) { state.segment = d.segment; state.page = 1; return renderCompetitor(); }
  if (d.page) { state.page = Number(d.page); return renderCompetitor(); }
  if (d.detail !== undefined) return openDetail(Number(d.detail));
  if (d.rdetail) return openResearchDetail(d.rdetail);
  if (d.ctab) { state.ctab = d.ctab; return renderCompetitor(); }
  if (d.tactic) return openMarketingEvidence(d.tactic, d.tacticBrand);
  if (d.segmentGo) { state.ctab = "list"; state.segment = d.segmentGo; state.page = 1; return renderCompetitor(); }
  if (d.ma === "culture-open") return openCultureModal();
  if (d.ma === "report-pdf") return printReport();
  if (d.ma === "detail-close") page.querySelector('[data-ma="detail"]').close();
});

page.addEventListener("pointerover", (event) => {
  const seg = event.target.closest(".ma-cg-donut-seg");
  if (!seg) return;
  const tip = seg.closest(".ma-cg-donut")?.querySelector('[data-ma="donut-tip"]');
  if (!tip) return;
  tip.innerHTML = `<strong>${esc(seg.dataset.donutName)}</strong><span><i class="ma-cg-tip-swatch" style="background:${esc(seg.dataset.donutColor)}"></i>${esc(seg.dataset.donutVal)}</span>`;
  tip.hidden = false;
});

page.addEventListener("pointerout", (event) => {
  const seg = event.target.closest(".ma-cg-donut-seg");
  if (!seg) return;
  const tip = seg.closest(".ma-cg-donut")?.querySelector('[data-ma="donut-tip"]');
  if (tip) tip.hidden = true;
});

page.addEventListener("change", (event) => {
  const el = event.target;
  if (el.matches("[data-rising]")) { state.risingKey = el.value; renderTrend(); }
  if (el.matches("[data-origin]")) { state.origin = el.value; state.page = 1; renderCompetitor(); }
  if (el.matches("[data-level]")) { state.level = el.value; state.page = 1; renderCompetitor(); }
  if (el.matches("[data-seller]")) { state.seller = el.value; state.page = 1; renderCompetitor(); }
  if (el.matches("[data-segment-select]")) { state.segment = el.value; state.page = 1; renderCompetitor(); }
  if (el.matches("[data-core]")) { state.coreOnly = el.checked; state.page = 1; renderCompetitor(); }
  if (el.matches("[data-sort]")) { state.sort = el.value; renderCompetitor(); }
});

page.addEventListener("input", (event) => {
  if (!event.target.matches("[data-search]")) return;
  state.search = event.target.value;
  state.page = 1;
  renderCompetitor();
  const input = page.querySelector("[data-search]");
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
});

showTab(state.tab);
