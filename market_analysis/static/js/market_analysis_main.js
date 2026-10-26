import { initTrends } from "./trends.js";
// 현지 시장 분석 화면 스크립트 [상준]
// type="module"로 불러오므로 전역 변수·함수가 생기지 않습니다. (README 7장)
// 서버(routes.py)가 넣어 준 실제 데이터만 그립니다. 값이 없으면 만들지 않고 "수집 전"으로 표시합니다.

const page = document.querySelector(".market-analysis-page");
const data = JSON.parse(page.querySelector('[data-ma="dashboard"]').textContent);
const country = data.countries.find((c) => c.code === data.country) || data.countries[0];
const DANANG = /da\s*nang|đà\s*nẵng|다낭/i;
const MONTHS = ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"];
const PAGE_SIZE = 8;
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
  coreOnly: false,
  sort: "price100_asc",
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

function renderCountryBar() {
  page.querySelector('[data-ma="country-chips"]').innerHTML = data.countries
    .map((c) => `<a class="ma-chip${c.code === data.country ? " is-active" : ""}" href="?country=${esc(c.code)}&tab=${esc(state.tab)}">${esc(c.name)}</a>`)
    .join("");
  // 언어 코드는 데이터에 소문자(ISO 639)로 있으므로 화면에서만 통화 코드처럼 대문자로 보여 줍니다
  page.querySelector('[data-ma="country-info"]').innerHTML = `
    <div><dt>언어 · 통화</dt><dd>${esc(String(country.language || "—").toUpperCase())} · ${esc(country.currency || "—")}</dd></div>
    <div><dt>우선 도시</dt><dd>${esc(country.city)}</dd></div>`;
}

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

// ---------- 2. 경쟁사 분석 ----------

function filteredCompetitors() {
  const q = state.search.trim().toLowerCase();
  const rows = data.competitors.items.filter((i) =>
    (!state.segment || i.segment === state.segment)
    && (!state.origin || i.origin === state.origin)
    && (!state.coreOnly || i.is_core)
    && (!q || `${i.brand} ${i.product}`.toLowerCase().includes(q)));
  const key = state.sort === "channels" ? "channel_count"
    : state.sort === "price_desc" ? "price_min_vnd" : "price_per_100g_min";
  const dir = state.sort === "price100_asc" ? 1 : -1;
  // 값이 비어 있는 제품은 정렬 방향과 관계없이 맨 아래로 보냅니다
  return rows.sort((a, b) => (a[key] === null) - (b[key] === null) || (a[key] - b[key]) * dir);
}

