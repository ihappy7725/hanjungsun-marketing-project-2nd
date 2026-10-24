// KPI 화면 스크립트 [민지]
// type="module"로 불러오므로 전역 변수·함수가 생기지 않습니다. (README 7장)
// 차트는 Chart.js(CDN). 라이브러리를 바꾸게 되면 아래 "차트" 묶음만 고칩니다.

const root = document.querySelector(".kpi-page");
const API = {
  summary: "/kpi/api/summary",
  voc: "/kpi/api/voc",
  analyze: "/kpi/api/voc/analyze",
};
const charts = {};

const $ = (name) => root.querySelector(`[data-kpi="${name}"]`);
const setText = (name, text) => {
  const el = $(name);
  if (el) el.textContent = text;
};

// ---------- 숫자 표시 ----------
const num = (n) => Number(n).toLocaleString("ko-KR");
const krwMan = (n) => `${num(Math.round(n / 10000))}만 원`;
const vnd = (n) => `${num(n)} VND`;
const pct = (n) => (n === null || n === undefined ? "—" : `${n.toFixed(1)}%`);
const signedKrw = (n) => `${n >= 0 ? "+" : "−"}${num(Math.abs(n))}원`;

const SENTIMENT_LABEL = { Positive: "긍정", Neutral: "중립", Negative: "부정" };
const PLATFORM_LABEL = { Shopee_VN: "Shopee", Instagram: "Instagram", TikTok: "TikTok", Zalo_OA: "Zalo QR" };
const STATUS_CLASS = { live: "is-live", fallback: "is-fallback", public_demo: "is-public", demo: "is-demo", warn: "is-warn" };

// ---------- 디자인 변수 ----------
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const palette = () => ({
  muted: cssVar("--muted"),
  line: cssVar("--line"),
  lineStrong: cssVar("--line-strong"),
  gold: cssVar("--gold"),
  green: cssVar("--green"),
  brown: cssVar("--brown"),
  red: cssVar("--badge-red-ink"),
  font: cssVar("--font-body"),
});

// ---------- 화면 조각 ----------
function el(tag, { text, className } = {}, children = []) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  children.forEach((child) => node.append(child));
  return node;
}

function badge(text, tone) {
  return el("span", { text, className: tone ? `badge ${tone}` : "badge" });
}

function setStatus(name, text, status, title = "") {
  const node = $(name);
  if (!node) return;
  node.textContent = text;
  node.className = `kpi-status ${STATUS_CLASS[status] || ""}`;
  node.title = title;
}

function fillRows(name, rows) {
  $(name).replaceChildren(...rows.map((cells) => el("tr", {}, cells.map((c) => (c instanceof Node ? el("td", {}, [c]) : el("td", { text: c }))))));
}

// ---------- 차트 ----------
function drawChart(key, config) {
  const canvas = root.querySelector(`[data-kpi-chart="${key}"]`);
  if (!canvas || !window.Chart) return;
  charts[key]?.destroy();
  const p = palette();
  window.Chart.defaults.font.family = p.font;
  window.Chart.defaults.font.size = 11;
  window.Chart.defaults.color = p.muted;
  charts[key] = new window.Chart(canvas, config);
}

function doughnut(key, labels, values, colors, { cutout = "68%", legend = false } = {}) {
  drawChart(key, {
    type: "doughnut",
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 0 }] },
    options: {
      cutout,
      maintainAspectRatio: false,
      plugins: { legend: legend ? { position: "right", labels: { boxWidth: 8, padding: 6 } } : { display: false } },
    },
  });
}

function chartNotice() {
  if (window.Chart) return;
  root.querySelectorAll("[data-kpi-chart]").forEach((canvas) => {
    canvas.replaceWith(el("p", { text: "차트 라이브러리를 불러오지 못했습니다. 확대해서 표의 숫자를 확인해 주세요.", className: "kpi-note" }));
  });
}

