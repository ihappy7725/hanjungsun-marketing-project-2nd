// 트렌드 분석 화면. 내부 API만 호출하며 외부 API 키를 다루지 않습니다.
const API_URL = document.querySelector("[data-trends-api]")?.dataset.trendsApi;
const STATUS_TEXT = { fresh: "최신", partial: "일부 데이터 부족", delayed: "갱신 지연", empty: "수집 전" };
const ITEM_STATUS_TEXT = { normal: "정상", insufficient: "데이터 부족", empty: "수집 전" };
const COLLECT_HINT = "";

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const num = (v) => (v === null || v === undefined ? "-" : Number(v).toFixed(1));
const rate = (v) => (v === null || v === undefined ? "-" : `${v > 0 ? "+" : ""}${Number(v).toFixed(1)}%`);
const rateClass = (v) => (v === null || v === undefined ? "" : v >= 0 ? "rate-up" : "rate-down");
// 기본 지표: 전년 동기 대비. 1년 전 검색이 없었으면 "신규"
const yoy = (row) => (row.is_new ? `<span class="rate-new">신규</span>`
  : `<span class="${rateClass(row.change_rate)}">${rate(row.change_rate)}</span>`);
// 보조 지표: 최근 4주 vs 직전 4주
const shortTerm = (row) => `<small class="short-rate">4주 ${rate(row.short_change_rate)}</small>`;
const day = (v) => (v ? String(v).slice(0, 10) : "-");
const badge = (status) => `<span class="item-status" data-status="${esc(status)}">${esc(ITEM_STATUS_TEXT[status] || status)}</span>`;
const emptyState = (message, command = COLLECT_HINT) =>
  `<div class="empty-data-state compact-empty"><span class="data-status">수집 전</span><p>${esc(message)}</p>${command ? `<code>${esc(command)}</code>` : ""}</div>`;

let dashboard = null;
let selectedId = null;

async function load() {
  try {
    const response = await fetch(API_URL);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "load failed");
    dashboard = data;
    selectedId = data.categories[0]?.id;
    render();
  } catch (error) {
    $("error").hidden = false;
  } finally {
    $("loading").hidden = true;
  }
}

function render() {
  $("dashboard").hidden = false;
  renderNotices();
  renderPicker();
  renderSelected();
  renderCategoryTrend();
  renderFruit();
  renderSeasonality();
  renderRegions();
  renderAds();
  $("source-line").textContent =
    `출처: ${dashboard.source.search} · ${dashboard.source.ads} · 마지막 확인 ${day(dashboard.checked_at)}`;
}

function renderNotices() {
  const notices = [];
  if (dashboard.data_status === "empty") {
    notices.push(["info", `아직 수집된 검색 데이터가 없습니다. 데이터 담당자의 갱신 후 확인해 주세요.`]);
  }
  if (dashboard.data_status === "delayed") {
    notices.push(["warn", "최근 데이터 갱신이 지연되고 있습니다. 마지막 확인일을 확인해 주세요."]);
  }
  const failed = Object.entries(dashboard.sections).filter(([, s]) => s.error);
  if (failed.length) {
    notices.push(["warn", `최근 수집에 실패한 영역이 있어 마지막 정상 데이터를 표시합니다: ${failed.map(([name]) => name).join(", ")}`]);
  }
  $("notices").innerHTML = notices.map(([kind, text]) => `<div class="notice trend-notice ${kind}">${esc(text)}</div>`).join("");
}

function renderPicker() {
  $("category-picker").innerHTML = `<span class="picker-label">카테고리 선택 · 상품 순위에 적용</span>`
    + dashboard.categories.map((category) => `
    <button type="button" data-id="${esc(category.id)}" aria-pressed="${category.id === selectedId}">${esc(category.label)}</button>`).join("");
  $("category-picker").querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => selectCategory(button.dataset.id));
  });
}

function selectCategory(id) {
  selectedId = id;
  $("category-picker").querySelectorAll("button").forEach((item) =>
    item.setAttribute("aria-pressed", String(item.dataset.id === id)));
  renderSelected();
  renderCategoryTrend();
}

