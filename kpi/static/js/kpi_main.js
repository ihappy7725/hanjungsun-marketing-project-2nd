// KPI 화면 스크립트 [민지]
// type="module"로 불러오므로 전역 변수·함수가 생기지 않습니다. (README 7장)
// 차트는 Chart.js(CDN). 라이브러리를 바꾸게 되면 아래 "차트" 묶음만 고칩니다.

const root = document.querySelector(".kpi-page");
const API = {
  summary: "/kpi/api/summary",
  voc: "/kpi/api/voc",
  analyze: "/kpi/api/voc/analyze",
  simulator: "/kpi/api/simulator",
};
const charts = {};
// 화면 선택 상태: ROAS 통화(기본 원화), 리뷰 언어(기본 한국어), 감성 필터(기본 전체)
const view = { currency: "KRW", summary: null, reviewLang: "ko", reviewFilter: "all", reviews: [] };

const $ = (name) => root.querySelector(`[data-kpi="${name}"]`);
const setText = (name, text) => {
  const el = $(name);
  if (el) {
    const description = /시연|데모|가상|\bdemo\b/i.test(String(text ?? ""));
    el.textContent = description ? "" : text;
    el.hidden = description || !String(text ?? "").trim();
  }
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
// .kpi-page에서 읽어야 KPI 안에서만 정의한 변수(--kpi-pink)까지 함께 읽힙니다.
const cssVar = (name) => getComputedStyle(root).getPropertyValue(name).trim();
// 차트 색: 공통 톤(남색·청록·갈색·살구) 안에서 서로 잘 구분되는 진한 색을 씁니다. (base.css 변수 + KPI 전용 분홍)
const palette = () => ({
  ink: cssVar("--ink"),         // 예산: 플랫폼 광고비(검정)
  pink: cssVar("--kpi-pink"),   // 예산: 인플루언서 예상(분홍, kpi_main.css에서 정의)
  ivory: cssVar("--beige"),     // 예산: 잔여 가용 예산(아이보리)
  muted: cssVar("--muted"),
  line: cssVar("--line"),
  lineStrong: cssVar("--line-strong"),
  strong: cssVar("--navy"),   // 가장 큰 몫(플랫폼 광고비)
  good: cssVar("--teal"),     // 기준 이상 · 긍정 · 전환
  low: cssVar("--orange"),    // 기준 미달 · 부정 · 예상 지출
  mid: cssVar("--brown"),     // 보조 계열(인플루언서 집행 · 키워드 · 클릭)
  soft: cssVar("--beige"),    // 중립
  ref: cssVar("--navy"),      // 기준선(손익분기 · 전체 평균)
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
  node.hidden = status === "demo" || status === "public_demo";
  node.textContent = node.hidden ? "" : text;
  node.className = `kpi-status ${STATUS_CLASS[status] || ""}`;
  node.title = node.hidden ? "" : title;
}

// 머리 칸에 .is-text가 있는 열은 본문 칸도 왼쪽 정렬합니다.
function fillRows(name, rows) {
  const body = $(name);
  const heads = body.closest("table")?.querySelectorAll("thead th") || [];
  const textCols = new Set([...heads].flatMap((th, i) => (th.classList.contains("is-text") ? [i] : [])));
  body.replaceChildren(...rows.map((cells) => el("tr", {}, cells.map((c, i) => {
    const td = c instanceof Node ? el("td", {}, [c]) : el("td", { text: c });
    if (textCols.has(i)) td.classList.add("is-text");
    return td;
  }))));
}

// ---------- 차트 ----------
function drawChart(key, config) {
  const canvas = root.querySelector(`[data-kpi-chart="${key}"]`);
  if (!canvas || !window.Chart) return;
  charts[key]?.destroy();
  const p = palette();
  window.Chart.defaults.font.family = p.font;
  window.Chart.defaults.font.size = parseFloat(cssVar("--fs-table"));
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
  gainEl.title = `매출 ${signedKrw(fx.revenue_gain_krw)} / 지출 ${signedKrw(fx.spend_loss_krw)} · ${tip}`;
}

// ---------- 예산 ----------
function renderBudget(data) {
  const b = data.budget;
  const p = palette();
  const remaining = Math.max(b.remaining_krw, 0);
  // 예산 색: 검정 · 녹색 · 분홍 · 아이보리
  const parts = [
    ["플랫폼 광고비", b.platform_krw, p.ink],
    ["인플루언서 집행", b.influencer_paid_krw, p.good],
    ["인플루언서 예상", b.influencer_expected_krw, p.pink],
    ["잔여 가용 예산", remaining, p.ivory],
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

  // 예산 소진 막대: 도넛과 같은 색 구간(플랫폼 · 인플루언서 집행 · 인플루언서 예상 · 잔여)
  setText("burn-pct", pct(b.burn_rate_percent));
  const share = (v) => (b.total_krw ? Math.max((v / b.total_krw) * 100, 0) : 0);
  $("burn-segments").replaceChildren(...parts.map(([label, value, color]) => {
    const seg = el("span", { className: "kpi-burn-seg" });
    seg.style.width = `${Math.min(share(value), 100)}%`;
    seg.style.background = color;
    seg.title = `${label} ${krwMan(value)} (${pct(share(value))})`;
    return seg;
  }));
  setText(
    "burn-legend",
    `소진 ${pct(b.burn_rate_percent)} · 인플루언서 예상 ${pct(share(b.influencer_expected_krw))} · 잔여 ${pct(b.remaining_percent)}`,
  );

  const link = data.influencer_link;
  setText(
    "influencer-link",
    !link.ok
      ? `${link.error} — 협찬비는 시연 값으로 표시합니다.`
      : link.total === 0
        ? "인플루언서 탭 단가 데이터: 아직 없음 — 협찬비는 시연 값으로 표시합니다."
        : `인플루언서 탭 단가 ${link.total}건 연동(견적 ${link.counts.quote} · 계약 ${link.counts.contract}). 예산 반영 기준은 확정 전이라 협찬비는 시연 값입니다.`,
  );
  setText("budget-meta", `출처: 시연 값 · 기간: ${data.campaign_month} · 범위: 베트남 전체 이벤트 · 단위: 원(기준 환율 ${data.fx.base_rate.toFixed(2)}원/100 VND)`);

  // 확대 시: 채널별 집행액과 총 예산 대비 비중
  const rate = data.fx.base_rate;
  fillRows("spend-rows", data.channels.map((c) => {
    const krw = Math.round((c.ad_spend_vnd * rate) / 100);
    return [c.label, num(c.ad_spend_vnd), krwMan(krw), pct((krw / b.total_krw) * 100), pct(c.roas_percent)];
  }));
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
          backgroundColor: ch.map((c) => (c.roas_percent >= bep ? p.good : p.low)),
          maxBarThickness: 40,
        },
        {
          type: "line",
          label: `손익분기 ${bep}%`,
          data: ch.map(() => bep),
          borderColor: p.ref,
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

  const best = [...ch].sort((a, b) => b.roas_percent - a.roas_percent)[0];
  const below = ch.filter((c) => c.roas_percent < bep).map((c) => c.label);
  setText(
    "roas-advice",
    `최고 ${best.label} ${pct(best.roas_percent)}` + (below.length ? ` · 손익분기 미달: ${below.join(", ")} → 예산 조정 검토` : ""),
  );
  renderRoasMoney(data);
}

// ROAS 블록의 금액(광고비·매출·CPA)을 선택한 통화로 표시합니다. ROAS(%)는 비율이라 통화와 무관합니다.
// A안: 원화 = VND × 편성 기준 환율 ÷ 100, 달러 = 그 원화 ÷ 현재 원/달러 고시 환율
const CURRENCY_LABEL = { KRW: "원", USD: "달러", VND: "VND" };

function money(vnd, data, cur) {
  if (vnd == null) return null;
  const krw = (vnd * data.fx.base_rate) / 100;
  if (cur === "KRW") return krw;
  if (cur === "USD") return data.usd?.ok ? krw / data.usd.krw_per_usd : null;
  return vnd;
}

function fmtMoney(value, cur) {
  if (value == null) return "—";
  if (cur === "USD") return `$${Number(value).toLocaleString("en-US", { maximumFractionDigits: value < 100 ? 2 : 0 })}`;
  if (cur === "KRW") return `${num(Math.round(value))}원`;
  return `${num(Math.round(value))} VND`;
}

function renderRoasMoney(data) {
  const cur = view.currency;
  const bep = data.roas_bep_percent;
  const unit = CURRENCY_LABEL[cur];
  setText("th-spend", `광고비(${unit})`);
  setText("th-revenue", `매출(${unit})`);
  setText("th-cpa", `CPA(${unit})`);
  fillRows("channel-rows", data.channels.map((c) => [
    c.label,
    fmtMoney(money(c.ad_spend_vnd, data, cur), cur),
    fmtMoney(money(c.sales_revenue_vnd, data, cur), cur),
    pct(c.roas_percent),
    fmtMoney(money(c.cpa_vnd, data, cur), cur),
    c.roas_percent >= bep ? badge("기준 초과", "green") : badge("기준 미달", "red"),
  ]));
  $("roas-totals").replaceChildren(
    el("div", {}, [el("dt", { text: "총 광고비" }), el("dd", { text: fmtMoney(money(data.totals.ad_spend_vnd, data, cur), cur) })]),
    el("div", {}, [el("dt", { text: "총 매출" }), el("dd", { text: fmtMoney(money(data.totals.revenue_vnd, data, cur), cur) })]),
  );

  // 달러 환율을 못 받으면 달러 버튼을 끄고 원화로 돌아갑니다.
  const usdBtn = root.querySelector('[data-kpi-action="currency"][data-cur="USD"]');
  usdBtn.disabled = !data.usd?.ok;
  usdBtn.title = data.usd?.ok
    ? `1달러 = ${num(data.usd.krw_per_usd)}원 · ${data.usd.source}${data.usd.as_of ? ` ${data.usd.as_of} 고시` : ""}`
    : data.usd?.error || "달러 환율을 불러오지 못했습니다.";
  if (cur === "USD" && !data.usd?.ok) return setCurrency("KRW");

  const rateNote = cur === "KRW"
    ? `원화 = 편성 기준 환율 ${data.fx.base_rate.toFixed(2)}원/100 VND`
    : cur === "USD"
      ? `달러 = 원화 ÷ ${num(data.usd.krw_per_usd)}원/달러(${data.usd.source}${data.usd.as_of ? ` ${data.usd.as_of}` : ""})`
      : "현지 통화 그대로";
  setText("roas-meta", `기간: ${data.campaign_month} · 범위: 베트남 · 단위: ${unit} (${rateNote})`);
}

function setCurrency(cur) {
  view.currency = cur;
  setSegment("currency", "cur", cur);
  if (view.summary) renderRoasMoney(view.summary);
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
  const period = g.period && (g.period.start || g.period.end) ? `${g.period.start || "?"} ~ ${g.period.end || "?"}` : "—";
  ga4View.status = g.status;
  ga4View.note = g.note;
  ga4View.meta = `출처: ${g.source} · 기간: ${period} · 범위: ${g.scope} · 표본: 세션 ${num(g.sessions)}`;
  renderGa4Channels(g);
  renderCreators(data.creators);
  setGa4Visible($("ga4-panel").hidden === false);
}

// 기본 화면: 세션이 많은 채널 5개의 참여율 막대 (세로 점선 = 전체 참여율)
function renderGa4Top(g) {
  const avg = g.engagement_rate_percent;
  const top = [...g.channels].sort((a, b) => b.sessions - a.sessions).slice(0, 5);
  $("ga4-top").replaceChildren(...top.map((c) => {
    const rate = c.engagement_rate_percent ?? 0;
    const fill = el("span", { className: `kpi-bar-fill${avg != null && rate >= avg ? " is-high" : ""}` });
    fill.style.width = `${Math.min(rate, 100)}%`;
    const track = el("span", { className: "kpi-bar-track" }, [fill]);
    if (avg != null) {
      const mark = el("span", { className: "kpi-bar-avg" });
      mark.style.left = `${Math.min(avg, 100)}%`;
      mark.title = `전체 참여율 ${pct(avg)}`;
      track.append(mark);
    }
    const name = el("span", { className: "kpi-bar-name" }, [document.createTextNode(c.channel), el("small", { text: `${num(c.sessions)}세션` })]);
    name.title = `${c.channel} · 세션 ${num(c.sessions)} · 참여 세션 ${c.engaged_sessions == null ? "—" : num(c.engaged_sessions)}`;
    return el("li", {}, [name, track, el("span", { className: "kpi-bar-value", text: pct(c.engagement_rate_percent) })]);
  }));
}

// 확대 시: 유입 채널별 세션·참여율 (GA4 데모 CSV의 채널별 줄)
function renderGa4Channels(g) {
  const hasChannels = g.channels && g.channels.length > 0;
  $("ga4-channel-section").hidden = !hasChannels;
  $("ga4-channel-empty").hidden = hasChannels;
  $("ga4-top-section").hidden = !hasChannels;
  if (!hasChannels) return;
  renderGa4Top(g);
  setStatus("ga4-channel-badge", g.status === "public_demo" ? "공개 데모" : "시연", g.status);
  const p = palette();
  const avg = g.engagement_rate_percent;
  const rows = g.channels.filter((c) => c.engagement_rate_percent != null);
  drawChart("ga4-channels", {
    data: {
      labels: rows.map((c) => c.channel),
      datasets: [
        {
          type: "bar",
          label: "채널 참여율(%)",
          data: rows.map((c) => c.engagement_rate_percent),
          backgroundColor: rows.map((c) => (avg != null && c.engagement_rate_percent >= avg ? p.good : p.low)),
          maxBarThickness: 28,
        },
        ...(avg != null
          ? [{ type: "line", label: `전체 ${pct(avg)}`, data: rows.map(() => avg), borderColor: p.ref, borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0 }]
          : []),
      ],
    },
    options: {
      maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true, max: 100, ticks: { callback: (v) => `${v}%` }, grid: { color: p.line } },
        x: { grid: { display: false }, ticks: { autoSkip: false, maxRotation: 30 } },
      },
      plugins: { legend: { position: "top", align: "end", labels: { boxWidth: 8 } } },
    },
  });
  fillRows("ga4-channel-rows", g.channels.map((c) => [
    c.channel,
    num(c.sessions),
    pct((c.sessions / g.sessions) * 100),
    c.engaged_sessions == null ? "—" : num(c.engaged_sessions),
    pct(c.engagement_rate_percent),
  ]));
}

// 크리에이터 전환표 + 확대 시 클릭·전환 막대
function renderCreators(creators) {
  const p = palette();
  fillRows("creator-rows", creators.map((c, i) => [String(i + 1), c.creator, c.platform, num(c.clicks), num(c.conversions), pct(c.cvr_percent)]));
  const clicks = creators.reduce((s, c) => s + c.clicks, 0);
  const conversions = creators.reduce((s, c) => s + c.conversions, 0);
  $("creator-total").replaceChildren(
    el("td", { text: "합계", className: "is-text" }),
    el("td", { className: "is-text" }),
    el("td", { className: "is-text" }),
    el("td", { text: num(clicks) }),
    el("td", { text: num(conversions) }),
    el("td", { text: pct(clicks ? (conversions / clicks) * 100 : null) }),
  );
  drawChart("creators", {
    type: "bar",
    data: {
      labels: creators.map((c) => c.creator),
      datasets: [
        { label: "링크 클릭", data: creators.map((c) => c.clicks), backgroundColor: p.mid, maxBarThickness: 26, yAxisID: "y" },
        { label: "전환", data: creators.map((c) => c.conversions), backgroundColor: p.good, maxBarThickness: 26, yAxisID: "y1" },
      ],
    },
    options: {
      maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true, position: "left", title: { display: true, text: "클릭" }, grid: { color: p.line } },
        y1: { beginAtZero: true, position: "right", title: { display: true, text: "전환" }, grid: { display: false } },
        x: { grid: { display: false } },
      },
      plugins: { legend: { position: "top", align: "end", labels: { boxWidth: 8 } } },
    },
  });
}