// ---------- 상단 KPI ----------
function renderScorecards(data) {
  const { totals, fx } = data;
  setText("month", `기준월 ${data.campaign_month}`);
  setText("spend-krw", krwMan(totals.ad_spend_krw_base));
  setText("spend-vnd", `${vnd(totals.ad_spend_vnd)} · 기준 환율 ${fx.base_rate.toFixed(2)}원 환산`);
  setText("roas", pct(totals.roas_percent));
  setText("roas-sub", `손익분기 ${data.roas_bep_percent}% ${totals.roas_percent >= data.roas_bep_percent ? "초과" : "미달"} · 전환 ${num(totals.conversions)}건`);

  const gainEl = $("fx-gain");
  if (!fx.ok) {
    setText("revenue-krw", krwMan(totals.revenue_krw_base));
    setText("revenue-vnd", `${vnd(totals.revenue_vnd)} · 기준 환율 환산`);
    setText("fx-rate", "—");
    setStatus("fx-badge", "연결 실패", "warn", fx.error || "");
    gainEl.textContent = `${fx.error} · 기준 ${fx.base_rate.toFixed(2)}원`;
    return;
  }

  setText("revenue-krw", krwMan(fx.revenue_krw_live));
  setText("revenue-vnd", `${vnd(totals.revenue_vnd)} · ${fx.is_fallback ? "대체 환율" : "ECOS 환율"} 환산`);
  setText("fx-rate", `${fx.live_rate.toFixed(2)}원`);
  const tip = `${fx.source} ${fx.updated_at || ""}${fx.source_detail ? ` · ${fx.source_detail}` : ""}`;
  if (fx.is_stale) setStatus("fx-badge", `${fx.age_days}일 지난 값`, "warn", `기준일이 ${fx.stale_days}일보다 오래되었습니다. ${tip}`);
  else if (fx.is_fallback) setStatus("fx-badge", "대체 출처", "fallback", tip);
  else setStatus("fx-badge", "ECOS 고시", "live", tip);

  const tone = fx.gain_loss_krw >= 0 ? "kpi-up" : "kpi-down";
  gainEl.replaceChildren(
    el("span", { text: `환차${fx.gain_loss_krw >= 0 ? "익" : "손"} ${signedKrw(fx.gain_loss_krw)}`, className: tone }),
    document.createTextNode(` · 기준 ${fx.base_rate.toFixed(2)}원 · ${fx.as_of || ""}`),
  );
  gainEl.title = `매출 ${signedKrw(fx.revenue_gain_krw)} / 지출 ${signedKrw(fx.spend_loss_krw)} · ${tip} · 금액은 시연 매출·지출 기준`;
}

// ---------- 예산 ----------
function renderBudget(data) {
  const b = data.budget;
  const p = palette();
  const remaining = Math.max(b.remaining_krw, 0);
  const parts = [
    ["플랫폼 광고비", b.platform_krw, p.brown],
    ["인플루언서 집행", b.influencer_paid_krw, p.gold],
    ["인플루언서 예상", b.influencer_expected_krw, p.muted],
    ["잔여 가용 예산", remaining, p.line],
  ];
  doughnut("budget", parts.map((x) => x[0]), parts.map((x) => x[1]), parts.map((x) => x[2]));
  setText("remaining-pct", pct(b.remaining_percent));

  const rows = parts.map(([label, value, color]) => {
    const swatch = el("span", { className: "kpi-swatch" });
    swatch.style.background = color;
    return el("div", {}, [el("dt", {}, [swatch, document.createTextNode(label)]), el("dd", { text: krwMan(value) })]);
  });
  rows.push(el("div", {}, [el("dt", { text: "총 배정 예산" }), el("dd", { text: krwMan(b.total_krw) })]));
  if (b.remaining_krw < 0) rows.push(el("div", {}, [el("dt", {}, [badge("예산 초과", "red")]), el("dd", { text: krwMan(-b.remaining_krw) })]));
  $("budget-list").replaceChildren(...rows);

  setText("burn-pct", pct(b.burn_rate_percent));
  $("burn-bar").style.width = `${Math.min(b.burn_rate_percent ?? 0, 100)}%`;

  const link = data.influencer_link;
  setText(
    "influencer-link",
    !link.ok
      ? `${link.error} — 협찬비는 시연 값으로 표시합니다.`
      : link.total === 0
        ? "인플루언서 탭 단가 데이터: 아직 없음 — 협찬비는 시연 값으로 표시합니다."
        : `인플루언서 탭 단가 ${link.total}건 연동(견적 ${link.counts.quote} · 계약 ${link.counts.contract}). 예산 반영 기준은 확정 전이라 협찬비는 시연 값입니다.`,
  );
  setText("budget-meta", `출처: 시연 값 · 기간: ${data.campaign_month} · 범위: 베트남 전체 캠페인 · 단위: 원(기준 환율 ${data.fx.base_rate.toFixed(2)}원/100 VND)`);
}

