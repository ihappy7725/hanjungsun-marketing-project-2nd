// KPI 엑셀(.xlsx) 만들기 [민지]
// 새 라이브러리 없이 브라우저에서 바로 만듭니다. .xlsx는 "시트·차트 XML 여러 개를 묶은 zip"이므로
// XML을 만들고 압축하지 않은(저장 방식) zip으로 묶습니다. 엑셀·구글 시트·LibreOffice에서 열립니다.
//
// 사용:
//   const sh = new Sheet("요약 보고");
//   sh.put(0, 1, "제목", { bold: true, size: 18 });            // 행·열은 0부터
//   sh.merge(0, 1, 0, 8);
//   sh.chart({ type: "bar", title: "ROAS", cats: [r1, c, r2], series: [{ name: "ROAS", vals: [r1, c2, r2], color: "4E6E6A" }],
//              anchor: [row, col, row2, col2] });
//   downloadXlsx("파일.xlsx", [sh]);
//
// 셀 서식은 { bold, italic, size, color, fill, fmt, align, valign, wrap, border: "bottom" | "top" | "box" | "hair" } 조합으로
// 자유롭게 주면 필요한 서식표를 자동으로 만듭니다. 숫자는 숫자 칸으로 저장합니다(엑셀에서 바로 계산 · 정렬).

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const NS_C = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_XDR = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";
const FONT = "맑은 고딕";

