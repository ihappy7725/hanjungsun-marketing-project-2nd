// 현지 시장 분석 화면 스크립트 [상준]
// type="module"로 불러오므로 전역 변수·함수가 생기지 않습니다. (README 7장)
// 서버(routes.py)가 넣어 준 실제 데이터만 그립니다. 값이 없으면 만들지 않고 "수집 전"으로 표시합니다.

const page = document.querySelector(".market-analysis-page");
const data = JSON.parse(page.querySelector('[data-ma="dashboard"]').textContent);
const country = data.countries.find((c) => c.code === data.country) || data.countries[0];
const DANANG = /da\s*nang|đà\s*nẵng|다낭/i;
const MONTHS = ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"];
const PAGE_SIZE = 8;

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
  sort: "sales",
  page: 1,
};

// ---------- 공통 조각 ----------

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const num = (value, digits = 0) =>
  value === null || value === undefined || value === "" ? "—"
    : Number(value).toLocaleString("ko-KR", { maximumFractionDigits: digits });

const vnd = (value) => (value === null || value === undefined ? "—" : `${num(value)} ₫`);

const pct = (value) =>
  value === null || value === undefined ? "—" : `${value > 0 ? "+" : ""}${num(value, 1)}%`;

const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

function panel({ eyebrow, title, body, head = "", wide = false }) {
  return `
    <article class="panel${wide ? " ma-wide" : ""}">
      <div class="panelhead">
        <div><p class="eyebrow">${esc(eyebrow)}</p><h2>${esc(title)}</h2></div>
        ${head}
      </div>
      ${body}
    </article>`;
}

function sourceLine({ source, asOf, asOfLabel = "기준일", region }) {
  return `
    <p class="footnote ma-source">
      <span class="badge green">실제 데이터</span>
      출처 ${esc(source)} · ${esc(asOfLabel)} ${esc(asOf || "—")} · 지역 ${esc(region || "표시 없음")}
    </p>`;
}