// ---------- ROAS ----------
function renderRoas(data) {
  const p = palette();
  const bep = data.roas_bep_percent;
  const ch = data.channels;
  drawChart("roas", {
    data: {
      labels: ch.map((c) => c.label),
      datasets: [
        {
          type: "bar",
          label: "ROAS(%)",
          data: ch.map((c) => c.roas_percent),
          backgroundColor: ch.map((c) => (c.roas_percent >= bep ? p.green : p.gold)),
          maxBarThickness: 40,
        },
        {
          type: "line",
          label: `손익분기 ${bep}%`,
          data: ch.map(() => bep),
          borderColor: p.red,
          borderDash: [5, 4],
          borderWidth: 1.5,
          pointRadius: 0,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true, ticks: { callback: (v) => `${v}%` }, grid: { color: p.line } },
        x: { grid: { display: false } },
      },
      plugins: { legend: { position: "top", align: "end", labels: { boxWidth: 8 } } },
    },
  });

  fillRows("channel-rows", ch.map((c) => [
    c.label,
    num(c.ad_spend_vnd),
    num(c.sales_revenue_vnd),
    pct(c.roas_percent),
    c.cpa_vnd === null ? "—" : num(c.cpa_vnd),
    c.roas_percent >= bep ? badge("기준 초과", "green") : badge("기준 미달", "red"),
  ]));

  const best = [...ch].sort((a, b) => b.roas_percent - a.roas_percent)[0];
  const below = ch.filter((c) => c.roas_percent < bep).map((c) => c.label);
  setText(
    "roas-advice",
    `최고 ${best.label} ${pct(best.roas_percent)}` + (below.length ? ` · 손익분기 미달: ${below.join(", ")} → 예산 조정 검토` : ""),
  );
  setText("roas-meta", `출처: 시연 값(Meta·TikTok·Shopee 정산 CSV 업로드 예정) · 기간: ${data.campaign_month} · 범위: 베트남 · 단위: VND`);
}

// ---------- GA4 / 크리에이터 ----------
function renderGa4(data) {
  const g = data.ga4;
  setText("ga4-engagement", pct(g.engagement_rate_percent));
  setText("ga4-engagement-sub", g.engaged_sessions == null ? "참여 세션 열 없음" : `${num(g.engaged_sessions)} / ${num(g.sessions)} 세션`);
  setText("ga4-ctr", pct(g.shopee_ctr_percent));
  setText("ga4-ctr-sub", `${num(g.shopee_clicks)}회 이동`);
  setText("ga4-pamphlet", num(g.pamphlet_sessions));
  setText(
    "ga4-proxy",
    g.purchase_rate_percent != null ? `대체 지표(데모): 구매 전환율 ${pct(g.purchase_rate_percent)} — 데모 스토어 값, 쇼피 이동 클릭률을 대신 참고` : "",
  );
  setText("ga4-note", g.note);
  setStatus("ga4-badge", g.status === "public_demo" ? "공개 데모" : "시연", g.status, g.note);
  const period = g.period && (g.period.start || g.period.end) ? `${g.period.start || "?"} ~ ${g.period.end || "?"}` : "—";
  setText("ga4-meta", `출처: ${g.source} · 기간: ${period} · 범위: ${g.scope} · 표본: 세션 ${num(g.sessions)}`);
  fillRows("creator-rows", data.creators.map((c, i) => [String(i + 1), c.creator, c.platform, num(c.clicks), num(c.conversions), pct(c.cvr_percent)]));
}