// GA4 켜기/끄기 — 크리에이터 표는 시연 값이므로 배지·출처도 함께 바꿉니다.
const ga4View = { status: "demo", note: "", meta: "출처: —" };

function setGa4Visible(show) {
  $("ga4-panel").hidden = !show;
  $("creator-panel").hidden = show;
  setText("ga4-title", show ? "GA4 트래픽 · 전환" : "크리에이터별 클릭 · 전환 Top 5");
  if (show) {
    setStatus("ga4-badge", ga4View.status === "public_demo" ? "공개 데모" : "시연", ga4View.status, ga4View.note);
    setText("ga4-meta", ga4View.meta);
  } else {
    setStatus("ga4-badge", "시연", "demo", "크리에이터별 클릭·전환은 시연 값입니다.");
    setText("ga4-meta", "출처: 시연 값(인플루언서 탭 공개 함수에 클릭·전환 항목 추가 필요) · 범위: 베트남 · 표본: 크리에이터 5명");
  }
  resizeCharts();
}

// ---------- VOC ----------
function renderVoc(stats, reviews, source) {
  const p = palette();
  const counts = stats.sentiment_counts;
  const keys = ["Positive", "Neutral", "Negative"];
  doughnut("sentiment", keys.map((k) => `${SENTIMENT_LABEL[k]} ${counts[k]}`), keys.map((k) => counts[k]), [p.good, p.soft, p.low], { cutout: "58%", legend: true });
  if (charts.sentiment) {
    // 도넛 조각을 누르면 그 감성 리뷰만 봅니다(같은 조각을 다시 누르면 전체).
    // 리뷰 목록은 확대 화면에 있으므로, 기본 화면에서 누르면 블록을 확대한 뒤 거릅니다.
    charts.sentiment.options.onClick = (_e, els) => {
      if (!els.length) return;
      const key = keys.at(els[0].index);
      const panel = root.querySelector('[data-kpi-panel="voc"]');
      if (!panel.classList.contains("is-expanded")) {
        setExpanded(panel);
        setReviewFilter(key);
      } else {
        setReviewFilter(view.reviewFilter === key ? "all" : key);
      }
    };
    charts.sentiment.options.onHover = (e, els) => { e.native.target.style.cursor = els.length ? "pointer" : "default"; };
  }

  drawChart("keywords", {
    type: "bar",
    data: {
      labels: stats.top_keywords.map((k) => k.keyword),
      datasets: [{ label: "언급 수", data: stats.top_keywords.map((k) => k.count), backgroundColor: p.mid, maxBarThickness: 14 }],
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

  view.reviews = reviews;
  renderReviewList();

  setStatus("voc-source", source.text, source.status, source.title || "");
  const platforms = [...new Set(reviews.map((r) => PLATFORM_LABEL[r.platform] || r.platform))].join("·");
  setText("voc-meta", `출처: ${source.meta} · 수집처: ${platforms} · 표본: 리뷰 ${num(stats.sample_size ?? reviews.length)}건 · 범위: 베트남`);
}

// 리뷰 목록(확대 화면): 언어(한국어 / 베트남어 / 둘 다) · 감성 드롭다운
function renderReviewList() {
  const tone = { Positive: "green", Negative: "red" };
  const list = view.reviewFilter === "all" ? view.reviews : view.reviews.filter((r) => r.sentiment === view.reviewFilter);
  const label = view.reviewFilter === "all" ? "전체" : SENTIMENT_LABEL[view.reviewFilter];
  $("review-count").textContent = `${label} ${num(list.length)}건`;
  if (!list.length) {
    $("review-list").replaceChildren(el("li", { className: "kpi-review-empty", text: `${label} 리뷰가 없습니다.` }));
    return;
  }
  $("review-list").replaceChildren(...list.map((r) => {
    const head = el("div", { className: "kpi-review-head" }, [
      el("span", { text: PLATFORM_LABEL[r.platform] || r.platform }),
      r.sentiment ? badge(SENTIMENT_LABEL[r.sentiment], tone[r.sentiment]) : badge("미분류"),
      el("span", { text: r.keyword_tag || "" }),
    ]);
    const ko = el("p", { className: "kpi-review-ko", text: r.translated_kr || r.raw_text_vn });
    const vi = el("p", { className: "kpi-review-vi", text: r.raw_text_vn });
    vi.lang = "vi";
    const body = view.reviewLang === "ko" ? [ko] : view.reviewLang === "vi" ? [vi] : [ko, vi];
    return el("li", {}, [head, ...body]);
  }));
}

function setSegment(action, attr, value) {
  root.querySelectorAll(`[data-kpi-action="${action}"]`).forEach((b) => {
    const on = b.dataset[attr] === value;
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-pressed", String(on));
  });
}

function setReviewLang(lang) {
  view.reviewLang = lang;
  $("review-lang").value = lang;
  renderReviewList();
}

function setReviewFilter(sentiment) {
  view.reviewFilter = sentiment;
  $("review-filter").value = sentiment;
  renderReviewList();
}

function renderQr(qr) {
  const strip = $("qr-strip");
  const step = (label, value) => el("span", {}, [document.createTextNode(`${label} `), el("b", { text: value })]);
  const arrow = () => el("span", { text: "→", className: "kpi-arrow" });
  strip.replaceChildren(
    step("팜플렛 QR 스캔", num(qr.qr_scans)),
    arrow(),
    step("Zalo 친구 추가", num(qr.zalo_follows)),
    arrow(),
    step("설문 응답", `${num(qr.survey_responses)} (${pct(qr.response_rate_percent)})`),
    ...(qr.survey.overall_avg != null ? [el("span", { text: "·", className: "kpi-arrow" }), step("만족도 평균", `${qr.survey.overall_avg.toFixed(1)} / 5`)] : []),
  );
  strip.title = `배포 팜플렛 ${num(qr.pamphlets)}장 · 스캔율 ${pct(qr.scan_rate_percent)} · 친구 추가율 ${pct(qr.follow_rate_percent)}`;

  // 확대 화면: 문항별 1~5점 분포 막대 · 평균 · 긍정(4~5점) 비율 · 응답 수
  const items = qr.survey.items;
  $("survey-count").textContent = `응답 ${num(qr.survey_responses)}건 · ${items.length}문항`;
  fillRows("survey-rows", items.map((s) => {
    const bar = el("span", { className: "kpi-survey-bar" }, s.dist.map((count, i) => {
      const seg = el("span", { className: `kpi-s${i + 1}` });
      seg.style.width = `${s.responses ? (count / s.responses) * 100 : 0}%`;
      seg.title = `${i + 1}점 ${num(count)}명 (${pct(s.responses ? (count / s.responses) * 100 : 0)})`;
      return seg;
    }));
    return [s.item, bar, s.avg == null ? "—" : s.avg.toFixed(2), pct(s.top2_percent), `${num(s.responses)}명`];
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
  // 문장마다 줄을 나눠 짧게 읽히도록 표시합니다.
  const summary = (ai.summary_kr || "").trim().replace(/([.!?。])\s+/g, "$1\n");
  setText("voc-summary", summary ? `AI 요약(검수 전)\n${summary}` : "AI 요약이 비어 있습니다.");
}

// ---------- 집행 시뮬레이션 (화면에서만 계산, 저장하지 않음) ----------
const sim = { data: null, items: [], nextId: 1 };
const KIND_LABEL = { influencer: "인플루언서", ad: "배너·플랫폼 광고" };

function simRoas(channel) {
  return sim.data?.channels.find((c) => c.channel === channel)?.roas_percent ?? null;
}

function renderSimOptions() {
  const d = sim.data;
  const inf = d.influencers;
  const select = $("sim-influencer");
  select.replaceChildren(...inf.options.map((o) => {
    const krw = Math.round((o.amount_vnd * d.base_rate) / 100);
    const label = `${o.influencer} · ${o.platform} ${o.content_format} · ${o.price_type_label} ${num(o.amount_vnd)} VND (≈${krwMan(krw)})`;
    const opt = el("option", { text: label });
    opt.value = o.id;
    return opt;
  }));
  if (!inf.options.length) select.append(el("option", { text: "선택할 수 있는 인플루언서 단가가 없습니다" }));
  $("sim-channel").replaceChildren(...d.ad_channels.map((ch) => {
    const opt = el("option", { text: `${d.channels.find((c) => c.channel === ch)?.label || ch} (현재 ROAS ${pct(simRoas(ch))})` });
    opt.value = ch;
    return opt;
  }));
  setText("sim-source", `인플루언서 후보: ${inf.note}${inf.status === "demo" ? " · 시연" : ""} · 환산: 기준 환율 ${d.base_rate.toFixed(2)}원/100 VND`);
}

function renderSim() {
  const d = sim.data;
  if (!d) return;
  const now = d.budget.remaining_krw;
  const planned = sim.items.reduce((s, it) => s + it.cost_krw, 0);
  const after = now - planned;
  const total = d.budget.total_krw;

  fillRows("sim-rows", sim.items.map((it) => {
    const remove = el("button", { text: "빼기", className: "btn kpi-sim-remove" });
    remove.type = "button";
    remove.dataset.kpiAction = "sim-remove";
    remove.dataset.id = String(it.id);
    return [it.label, KIND_LABEL[it.kind], krwMan(it.cost_krw), it.revenue_krw == null ? "—" : krwMan(it.revenue_krw), remove];
  }));
  if (!sim.items.length) fillRows("sim-rows", [["아직 추가한 항목이 없습니다", "", "", "", ""]]);

  setText("sim-now", krwMan(now));
  setText("sim-planned", krwMan(planned));
  const afterEl = $("sim-after");
  afterEl.textContent = after >= 0 ? krwMan(after) : `−${krwMan(-after)}`;
  afterEl.classList.toggle("is-over", after < 0);

  const used = Math.max(total - now, 0);
  const bar = root.querySelector(".kpi-sim-bar");
  bar.classList.toggle("is-over", after < 0);
  $("sim-bar-used").style.width = `${Math.min((used / total) * 100, 100)}%`;
  $("sim-bar-planned").style.width = `${Math.min((planned / total) * 100, Math.max(100 - (used / total) * 100, 0))}%`;

  const revenue = sim.items.reduce((s, it) => s + (it.revenue_krw || 0), 0);
  setText(
    "sim-summary",
    !sim.items.length
      ? "항목을 추가하면 집행 후 남는 예산을 바로 계산합니다."
      : after < 0
        ? `예산 초과 ${krwMan(-after)} — 항목을 줄이거나 예산 조정이 필요합니다. (참고 예상 매출 ${krwMan(revenue)}, 현재 ROAS 유지 가정)`
        : `집행 후 총 예산의 ${pct((after / total) * 100)}가 남습니다. 참고 예상 매출 ${krwMan(revenue)} (현재 ROAS 유지 가정)`,
  );
}

function addSimItem(form) {
  const d = sim.data;
  const kind = form.elements.kind.value;
  showError("sim-error", "");
  let item;
  if (kind === "influencer") {
    const o = d.influencers.options.find((x) => x.id === form.elements.influencer.value);
    if (!o) return showError("sim-error", "인플루언서 단가를 선택해 주세요.");
    const cost = Math.round((o.amount_vnd * d.base_rate) / 100);
    const roas = simRoas("Influencer");
    item = { kind, label: `${o.influencer} (${o.price_type_label})`, cost_krw: cost, revenue_krw: roas == null ? null : Math.round((cost * roas) / 100) };
  } else {
    const amount = Number(form.elements.amount.value);
    if (!Number.isFinite(amount) || amount <= 0) return showError("sim-error", "예정 광고비를 0보다 큰 숫자로 입력해 주세요.");
    const channel = form.elements.channel.value;
    const cost = form.elements.unit.value === "KRW" ? Math.round(amount) : Math.round((amount * d.base_rate) / 100);
    const roas = simRoas(channel);
    const label = d.channels.find((c) => c.channel === channel)?.label || channel;
    item = { kind, label: `${label} 광고`, cost_krw: cost, revenue_krw: roas == null ? null : Math.round((cost * roas) / 100) };
    form.elements.amount.value = "";
  }
  sim.items.push({ ...item, id: sim.nextId++ });
  renderSim();
}

function setSimKind(kind) {
  $("sim-influencer-fields").hidden = kind !== "influencer";
  $("sim-ad-fields").hidden = kind !== "ad";
}

async function loadSimulator() {
  try {
    sim.data = await getJson(API.simulator);
    renderSimOptions();
    renderSim();
  } catch (err) {
    showError("sim-error", `시뮬레이션 데이터를 불러오지 못했습니다: ${err.message}`);
  }
}

// ---------- 블록 확대 ----------
function resizeCharts() {
  requestAnimationFrame(() => Object.values(charts).forEach((c) => c.resize()));
}

// 4개 블록 높이를 예산 블록(기본 화면) 높이에 맞춥니다. 넘치는 내용은 블록 안에서 스크롤합니다.
function syncBlockHeight() {
  const board = $("board");
  const budget = board.querySelector('[data-kpi-panel="budget"]');
  if (!budget || budget.classList.contains("is-expanded")) return;
  board.classList.remove("is-synced");
  board.style.setProperty("--kpi-block-h", `${Math.ceil(budget.getBoundingClientRect().height)}px`);
  board.classList.add("is-synced");
  resizeCharts();
}

let syncFrame = 0;
window.addEventListener("resize", () => {
  cancelAnimationFrame(syncFrame);
  syncFrame = requestAnimationFrame(syncBlockHeight);
});

function setExpanded(panel) {
  root.querySelectorAll(".kpi-panel.is-expanded").forEach((p) => p.classList.remove("is-expanded"));
  if (panel) panel.classList.add("is-expanded");
  root.querySelector(".kpi-backdrop").hidden = !panel;
  if (!panel) syncBlockHeight();
  root.querySelectorAll(".kpi-expand").forEach((btn) => {
    const open = btn.closest(".kpi-panel") === panel;
    btn.setAttribute("aria-label", open ? "원래 크기로" : "블록 확대");
    btn.title = open ? "닫기 (Esc)" : "확대";
  });
  resizeCharts();
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
    view.summary = data;
    renderScorecards(data);
    renderBudget(data);
    renderRoas(data);
    renderGa4(data);
    syncBlockHeight();
  } catch (err) {
    root.querySelector(".kpi-legend-note").hidden = false;
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
    // 기본값: 베트남어 리뷰를 AI가 한국어로 다듬어 보여 줍니다. 키가 있으면 처음 한 번 자동 실행(서버가 결과 보관).
    if (!data.ai && data.ai_available && !vocAutoTried) {
      vocAutoTried = true;
      setText("voc-summary", "AI가 베트남어 리뷰를 한국어로 다듬는 중…");
      analyzeVoc(root.querySelector('[data-kpi-action="voc-analyze"]'));
    }
  } catch (err) {
    showError("voc-error", `VOC 데이터를 불러오지 못했습니다: ${err.message}`);
  }
}

let vocAutoTried = false;

// ---------- 블록 순서 바꾸기 (위젯) — 순서는 이 브라우저에만 저장 ----------
const ORDER_KEY = "kpi-board-order";
const DEFAULT_ORDER = ["budget", "roas", "voc", "ga4"];
let dragged = null;

function boardPanels() {
  return [...$("board").querySelectorAll(":scope > .kpi-panel")];
}

function saveOrder() {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(boardPanels().map((p) => p.dataset.kpiPanel)));
  } catch { /* 저장이 막힌 브라우저에서는 이번 화면에만 적용 */ }
}

function applyOrder(order) {
  const board = $("board");
  const byKey = Object.fromEntries(boardPanels().map((p) => [p.dataset.kpiPanel, p]));
  const keys = [...order.filter((k) => byKey[k]), ...DEFAULT_ORDER.filter((k) => !order.includes(k) && byKey[k])];
  keys.forEach((k) => board.append(byKey[k]));
  resizeCharts();
}

function loadOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem(ORDER_KEY) || "null");
    if (Array.isArray(saved)) applyOrder(saved);
  } catch { /* 저장 값이 없거나 깨졌으면 기본 순서 */ }
}