function empty(files, note = "") {
  const list = [].concat(files).map((f) => `<code>${esc(f)}</code>`).join("");
  return `
    <div class="ma-empty">
      <span class="badge">수집 전</span>
      <p>데이터 없음 · 아래 파일을 넣으면 표시됩니다.</p>
      <div class="ma-files">${list}</div>
      ${note ? `<p class="ma-empty-note">${esc(note)}</p>` : ""}
    </div>`;
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

const STAR = '<svg class="ma-star" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg>';

// ---------- 국가 선택 바 ----------

function renderCountryBar() {
  page.querySelector('[data-ma="country-chips"]').innerHTML = data.countries
    .map((c) => `<a class="ma-chip${c.code === data.country ? " is-active" : ""}" href="?country=${esc(c.code)}&tab=${esc(state.tab)}">${esc(c.name)}</a>`)
    .join("");
  const items = data.competitors.items;
  page.querySelector('[data-ma="country-info"]').innerHTML = `
    <div><dt>언어 · 통화</dt><dd>${esc(country.language)} · ${esc(country.currency || "—")}</dd></div>
    <div><dt>우선 도시</dt><dd>${esc(country.city)}</dd></div>
    <div><dt>수집한 경쟁 제품</dt><dd>${items.length ? `${items.length}개` : "수집 전"}</dd></div>
    <div><dt>핵심 경쟁사 ★</dt><dd>${items.length ? `${items.filter((i) => i.is_core).length}개` : "수집 전"}</dd></div>`;
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
      ${panel({ eyebrow: "CATEGORY INTEREST", title: "카테고리 관심도 추이", head: periodButtons, body: categoryBody() })}
      ${panel({ eyebrow: "RISING SEARCHES", title: "급상승 검색 키워드", head: risingSelect(), body: risingBody() })}
    </div>
    <div class="grid section-space">
      ${panel({ eyebrow: "SEASONALITY", title: "월별 검색 계절성", body: seasonalityBody() })}
      ${panel({ eyebrow: "FRUIT FLAVOR", title: "현지 과일 맛 트렌드", body: fruitBody() })}
    </div>
    <div class="section-space">
      ${panel({ eyebrow: "REGIONAL INTEREST", title: "지역별 관심도", head: geoButtons(), body: geoBody(), wide: true })}
    </div>
    <p class="statusline">관심도는 Google Trends 상대 지수(0~100)이며 실제 검색 횟수가 아닙니다. 저장 위치: <code>${esc(t.folder)}/</code></p>`;
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
  const key = state.sort === "sales" ? "monthly_sales" : "unit_price_vnd";
  const dir = state.sort === "price_asc" ? 1 : -1;
  // 값이 비어 있는 제품은 정렬 방향과 관계없이 맨 아래로 보냅니다
  return rows.sort((a, b) => (a[key] === null) - (b[key] === null) || (a[key] - b[key]) * dir);
}

function renderCompetitor() {
  const c = data.competitors;
  const view = page.querySelector('[data-view="competitor"]');
  if (!c.items.length) {
    view.innerHTML = panel({
      eyebrow: "COMPETITOR PRODUCTS", title: "경쟁 제품", wide: true,
      body: empty(c.file, "Shopee · Lazada · TikTok Shop 판매량순 상위 20~30개를 월 1회 조사해 이 파일에 한 줄씩 적습니다. 엑셀에서는 'CSV UTF-8'로 저장합니다."),
    }) + `<p class="statusline">열 이름: <code>${esc(c.columns.join(", "))}</code></p>`;
    return;
  }

  const unitPrices = c.items.map((i) => i.unit_price_vnd).filter((v) => v !== null);
  const segments = [...new Set(c.items.map((i) => i.segment).filter(Boolean))];
  const origins = [...new Set(c.items.map((i) => i.origin).filter(Boolean))];
  const rows = filteredCompetitors();
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  state.page = Math.min(state.page, pages);
  const shown = rows.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);

  const segmentButtons = [{ key: "", label: "전체", items: c.items }]
    .concat(segments.map((s) => ({ key: s, label: s, items: c.items.filter((i) => i.segment === s) })))
    .map((s) => {
      const avg = mean(s.items.map((i) => i.unit_price_vnd).filter((v) => v !== null));
      return `<button type="button" class="ma-segment${state.segment === s.key ? " is-active" : ""}" data-segment="${esc(s.key)}">
        <b>${esc(s.label)}</b><small>${s.items.length}개 · 개당 ${vnd(avg === null ? null : Math.round(avg))}</small></button>`;
    }).join("");

  view.innerHTML = `
    <div class="kpis ma-kpis3">
      <div class="kpi"><div class="label">수집한 경쟁 제품 <span>${esc(c.as_of || "")}</span></div><div class="value">${c.items.length}<small>개</small></div></div>
      <div class="kpi"><div class="label">핵심 경쟁사 ★</div><div class="value">${c.items.filter((i) => i.is_core).length}<small>개</small></div></div>
      <div class="kpi"><div class="label">평균 개당 가격</div><div class="value">${unitPrices.length ? num(Math.round(mean(unitPrices))) : "—"}<small>₫</small></div></div>
    </div>
    <div class="ma-segments">${segmentButtons}</div>
    ${panel({
      eyebrow: "COMPETITOR PRODUCTS", title: "경쟁 제품 목록", wide: true,
      head: `
        <div class="ma-toolbar">
          <input type="search" data-search placeholder="브랜드 · 제품 검색" value="${esc(state.search)}" aria-label="검색">
          <select data-origin aria-label="원산지"><option value="">원산지 전체</option>${origins.map((o) => `<option${o === state.origin ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>
          <label class="ma-check"><input type="checkbox" data-core${state.coreOnly ? " checked" : ""}> ★ 핵심만</label>
          <select data-sort aria-label="정렬">
            <option value="sales"${state.sort === "sales" ? " selected" : ""}>월 판매량순</option>
            <option value="price_desc"${state.sort === "price_desc" ? " selected" : ""}>개당 가격 높은 순</option>
            <option value="price_asc"${state.sort === "price_asc" ? " selected" : ""}>개당 가격 낮은 순</option>
          </select>
        </div>`,
      body: `
        <div class="table-wrap"><table class="ma-table">
          <thead><tr><th>핵심</th><th>브랜드 · 제품</th><th>세그먼트</th><th>원산지</th><th>구성</th><th>판매가</th><th>개당 가격</th><th>월 판매량(추정)</th></tr></thead>
          <tbody>${shown.map((i) => `
            <tr>
              <td class="${i.is_core ? "is-core" : ""}" title="${i.is_core ? "핵심 경쟁사" : ""}">${STAR}</td>
              <td><button type="button" class="linkbtn ma-product" data-detail="${esc(c.items.indexOf(i))}"><strong>${esc(i.brand)}</strong><small lang="vi">${esc(i.product)}</small></button></td>
              <td>${esc(i.segment || "—")}</td>
              <td>${esc(i.origin || "—")}</td>
              <td>${i.pack_count ? `${num(i.pack_count)}입` : "—"}${i.unit_weight_g ? ` · ${num(i.unit_weight_g)}g` : ""}</td>
              <td>${vnd(i.price_vnd)}</td>
              <td>${vnd(i.unit_price_vnd)}</td>
              <td>${num(i.monthly_sales)}</td>
            </tr>`).join("") || '<tr><td colspan="8">조건에 맞는 제품이 없습니다.</td></tr>'}</tbody>
        </table></div>
        <div class="ma-pager">
          <button type="button" class="btn" data-page="${state.page - 1}"${state.page <= 1 ? " disabled" : ""}>이전</button>
          <span>${state.page} / ${pages} · ${rows.length}개</span>
          <button type="button" class="btn" data-page="${state.page + 1}"${state.page >= pages ? " disabled" : ""}>다음</button>
        </div>
        ${sourceLine({ source: "이커머스 · 매장 수동 조사", asOf: c.as_of, asOfLabel: "최근 조사일", region: "제품별 region 열 (이커머스 = 베트남 전국)" })}`,
    })}`;
}

function openDetail(index) {
  const i = data.competitors.items[index];
  if (!i) return;
  const dialog = page.querySelector('[data-ma="detail"]');
  const info = [
    ["세그먼트", i.segment], ["원산지", i.origin],
    ["구성", i.pack_count ? `${num(i.pack_count)}입${i.unit_weight_g ? ` · ${num(i.unit_weight_g)}g` : ""}` : ""],
    ["판매가", vnd(i.price_vnd)], ["개당 가격", vnd(i.unit_price_vnd)], ["월 판매량(추정)", num(i.monthly_sales)],
  ];
  const marketing = data.competitors.marketing_labels
    .map(([key, label]) => `<div><dt>${esc(label)}</dt><dd>${esc(i[key] || "기록 없음")}</dd></div>`).join("");
  const history = i.history.filter((h) => h.monthly_sales !== null);
  const maxSales = Math.max(...history.map((h) => h.monthly_sales), 1);
  page.querySelector('[data-ma="detail-body"]').innerHTML = `
    <p class="eyebrow">${i.is_core ? "★ 핵심 경쟁사" : "COMPETITOR"}</p>
    <h2>${esc(i.brand)} <small lang="vi">${esc(i.product)}</small></h2>
    <dl class="ma-info">${info.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v || "—")}</dd></div>`).join("")}</dl>
    <h3>마케팅 기법</h3>
    <dl class="ma-info">${marketing}</dl>
    <h3>월별 판매 추이 (추정)</h3>
    ${history.length >= 2
      ? bars(history.map((h) => ({ key: h.surveyed_at, label: h.surveyed_at, value: h.monthly_sales, text: num(h.monthly_sales) })), { max: maxSales })
      : '<p class="statusline">같은 제품을 두 달 이상 조사하면 표시됩니다.</p>'}
    <dl class="ma-info">
      <div><dt>입점 채널</dt><dd>${esc(i.channels || "—")}</dd></div>
      <div><dt>소비자 반응 (리뷰 키워드)</dt><dd lang="vi">${esc(i.review_keywords || "—")}</dd></div>
      <div><dt>한정선이 참고할 점</dt><dd>${esc(i.takeaway || "—")}</dd></div>
      <div><dt>한정선 가정 가격 비교</dt><dd>가정 가격 확정 전</dd></div>
    </dl>
    <p class="footnote">출처 ${i.source_url ? `<a href="${esc(i.source_url)}" target="_blank" rel="noopener">${esc(i.source_url)}</a>` : "—"} · 조사일 ${esc(i.surveyed_at || "—")} · 지역 ${esc(i.region || "—")}</p>`;
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

function renderCulture() {
  const { basic, basic_file: basicFile, guidelines = {}, guidelines_file: gFile } = data.culture;
  const g = guidelines || {};
  const rec = g.recommended || {};
  const view = page.querySelector('[data-view="culture"]');

  const basicBody = basic
    ? `
      <dl class="ma-info">
        <div><dt>언어</dt><dd>${esc(country.language)}</dd></div>
        <div><dt>시간대</dt><dd>${esc(country.timezone)}</dd></div>
        <div><dt>통화</dt><dd>${esc(country.currency || "—")}</dd></div>
        ${basic.indicators.map((x) => `<div><dt>${esc(x.label)} <small>${esc(x.year)}년</small></dt><dd>${num(x.value, x.unit === "%" ? 1 : 0)} <small>${esc(x.unit)}</small></dd></div>`).join("")}
        <div><dt>종교</dt><dd><span class="badge">수집 전</span></dd></div>
      </dl>
      ${sourceLine({ source: `${basic.source.publisher} (${basic.indicators.map((x) => x.source_indicator).join(" · ")})`, asOf: basic.checked_at, asOfLabel: "조회일", region: basic.region_scope })}`
    : empty(basicFile);

  const avoid = (g.avoid_expressions || []).map((r) => ({
    name: `${r.category || ""} · ${(r.keywords?.vi || r.keywords?.ko || []).join(", ")}`,
    reason: r.reason,
    severity: r.severity,
  }));
  const cautions = avoid.concat((g.visual_cautions || []).map((v) => ({ name: v.rule, severity: v.severity })));
  const cautionBody = cautions.length
    ? `<ul class="ma-list">${cautions.map((c) => `<li><span class="badge ${c.severity === "block" ? "red" : ""}">${c.severity === "block" ? "쓰지 않음" : "주의"}</span> ${labelOf(c)}</li>`).join("")}</ul>`
    : empty(gFile, "avoid_expressions · visual_cautions 항목을 출처와 함께 채웁니다.");

  const numbers = rec.numbers || {};
  const numberBody = (numbers.lucky?.length || numbers.avoid?.length)
    ? `<dl class="ma-info"><div><dt>길수</dt><dd>${esc((numbers.lucky || []).join(", ") || "—")}</dd></div><div><dt>주의</dt><dd>${esc((numbers.avoid || []).join(", ") || "—")}</dd></div></dl>${numbers.note ? `<p class="statusline">${esc(numbers.note)}</p>` : ""}`
    : "";

  const status = g.status
    ? `<p class="empty-note">문화 가이드라인 상태: <b>${g.status === "confirmed" ? "확정" : "초안"}</b> · 검토일 ${esc(g.reviewed_at || "—")} · 지역 ${esc(g.region_scope || "표시 없음")} · ${esc(g.disclaimer || "")}</p>`
    : "";
  const noSource = (note) => empty("저장 위치 확정 전 (README 7장 market_analysis_culture)", note);

  view.innerHTML = `
    ${status}
    <div class="grid">
      ${panel({ eyebrow: "COUNTRY PROFILE", title: "기본 정보", body: basicBody })}
      ${panel({ eyebrow: "CULTURAL CAUTIONS", title: "문화적 금기 · 주의사항", body: cautionBody })}
    </div>
    <div class="grid section-space">
      ${panel({ eyebrow: "COLOR SYMBOLISM", title: "컬러 상징 · 패키징 색", body: (rec.colors?.length || rec.avoid_colors?.length)
        ? `<h3>권장</h3>${listOrEmpty(rec.colors, gFile)}<h3>주의</h3>${listOrEmpty(rec.avoid_colors, gFile)}`
        : empty(gFile, "recommended.colors · avoid_colors 항목을 채웁니다.") })}
      ${panel({ eyebrow: "SYMBOLS & NUMBERS", title: "상징물 · 숫자", body: (rec.motifs?.length || numberBody)
        ? `${rec.motifs?.length ? `<h3>상징물</h3>${listOrEmpty(rec.motifs, gFile)}` : ""}${numberBody}`
        : empty(gFile, "recommended.motifs · numbers 항목을 채웁니다.") })}
    </div>
    <div class="ma-three section-space">
      ${panel({ eyebrow: "PACKAGING", title: "선호 패키징", body: noSource("출처 있는 참고 자료(KOTRA 등)로 작성한 뒤 연결합니다.") })}
      ${panel({ eyebrow: "CLIMATE & LOGISTICS", title: "기후 · 유통 환경", body: noSource("기후·배송 환경 자료를 출처와 함께 작성한 뒤 연결합니다.") })}
      ${panel({ eyebrow: "FUNCTIONAL PACKAGING", title: "기후 맞춤형 기능성 포장", body: noSource("포장 기술 자료를 출처와 함께 작성한 뒤 연결합니다.") })}
    </div>
    <p class="statusline">연휴 · 기념일 · 과일 시즌 캘린더는 HOME에서 표시합니다.</p>`;
}

// ---------- 4. AI 인사이트 ----------

function renderInsight() {
  const view = page.querySelector('[data-view="insight"]');
  view.innerHTML = `
    <p class="empty-note">AI 인사이트는 준비 중입니다. AI 제공사 · 키 이름 · 입력 항목이 팀에서 확정되면 연결합니다. (README 6 · 10장)</p>
    ${panel({
      eyebrow: "DATA READINESS", title: "AI에 넘길 데이터 준비 상태", wide: true,
      body: `
        <div class="table-wrap"><table>
          <thead><tr><th>데이터</th><th>상태</th><th>준비</th><th>저장 위치</th></tr></thead>
          <tbody>${data.readiness.map((r) => `
            <tr>
              <td><strong>${esc(r.label)}</strong></td>
              <td><span class="badge ${r.ready ? "green" : ""}">${r.ready ? "준비됨" : "수집 전"}</span></td>
              <td>${r.total === null ? `${r.ready}개` : `${r.ready} / ${r.total}`}</td>
              <td><code>${esc(r.where)}</code></td>
            </tr>`).join("")}</tbody>
        </table></div>
        <p class="statusline">AI는 위 실제 데이터만 근거로 사용하도록 서버(routes.py)에서 모아 넘길 예정입니다.</p>`,
    })}`;
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