function selectedCategory() {
  return dashboard.categories.find((category) => category.id === selectedId);
}

function renderSelected() {
  const category = selectedCategory();
  renderRanking(category);
}

const RANK_LIMIT = 5;

function rankBadges(row) {
  return [row.is_new ? `<span class="rate-new">신규</span>` : "",
    row.is_rising ? `<span class="rate-rising">급상승</span>` : ""].join("");
}

function renderRanking(category) {
  if (!category.ranking.length) {
    $("ranking").innerHTML = emptyState(`${category.label} 상품 검색어 데이터가 아직 없습니다.`);
    return;
  }
  // 순위(관심도 5 이상)가 5개 미만이면 순위에서 뺀 상품을 관심도 높은 순으로 "참고" 줄에 채웁니다.
  // 참고 줄은 순위 번호·전년 대비를 붙이지 않아 실제 순위처럼 보이지 않게 합니다.
  const ranked = category.ranking.filter((row) => row.rank !== null).sort((a, b) => a.rank - b.rank).slice(0, RANK_LIMIT);
  const unranked = category.ranking.filter((row) => row.rank === null)
    .sort((a, b) => (b.recent_average ?? -1) - (a.recent_average ?? -1));
  const reference = unranked.slice(0, RANK_LIMIT - ranked.length);
  const excluded = unranked.length - reference.length;
  const footnote = `<p class="source">확인일 ${day(category.ranking[0].checked_at)} · 같은 기준 검색어로 맞춘 상대 관심도 · 급상승 = 전년 동기 대비 +50% 이상${
    reference.length ? " · 참고 = 관심도 5 미만이거나 데이터가 부족해 순위에서 뺀 상품" : ""}${excluded ? ` · 그 외 ${excluded}개 제외` : ""}</p>`;
  if (!ranked.length && !reference.length) {
    $("ranking").innerHTML = emptyState(`${category.label} 상품 중 순위를 매길 만큼 관심도가 있는 검색어가 없습니다.`) + footnote + risingRow(category);
    return;
  }
  const referenceLabel = (row) => (row.recent_average !== null && row.recent_average < 5 ? "참고 · 검색 적음" : "참고 · 데이터 부족");
  $("ranking").innerHTML = `
    <div class="table-wrap"><table class="trend-table">
      <caption class="visually-hidden">${esc(category.label)} 상품 관심도 상위 ${RANK_LIMIT}개</caption>
      <thead><tr><th scope="col" class="nowrap">순위</th><th scope="col">상품명 · 검색어</th><th scope="col" class="num">최근 12주<br>평균 관심도</th>
        <th scope="col" class="num">전년 동기<br>대비</th></tr></thead>
      <tbody>${ranked.map((row) => `
        <tr>
          <td class="rank">${row.rank}</td>
          <td><strong>${esc(row.name)}</strong> ${rankBadges(row)}<small lang="vi">${esc(row.query)}</small></td>
          <td class="num">${num(row.recent_average)}</td>
          <td class="num">${yoy(row) + shortTerm(row)}</td>
        </tr>`).join("")}${reference.map((row) => `
        <tr class="is-reference">
          <td class="rank">·</td>
          <td><strong>${esc(row.name)}</strong> <span class="ref-badge">${referenceLabel(row)}</span><small lang="vi">${esc(row.query)}</small></td>
          <td class="num">${num(row.recent_average)}</td>
          <td class="num">-</td>
        </tr>`).join("")}</tbody>
    </table></div>
    ${ranked.length + reference.length < RANK_LIMIT ? `<p class="inline-warn">비교한 상품 후보가 ${ranked.length + reference.length}개라 ${ranked.length + reference.length}개만 표시합니다.</p>` : ""}
    ${risingRow(category)}
    ${footnote}
    ${category.ranking_source_url ? `<a class="source-link" href="${esc(category.ranking_source_url)}" target="_blank" rel="noopener">Google Trends에서 비교 조건 확인 ↗</a>` : ""}`;
}