function setGa4Visible(show) {
  $("ga4-panel").hidden = !show;
  $("creator-panel").hidden = show;
  setText("ga4-eyebrow", show ? "GA4 TRAFFIC" : "CREATOR CONVERSION");
  setText("ga4-title", show ? "GA4 트래픽 · 전환" : "크리에이터별 클릭 · 전환 Top 5");
}

// ---------- VOC ----------
function renderVoc(stats, reviews, source) {
  const p = palette();
  const counts = stats.sentiment_counts;
  const keys = ["Positive", "Neutral", "Negative"];
  doughnut("sentiment", keys.map((k) => `${SENTIMENT_LABEL[k]} ${counts[k]}`), keys.map((k) => counts[k]), [p.green, p.lineStrong, p.red], { cutout: "58%", legend: true });

  drawChart("keywords", {
    type: "bar",
    data: {
      labels: stats.top_keywords.map((k) => k.keyword),
      datasets: [{ label: "언급 수", data: stats.top_keywords.map((k) => k.count), backgroundColor: p.gold, maxBarThickness: 14 }],
    },
    options: {
      indexAxis: "y",
      maintainAspectRatio: false,
      scales: {
        x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: p.line } },
        y: { grid: { display: false }, ticks: { autoSkip: false } },  // 키워드 이름을 건너뛰지 않고 모두 표시
      },
      plugins: { legend: { display: false }, title: { display: true, text: "핵심 키워드 Top 5", align: "start", padding: { top: 0, bottom: 4 } } },
    },
  });

  const tone = { Positive: "green", Negative: "red" };
  fillRows("review-rows", reviews.map((r) => {
    const text = el("div", {}, [document.createTextNode(r.translated_kr || "—"), el("small", { text: r.raw_text_vn })]);
    return [
      PLATFORM_LABEL[r.platform] || r.platform,
      text,
      r.sentiment ? badge(SENTIMENT_LABEL[r.sentiment], tone[r.sentiment]) : badge("미분류"),
      r.keyword_tag || "—",
    ];
  }));

  setStatus("voc-source", source.text, source.status, source.title || "");
  const platforms = [...new Set(reviews.map((r) => PLATFORM_LABEL[r.platform] || r.platform))].join("·");
  setText("voc-meta", `출처: ${source.meta} · 수집처: ${platforms} · 표본: 리뷰 ${num(stats.sample_size ?? reviews.length)}건 · 범위: 베트남`);
}

function renderQr(qr) {
  const strip = $("qr-strip");
  const step = (label, value) => el("span", {}, [document.createTextNode(`${label} `), el("b", { text: value })]);
  const arrow = () => el("span", { text: "→", className: "kpi-arrow" });
  strip.replaceChildren(
    el("span", { text: "시연", className: "kpi-status is-demo" }),
    step("팜플렛 QR 스캔", num(qr.qr_scans)),
    arrow(),
    step("Zalo 친구 추가", num(qr.zalo_follows)),
    arrow(),
    step("설문 응답", `${num(qr.survey_responses)} (${pct(qr.response_rate_percent)})`),
  );
  strip.title = `배포 팜플렛 ${num(qr.pamphlets)}장 · 스캔율 ${pct(qr.scan_rate_percent)} · 친구 추가율 ${pct(qr.follow_rate_percent)}`;

  $("survey-list").replaceChildren(...qr.survey.map((s) => {
    const bar = el("div", { className: "progress" }, [el("span")]);
    bar.firstChild.style.width = `${(s.score / 5) * 100}%`;
    return el("div", {}, [el("dt", { text: s.item }), el("dd", {}, [bar]), el("dd", { text: s.score.toFixed(1) })]);
  }));
}