// XML에 넣을 수 없는 제어 문자는 지우고 특수 문자는 바꿉니다.
const esc = (value) => String(value)
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const colName = (index) => {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    name = String.fromCharCode(65 + r) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
};
const cellRef = (r, c) => `${colName(c)}${r + 1}`;
const absRef = (sheetName, r1, c1, r2, c2) => `'${sheetName.replace(/'/g, "''")}'!$${colName(c1)}$${r1 + 1}:$${colName(c2)}$${r2 + 1}`;
const hex = (color, fallback = "4E6E6A") => {
  const m = String(color || "").trim().match(/^#?([0-9a-f]{6})$/i);
  return (m ? m[1] : fallback).toUpperCase();
};

// ---------- 시트 ----------
export class Sheet {
  constructor(name) {
    this.name = name;
    this.cells = new Map();   // "r,c" → { v, s }
    this.heights = new Map(); // 행 → 높이(pt)
    this.widths = [];         // 열 → 너비(문자 수)
    this.merges = [];
    this.charts = [];
    this.filter = null;
    this.gridLines = true;
  }

  put(r, c, v, style = {}) {
    this.cells.set(`${r},${c}`, { v, s: style });
    return this;
  }

  merge(r1, c1, r2, c2) {
    if (r1 !== r2 || c1 !== c2) this.merges.push([r1, c1, r2, c2]);
    return this;
  }

  height(r, pt) {
    this.heights.set(r, pt);
    return this;
  }

  // 차트: type "bar"(세로) | "barH"(가로) | "doughnut", grouping "clustered" | "stacked" | "percentStacked"
  // series[].labelColor: 막대 안 숫자 색(진한 막대 위에서는 흰색)
  // cats/vals는 [r1, c, r2] (같은 열의 r1~r2), series[].name은 글자, line: true면 꺾은선(기준선 등)
  chart(spec) {
    this.charts.push(spec);
    return this;
  }

  autoFilter(r1, c1, r2, c2) {
    this.filter = [r1, c1, r2, c2];
    return this;
  }
}

// ---------- 서식표 (필요한 조합만 만들기) ----------
class Styles {
  constructor() {
    this.fonts = ['<font><sz val="10"/><name val="' + FONT + '"/><family val="2"/></font>'];
    this.fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
    this.borders = ["<border><left/><right/><top/><bottom/><diagonal/></border>"];
    this.numFmts = [];
    this.xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
    this.keys = new Map([["{}", 0]]);
  }

  index(list, xml) {
    const i = list.indexOf(xml);
    if (i >= 0) return i;
    list.push(xml);
    return list.length - 1;
  }

  fmtId(code) {
    const builtin = { General: 0, "0": 1, "0.00": 2, "#,##0": 3, "#,##0.00": 4, "0%": 9, "0.00%": 10 };
    if (code in builtin) return builtin[code];
    let found = this.numFmts.find((f) => f.code === code);
    if (!found) {
      found = { id: 164 + this.numFmts.length, code };
      this.numFmts.push(found);
    }
    return found.id;
  }

  id(s = {}) {
    const key = JSON.stringify(s, Object.keys(s).sort());
    if (this.keys.has(key)) return this.keys.get(key);
    const font = `<font>${s.bold ? "<b/>" : ""}${s.italic ? "<i/>" : ""}<sz val="${s.size || 10}"/>`
      + `${s.color ? `<color rgb="FF${hex(s.color)}"/>` : ""}<name val="${FONT}"/><family val="2"/></font>`;
    const fontId = this.index(this.fonts, font);
    const fillId = s.fill
      ? this.index(this.fills, `<fill><patternFill patternType="solid"><fgColor rgb="FF${hex(s.fill)}"/><bgColor indexed="64"/></patternFill></fill>`)
      : 0;
    const line = (side, style, color) => `<${side} style="${style}"><color rgb="FF${color}"/></${side}>`;
    const borderXml = {
      bottom: `<border><left/><right/><top/>${line("bottom", "thin", "2B2A28")}<diagonal/></border>`,
      hair: `<border><left/><right/><top/>${line("bottom", "thin", "E3DDD1")}<diagonal/></border>`,
      top: `<border><left/><right/>${line("top", "thin", "2B2A28")}${line("bottom", "thin", "2B2A28")}<diagonal/></border>`,
      box: `<border>${line("left", "thin", "D9CFBD")}${line("right", "thin", "D9CFBD")}${line("top", "thin", "D9CFBD")}${line("bottom", "thin", "D9CFBD")}<diagonal/></border>`,
    }[s.border];
    const borderId = borderXml ? this.index(this.borders, borderXml) : 0;
    const numFmtId = s.fmt ? this.fmtId(s.fmt) : 0;
    const align = s.align || s.valign || s.wrap
      ? `<alignment${s.align ? ` horizontal="${s.align}"` : ""} vertical="${s.valign || "center"}"${s.wrap ? ' wrapText="1"' : ""}/>`
      : "";
    const xf = `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"`
      + `${numFmtId ? ' applyNumberFormat="1"' : ""}${fontId ? ' applyFont="1"' : ""}${fillId ? ' applyFill="1"' : ""}`
      + `${borderId ? ' applyBorder="1"' : ""}${align ? ' applyAlignment="1">' + align + "</xf>" : "/>"}`;
    this.xfs.push(xf);
    const id = this.xfs.length - 1;
    this.keys.set(key, id);
    return id;
  }

  xml() {
    const fmts = this.numFmts.length
      ? `<numFmts count="${this.numFmts.length}">${this.numFmts.map((f) => `<numFmt numFmtId="${f.id}" formatCode="${esc(f.code)}"/>`).join("")}</numFmts>`
      : "";
    return `${XML_HEAD}<styleSheet xmlns="${NS_MAIN}">${fmts}`
      + `<fonts count="${this.fonts.length}">${this.fonts.join("")}</fonts>`
      + `<fills count="${this.fills.length}">${this.fills.join("")}</fills>`
      + `<borders count="${this.borders.length}">${this.borders.join("")}</borders>`
      + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + `<cellXfs count="${this.xfs.length}">${this.xfs.join("")}</cellXfs>`
      + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  }
}

function sheetXml(sheet, styles, hasDrawing) {
  const rows = new Map();
  for (const [key, cell] of sheet.cells) {
    const [r, c] = key.split(",").map(Number);
    if (!rows.has(r)) rows.set(r, []);
    rows.get(r).push([c, cell]);
  }
  for (const r of sheet.heights.keys()) if (!rows.has(r)) rows.set(r, []);
  const body = [...rows.keys()].sort((a, b) => a - b).map((r) => {
    const ht = sheet.heights.get(r);
    const cells = rows.get(r).sort((a, b) => a[0] - b[0]).map(([c, { v, s }]) => {
      const ref = cellRef(r, c);
      const sid = styles.id(s);
      if (v === null || v === undefined || v === "") return `<c r="${ref}" s="${sid}"/>`;
      if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}" s="${sid}"><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr" s="${sid}"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    }).join("");
    return `<row r="${r + 1}"${ht ? ` ht="${ht}" customHeight="1"` : ""}>${cells}</row>`;
  }).join("");
  const cols = sheet.widths.length
    ? `<cols>${sheet.widths.map((w, i) => (w ? `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>` : "")).join("")}</cols>`
    : "";
  const view = `<sheetViews><sheetView workbookViewId="0"${sheet.gridLines ? "" : ' showGridLines="0"'}${sheet.zoom ? ` zoomScale="${sheet.zoom}"` : ""}/></sheetViews>`;
  const filter = sheet.filter ? `<autoFilter ref="${cellRef(sheet.filter[0], sheet.filter[1])}:${cellRef(sheet.filter[2], sheet.filter[3])}"/>` : "";
  const merges = sheet.merges.length
    ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map(([r1, c1, r2, c2]) => `<mergeCell ref="${cellRef(r1, c1)}:${cellRef(r2, c2)}"/>`).join("")}</mergeCells>`
    : "";
  const page = '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>'
    + '<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/>';
  return `${XML_HEAD}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>${view}`
    + `<sheetFormatPr defaultRowHeight="16.5"/>${cols}<sheetData>${body}</sheetData>${filter}${merges}${page}`
    + `${hasDrawing ? '<drawing r:id="rId1"/>' : ""}</worksheet>`;
}

// ---------- 차트 (DrawingML) ----------
const solid = (color) => `<a:solidFill><a:srgbClr val="${hex(color)}"/></a:solidFill>`;
const txPr = (size, bold = false, color = "4A4844") => `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${size}"${bold ? ' b="1"' : ""}>`
  + `${solid(color)}<a:latin typeface="${FONT}"/><a:ea typeface="${FONT}"/></a:defRPr></a:pPr><a:endParaRPr lang="ko-KR"/></a:p></c:txPr>`;