// 연관 검색어(급상승) 중 상품 검색어. 순위 후보에 없는 새 트렌드를 발견하는 용도이며, 없으면 줄을 숨깁니다.
function risingRow(category) {
  const rows = category.rising_products || [];
  if (!rows.length) return "";
  // Google은 신규 급상승을 "Breakout" 또는 베트남어 "Đột phá"로 표시합니다.
  const value = (v) => (["breakout", "đột phá"].includes(String(v).toLowerCase()) ? "급상승" : esc(v));
  return `<div class="rising-row"><span class="rising-label">새로 뜨는 검색어</span>${rows.map((row) =>
    `<span class="chip"><span lang="vi">${esc(row.query)}</span> <b>${value(row.value)}</b></span>`).join("")}
    <small>연관 검색어 · 확인일 ${day(category.related_checked_at)}</small></div>`;
}

function sparkline(series) {
  const width = 200, height = 40, values = series.map((p) => p.interest).filter((v) => v !== null);
  if (!values.length) return "";
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const x = (i) => (series.length === 1 ? 0 : (i / (series.length - 1)) * width);
  const y = (v) => height - 3 - ((v - min) / span) * (height - 6);
  let d = "", pen = false;
  series.forEach((point, i) => {
    if (point.interest === null) { pen = false; return; }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(point.interest).toFixed(1)}`;
    pen = true;
  });
  return `<svg class="sparkline" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}"></path></svg>`;
}

function renderCategoryTrend() {
  const categories = dashboard.categories;
  if (!categories.some((category) => category.series.length)) {
    $("category-trend").innerHTML = emptyState("대표 검색어 관심도 데이터가 아직 없습니다.");
    return;
  }
  $("category-trend").innerHTML = `
    <ul class="spark-rows">${categories.map((category) => {
      const lastYear = category.series.slice(-52);
      return `
      <li><button type="button" class="spark-row ${category.id === selectedId ? "selected" : ""}" data-id="${esc(category.id)}"
          aria-pressed="${category.id === selectedId}"
          title="최근 12주 평균 ${num(category.recent_average)} · 1년 전 같은 12주 평균 ${num(category.year_ago_average)} · 최근 4주 vs 직전 4주 ${rate(category.short_change_rate)}">
        <span class="spark-label"><strong>${esc(category.label)}</strong></span>
        ${sparkline(lastYear)}
        <span class="spark-value">${num(category.recent_average)}</span>
        <span class="spark-rate">${category.data_status === "insufficient" ? badge("insufficient")
          : yoy(category) + shortTerm(category)}</span>
      </button></li>`;
    }).join("")}
    </ul>
    <p class="source">숫자 = 최근 12주 평균 관심도 · 증감률 = 전년 동기(1년 전 같은 12주) 대비 · 4주 = 최근 4주 vs 직전 4주<br>
      선 = 최근 52주 주간 관심도(줄마다 자체 눈금) · 
출처: SerpApi Google Trends · 확인일 ${day(categories[0].checked_at)}
      ${categories[0].source_url ? ` · <a href="${esc(categories[0].source_url)}" target="_blank" rel="noopener">원본 비교 ↗</a>` : ""}</p>`;
  $("category-trend").querySelectorAll(".spark-row").forEach((button) => {
    button.addEventListener("click", () => selectCategory(button.dataset.id));
  });
}

function barRows(rows, { label, sub, value, extra = () => "", max = 100 }) {
  return `<ol class="bar-rows">${rows.map((row) => `
    <li class="${row.data_status === "insufficient" ? "is-insufficient" : ""}">
      <span class="bar-rank">${row.rank ?? "-"}</span>
      <span class="bar-label">${esc(label(row))}${sub ? `<small lang="vi">${esc(sub(row))}</small>` : ""}</span>
      <span class="bar-value">${num(value(row))}</span>
      <span class="bar-track" title="${esc(label(row))}: ${num(value(row))}"><span class="bar-fill" style="width:${Math.max(0, Math.min(100, ((value(row) ?? 0) / max) * 100))}%"></span></span>
      <span class="bar-extra">${extra(row)}</span>
    </li>`).join("")}</ol>`;
}