function showVocAi(demoReviews, ai) {
  const byId = Object.fromEntries(ai.reviews.map((r) => [r.review_id, r]));
  const merged = demoReviews.map((r) => ({ ...r, ...(byId[r.review_id] || { translated_kr: "", sentiment: null, keyword_tag: null }) }));
  renderVoc({ ...ai, sample_size: merged.length }, merged, {
    text: "OpenAI 분석 · 검수 전",
    status: "live",
    title: `${ai.model} · ${ai.analyzed_at} · AI 번역·분류는 사람이 검수하기 전 결과입니다.`,
    meta: `OpenAI ${ai.model} 분석(${ai.analyzed_at}, 검수 전) · 원문은 시연 리뷰`,
  });
  setText("voc-summary", ai.summary_kr ? `AI 요약(검수 전): ${ai.summary_kr}` : "AI 요약이 비어 있습니다.");
}

// ---------- 블록 확대 ----------
function setExpanded(panel) {
  root.querySelectorAll(".kpi-panel.is-expanded").forEach((p) => p.classList.remove("is-expanded"));
  if (panel) panel.classList.add("is-expanded");
  root.querySelector(".kpi-backdrop").hidden = !panel;
  root.querySelectorAll(".kpi-expand").forEach((btn) => {
    const open = btn.closest(".kpi-panel") === panel;
    btn.setAttribute("aria-label", open ? "원래 크기로" : "블록 확대");
    btn.title = open ? "닫기 (Esc)" : "확대";
  });
}

// ---------- 불러오기 ----------
async function getJson(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `요청 실패 (${res.status})`);
  return body;
}

function showError(name, message) {
  const box = $(name);
  box.textContent = message;
  box.hidden = !message;
}

let vocReviews = [];

async function loadSummary() {
  try {
    const data = await getJson(API.summary);
    renderScorecards(data);
    renderBudget(data);
    renderRoas(data);
    renderGa4(data);
  } catch (err) {
    root.querySelector(".kpi-legend-note").textContent = `KPI 데이터를 불러오지 못했습니다: ${err.message}`;
  }
}

async function loadVoc() {
  try {
    const data = await getJson(API.voc);
    vocReviews = data.reviews;
    renderQr(data.qr);
    if (data.ai) showVocAi(vocReviews, data.ai);
    else renderVoc(data, vocReviews, { text: "시연 분류", status: "demo", meta: "시연 리뷰·시연 분류" });
  } catch (err) {
    showError("voc-error", `VOC 데이터를 불러오지 못했습니다: ${err.message}`);
  }
}

async function analyzeVoc(button) {
  button.disabled = true;
  button.textContent = "분석 중…";
  showError("voc-error", "");
  try {
    const data = await getJson(API.analyze, { method: "POST" });
    showVocAi(vocReviews, data.ai);
  } catch (err) {
    showError("voc-error", `${err.message} 시연 분류를 그대로 보여 줍니다.`);
  } finally {
    button.disabled = false;
    button.textContent = "AI로 분석";
  }
}

root.addEventListener("click", (event) => {
  const target = event.target.closest("[data-kpi-action]");
  const action = target?.dataset.kpiAction;
  if (action === "refresh") {
    loadSummary();
    loadVoc();
  } else if (action === "voc-analyze") {
    analyzeVoc(target);
  } else if (action === "expand") {
    const panel = target.closest(".kpi-panel");
    setExpanded(panel.classList.contains("is-expanded") ? null : panel);
  } else if (action === "collapse") {
    setExpanded(null);
  }
});

root.addEventListener("change", (event) => {
  if (event.target.matches('[data-kpi-action="ga4-toggle"]')) setGa4Visible(event.target.checked);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setExpanded(null);
});

chartNotice();
setGa4Visible(true);
loadSummary();
loadVoc();