const dLbls = (fmt, { percent = false, show = true, pos = "", color = "4A4844" } = {}) => `<c:dLbls>${fmt ? `<c:numFmt formatCode="${esc(fmt)}" sourceLinked="0"/>` : ""}`
  + `<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${txPr(800, false, hex(color, "4A4844"))}${pos ? `<c:dLblPos val="${pos}"/>` : ""}`
  + `<c:showLegendKey val="0"/><c:showVal val="${show && !percent ? 1 : 0}"/><c:showCatName val="0"/><c:showSerName val="0"/>`
  + `<c:showPercent val="${percent ? 1 : 0}"/><c:showBubbleSize val="0"/></c:dLbls>`;

function chartXml(sheetName, spec) {
  const ref = ([r1, c, r2]) => absRef(sheetName, r1, c, r2, c);
  const title = spec.title
    ? `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1100" b="1"/></a:pPr><a:r><a:rPr lang="ko-KR" sz="1100" b="1">${solid("2B2A28")}`
      + `<a:latin typeface="${FONT}"/><a:ea typeface="${FONT}"/></a:rPr><a:t>${esc(spec.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>`
    : '<c:autoTitleDeleted val="1"/>';
  const cat = `<c:cat><c:strRef><c:f>${ref(spec.cats)}</c:f></c:strRef></c:cat>`;
  const serName = (s) => `<c:tx><c:v>${esc(s.name)}</c:v></c:tx>`;
  let plot;
  if (spec.type === "doughnut") {
    const s = spec.series[0];
    const pts = (s.colors || []).map((col, i) => `<c:dPt><c:idx val="${i}"/><c:bubble3D val="0"/><c:spPr>${solid(col)}<a:ln w="12700"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:dPt>`).join("");
    plot = `<c:doughnutChart><c:varyColors val="1"/><c:ser><c:idx val="0"/><c:order val="0"/>${serName(s)}${pts}${dLbls("0.0%", { percent: true })}`
      + `${cat}<c:val><c:numRef><c:f>${ref(s.vals)}</c:f></c:numRef></c:val></c:ser><c:firstSliceAng val="0"/><c:holeSize val="58"/></c:doughnutChart>`;
  } else {
    const horizontal = spec.type === "barH";
    const grouping = spec.grouping || "clustered";
    const bars = spec.series.filter((s) => !s.line);
    const lines = spec.series.filter((s) => s.line);
    const barSer = bars.map((s, i) => {
      const pts = (s.pointColors || []).map((col, p) => (col ? `<c:dPt><c:idx val="${p}"/><c:invertIfNegative val="0"/><c:bubble3D val="0"/><c:spPr>${solid(col)}</c:spPr></c:dPt>` : "")).join("");
      return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${serName(s)}<c:spPr>${solid(s.color)}</c:spPr><c:invertIfNegative val="0"/>${pts}`
        + `${spec.labels === false ? "" : dLbls(s.fmt || "#,##0", { pos: grouping === "clustered" ? "outEnd" : "ctr", color: s.labelColor })}${cat}<c:val><c:numRef><c:f>${ref(s.vals)}</c:f></c:numRef></c:val></c:ser>`;
    }).join("");
    const lineSer = lines.map((s, i) => `<c:ser><c:idx val="${bars.length + i}"/><c:order val="${bars.length + i}"/>${serName(s)}`
      + `<c:spPr><a:ln w="19050" cap="rnd"><a:solidFill><a:srgbClr val="${hex(s.color)}"/></a:solidFill><a:prstDash val="dash"/></a:ln></c:spPr>`
      + `<c:marker><c:symbol val="none"/></c:marker>${cat}<c:val><c:numRef><c:f>${ref(s.vals)}</c:f></c:numRef></c:val><c:smooth val="0"/></c:ser>`).join("");
    const axisLine = '<c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="D9CFBD"/></a:solidFill></a:ln></c:spPr>';
    plot = `<c:barChart><c:barDir val="${horizontal ? "bar" : "col"}"/><c:grouping val="${grouping}"/><c:varyColors val="0"/>${barSer}`
      + `<c:gapWidth val="${spec.gap ?? 70}"/>${grouping === "clustered" ? "" : '<c:overlap val="100"/>'}<c:axId val="101"/><c:axId val="102"/></c:barChart>`
      + (lineSer ? `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${lineSer}<c:marker val="1"/><c:axId val="101"/><c:axId val="102"/></c:lineChart>` : "")
      + `<c:catAx><c:axId val="101"/><c:scaling><c:orientation val="${horizontal ? "maxMin" : "minMax"}"/></c:scaling><c:delete val="0"/>`
      + `<c:axPos val="${horizontal ? "l" : "b"}"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/>`
      + `<c:tickLblPos val="nextTo"/>${axisLine}${txPr(800)}<c:crossAx val="102"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`
      + `<c:valAx><c:axId val="102"/><c:scaling><c:orientation val="minMax"/>${spec.max != null ? `<c:max val="${spec.max}"/>` : ""}<c:min val="0"/></c:scaling>`
      + `<c:delete val="${spec.hideValueAxis ? 1 : 0}"/><c:axPos val="${horizontal ? "t" : "l"}"/>`
      + '<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="ECE7DD"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>'
      + `<c:numFmt formatCode="${esc(spec.axisFmt || "#,##0")}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>`
      + `<c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${txPr(800, false, "8A857C")}<c:crossAx val="101"/><c:crosses val="${horizontal ? "max" : "autoZero"}"/><c:crossBetween val="between"/></c:valAx>`;
  }
  const legend = spec.legend === false ? "" : `<c:legend><c:legendPos val="${spec.legendPos || "b"}"/><c:overlay val="0"/>${txPr(800)}</c:legend>`;
  return `${XML_HEAD}<c:chartSpace xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:r="${NS_REL}"><c:roundedCorners val="0"/>`
    + `<c:chart>${title}<c:plotArea><c:layout/>${plot}<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:plotArea>${legend}`
    + '<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>'
    + '<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="6350"><a:solidFill><a:srgbClr val="E3DDD1"/></a:solidFill></a:ln></c:spPr>'
    + `${txPr(900)}<c:printSettings><c:headerFooter/><c:pageMargins b="0.75" l="0.7" r="0.7" t="0.75" header="0.3" footer="0.3"/><c:pageSetup/></c:printSettings></c:chartSpace>`;
}

function drawingXml(sheet, firstChartNo) {
  const anchors = sheet.charts.map((spec, i) => {
    const [r1, c1, r2, c2] = spec.anchor;
    return `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${c1}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>`
      + `<xdr:to><xdr:col>${c2}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r2}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>`
      + `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Chart ${firstChartNo + i}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>`
      + '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">'
      + `<c:chart xmlns:c="${NS_C}" xmlns:r="${NS_REL}" r:id="rId${i + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
  }).join("");
  return `${XML_HEAD}<xdr:wsDr xmlns:xdr="${NS_XDR}" xmlns:a="${NS_A}">${anchors}</xdr:wsDr>`;
}

// 시트 이름: 31자 이하, []:*?/\ 사용 불가, 중복 불가
function fixNames(sheets) {
  const used = new Set();
  sheets.forEach((s, i) => {
    let name = String(s.name || `Sheet${i + 1}`).replace(/[[\]:*?/\\]/g, " ").slice(0, 31) || `Sheet${i + 1}`;
    while (used.has(name)) name = `${name.slice(0, 28)}_${i + 1}`;
    used.add(name);
    s.name = name;
  });
}

function workbookFiles(sheets) {
  fixNames(sheets);
  const styles = new Styles();
  const files = {};
  const overrides = [];
  let chartNo = 1;
  let drawingNo = 1;
  sheets.forEach((sheet, i) => {
    const n = i + 1;
    const hasDrawing = sheet.charts.length > 0;
    files[`xl/worksheets/sheet${n}.xml`] = sheetXml(sheet, styles, hasDrawing);
    overrides.push(`<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
    if (!hasDrawing) return;
    const d = drawingNo++;
    files[`xl/worksheets/_rels/sheet${n}.xml.rels`] = `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">`
      + `<Relationship Id="rId1" Type="${NS_REL}/drawing" Target="../drawings/drawing${d}.xml"/></Relationships>`;
    files[`xl/drawings/drawing${d}.xml`] = drawingXml(sheet, chartNo);
    overrides.push(`<Override PartName="/xl/drawings/drawing${d}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
    const rels = sheet.charts.map((spec, k) => {
      const no = chartNo + k;
      files[`xl/charts/chart${no}.xml`] = chartXml(sheet.name, spec);
      overrides.push(`<Override PartName="/xl/charts/chart${no}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
      return `<Relationship Id="rId${k + 1}" Type="${NS_REL}/chart" Target="../charts/chart${no}.xml"/>`;
    }).join("");
    files[`xl/drawings/_rels/drawing${d}.xml.rels`] = `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">${rels}</Relationships>`;
    chartNo += sheet.charts.length;
  });
  const defined = sheets.map((s, i) => (s.filter
    ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${absRef(s.name, s.filter[0], s.filter[1], s.filter[2], s.filter[3])}</definedName>`
    : "")).join("");
  files["xl/workbook.xml"] = `${XML_HEAD}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><bookViews><workbookView activeTab="0"/></bookViews><sheets>`
    + sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")
    + `</sheets>${defined ? `<definedNames>${defined}</definedNames>` : ""}</workbook>`;
  files["xl/_rels/workbook.xml.rels"] = `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">`
    + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")
    + `<Relationship Id="rId${sheets.length + 1}" Type="${NS_REL}/styles" Target="styles.xml"/></Relationships>`;
  files["xl/styles.xml"] = styles.xml();  // 시트를 만든 뒤에(쓰인 서식이 모두 등록된 뒤에) 씁니다.
  files["_rels/.rels"] = `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  files["[Content_Types].xml"] = `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + `${overrides.join("")}</Types>`;
  return files;
}

// ---------- zip (저장 방식, 압축 없음) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  // [Content_Types].xml을 맨 앞에 둡니다(일부 프로그램이 첫 파일로 기대함).
  const entries = Object.entries(files).sort(([a], [b]) => (a === "[Content_Types].xml" ? -1 : b === "[Content_Types].xml" ? 1 : 0));
  for (const [path, text] of entries) {
    const name = enc.encode(path);
    const data = enc.encode(text);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);  // 파일 이름 UTF-8
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(local, name, data);
    const head = new DataView(new ArrayBuffer(46));
    head.setUint32(0, 0x02014b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 20, true);
    head.setUint16(8, 0x0800, true);
    head.setUint32(16, crc, true);
    head.setUint32(20, data.length, true);
    head.setUint32(24, data.length, true);
    head.setUint16(28, name.length, true);
    head.setUint32(42, offset, true);
    central.push(head, name);
    offset += 30 + name.length + data.length;
  }
  const centralSize = central.reduce((s, p) => s + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function buildXlsx(sheets) {
  return zip(workbookFiles(sheets));
}

export function downloadXlsx(filename, sheets) {
  const url = URL.createObjectURL(buildXlsx(sheets));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