function movePanel(panel, dir) {
  const panels = boardPanels();
  const to = panels.indexOf(panel) + dir;
  if (to < 0 || to >= panels.length) return;
  if (dir < 0) panels.at(to).before(panel);
  else panels.at(to).after(panel);
  saveOrder();
  resizeCharts();
  panel.querySelector(`[data-kpi-action="move"][data-dir="${dir}"]`)?.focus();
}

root.addEventListener("dragstart", (event) => {
  const handle = event.target.closest?.(".kpi-drag");
  if (!handle) return;
  dragged = handle.closest(".kpi-panel");
  dragged.classList.add("is-dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", dragged.dataset.kpiPanel);
  event.dataTransfer.setDragImage(dragged, 24, 24);
});

root.addEventListener("dragover", (event) => {
  const over = event.target.closest?.(".kpi-board > .kpi-panel");
  if (!dragged || !over) return;
  event.preventDefault();
  root.querySelectorAll(".is-drop-target").forEach((p) => p !== over && p.classList.remove("is-drop-target"));
  if (over !== dragged) over.classList.add("is-drop-target");
});

root.addEventListener("drop", (event) => {
  const over = event.target.closest?.(".kpi-board > .kpi-panel");
  if (!dragged || !over || over === dragged) return;
  event.preventDefault();
  const panels = boardPanels();
  if (panels.indexOf(dragged) < panels.indexOf(over)) over.after(dragged);
  else over.before(dragged);
  saveOrder();
  resizeCharts();
});