const LIST_LIMIT = 5;
const expanded = { "fruit-flavors": false, regions: false };
const visibleRows = (id, rows) => (expanded[id] ? rows : rows.slice(0, LIST_LIMIT));

// 목록은 LIST_LIMIT개까지 보여 주고 나머지는 더보기로 펼칩니다. 버튼·설명은 카드 하단(.list-foot)에 붙습니다.
function renderExpandable(id, total, list, note, rerender, head = "") {
  const hidden = total - LIST_LIMIT;
  $(id).innerHTML = `${head}<div class="list-body">${list}</div>
    <div class="list-foot">${hidden > 0
      ? `<button type="button" class="more-toggle" aria-expanded="${expanded[id]}">${expanded[id] ? "접기" : `더보기 (${hidden}개)`}</button>` : ""}${note}</div>`;
  $(id).querySelector(".more-toggle")?.addEventListener("click", () => {
    expanded[id] = !expanded[id];
    rerender();
  });
}

function renderFruit() {
  const rows = dashboard.fruit_flavors;
  if (!rows.length) {
    $("fruit-flavors").innerHTML = emptyState("과일 검색어 데이터가 아직 없습니다.");
    return;
  }
  const max = Math.max(1, ...rows.map((row) => row.recent_average ?? 0));
  renderExpandable("fruit-flavors", rows.length, barRows(visibleRows("fruit-flavors", rows), {
    label: (row) => row.name,
    sub: (row) => row.query,
    value: (row) => row.recent_average,
    max,
    extra: (row) => row.data_status === "insufficient" ? badge(row.data_status) : "",
  }), "", renderFruit);
}

let seasonTabId = null;

function renderSeasonality() {
  const tabs = dashboard.seasonality;
  if (!tabs.length) {
    $("seasonality").innerHTML = emptyState("최근 12개월 이상 데이터가 아직 없습니다.", `${COLLECT_HINT} --sections seasonality`);
    return;
  }
  if (!tabs.some((tab) => tab.id === seasonTabId)) seasonTabId = tabs[0].id;
  const tab = tabs.find((item) => item.id === seasonTabId);
  $("seasonality").innerHTML = `
    <div class="season-tabs" role="group" aria-label="계절성 주제">${tabs.map((item) => `
      <button type="button" data-id="${esc(item.id)}" aria-pressed="${item.id === tab.id}">${esc(item.label)}</button>`).join("")}
    </div>
    ${tab.data_status === "insufficient" ? `<p class="inline-warn">${badge("insufficient")} 12개월 미만이거나 비어 있는 달이 있습니다.</p>` : ""}
    ${tab.type === "fruits" ? fruitCalendar(tab) : monthBars(tab)}
    <p class="source">출처: SerpApi Google Trends · 최근 5년 월평균 관심도(가장 높은 달 = 100) ·
      ${esc(day(tab.span?.start))} ~ ${esc(day(tab.span?.end))} · 확인일 ${day(tab.checked_at)}
      ${tab.source_url ? ` · <a href="${esc(tab.source_url)}" target="_blank" rel="noopener">원본 ↗</a>` : ""}</p>`;
  $("seasonality").querySelectorAll(".season-tabs button[data-id]").forEach((button) => {
    button.addEventListener("click", () => { seasonTabId = button.dataset.id; renderSeasonality(); });
  });
  $("seasonality").querySelectorAll(".fruit-picker button").forEach((button) => {
    button.addEventListener("click", () => { fruitId = button.dataset.fruit; renderSeasonality(); });
  });
}