function renderCompetitor() {
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
            <option value="price100_asc"${state.sort === "price100_asc" ? " selected" : ""}>100g당 가격 낮은 순</option>
            <option value="price_desc"${state.sort === "price_desc" ? " selected" : ""}>개당 가격 높은 순</option>
            <option value="channels"${state.sort === "channels" ? " selected" : ""}>입점 채널 많은 순</option>
          </select>
        </div>`,
      body: `
        <div class="table-wrap"><table class="ma-table">
          <thead><tr><th>사진</th><th>브랜드 · 제품</th><th>세그먼트</th><th>구성</th><th>판매가 범위</th><th>100g당</th><th>판매처</th><th>검증</th></tr></thead>
          <tbody>${shown.map((i) => `
            <tr>
              <td>${i.image_url ? `<img class="ma-product-thumb" src="${esc(i.image_url)}" alt="">` : '<span class="ma-product-placeholder">사진<br>확인 필요</span>'}</td>
              <td><button type="button" class="linkbtn ma-product" data-detail="${esc(c.items.indexOf(i))}"><strong>${esc(i.brand)}</strong><small lang="vi">${esc(i.product)}</small></button></td>
              <td>${esc(i.segment || "—")}</td>
              <td>${i.pack_count ? `${num(i.pack_count)}입` : "—"}${i.net_weight_g ? ` · 총 ${num(i.net_weight_g)}g` : ""}</td>
              <td>${priceRange(i.price_min_vnd, i.price_max_vnd)}</td>
              <td>${vnd(i.price_per_100g_min)}</td>
              <td>${num(i.channel_count)}개 채널<small>${num(i.listing_count)}건</small></td>
              <td><span class="ma-evidence ${evidenceClass(i.evidence_status)}">${esc(i.evidence_status)}</span></td>
            </tr>`).join("") || '<tr><td colspan="8">조건에 맞는 제품이 없습니다.</td></tr>'}</tbody>
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
    ["구성", `${i.pack_count ? `${num(i.pack_count)}입` : ""}${i.net_weight_g ? ` · 총 ${num(i.net_weight_g)}g` : ""}`],
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
      <div><dt>한정선 가정 가격 비교</dt><dd>한정선 중량·입수량·판매가 확정 후 계산</dd></div>
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

function renderCulture() {
  const { basic, guidelines = {} } = data.culture;
  const d = guidelines?.culture_dashboard;
  const view = page.querySelector('[data-view="culture"]');
  const section = (title, sub, body) => `
    <section class="ma-cg-section"><header class="ma-cg-head"><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ""}</header>${body}</section>`;
  const basicRow = `<dl class="ma-cg-basic">
    <div><dt>언어</dt><dd>${esc(country.language || "미확인")}</dd></div>
    <div><dt>시간대</dt><dd>${esc(country.timezone || "미확인")}</dd></div>
    <div><dt>통화</dt><dd>${esc(country.currency || "미확인")}</dd></div>
    ${(basic?.indicators || []).map(x => `<div><dt>${esc(x.label)} (${esc(x.year)})</dt><dd>${num(x.value, x.unit === "%" ? 1 : 0)} ${esc(x.unit)}</dd></div>`).join("")}
  </dl>`;
  if (!d) {
    view.innerHTML = `<div class="ma-cg">${section("베트남 기본 정보", "", basicRow)}${empty()}</div>`;
    return;
  }
  const rows = (items) => (items?.length ? `<ul class="ma-cg-rows">${items.map(x => `
    <li><strong>${esc(x.title)}</strong><p>${esc(x.fact)}</p></li>`).join("")}</ul>` : empty());

  // 숫자로 보는 디지털 이용 (DataReportal)
  // 아이콘: 기호면 그대로, 이름이면 sns/<이름>.svg (Simple Icons, CC0)를 회색으로 칠해 표시
  const icon = (name) => (!name ? "" : /^[a-z]+$/.test(name)
    ? `<span class="ma-cg-icon is-svg" style="--icon:url('${esc(CULTURE_IMG(`sns/${name}.svg`))}')" aria-hidden="true"></span>`
    : `<span class="ma-cg-icon" aria-hidden="true">${esc(name)}</span>`);
  const facts = (d.consumer_facts || []).map(x => `
    <li>${icon(x.icon)}<span class="ma-cg-stat">${esc(x.value)}</span><strong>${esc(x.label)}</strong><span class="ma-cg-dim">${esc(x.note)} · ${esc(x.as_of)} 기준</span></li>`).join("");

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
    <div class="ma-cg-box is-bad"><h3>피하는 숫자</h3><ul class="ma-cg-nums">${(numbers.avoid || []).map(x => numberRow(x, "is-bad")).join("") || empty()}</ul></div></div>
    ${numbers.note ? `<p class="ma-cg-note">${esc(numbers.note)}</p>` : ""}`;

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
    </section>`;

  // 온라인 구매 채널 (Metric 데이터 기사): 숫자 카드 + 점유율 막대 + 짧은 설명
  const ec = d.ecommerce_facts || {};
  // "공식몰 집중"은 화면에서만 뺍니다(옆 카드와 높이 맞춤). 데이터·AI 인사이트에는 남아 있습니다
  const ecNotes = (ec.notes || []).filter(n => n.title !== "공식몰 집중");
  const ecCards = (ec.cards || []).map(x => `
    <li>${icon(x.icon)}<span class="ma-cg-stat">${esc(x.value)}</span><strong>${esc(x.label)}</strong><span class="ma-cg-dim">${esc(x.note)} · ${esc(x.as_of)}</span></li>`).join("");
  const shares = (ec.shares?.items || []).map(x => `
    <li><span class="ma-cg-share-name">${icon(x.icon)}${esc(x.name)}</span>
      <span class="ma-cg-share-track"><span style="width:${Math.max(0, Math.min(100, Number(x.share) || 0))}%"></span></span>
      <span class="ma-cg-share-value">${esc(x.share)}%</span><span class="ma-cg-dim">${esc(x.prev)}</span></li>`).join("");
  const ecBody = `<ul class="ma-cg-stats">${ecCards || empty()}</ul>
    ${shares ? `<h3 class="ma-cg-h3">플랫폼 점유율 (${esc(ec.shares.as_of)} 거래액 기준)</h3><ul class="ma-cg-shares">${shares}</ul>` : ""}
    ${ecNotes.length ? rows(ecNotes) : ""}`;

  // 디저트 소비 문화: 중요한 4개 장면만 이 순서로 표시 (선물용 과자는 데이터·AI 인사이트에는 남음, 2026-10-26 담당자 결정)
  const DESSERT_SHOWN = [["명절 떡·디저트", "🎎"], ["일상 디저트 chè", "🍧"], ["카페 문화", "☕"], ["당 줄이기 흐름", "🥤"]];
  const dessertByTitle = new Map((d.dessert_culture || []).map(g => [g.title, g]));
  const dessertGroups = DESSERT_SHOWN.filter(([title]) => dessertByTitle.has(title)).map(([title, emoji]) => {
    const g = dessertByTitle.get(title);
    return `
    <article class="ma-cg-group"><h3><span aria-hidden="true">${emoji}</span>${esc(g.title)}<span class="ma-cg-dim">${esc(g.as_of)} 기준</span></h3>
      <ul>${g.items.map(item => `<li>${esc(item)}</li>`).join("")}</ul></article>`;
  }).join("");

  // 넓은 화면은 2칸 배치(.ma-cg-pair), 좁은 화면은 1칸
  const pair = (left, right) => `<div class="ma-cg-pair">${left}${right}</div>`;
  view.innerHTML = `<div class="ma-cg">
    ${section("베트남 기본 정보", "", basicRow)}
    ${pair(section("디지털·SNS 이용", "광고 채널 선택 참고", `<ul class="ma-cg-stats">${facts || empty()}</ul>`),
      section("온라인 구매 채널", "판매 채널 선택 참고 · Shopee·TikTok Shop·Lazada·Tiki", ecBody))}
    ${section("디저트 소비 문화", "베트남 사람들이 디저트를 먹는 장면", `<div class="ma-cg-groups">${dessertGroups || rows(d.dessert_facts)}</div>`)}
    ${pair(section("베트남 상징물", "시즌 포장·광고 모티프 · 지역별 차이", symbolBody),
      section("선물 포장 색", "지역·세대에 따라 차이 있음", colors))}
    ${pair(section("선물 예절", "선물 세트·사은품 기획 시 확인", rows(d.gift_etiquette)), section("숫자", "가격 끝자리·입수·세트 구성 참고", numberBody))}
    ${adWarning}
  </div>`;
}

// ---------- 4. AI 인사이트 ----------

// 설계: AI 인사이트 출력 내용 설계 (2026-10-26). 입력 6개(필수 3·선택 3) → 출력 11블록, 사실 문장마다 근거 태그.
// 근거 태그·과일·타임라인 월은 서버가 정하고 검증합니다(services/insight_service.py). 결과는 저장하지 않습니다.
const INSIGHT_URL = `/market_analysis/api/insight?country=${encodeURIComponent(data.country)}`;
const insight = { options: null, form: { channels: [], fruits: [] }, result: null, loading: false, error: "" };

function renderInsight() {
  const view = page.querySelector('[data-view="insight"]');
  if (!insight.options) {
    view.innerHTML = `<p class="empty-note">AI 인사이트 입력 항목을 불러오는 중입니다.</p>`;
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
    <div class="ma-ai-form-head"><h2>AI 인사이트</h2><p>답에 따라 결과가 달라지는 것만 묻습니다. 국가·트렌드·경쟁사·문화 정보는 대시보드에서 자동으로 채웁니다.</p></div>
    <fieldset><legend>1. 이번 목표 <b>필수</b></legend>${choice("goal", o.goals, f.goal)}</fieldset>
    <fieldset><legend>2. 실행 기간 <b>필수</b></legend>${choice("period", o.periods, f.period)}</fieldset>
    <fieldset><legend>3. 주력 채널 <b>필수 · 복수 선택</b></legend>${choice("channels", o.channels, f.channels, "checkbox")}</fieldset>
    <details class="ma-ai-optional" ${f.fruits.length || f.budget || f.memo ? "open" : ""}><summary>선택 입력 (비워도 생성됨)</summary>
      <fieldset><legend>4. 생산 가능한 과일</legend>${choice("fruits", o.fruits, f.fruits, "checkbox")}
        <p class="ma-ai-hint">비우면 찹쌀떡 활용 가능 과일 전체에서 고릅니다.</p></fieldset>
      <fieldset><legend>5. 예산 규모</legend>${choice("budget", [{ id: "", label: "선택 안 함" }, ...o.budgets], f.budget || "")}</fieldset>
      <fieldset><legend>6. 추가 메모</legend><textarea name="memo" maxlength="${o.memo_max}" rows="2"
        placeholder="예: 편의점 입점 협의 중">${esc(f.memo || "")}</textarea></fieldset>
    </details>
    <div class="ma-ai-submit">
      ${o.ai_ready ? "" : `<span class="ma-ai-warn">OPENAI_API_KEY가 설정되지 않아 생성할 수 없습니다.</span>`}
      ${insight.error ? `<span class="ma-ai-warn">${esc(insight.error)}</span>` : ""}
      <button type="submit" ${o.ai_ready && !insight.loading ? "" : "disabled"}>${insight.loading ? "생성 중…" : "AI 인사이트 생성"}</button>
    </div>
  </form>`;
}

function bindInsightForm(view) {
  const form = view.querySelector('[data-ma="insight-form"]');
  const read = () => {
    const fd = new FormData(form);
    insight.form = { goal: fd.get("goal") || undefined, period: fd.get("period") || undefined,
      channels: fd.getAll("channels"), fruits: fd.getAll("fruits"), budget: fd.get("budget") || undefined,
      memo: String(fd.get("memo") || "").trim() };
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
    if (insight.result && !insight.error) openReport();  // 결과가 나오면 보고서 미리보기를 바로 엽니다
  });
}

function insightResult() {
  const out = insight.result;
  if (!out) return "";
  const input = out.input;
  return `<div class="ma-ai-result">
    <div class="ma-ai-report-bar">
      <p class="ma-ai-meta">${esc(input.goal_label)} · ${esc(input.period_label)} · ${esc(input.channel_labels.join(", "))} · 생성 ${esc(out.generated_at)} · 저장되지 않음</p>
      <button type="button" data-ma="report-open">보고서 미리보기 · PDF</button>
    </div>
    ${insightBlocks(out)}
  </div>`;
}

// 결과 9블록. 화면(insightResult)과 보고서(reportDocument)가 같이 씁니다
function insightBlocks(out) {
  const r = out.result, ev = out.evidence;
  const tags = (list) => (list || []).map((t) => ev[t]
    ? `<span class="ma-ai-tag" title="${esc(`${ev[t].source} · ${ev[t].date}\n${ev[t].text}`)}">${esc(t)}</span>` : "").join("");
  const block = (no, title, body) => `<section class="ma-ai-block"><h3><span>${no}</span>${esc(title)}</h3>${body}</section>`;
  const table = (heads, rows) => (rows.length ? `<div class="table-wrap"><table class="ma-ai-table"><thead><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : `<p class="ma-ai-none">근거 부족 · 내용 없음</p>`);
  const pct = (v) => (v === null || v === undefined ? "-" : `${v > 0 ? "+" : ""}${Number(v).toFixed(1)}%`);
  const swotCell = (key, label) => `<div class="ma-ai-swot-cell is-${key.toLowerCase()}"><h4>${key} ${label}</h4>${(r.swot[key] || []).length
    ? `<ul>${r.swot[key].map((x) => `<li>${esc(x.text)} ${tags(x.tags)}${x.response ? `<br><small>대응 · ${esc(x.response)}</small>` : ""}</li>`).join("")}</ul>`
    : `<p class="ma-ai-none">근거 부족</p>`}</div>`;
  return `
    ${block(1, "한 줄 결론", `<p class="ma-ai-conclusion">${esc(r.conclusion)}</p>`)}
    ${block(2, "핵심 인사이트", table(["사실 (근거)", "한정선에 주는 의미", "할 일"],
      r.insights.map((x) => [`${esc(x.fact)} ${tags(x.tags)}`, esc(x.meaning), esc(x.action)])))}
    ${block(3, "현지화 과일 추천", table(["순위", "과일", "근거", "제품 아이디어", "출시 시기"],
      r.fruits.map((x) => [x.rank, `<strong>${esc(x.name)}</strong>`,
        `인기 점수 ${esc(x.interest)} · 전년 대비 ${pct(x.change_rate)} · 피크 ${esc(x.peak_months.join("·"))}월 ${tags(x.tags)}${x.reason ? `<br>${esc(x.reason)}` : ""}`,
        esc(x.idea || ""), esc(x.launch)])))}
    ${block(4, "마케팅 방식", table(["방식", "내용", "근거"], r.marketing.map((x) => [`<strong>${esc(x.method)}</strong>`, esc(x.content), tags(x.tags)])))}
    ${block(5, "실행 타임라인", `<ol class="ma-ai-timeline">${r.timeline.map((x) => `<li><strong>${esc(x.label)}</strong> ${esc(x.action || "-")}</li>`).join("")}</ol>`)}
    ${block(6, "채널별 실행안", table(["채널", "메시지 한 줄", "콘텐츠·패키징"],
      r.channels.map((x) => [`<strong>${esc(x.channel)}</strong>`, esc(x.message), `${esc(x.content_packaging)} ${tags(x.tags)}`])))}
    ${block(7, "경쟁사 대비 포지셔닝", `<p>${esc(r.positioning.text)} ${tags(r.positioning.tags)}</p>`)}
    ${block(8, "SWOT 분석", `<div class="ma-ai-swot">${swotCell("S", "강점")}${swotCell("W", "약점")}${swotCell("O", "기회")}${swotCell("T", "위협")}</div>`)}
    ${block(9, "AI 종합 의견 · 근거 기반", r.opinions.length ? r.opinions.map((x) => `<div class="ma-ai-opinion"><p><b>의견</b> ${esc(x.text)}</p>
      <p class="ma-ai-sources"><b>근거</b> ${x.tags.map((t) => `${tags([t])} ${esc(ev[t].source)} (${esc(ev[t].date)})`).join(" · ")}</p></div>`).join("")
      : `<p class="ma-ai-none">근거 부족 · 의견 없음</p>`)}`;
}

// ---------- AI 인사이트 보고서 (미리보기 · PDF) ----------
// 보고서는 iframe 안의 별도 문서로 만들어 대시보드 스타일과 섞이지 않게 하고, PDF는 브라우저 인쇄(→ PDF로 저장)로 받습니다.
// 표지 그림은 공용 이미지입니다. 제품 사진은 content_studio public.py가 생기면 바꿉니다(유진 요청 중, 2026-10-26).
const REPORT_CSS = ["/platform_core/static/css/fonts.css", "/platform_core/static/css/base.css",
  "/market_analysis/static/css/insight_report.css"];
const REPORT_LOGO = "/platform_core/static/images/hanjungsun_logo_wide.png";
const REPORT_COVER = "/platform_core/static/images/inkwash_tteok.png";

function reportDocument(out) {
  const input = out.input;
  const date = String(out.generated_at || "").slice(0, 10);
  const meta = [["목표", input.goal_label], ["기간", input.period_label], ["주력 채널", input.channel_labels.join(", ")], ["생성일", date]];
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
    <title>한정선_베트남_수출_마케팅_전략_${esc(date)}</title>
    ${REPORT_CSS.map((href) => `<link rel="stylesheet" href="${href}">`).join("")}</head>
  <body class="ma-report">
    <section class="ma-report-page ma-report-cover">
      <img class="ma-report-logo" src="${REPORT_LOGO}" alt="한정선">
      <p class="ma-report-kicker">VIETNAM EXPORT MARKETING STRATEGY</p>
      <h1>한정선 베트남 수출 마케팅 전략</h1>
      <figure class="ma-report-hero"><img src="${REPORT_COVER}" alt=""></figure>
      <p class="ma-report-slogan">${esc(out.result.conclusion)}</p>
      <dl class="ma-report-meta">${meta.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
    </section>
    <section class="ma-report-page ma-report-body">${insightBlocks(out)}</section>
  </body></html>`;
}

function openReport() {
  if (!insight.result) return;
  let dialog = page.querySelector('[data-ma="report"]');
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.className = "ma-report-dialog";
    dialog.dataset.ma = "report";
    dialog.innerHTML = `
      <div class="ma-report-bar"><strong>AI 인사이트 보고서 미리보기</strong>
        <button type="button" class="ma-report-pdf" data-ma="report-pdf">PDF 저장</button>
        <button type="button" class="ma-report-close" data-ma="report-close">닫기</button></div>
      <iframe class="ma-report-frame" title="AI 인사이트 보고서"></iframe>`;
    page.append(dialog);
  }
  dialog.querySelector("iframe").srcdoc = reportDocument(insight.result);
  dialog.showModal();
}

// 인쇄 창에서 "PDF로 저장"을 고르면 파일로 받습니다(파일 이름 = 보고서 title)
function printReport() {
  const frame = page.querySelector('[data-ma="report"] iframe');
  frame?.contentWindow?.focus();
  frame?.contentWindow?.print();
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
  renderCountryBar();
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
  if (d.ma === "report-open") return openReport();
  if (d.ma === "report-pdf") return printReport();
  if (d.ma === "report-close") return page.querySelector('[data-ma="report"]').close();
  if (d.ma === "detail-close") page.querySelector('[data-ma="detail"]').close();
});

page.addEventListener("change", (event) => {
  const el = event.target;
  if (el.matches("[data-rising]")) { state.risingKey = el.value; renderTrend(); }
  if (el.matches("[data-origin]")) { state.origin = el.value; state.page = 1; renderCompetitor(); }
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