root.addEventListener("dragend", () => {
  dragged?.classList.remove("is-dragging");
  root.querySelectorAll(".is-drop-target").forEach((p) => p.classList.remove("is-drop-target"));
  dragged = null;
});

async function analyzeVoc(button) {
  button.disabled = true;
  button.textContent = "분석 중…";
  showError("voc-error", "");
  try {
    const data = await getJson(API.analyze, { method: "POST" });
    showVocAi(vocReviews, data.ai);
  } catch (err) {
    showError("voc-error", `${err.message}`);
    setText("voc-summary", "");
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
    loadSimulator();
  } else if (action === "simulate") {
    setExpanded(target.closest(".kpi-panel"));
    requestAnimationFrame(() => {
      $("sim").scrollIntoView({ block: "start", behavior: "smooth" });
      $("sim-influencer").focus({ preventScroll: true });
    });
  } else if (action === "sim-remove") {
    sim.items = sim.items.filter((it) => String(it.id) !== target.dataset.id);
    renderSim();
  } else if (action === "voc-analyze") {
    analyzeVoc(target);
  } else if (action === "currency") {
    setCurrency(target.dataset.cur);
  } else if (action === "move") {
    movePanel(target.closest(".kpi-panel"), Number(target.dataset.dir));
  } else if (action === "reset-order") {
    applyOrder(DEFAULT_ORDER);
    saveOrder();
  } else if (action === "expand") {
    const panel = target.closest(".kpi-panel");
    setExpanded(panel.classList.contains("is-expanded") ? null : panel);
  } else if (action === "collapse") {
    setExpanded(null);
  }
});

root.addEventListener("change", (event) => {
  if (event.target.matches('[data-kpi-action="ga4-toggle"]')) setGa4Visible(event.target.checked);
  if (event.target.matches('[data-kpi="sim-form"] [name="kind"]')) setSimKind(event.target.value);
  if (event.target.matches('[data-kpi-action="review-lang"]')) setReviewLang(event.target.value);
  if (event.target.matches('[data-kpi-action="review-filter"]')) setReviewFilter(event.target.value);
});

root.addEventListener("submit", (event) => {
  if (!event.target.matches('[data-kpi="sim-form"]')) return;
  event.preventDefault();
  if (sim.data) addSimItem(event.target);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setExpanded(null);
});

chartNotice();
loadOrder();
document.fonts?.ready.then(syncBlockHeight);  // 글꼴이 늦게 적용되면 예산 블록 높이가 바뀌므로 다시 맞춤
setGa4Visible(true);
loadSummary();
loadVoc();
loadSimulator();