function monthBars(tab, peakText = PEAK_TEXT) {
  const peaks = tab.year_round ? [] : tab.peak_months;
  return `
    <div class="month-chart" role="img" aria-label="${esc(tab.label)} 월별 관심도 지수, 피크 ${peaks.map((m) => `${m}월`).join(", ")}">
      ${tab.months.map((m) => `
        <div class="month-bar ${peaks.includes(m.month) ? "peak" : ""}" title="${m.month}월: 지수 ${m.index ?? "-"} (평균 관심도 ${num(m.interest)})">
          <span class="month-value">${m.index ?? "-"}</span>
          <span class="month-fill" style="height:${m.index ?? 0}%"></span>
          <small>${m.month}월</small>
        </div>`).join("")}
    </div>
    ${tab.year_round
      ? `<div class="season-callout">"${esc(tab.label)}": <strong>연중 고른 수요</strong>
      <small>검색어 <span lang="vi">${esc(tab.query)}</span> · 모든 달 지수 80 이상이라 특정 시기를 타지 않습니다</small></div>`
      : `<div class="season-callout">"${esc(tab.label)}" 검색 피크: <strong>${peaks.map((m) => `${m}월`).join(", ")}</strong>
      <small>검색어 <span lang="vi">${esc(tab.query)}</span> · 지수 ${peakText}</small></div>`}`;
}

const PEAK_TEXT = "90 이상인 달(최대 3개)";

let fruitId = null;

// 과일 하나를 골라 다른 계절성 탭과 같은 월별 막대로 보여 줍니다.
// 칩은 피크가 빠른 달 순서이고, 연중 고른 수요·데이터 부족 과일은 맨 뒤에 둡니다.
function fruitCalendar(tab) {
  const firstPeak = (fruit) => (fruit.year_round || fruit.data_status !== "normal" ? 13 : Math.min(...fruit.peak_months));
  const fruits = [...tab.fruits].sort((a, b) => firstPeak(a) - firstPeak(b));
  if (!fruits.some((fruit) => fruit.id === fruitId)) fruitId = fruits[0].id;
  const fruit = fruits.find((item) => item.id === fruitId);
  return `
    <div class="season-tabs fruit-picker" role="group" aria-label="과일 선택">${fruits.map((item) => `
      <button type="button" data-fruit="${esc(item.id)}" aria-pressed="${item.id === fruit.id}">${esc(item.name)}</button>`).join("")}
    </div>
    ${fruit.data_status !== "normal" ? `<p class="inline-warn">${badge("insufficient")} ${esc(fruit.name)}은(는) 12개월 미만이거나 비어 있는 달이 있습니다.</p>` : ""}
    ${monthBars({ ...fruit, label: fruit.name }, "90 이상인 달(최대 2개) · 과일마다 가장 높은 달 = 100이라 과일끼리 인기 비교는 아님")}`;
}

// 지역 카드는 카테고리 종합(디저트 전체)만 보여 줍니다. 카테고리별 지역 데이터(regions_by_category)는 응답에 남아 있습니다.
function renderRegions() {
  const rows = dashboard.regions;
  if (!rows.length) {
    $("regions").innerHTML = emptyState("지역별 관심도 데이터가 아직 없습니다.", `${COLLECT_HINT} --sections regions`);
    return;
  }
  const labels = Object.fromEntries(dashboard.categories.map((item) => [item.id, item.label]));
  const breakdown = (row) => Object.entries(row.categories || {})
    .map(([id, value]) => `${esc(labels[id] || id)} ${num(value)}`).join(" · ");
  const checked = `상위 10개 지역 · 확인일 ${day(rows[0].checked_at)}`;
  let note;
  if (rows[0].combined) {
    // 검색 규모 가중 평균(추정치). 카테고리 검색 규모가 없으면 서버가 같은 비중으로 계산하고 method="equal"로 알려 줍니다.
    const meta = dashboard.regions_meta || {};
    const weights = Object.entries(meta.weights || {}).map(([id, pct]) => `${esc(labels[id] || id)} ${num(pct)}%`).join(" · ");
    note = meta.method === "weighted"
      ? `<p class="source">추정 종합 = 카테고리별 지역 관심도를 검색 규모로 가중 평균 · 1위 지역 = 100 · 비중 ${weights}
          (카테고리 관심도 확인일 ${day(meta.weights_checked_at)}) · ${checked}</p>`
      : `<p class="source">종합 = 카테고리별 지역 관심도 단순 평균(카테고리 검색 규모 데이터 없음) · 1위 지역 = 100 · ${checked}</p>`;
  } else {
    note = `<p class="source">이전 수집본: 대표 검색어 <span lang="vi">${esc(rows[0].query)}</span> 하나 기준 · 카테고리 종합 전 · ${checked}</p>`;
  }
  const top = rows.slice(0, 10);
  renderExpandable("regions", top.length, barRows(visibleRows("regions", top), {
    label: (row) => row.name,
    sub: (row) => (row.name !== row.location ? row.location : ""),
    value: (row) => row.interest,
    extra: (row) => (row.data_status === "insufficient" ? badge(row.data_status) : "") + breakdown(row),
  }), note, renderRegions);
}


function renderAds() {
  const ads = dashboard.ad_creative_trends;
  if (ads.status === "empty") {
    $("ad-trends").innerHTML = emptyState(
      "아직 조사된 공개 광고 사례가 없습니다. 아래 파일에 사례를 기록한 뒤 수집 명령을 실행하세요.",
      "app/market_analysis/data/ad_cases_vn.csv → python collect_trends.py --sections ads");
    return;
  }
  const research = ads.research;
  $("ad-trends").innerHTML = (research ? adResearch(research) : "")
    + (ads.summary ? renderCaseSummary(ads) : "");
}

// 표본 수(건수)는 화면에 표시하지 않고 막대 길이로 상대 비중만 보여 줍니다. 표본이 늘면 다시 표시합니다.
const meterRow = (label, count, total) => `
  <li class="meter-row">
    <span class="meter-label">${esc(label)}</span>
    <span class="bar-track"><span class="bar-fill" style="width:${(count / total) * 100}%"></span></span>
  </li>`;
const chips = (items, cls = "") => `<div class="chip-list">${items.map((item) => `<span class="chip ${cls}">${item}</span>`).join("")}</div>`;
const sourceLink = (url, label) => (url ? `<a class="source-link" href="${esc(url)}" target="_blank" rel="noopener">${esc(label)} ↗</a>` : "");

function adResearch(r) {
  return `
    <h3 class="ad-h3">베트남 광고에서 반복되는 트렌드 <small>여러 자료에서 반복 확인된 신호</small></h3>
    <ol class="insight-grid">${r.insights.map((item, i) => `
      <li><span class="insight-no">${i + 1}</span><div><strong>${esc(item.title)}</strong><p>${esc(item.body)}</p></div></li>`).join("")}
    </ol>

    <h3 class="ad-h3">주제별 광고 트렌드 <small>TikTok·Meta 공개 광고 종합 · 확인일 ${day(r.checked_at)}</small></h3>
    ${themeCards(r)}`;
}

// TikTok·Meta 공개 광고 자료를 주제별로 묶어 보여 줍니다. 관찰한 사실만 정리하고 해석·제안은 AI 인사이트 탭에 맡깁니다.
function themeCards(r) {
  const t = r.tiktok, m = r.meta;
  const card = (title, body, links) => `
    <article class="exec-card theme-card"><h4>${title}</h4>${body}
      <div class="theme-sources">${links.join("")}</div></article>`;
  return `<div class="theme-grid">
    ${card("영상 구성·식감 표현", `
      <p class="mini-label">TikTok 광고 영상에서 확인한 장면</p>
      <ol class="meter-list">${t.patterns.map((x) => meterRow(x.label, x.count, t.coded)).join("")}</ol>
      <p class="mini-label">영상 길이</p>
      ${chips([`TikTok 약 ${Math.round(t.duration.min)}~${Math.round(t.duration.max)}초 · 중앙값 약 ${Math.round(t.duration.median)}초`,
        ...(m.video_lengths.length ? [`Meta 약 ${Math.min(...m.video_lengths)}~${Math.max(...m.video_lengths)}초`] : [])])}
      <p class="mini-label">광고에 쓰인 식감 단어</p>
      <div class="word-grid">${m.texture_words.map((w) => `<span><b lang="vi">${esc(w.vi)}</b>${esc(w.ko)}</span>`).join("")}</div>`,
      [sourceLink(t.source_url, "TikTok"), sourceLink(m.source_url, "Meta")])}
    ${card("메시지·카피", `
      <ul class="pattern-cards">${m.patterns.map((x) => `<li><strong>${esc(x.title)}</strong><p>${esc(x.body)}</p></li>`).join("")}</ul>
      <p class="mini-label">반복된 메시지 순서</p>
      <ol class="flow">${m.message_flow.map((step) => `<li>${esc(step)}</li>`).join("")}</ol>`,
      [sourceLink(m.source_url, "Meta")])}
  </div>`;
}

function renderCaseSummary(ads) {
  const s = ads.summary;
  const pattern = (title, rows) => `
    <div class="pattern"><h4>${title}</h4><ol>${rows.map((row) => `<li>${esc(row.label)} <small>${row.count}건 · ${num(row.share)}%</small></li>`).join("") || "<li>-</li>"}</ol></div>`;
  return `
    <h3 class="ad-h3">수집기 기록 사례</h3>
    ${ads.status === "insufficient" ? `<p class="inline-warn">${badge("insufficient")} 조사 사례가 ${ads.case_count}개로 권장 수량(20~30개)보다 적습니다.</p>` : ""}
    <div class="ad-grid">
      <div><h3>많이 관찰된 광고 형식 TOP 5</h3>
        ${barRows(s.formats.map((row, i) => ({ ...row, rank: i + 1 })), {
          label: (row) => row.label, value: (row) => row.share, extra: (row) => `${row.count}건`,
        })}
        <p class="source">조사 사례 ${ads.case_count}개 중 관찰 비중(%)</p>
      </div>
      <div class="pattern-grid">
        ${pattern("오프닝", s.opening_hooks)}${pattern("자막", s.subtitle_styles)}
        ${pattern("영상 길이", s.durations)}${pattern("CTA", s.ctas)}
      </div>
    </div>
    <h3>대표 광고 사례</h3>
    <div class="table-wrap"><table class="trend-table">
      <thead><tr><th scope="col">브랜드</th><th scope="col">형식</th><th scope="col" class="num">길이</th><th scope="col">오프닝</th>
        <th scope="col">CTA</th><th scope="col">성과 구간</th><th scope="col">수집일</th><th scope="col">원문</th></tr></thead>
      <tbody>${ads.examples.map((ad) => `<tr><td>${esc(ad.brand)}</td><td>${esc(ad.format)}</td><td class="num">${ad.duration_seconds}초</td>
        <td>${esc(ad.opening_hook)}</td><td>${esc(ad.cta)}</td><td>${esc(ad.performance_band || "-")}</td><td class="date">${day(ad.collected_at)}</td>
        <td><a href="${esc(ad.ad_url)}" target="_blank" rel="noopener">${esc(ad.platform)} ↗</a></td></tr>`).join("")}</tbody>
    </table></div>
    <h3>한정선 적용 아이디어</h3>
    ${ads.ideas.length ? `<ul class="idea-list">${ads.ideas.map((idea) => `<li>${esc(idea)}</li>`).join("")}</ul>`
      : `<p class="muted">적용 아이디어는 ad_cases_vn.json의 ideas 항목에 기록하면 표시됩니다. 종합 실행 전략은 AI 인사이트 탭에서 확인하세요.</p>`}
    <p class="source">${esc(dashboard.source.ads)} · 최근 사례 수집일 ${day(ads.latest_collected_at)} · 반영일 ${day(ads.checked_at)}</p>`;
}

let started = false;
export function initTrends() {
  if (started || !API_URL) return;
  started = true;
  load();
}

