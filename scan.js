"use strict";
/* The "Daily scan" tab: what moved before the open, 52-week highs and lows, and insider buys, from daily-scan.json
   (built each weekday at 6:00 AM Seattle time by tools/daily_scan.py, plain price look-ups, no AI).
   Uses the helpers defined in index.html ($, h, fmt). A record of what moved and what the news feed said; never advice. */
(function () {
  const panel = $("#tab-scan");
  const S = { loading: false, data: null, replay: null };
  const PUBLIC = !!window.SC_PUBLIC;                 // the public web copy: no Discord-derived facts
  panel.innerHTML = `
  <h1>Daily scan</h1>
  <p class="lede" id="sc-lede">Loading…</p>
  <div id="sc-body"></div>`;

  const pct = (r, d = 0) => { if (r == null || !isFinite(r)) return "–"; const t = Math.abs(r * 100).toFixed(d); return (+t === 0 ? "" : r > 0 ? "+" : "−") + t + "%"; };
  const cls = r => (r == null ? "flat" : r > 0 ? "up" : r < 0 ? "down" : "flat");
  const tint = (r, d = 0) => h("span", { class: cls(r), text: (r > 0 ? "▲ " : r < 0 ? "▼ " : "") + pct(r, d) });
  const px = v => (v == null ? "–" : "$" + (Math.abs(v) < 1 ? v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "") : v.toFixed(2)));
  const big = n => (n >= 1e9 ? (n / 1e9).toFixed(1) + "B" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "K" : String(n));
  const clock = m => (m == null ? "–" : ((m / 60 | 0) % 12 || 12) + ":" + String(m % 60).padStart(2, "0") + (m < 720 ? " AM" : " PM"));
  const KIND = { financing: "offering, listing or filing", short: "short-seller report", deal: "deal", product: "product, trial or approval", earnings: "earnings", analyst: "analyst note", move: "price-move commentary", other: "company news" };
  const yahoo = s => h("a", { class: "link", href: "https://finance.yahoo.com/quote/" + encodeURIComponent(s), target: "_blank", rel: "noopener noreferrer", text: s + " ↗" });
  const newsCell = m => {
    const n = m.news;
    if (!n || !n.last) return h("span", { class: "sub", text: n ? "none about the stock" : "–" });
    const t = new Date(n.last.t);
    const when = t.toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const text = (KIND[n.last.k] || "news") + ", " + when + ": " + n.last.h;
    return n.last.u && n.last.u.startsWith("https://") ? h("a", { class: "link", href: n.last.u, target: "_blank", rel: "noopener noreferrer", text }) : h("span", { text });
  };
  function card(title, sub, ...kids) {
    const id = "sc-" + title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-$/, "");
    const how = !sub ? null : sub.length < 110 ? h("p", { class: "sub", text: sub }) : h("details", { class: "howto" }, h("summary", { text: "How this list is chosen" }), h("p", { class: "sub", text: sub }));
    return h("section", { class: "card full", id, style: "margin-bottom:16px" }, h("header", {}, h("div", {}, h("h2", { text: title }), how)), ...kids);
  }
  /* A table whose rows can carry a detail block: click the stock to open it. details[i] is a node (or null) shown under row i. */
  function table(head, rows, numeric = [], details = null) {
    const cols = head.length, body = [];
    rows.forEach((r, i) => {
      const tr = h("tr", {}, r.map((c, j) => h("td", { class: numeric.includes(j) ? "n" : "" }, c)));
      body.push(tr);
      if (details && details[i]) {
        const dtr = h("tr", { class: "scan-detail", hidden: "" }, h("td", { colspan: String(cols), style: "background:var(--bg2, #f6f5f1);padding:10px 14px" }, details[i]));
        dtr.hidden = true;
        body.push(dtr);
      }
    });
    return h("div", { class: "tablewrap tall" }, h("table", {}, h("thead", {}, h("tr", {}, head.map((t, i) => h("th", { class: numeric.includes(i) ? "n" : "", text: t })))), h("tbody", {}, body)));
  }
  const empty = text => h("p", { class: "sub", text });

  /* ----- dates and times, always written out ----- */
  const dayLabel = iso => (iso ? new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }) : "–");
  const dayAt = (iso, minute) => dayLabel(iso) + ", " + clock(minute);
  const ptParts = iso => { const f = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso)).reduce((a, x) => (a[x.type] = x.value, a), {}); return { day: f.year + "-" + f.month + "-" + f.day, min: +f.hour * 60 + +f.minute }; };
  const when = iso => { const q = ptParts(iso); return dayAt(q.day, q.min); };
  const two = (top, bottom) => h("div", {}, h("div", { text: top }), h("div", { class: "sub", style: "margin:0;white-space:nowrap", text: bottom }));
  const link = (href, text) => h("a", { class: "link", href, target: "_blank", rel: "noopener noreferrer", text });
  const safe = u => (u && u.startsWith("https://") ? u : "");

  /* ----- one stock's evidence: price line with the news marked, history, filings, headlines, links ----- */
  const T0 = 60, T1 = 390;
  function priceLine(m, day) {
    if (!m.series || m.series.length < 2) return null;
    const W = 600, H = 96, L = 8, R = 8, Tp = 8, B = 16, ys = m.series.map(x => x[1]).concat(m.prev ? [m.prev] : []), lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
    const X = mn => L + (Math.min(Math.max(mn, T0), T1) - T0) / (T1 - T0) * (W - L - R), Y = v => Tp + (1 - (v - lo) / span) * (H - Tp - B);
    const marks = [];
    for (const x of (m.news && m.news.items) || []) { const q = ptParts(x.t); if (q.day === day && q.min >= T0 && q.min <= T1) marks.push([q.min, "#2d6cdf"]); }
    for (const x of m.filings || []) { const q = ptParts(x.t); if (q.day === day && q.min >= T0 && q.min <= T1) marks.push([q.min, "#d9822b"]); }
    const poly = m.series.map(x => X(x[0]).toFixed(1) + "," + Y(x[1]).toFixed(1)).join(" ");
    const hours = [60, 120, 180, 240, 300, 360].map(mn => `<text x="${X(mn).toFixed(1)}" y="${H - 3}" font-size="9" fill="currentColor" opacity=".55" text-anchor="middle">${clock(mn).replace(":00", "")}</text>`).join("");
    const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;height:auto" role="img" aria-label="Premarket price line">` +
      (m.prev ? `<line x1="${L}" x2="${W - R}" y1="${Y(m.prev).toFixed(1)}" y2="${Y(m.prev).toFixed(1)}" stroke="currentColor" opacity=".35" stroke-dasharray="3 3"/>` : "") +
      marks.map(([mn, c]) => `<line x1="${X(mn).toFixed(1)}" x2="${X(mn).toFixed(1)}" y1="${Tp}" y2="${H - B}" stroke="${c}" stroke-width="2" opacity=".8"/>`).join("") +
      `<polyline points="${poly}" fill="none" stroke="#1f7a4d" stroke-width="1.8"/>` + hours + `</svg>`;
    const box = h("div", {});
    box.innerHTML = svg;
    box.append(h("div", { class: "sub", style: "margin:0", text: "Price every 5 minutes, 1:00 to 6:30 AM Seattle on " + dayLabel(day) + " (" + px(lo) + " to " + px(hi) + "). Dashed line: previous close of " + px(m.prev) + ". Blue marks: a headline about the stock came out; orange marks: an SEC filing was accepted." }));
    return box;
  }
  function detailOf(m, day, kind) {
    const parts = [], fact = (label, text) => h("li", {}, h("b", { text: label + " " }), text);
    const pb = kind ? plainBox(m, day, kind) : null;
    if (pb) parts.push(pb);
    if (kind) { const rc = riskChips(m); if (rc.length) parts.push(h("div", { class: "mv-chips", style: "padding:0 0 10px" }, rc)); }
    const line = priceLine(m, day);
    if (line) parts.push(line);
    const facts = [];
    if (m.firstAt != null) facts.push(fact("First trade before the open:", dayAt(day, m.firstAt) + (m.openPct != null ? ", " + pct(m.openPct) + " from the previous close" : "") + (m.cross10 != null ? ". First minute closing 10% over the previous close: " + dayAt(day, m.cross10) : "")));
    if (m.prevDay) facts.push(fact("Before this morning:", "closed " + px(m.prev != null ? m.prev : m.close) + " on " + dayLabel(m.prevDay || m.closeDay) + (m.prevVol != null ? " on " + big(m.prevVol) + " shares" + (m.avgVol ? " (usual " + big(m.avgVol) + ")" : "") : "")));
    if (m.closeDay && !m.prevDay) facts.push(fact("Last close:", px(m.close) + " on " + dayLabel(m.closeDay) + " on " + big(m.vol) + " shares" + (m.avgVol ? " (usual " + big(m.avgVol) + ")" : "")));
    if (m.ret5 != null || m.ret20 != null) facts.push(fact("Run-up before the scan:", [m.ret5 != null ? pct(m.ret5, 1) + " over the last 5 sessions" : null, m.ret20 != null ? pct(m.ret20, 1) + " over the last 20" : null].filter(Boolean).join(", ") + " (to the close of " + dayLabel(m.prevDay || m.closeDay) + ")"));
    if (m.hi52 != null) facts.push(fact("52-week range:", "high " + px(m.hi52) + " on " + dayLabel(m.hi52Day) + ", low " + px(m.lo52) + " on " + dayLabel(m.lo52Day) + " (before the previous session)"));
    if (PUBLIC) { /* the public copy leaves the Discord record out */ }
    else if (m.discord) facts.push(fact("In the Discord record (a local snapshot):", fmt(m.discord.posts) + " post" + (m.discord.posts === 1 ? "" : "s") + ", first " + m.discord.first.slice(0, 10) + ", latest " + m.discord.last.slice(0, 10) + (m.discord.top.length ? " (" + m.discord.top.join(", ") + ")" : "")));
    else facts.push(fact("In the Discord record (a local snapshot):", "no post about it"));
    parts.push(h("ul", { style: "margin:8px 0 6px;padding-left:18px" }, facts));
    const fil = m.filings;
    parts.push(h("div", {}, h("b", { text: "SEC filings in the 3 days before the scan: " }),
      fil == null ? h("span", { class: "sub", text: "not read" }) : !fil.length ? h("span", { text: "none" }) :
        h("ul", { style: "margin:4px 0 6px;padding-left:18px" }, fil.map(x => h("li", {}, h("span", { class: "when", text: when(x.t) + " · " }), safe(x.u) ? link(x.u, x.form) : x.form, " ",
          x.items.length ? x.items.map(i => i.n + (i.w ? " (" + i.w + ")" : "")).join("; ") : (x.desc || ""), x.offering ? " · a share offering or registration form" : "")))));
    const news = (m.news && m.news.items) || [];
    parts.push(h("div", {}, h("b", { text: "Headlines about the stock itself, last 3 days: " }), !news.length ? h("span", { text: "none in this feed (it misses small-company filings, halts and social media)" }) :
      h("ul", { style: "margin:4px 0 6px;padding-left:18px" }, news.map(x => h("li", {}, h("span", { class: "when", text: when(x.t) + " · " + (KIND[x.k] || "news") + " · " }), safe(x.u) ? link(x.u, x.h) : x.h)))));
    const sym = m.s;
    parts.push(h("div", {}, h("b", { text: "Look further: " }), link("https://finance.yahoo.com/quote/" + encodeURIComponent(sym), "Yahoo Finance chart ↗"), "  ·  ",
      m.cik ? link("https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=" + m.cik + "&owner=include&count=40", "All SEC filings ↗") : "", m.cik ? "  ·  " : "", link("https://www.google.com/search?tbm=nws&q=" + encodeURIComponent(sym + " stock"), "News search ↗")));
    parts.push(h("p", { class: "sub", style: "margin:6px 0 0", text: "A headline or filing near a jump is a lead, not proof of the reason. Nothing here says what the stock will do next." }));
    return h("div", {}, parts);
  }
  const filingsCell = m => {
    if (m.filings == null) return h("span", { class: "sub", text: "–" });
    if (!m.filings.length) return h("span", { class: "sub", text: "none" });
    const f = m.filings[0];
    return two(m.filings.length + " filing" + (m.filings.length === 1 ? "" : "s") + (m.filings.some(x => x.offering) ? " (offering form)" : ""), f.form + (f.items.length ? " " + f.items.map(i => i.n).join(", ") : "") + " · " + when(f.t));
  };
  const toggle = (m, day) => h("button", { class: "link", type: "button", style: "font-weight:650", title: "Open the evidence for " + m.s, text: "▸ " + m.s, onclick: ev => { const b = ev.currentTarget, tr = b.closest("tr").nextElementSibling; if (tr && tr.classList.contains("scan-detail")) { tr.hidden = !tr.hidden; b.textContent = (tr.hidden ? "▸ " : "▾ ") + m.s; } } });

  /* ----- the mover list: one card per stock, the story in one glance, click for the evidence ----- */
  const CSS = `
  #tab-scan h1{font-size:28px;letter-spacing:-.02em;margin-bottom:4px}
  #tab-scan .lede{max-width:none}
  #tab-scan .howto summary{cursor:pointer;color:var(--ink2);font-size:12.5px;margin-top:2px}
  #tab-scan .howto p{max-width:110ch;margin:6px 0 0}
  #tab-scan th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
  #tab-scan td{padding:9px 12px 9px 0}
  #tab-scan tbody tr:not(.scan-detail):hover td{background:var(--wash)}
  .sc-nav{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 16px}
  .sc-nav button{font:inherit;font-size:12.5px;font-weight:600;color:var(--ink2);background:var(--surface);border:1px solid var(--border);border-radius:999px;padding:5px 13px;cursor:pointer}
  .sc-nav button:hover{color:var(--ink);background:var(--wash)}
  .sc-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin:2px 0 14px}
  .sc-tile{border:1px solid var(--border);border-radius:12px;padding:11px 14px;background:var(--page)}
  .sc-tile .k{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
  .sc-tile .v{font-size:22px;font-weight:700;line-height:1.25;font-variant-numeric:tabular-nums}
  .sc-tile .v small{font-size:13px;font-weight:600;color:var(--ink2);margin-left:6px}
  .mv-plainshort{padding:0 16px 8px;font-size:13.5px;color:var(--ink)}
  .mv-plain{background:color-mix(in srgb,var(--s1) 8%,transparent);border:1px solid color-mix(in srgb,var(--s1) 25%,transparent);border-radius:10px;padding:10px 14px 4px;margin:0 0 14px}
  .mv-plain .k{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--s1);font-weight:700;margin-bottom:4px}
  .mv-plain p{margin:0 0 8px;font-size:14px;line-height:1.5;max-width:100ch}
  .sc-guide{border:1px solid var(--border);border-radius:12px;background:var(--surface);padding:10px 16px;margin:0 0 16px}
  .sc-guide summary{cursor:pointer;font-weight:650;font-size:14px}
  .sc-guide dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px 22px;margin:12px 0 8px}
  .sc-guide dt{font-weight:650;font-size:13px} .sc-guide dd{margin:2px 0 0;color:var(--ink2);font-size:13px}
  .mv-chip.risk{background:color-mix(in srgb,var(--down) 12%,transparent);color:var(--down);font-weight:600}
  .ld-list{max-height:380px;overflow:auto;border:1px solid var(--border);border-radius:12px;background:var(--page)}
  .ld-row{display:grid;grid-template-columns:minmax(150px,1.3fr) 110px minmax(120px,1fr) 110px;gap:10px;align-items:center;padding:7px 14px;border-bottom:1px solid var(--grid)}
  .ld-row:last-child{border-bottom:0}
  .ld-id b{display:block;font-size:15px} .ld-kind{font-size:12.5px;color:var(--ink2)} .ld-px{font-size:12.5px;color:var(--muted);font-variant-numeric:tabular-nums}
  .ld-row .mv-pct{font-size:14px;padding:3px 10px}
  .mv-bar{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;margin:8px 0 10px}
  .mv-bar h3{margin:0;font-size:15px}
  .seg{display:inline-flex;background:var(--wash);border-radius:9px;padding:2px}
  .seg button{font:inherit;font-size:12.5px;border:0;background:none;color:var(--ink2);padding:5px 11px;border-radius:7px;cursor:pointer}
  .seg button[aria-pressed=true]{background:var(--surface);color:var(--ink);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.14)}
  .mv-only{font-size:12.5px;color:var(--ink2);display:flex;gap:6px;align-items:center;cursor:pointer}
  .mv-count{margin-left:auto;font-size:12.5px;color:var(--muted)}
  .mv-row{border:1px solid var(--border);border-left-width:4px;border-radius:12px;background:var(--surface);margin-bottom:8px;transition:box-shadow .15s,border-color .15s}
  .mv-row.r-up{border-left-color:var(--up)} .mv-row.r-down{border-left-color:var(--down)} .mv-row.r-flat{border-left-color:var(--axis)}
  .mv-row:hover{box-shadow:0 3px 14px rgba(0,0,0,.08)}
  .mv-main{display:grid;grid-template-columns:minmax(150px,1.05fr) 130px minmax(200px,1.3fr) 112px 16px;gap:6px 18px;align-items:center;padding:12px 16px 8px;cursor:pointer;outline:none;border-radius:12px}
  .mv-main:focus-visible{box-shadow:0 0 0 2px var(--s1)}
  .mv-sym{display:block;font-size:19px;font-weight:700;letter-spacing:.01em}
  .mv-name{display:block;font-size:12.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .mv-spark{display:block;line-height:0}
  .mv-px .a{font-size:15px;font-weight:600;font-variant-numeric:tabular-nums}
  .mv-px .a i{font-style:normal;color:var(--muted);margin:0 6px}
  .mv-px .b{display:block;font-size:11.5px;color:var(--muted);margin-top:1px}
  .mv-pct{justify-self:end;font-size:18px;font-weight:700;padding:5px 12px;border-radius:999px;font-variant-numeric:tabular-nums;white-space:nowrap}
  .mv-pct.up{background:color-mix(in srgb,var(--up) 13%,transparent)} .mv-pct.down{background:color-mix(in srgb,var(--down) 13%,transparent)}
  .mv-chev{color:var(--muted);font-size:18px;line-height:1;transition:transform .15s}
  .mv-row.open .mv-chev{transform:rotate(90deg)}
  .mv-chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 13px}
  .mv-chip{font-size:12px;padding:2px 10px;border-radius:999px;background:var(--wash);color:var(--ink2);white-space:nowrap}
  .mv-chip.news{background:color-mix(in srgb,var(--s1) 15%,transparent);color:var(--s1);font-weight:600}
  .mv-chip.fil{background:color-mix(in srgb,var(--s2) 15%,transparent);color:var(--s2);font-weight:600}
  .mv-chip.hot{background:color-mix(in srgb,var(--s2) 15%,transparent);color:var(--ink);font-weight:600}
  .mv-detail{border-top:1px solid var(--grid);padding:14px 18px 16px;background:var(--page);border-radius:0 0 12px 12px}
  .mv-dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px 22px;margin:0 0 14px}
  .mv-dl .k{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
  .mv-dl .v{font-size:13.5px;white-space:normal}
  @media (max-width:760px){
    .ld-row{grid-template-columns:minmax(0,1fr) auto;gap:2px 10px} .ld-kind,.ld-px{grid-column:1} .ld-row .mv-pct{grid-column:2;grid-row:1 / span 2}
    .mv-main{grid-template-columns:minmax(0,1fr) auto;gap:8px 12px;padding:12px 12px 6px}
    .mv-spark,.mv-chev{display:none}
    .sc-tiles{grid-template-columns:1fr 1fr;gap:8px}
    .sc-tile{padding:9px 11px} .sc-tile .v{font-size:18px}
    .seg{flex-wrap:wrap}
    .mv-px{grid-column:1 / -1;grid-row:2}
    .mv-chips{padding:0 12px 12px}
  }`;
  document.head.append(h("style", { id: "sc-style", text: CSS }));

  function spark(m) {
    if (!m.series || m.series.length < 2) return h("span", { class: "sub", text: "" });
    const W = 130, H = 36, ys = m.series.map(x => x[1]).concat(m.prev ? [m.prev] : []), lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
    const X = mn => 2 + (Math.min(Math.max(mn, T0), T1) - T0) / (T1 - T0) * (W - 4), Y = v => 3 + (1 - (v - lo) / span) * (H - 6);
    const pts = m.series.map(x => X(x[0]).toFixed(1) + "," + Y(x[1]).toFixed(1));
    const box = h("span", { class: "mv-spark " + cls(m.lastPct), title: "Price every 5 minutes, 1:00 to 6:30 AM Seattle. Dashed: previous close." });
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Premarket price line">` +
      (m.prev ? `<line x1="2" x2="${W - 2}" y1="${Y(m.prev).toFixed(1)}" y2="${Y(m.prev).toFixed(1)}" stroke="currentColor" opacity=".35" stroke-dasharray="2 3"/>` : "") +
      `<path d="M${pts[0]} L${pts.join(" L")} L${X(m.series[m.series.length - 1][0]).toFixed(1)},${H} L${X(m.series[0][0]).toFixed(1)},${H} Z" fill="currentColor" opacity=".12"/>` +
      `<polyline points="${pts.join(" ")}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
    return box;
  }
  /* ----- plain words: fixed rules turn the numbers into sentences a newcomer can read (no AI, so nothing is invented) ----- */
  const times = v => (v >= 10 ? fmt(Math.round(v)) : v.toFixed(1)) + " times";
  const leadParas = (m, quiet) => {
    const out = [], n = m.news && m.news.last, f = m.filings || [];
    if (n) out.push("A news headline about the company came out " + when(n.t) + " Seattle time (" + (KIND[n.k] || "company news") + '): "' + n.h + '". That may be related, but a headline near a move is a lead, not proof of the reason.');
    if (f.length) out.push("In the 3 days before this scan the company sent " + f.length + " official document" + (f.length === 1 ? "" : "s") + " to the SEC, the US stock regulator (" + [...new Set(f.map(x => x.form))].join(", ") + ")." + (f.some(x => x.offering) ? " One looks like a share offering. When a company sells new shares the price often falls, even when the news sounds good." : " They are listed below."));
    if (!n && !f.length && !quiet) out.push("We found no headline or SEC filing that explains it, so the reason is unknown. Our news feed misses trading halts, small-company filings and social media.");
    return out;
  };
  function plainParas(m, day, kind) {
    const out = [], K = { up: 1, down: 1, gapUp: 1, gapDown: 1 };
    if (K[kind]) {
      const up = m.lastPct >= 0, x = m.prev ? m.last / m.prev : null;
      out.push(m.s + " closed " + dayLabel(m.prevDay) + " at " + px(m.prev) + ". By " + clock(m.lastAt) + " Seattle time on " + dayLabel(day) + ", before the market opened, it was trading at " + px(m.last) + ": " + (up ? "up " : "down ") + Math.abs(m.lastPct * 100).toFixed(0) + "%" +
        (up && x >= 2 ? " (its price multiplied by " + x.toFixed(1) + ")" : !up && x <= 0.5 ? " (it lost more than half its value)" : "") + ".");
      if (m.shares != null) out.push(big(m.shares) + " shares traded before the open" + (m.volX == null ? "." : m.volX >= 5 ? ", " + times(m.volX) + " a normal full day (" + big(m.avgVol) + "). That is unusually heavy: far more people than normal are suddenly trading it." :
        m.volX >= 1 ? ", about " + times(m.volX) + " a normal full day." : ", less than a normal full day. With so little trading, a few orders can move the price a lot."));
      out.push(...leadParas(m));
      const ctx = [];
      if (m.ret20 != null && m.ret20 <= -0.3) ctx.push("It had already fallen " + Math.abs(m.ret20 * 100).toFixed(0) + "% over the last 20 trading days, so this may be a bounce after a big drop.");
      else if (m.ret20 != null && m.ret20 >= 0.5) ctx.push("It had already risen " + (m.ret20 * 100).toFixed(0) + "% over the last 20 trading days, so it was running before today.");
      if (m.hi52 && m.last <= m.hi52 * 0.25) ctx.push("Its highest price in the past year was " + px(m.hi52) + ", so even after this move it is far below that.");
      if (ctx.length) out.push(ctx.join(" "));
      const c = [];
      if (m.last < 1) c.push("A stock under $1 is called a penny stock: its price can jump or drop fast, and it can be hard to sell at the price you see.");
      c.push("Early-morning trading has far fewer people than the regular session (it opens at 6:30 AM Seattle time), so a price can reverse once the market opens.");
      out.push(c.join(" "));
    } else if (kind === "high" || kind === "low") {
      const hi = kind === "high", lvl = hi ? m.hi52 : m.lo52, lday = hi ? m.hi52Day : m.lo52Day;
      out.push(m.s + " " + (m.yesterday ? "closed " + dayLabel(m.closeDay) + " at " + px(m.close) + ", " + (hi ? "above" : "below") + " the " + (hi ? "highest" : "lowest") + " price it had touched in the previous year (" + px(lvl) + " on " + dayLabel(lday) + ")" : "was at " + px(m.close) + " at the " + dayLabel(m.closeDay) + " close") +
        (m.premarket && m.now != null ? (m.yesterday ? ", and this morning it is trading at " : ". This morning it is trading at ") + px(m.now) + ", " + (hi ? "above" : "below") + " that " + (hi ? "high" : "low") : "") + ".");
      out.push(hi ? "A new 52-week high means the stock is the most expensive it has been in a year. It can follow good news or hype, and it can also fade quickly." : "A new 52-week low means the stock is the cheapest it has been in a year. It can follow bad news. A spin-off or a special payout can also make the price look lower when nothing happened to the business.");
      if (m.vol != null) out.push(big(m.vol) + " shares traded in the last session" + (m.volX != null ? ", " + (m.volX >= 1.5 ? times(m.volX) + " a normal day, so many people were involved." : m.volX >= 0.7 ? "about a normal day." : "less than a normal day.") : "."));
      out.push(...leadParas(m));
    } else if (kind === "insider") {
      out.push((m.who || "An insider") + (m.role ? ", " + m.role + " of " : " of ") + m.issuer + ", bought " + fmt(m.shares) + " shares at about " + px(m.price) + " (about $" + big(m.value) + " in all) on " + dayLabel(m.day) + ", on the open market with their own money, and reported it to the SEC on " + dayLabel(m.filed) + ".");
      out.push("Insiders (executives, directors and large owners) buy for their own reasons: it is a fact about what they did, not a sign they know something and not a promise the price will rise. Stock grants, option exercises and sales are not counted here.");
      out.push(...leadParas(m, true));
    }
    return out;
  }
  /* ----- risk tags: plain warnings drawn from the same numbers ----- */
  function riskTags(m) {
    const t = [], price = m.last != null ? m.last : m.now != null ? m.now : m.close != null ? m.close : m.price;
    if (price != null && price < 1) t.push("Penny stock (under $1)");
    if (m.shares != null && m.shares < 100000) t.push("Thin premarket trading");
    else if (m.avgVol != null && m.avgVol < 150000 && m.shares == null) t.push("Thinly traded stock");
    if (m.filings && m.filings.some(x => x.offering)) t.push("Share-offering filing (price often falls)");
    if (m.news && m.news.items && m.news.items.some(x => x.k === "short")) t.push("Short-seller report");
    if (m.ret20 != null && m.ret20 >= 0.5) t.push(m.ret20 >= 1 ? "Ran up " + (1 + m.ret20).toFixed(1) + "× in 20 days" : "Already up " + Math.round(m.ret20 * 100) + "% in 20 days");
    else if (m.ret20 != null && m.ret20 <= -0.5) t.push("Down " + Math.round(Math.abs(m.ret20) * 100) + "% in 20 days");
    if (m.hi52 && price != null && price <= m.hi52 * 0.2) t.push("Down " + Math.round((1 - price / m.hi52) * 100) + "% from its 1-year high");
    if (m.lastPct != null && Math.abs(m.lastPct) >= 1) t.push(m.lastPct > 0 ? "More than doubled before the open" : "Lost over half before the open");
    return t;
  }
  const riskChips = m => riskTags(m).map(x => h("span", { class: "mv-chip risk", text: "⚠ " + x }));
  const CAT = { up: "Mover up", down: "Mover down", gapUp: "Gap up", gapDown: "Gap down", highs: "52-week high", lows: "52-week low", insider: "Insider buy" };
  function lastDayCard(d) {
    const L = (d.record && d.record.latest) || (S.replay && S.replay.latest);
    if (!L || !L.flags || !L.flags.length) return null;
    const UPS = { up: 1, gapUp: 1, highs: 1, insider: 1 }, dir = c => (UPS[c] ? 1 : -1);
    const seen = new Map();                        // a stock flagged twice (a mover that also gapped) counts once
    for (const e of L.flags) { const o = seen.get(e.s); if (!o) seen.set(e.s, Object.assign({}, e, { cats: [e.cat] })); else if (!o.cats.includes(e.cat)) o.cats.push(e.cat); }
    const fl = [...seen.values()].sort((a, b) => b.c0 - a.c0), n = fl.length;
    const rose = fl.filter(e => e.c0 > 0).length, kept = fl.filter(e => e.c0 * dir(e.cat) > 0).length;
    const sorted = fl.map(e => e.c0).sort((a, b) => a - b), median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    const ups = fl.filter(e => UPS[e.cat]), downs = fl.filter(e => !UPS[e.cat]), spy = L.spy && L.spy[0];
    const tile = (k, v, small, c) => h("div", { class: "sc-tile" }, h("div", { class: "k", text: k }), h("div", { class: "v" }, v, small ? h("small", { class: c || "", text: small }) : null));
    const tiles = h("div", { class: "sc-tiles" }, tile("Stocks flagged", String(n)), tile("Higher at the close than when flagged", rose + " of " + n), tile("Kept going the way the flag pointed", kept + " of " + n),
      tile("Median change", tint(median, 1)), spy != null ? tile("S&P 500 fund that day", tint(spy, 1)) : null);
    const said = [];
    if (ups.length) said.push("Of the " + ups.length + " stocks flagged as moving up (movers, gaps, new highs, insider buys), " + ups.filter(e => e.c0 > 0).length + " were higher at the close than when they were flagged.");
    if (downs.length) said.push("Of the " + downs.length + " flagged as falling, " + downs.filter(e => e.c0 < 0).length + " were lower at the close.");
    const rows = fl.map(e => h("div", { class: "ld-row" }, h("div", { class: "ld-id" }, h("b", { text: e.s }), h("span", { class: "mv-name", title: e.name || "", text: e.name || "" })), h("span", { class: "ld-kind", text: e.cats.map(c => CAT[c] || c).join(" + ") }),
      h("span", { class: "ld-px", text: e.price != null && e.close != null ? px(e.price) + " → " + px(e.close) : "" }), h("span", { class: "mv-pct " + cls(e.c0), text: (e.c0 > 0 ? "▲ " : e.c0 < 0 ? "▼ " : "") + pct(e.c0, 1) })));
    const card_ = card("How the flags of " + dayLabel(L.day) + " did", null,
      h("p", { class: "sub", text: "Every stock the scan flagged that morning, from the price when it was flagged to that day's close." }), tiles,
      h("p", { text: said.join(" ") + " One day is luck-sized: it shows what happened, not what to expect. The 60-day replay further down is the bigger picture.", style: "margin:4px 0 10px;font-size:14px" }),
      h("div", { class: "ld-list" }, rows),
      h("p", { class: "sub", style: "margin-top:8px", text: L.source === "replay" ? "This day comes from the replay: the scan as it would have looked at 6:00 AM that morning. Real scans are scored here from the morning after they run. The S&P 500 fund is measured from the same morning minute to the close." : "A real scan, scored from the morning after it ran. The S&P 500 fund is its change from the previous close to the close." }));
    card_.id = "sc-lastday";
    return card_;
  }
  const plainBox = (m, day, kind) => { const ps = plainParas(m, day, kind); return ps.length ? h("div", { class: "mv-plain" }, h("div", { class: "k", text: "In plain words" }), ps.map(t => h("p", { text: t }))) : null; };
  function plainShort(m) {
    const up = m.lastPct >= 0, x = m.volX;
    const lead = m.news && m.news.last ? "there is news" : m.filings && m.filings.length ? "filings but no news" : "no news found";
    return (up ? "Jumped " : "Fell ") + Math.abs(m.lastPct * 100).toFixed(0) + "% before the open · " + (x == null ? "trading volume unknown" : x >= 5 ? "very heavy trading (" + times(x) + " normal)" : x >= 1 ? "busier than normal" : "light trading") + " · " + lead;
  }
  const GLOSSARY = [
    ["Premarket", "Trading that happens before the regular market opens (6:30 AM Seattle time). Fewer people trade then, so prices swing more."],
    ["Previous close", "The price when the market closed the day before. Every “change” on this page is measured from it."],
    ["Change (+204%)", "How far the price moved from the previous close. +100% means the price doubled."],
    ["Peak / fastest 5 minutes", "The highest price seen before the open, and the biggest move inside any 5-minute stretch."],
    ["Shares / “× usual”", "How many shares changed hands, compared with a normal full day. 482 times means far more people than usual are trading it."],
    ["Headline", "A news story about the company. A headline near a move is a possible reason, never proof."],
    ["SEC filing", "An official document a company sends to the US stock regulator. An “offering” means the company may sell new shares, which often pushes the price down."],
    ["Gap", "A stock that starts the day far above or below yesterday's close."],
    ["52-week high / low", "The highest or lowest price in the past year."],
    ["Insider buy", "A company executive or director buying shares with their own money, reported on an SEC “Form 4”."],
    ["Penny stock", "A stock under $1. Prices jump and fall fast and it can be hard to sell."]
  ];
  const guide = () => h("details", { class: "sc-guide" }, h("summary", { text: "New to stocks? What the words on this page mean" }),
    h("dl", {}, GLOSSARY.map(([k, v]) => h("div", {}, h("dt", { text: k }), h("dd", { text: v })))),
    h("p", { class: "sub", text: "This page is a record of what moved and what the news feed said. The “In plain words” notes only restate the numbers; they do not say why a stock moved or what it will do next, and nothing here is advice." }));

  const hasLead = m => !!((m.news && m.news.last) || (m.filings && m.filings.length));
  function stockRow(m, day, kind) {
    const c = cls(m.lastPct), chips = [];
    chips.push(...riskChips(m));
    if (m.hiPct != null) chips.push(h("span", { class: "mv-chip", title: "The highest price seen before the open", text: "Peak " + pct(m.hiPct) + " at " + clock(m.hiAt) }));
    if (m.jump) chips.push(h("span", { class: "mv-chip", title: "The biggest move inside any 5 minutes", text: "Fastest 5 min " + pct(m.jump.pct) + " · " + clock(m.jump.from) }));
    chips.push(h("span", { class: "mv-chip" + (m.volX != null && m.volX >= 5 ? " hot" : ""), title: "Shares traded before the open" + (m.avgVol ? "; a usual full day is " + big(m.avgVol) : ""), text: big(m.shares) + " shares" + (m.volX != null ? " · " + (m.volX >= 10 ? fmt(Math.round(m.volX)) : m.volX.toFixed(1)) + "× usual" : "") }));
    if (m.news && m.news.last) chips.push(h("span", { class: "mv-chip news", title: "Open the row to read it", text: "Headline · " + (KIND[m.news.last.k] || "news") }));
    if (m.filings && m.filings.length) chips.push(h("span", { class: "mv-chip fil", text: m.filings.length + " SEC filing" + (m.filings.length === 1 ? "" : "s") + (m.filings.some(x => x.offering) ? " · offering" : "") }));
    if (!hasLead(m)) chips.push(h("span", { class: "mv-chip", text: "No headline or filing found" }));
    const main = h("div", { class: "mv-main", role: "button", tabindex: "0", "aria-expanded": "false", title: "Click for the evidence on " + m.s },
      h("div", {}, h("span", { class: "mv-sym", text: m.s }), h("span", { class: "mv-name", title: m.name, text: m.name })),
      spark(m),
      h("div", { class: "mv-px" }, h("span", { class: "a" }, px(m.prev), h("i", { text: "→" }), px(m.last)), h("span", { class: "b", text: dayLabel(m.prevDay) + " close → " + dayAt(day, m.lastAt) })),
      h("span", { class: "mv-pct " + c, text: (m.lastPct > 0 ? "▲ " : m.lastPct < 0 ? "▼ " : "") + pct(m.lastPct) }),
      h("span", { class: "mv-chev", text: "▸" }));
    const row = h("div", { class: "mv-row r-" + c }, main, h("div", { class: "mv-plainshort", text: plainShort(m) }), h("div", { class: "mv-chips" }, chips));
    let detail = null;
    const flip = () => {
      if (!detail) {
        const kv = (k, v) => h("div", {}, h("div", { class: "k", text: k }), h("div", { class: "v" }, v));
        detail = h("div", { class: "mv-detail" }, plainBox(m, day, kind),
          h("div", { class: "mv-dl" },
            kv("Previous close", two(px(m.prev), dayLabel(m.prevDay) + " close")),
            kv("Last premarket price", two(px(m.last), dayAt(day, m.lastAt))),
            kv("Premarket high", two(pct(m.hiPct) + " (" + px(m.hi) + ")", dayAt(day, m.hiAt))),
            kv("Biggest 5-minute move", m.jump ? two(pct(m.jump.pct) + ", " + px(m.jump.lo) + " → " + px(m.jump.hi), dayLabel(day) + ", " + clock(m.jump.from) + " to " + clock(m.jump.to)) : "–"),
            kv("Shares before the open", two(big(m.shares) + (m.volX != null ? " (" + (m.volX >= 10 ? fmt(Math.round(m.volX)) : m.volX.toFixed(1)) + "× usual)" : ""), "usual day " + (m.avgVol ? big(m.avgVol) : "–") + " (20 sessions to " + dayLabel(m.prevDay) + ")")),
            kv("Newest SEC filing", filingsCell(m)),
            kv("Nearest headline", newsCell(m))),
          detailOf(m, day));
        row.append(detail);
      } else detail.hidden = !detail.hidden;
      const open = !detail.hidden;
      row.classList.toggle("open", open);
      main.setAttribute("aria-expanded", String(open));
    };
    main.addEventListener("click", flip);
    main.addEventListener("keydown", ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); flip(); } });
    return row;
  }
  const SORTS = { change: ["Biggest change", m => Math.abs(m.lastPct || 0)], peak: ["Highest peak", m => Math.abs(m.hiPct || 0)], volume: ["Most active vs usual", m => (m.volX == null ? -1 : m.volX)] };
  function mtable(list, day, kind) {
    let sort = "change", only = false;
    const rows = h("div", {}), count = h("span", { class: "mv-count" });
    const seg = h("div", { class: "seg", role: "group", "aria-label": "Sort" });
    const render = () => {
      const l = list.filter(m => !only || hasLead(m)).sort((a, b) => SORTS[sort][1](b) - SORTS[sort][1](a));
      rows.replaceChildren(...(l.length ? l.map(m => stockRow(m, day, kind)) : [empty("Nothing here has a headline or an SEC filing.")]));
      count.textContent = l.length + " of " + list.length + " stocks";
      for (const b of seg.children) b.setAttribute("aria-pressed", String(b.dataset.k === sort));
    };
    for (const k of Object.keys(SORTS)) seg.append(h("button", { type: "button", "data-k": k, text: SORTS[k][0], onclick: () => { sort = k; render(); } }));
    const chk = h("input", { type: "checkbox" });
    chk.addEventListener("change", () => { only = chk.checked; render(); });
    render();
    return h("div", {}, h("div", { class: "mv-bar" }, seg, h("label", { class: "mv-only" }, chk, "Only with a headline or filing"), count), rows);
  }
  function tiles(p) {
    const top = (l, f) => l.slice().sort((a, b) => f(b) - f(a))[0];
    const all = p.up.concat(p.down), t = [];
    const up = top(p.up, m => m.lastPct || 0), dn = top(p.down, m => -(m.lastPct || 0)), vol = top(all.filter(m => m.volX != null), m => m.volX);
    if (up) t.push(["Biggest gainer", up.s, pct(up.lastPct), "up"]);
    if (dn) t.push(["Biggest drop", dn.s, pct(dn.lastPct), "down"]);
    if (vol) t.push(["Busiest vs usual", vol.s, (vol.volX >= 10 ? fmt(Math.round(vol.volX)) : vol.volX.toFixed(1)) + "× usual", "flat"]);
    t.push(["With a headline or filing", all.filter(hasLead).length + " of " + all.length, "", "flat"]);
    return h("div", { class: "sc-tiles" }, t.map(([k, v, s, c]) => h("div", { class: "sc-tile" }, h("div", { class: "k", text: k }), h("div", { class: "v" }, v, s ? h("small", { class: c, text: s }) : null))));
  }

  function draw() {
    const d = S.data, p = d.premarket, lv = d.levels, ins = d.insiders, body = $("#sc-body");
    body.replaceChildren();
    const built = new Date(d.builtAt).toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    $("#sc-lede").replaceChildren("Scan of " + dayLabel(d.day) + ", built " + built + " Seattle time · " + fmt(d.read) + " stocks read",
      h("details", { class: "howto" }, h("summary", { text: "About this scan" }), h("p", { class: "sub", text: "Read from " + fmt(d.read) + " of " + fmt(d.universe) + " listed stocks (ETFs, funds, warrants and rights are left out) in " + d.seconds + " seconds. " +
        "Prices are Alpaca's free feed, 15 minutes behind. Premarket means 1:00 to 6:30 AM Seattle time. This lists what moved and what the news feed said; it does not say why a stock moved or what it will do next." })));
    const r = d.rules;
    body.append(card("Premarket movers", "Largest moves from the previous close, among stocks with at least " + fmt(r.moverMinShares) + " shares traded before the open and a previous close of " + px(r.moverMinPrice) + " or more. " + fmt(p.read) + " stocks that had moved 3% or more were read minute by minute.",
      tiles(p), h("h3", { text: "Up", style: "margin:14px 0 0;font-size:15px" }), p.up.length ? mtable(p.up, d.day, "up") : empty("None met the bars."),
      h("h3", { text: "Down", style: "margin:18px 0 0;font-size:15px" }), p.down.length ? mtable(p.down, d.day, "down") : empty("None met the bars.")));
    body.append(card("Gaps", "A gap is a premarket price at least " + pct(r.gapPct) + " away from the previous close, on at least " + fmt(r.gapMinShares) + " shares and a previous close of " + px(r.gapMinPrice) + " or more, most traded dollars first." + (PUBLIC ? "" : ""),
      h("h3", { text: "Gap up (" + p.gapUp.length + ")", style: "margin:6px 0 0;font-size:15px" }), p.gapUp.length ? mtable(p.gapUp, d.day, "gapUp") : empty("None."),
      h("h3", { text: "Gap down (" + p.gapDown.length + ")", style: "margin:18px 0 0;font-size:15px" }), p.gapDown.length ? mtable(p.gapDown, d.day, "gapDown") : empty("None.")));
    const lvRows = (list, key) => list.map(m => [toggle(m, d.day), m.name, two(px(m.close), dayLabel(m.closeDay) + " close"), two(px(key === "highs" ? m.hi52 : m.lo52), dayLabel(key === "highs" ? m.hi52Day : m.lo52Day)),
      m.now != null ? two(px(m.now), dayLabel(d.day) + " premarket") : "–", pct(m.pct, 1), (m.yesterday ? dayLabel(m.closeDay) + " (the previous session)" : "") + (m.yesterday && m.premarket ? " and " : "") + (m.premarket ? dayLabel(d.day) + " premarket" : ""),
      two(big(m.vol) + (m.volX != null ? " (" + m.volX.toFixed(1) + "× usual)" : ""), "on " + dayLabel(m.closeDay)), filingsCell(m), newsCell(m)]);
    const LV = side => ["Stock (click)", "Company", "Last close", "Prior 52-week " + side, "Premarket price", "Past the " + side, "When", "Shares in the last session", "SEC filings, last 3 days", "Nearest headline about the stock"];
    body.append(card("52-week highs and lows", "Stocks that set a new 52-week high or low in the previous session, or trade beyond one before the open, among stocks with at least " + fmt(r.hiloMinVolume) + " shares yesterday and a close of " + px(r.hiloMinPrice) + " or more; the most traded dollars first. " +
      fmt(lv.highCount) + " highs and " + fmt(lv.lowCount) + " lows in all; the top " + lv.highs.length + " of each are shown. A spin-off or a special payout can make a price look like a crash or a breakout when nothing happened to the business.",
      h("h3", { text: "Highs", style: "margin:6px 0 4px;font-size:13px" }), lv.highs.length ? table(LV("high"), lvRows(lv.highs, "highs"), [2, 3, 4, 5, 7], lv.highs.map(m => detailOf(m, d.day, "high"))) : empty("None."),
      h("h3", { text: "Lows", style: "margin:12px 0 4px;font-size:13px" }), lv.lows.length ? table(LV("low"), lvRows(lv.lows, "lows"), [2, 3, 4, 5, 7], lv.lows.map(m => detailOf(m, d.day, "low"))) : empty("None.")));
    let insKids;
    if (ins.blocked) insKids = [empty("Not read: the SEC refuses scripts that do not name a contact. Put one line (a name and an email) in the file sec-contact.txt in the dashboard folder; it stays on this Mac. The next scan will fill this in.")];
    else if (ins.skipped) insKids = [empty("This scan was run without the insider step.")];
    else insKids = [ins.buys.length ? table(["Stock (click)", "Company", "Who", "Role", "Shares", "Average price", "Value", "Bought on", "Filed with the SEC", "SEC filings, last 3 days", "Nearest headline about the stock", "The Form 4"],
      ins.buys.map(m => [toggle(m, d.day), m.issuer, m.who, m.role || "–", fmt(m.shares), px(m.price), "$" + big(m.value), dayLabel(m.day), dayLabel(m.filed), filingsCell(m), newsCell(m), h("a", { class: "link", href: m.link, target: "_blank", rel: "noopener noreferrer", text: "SEC ↗" })]), [4, 5, 6], ins.buys.map(m => detailOf(m, d.day, "insider"))) : empty("No open-market purchase of " + px(r.insiderMinValue) + " or more in these days' filings.")];
    body.append(card("Insider buys", "Open-market purchases (Form 4, code P) of at least $" + fmt(r.insiderMinValue) + " in one filing, from the SEC's filings" + (ins.days && ins.days.length ? " of " + ins.days.join(", ") + ". " + fmt(ins.count || 0) + " found" : "") + ". An insider buying is a fact about what they did; it does not say they know something. Grants, option exercises and sales are not counted.", ...insKids));
    const rp = S.replay, kinds = { up: "Movers up", down: "Movers down", gapUp: "Gap up", gapDown: "Gap down", highs: "52-week highs", lows: "52-week lows" };
    if (rp && rp.days && rp.days.length) {
      const med = v => (v == null ? "–" : tint(v, 1)), kept = (c, k) => (c && c[k] ? c[k].kept + " of " + c[k].n : "–");
      const rows = Object.keys(kinds).filter(k => rp.cats[k]).map(k => { const a = rp.cats[k].c0 || {}, b = rp.cats[k].c5 || {};
        return [kinds[k], a.n || 0, med(a.median), med(a.medianEx), kept(rp.cats[k], "c0"), b.n || 0, med(b.median), med(b.medianEx), kept(rp.cats[k], "c5"), b.n ? med(b.firstHalf) + " then " + med(b.secondHalf) : "–"]; });
      const bs = rp.base || {};
      rows.push(["Any stock with 20,000+ shares before the open", bs.c0 ? bs.c0.n : 0, bs.c0 ? med(bs.c0.median) : "–", "–", "–", bs.c5 ? bs.c5.n : 0, bs.c5 ? med(bs.c5.median) : "–", "–", "–", "–"]);
      body.append(card("How the flags would have done: a replay of " + rp.days.length + " past sessions", "The same scan, run on each past market day as it would have looked at 6:00 AM Seattle time (prices up to " + rp.cutoff + "), with every flag followed to that day's close and to five sessions later: " + fmt(rp.flags) + " flags, " + rp.days[0] + " to " + rp.days[rp.days.length - 1] + ". " +
        "“Against the fund” is the stock's change minus the S&P 500 fund's (SPY) over the same stretch; “kept going” is how many moved further the way the flag pointed (up for movers up, gap up and highs; down for the rest). The last column is the median five sessions on, first half of the days then second half: if they disagree, the result is not steady.",
        table(["Kind of flag", "To the close: flags", "Median change", "Against the fund", "Kept going", "Five sessions on: flags", "Median change", "Against the fund", "Kept going", "First half, then second"], rows, [1, 2, 3, 4, 5, 6, 7, 8]),
        h("p", { class: "sub", text: "Limits: the replay uses today's list of listed stocks, so a stock delisted since is missing, which leans toward winners; one stretch of one market; prices only, no news; insider buys are not replayed. Overlapping five-session stretches and a few hundred flags make small gaps meaningless. A record of what happened, not a promise." })));
    }
    const rec = d.record || { scans: 0, cats: {} }, names = { up: "Movers up", down: "Movers down", gapUp: "Gap up", gapDown: "Gap down", highs: "52-week highs", lows: "52-week lows", insider: "Insider buys" };
    const keys = Object.keys(rec.cats);
    body.append(card("How past flags did", "Every scan is kept. For each earlier scan: the change from the flagged price to that day's close and to five sessions later. " + (rec.scans ? fmt(rec.scans) + " earlier scan" + (rec.scans === 1 ? "" : "s") + " scored so far, from " + rec.first + "." : "No earlier scan to score yet: the first results appear after the second scan."),
      keys.length ? table(["Kind of flag", "To that day's close: flags", "Median change", "Rose", "Five sessions on: flags", "Median change", "Rose"],
        keys.map(k => { const c = rec.cats[k], a = c.c0 || {}, b = c.c5 || {}; return [names[k] || k, a.n || 0, a.n ? tint(a.median, 1) : "–", a.n ? a.positive + " of " + a.n : "–", b.n || 0, b.n ? tint(b.median, 1) : "–", b.n ? b.positive + " of " + b.n : "–"]; }), [1, 2, 3, 4, 5, 6])
        : empty("Nothing to show yet."),
      h("p", { class: "sub", text: "Small counts are luck-sized: a handful of flags says nothing. This compares with the flagged price only, not with the S&P 500 fund." })));
    const nav = h("div", { class: "sc-nav" });
    for (const [label, pre] of [["Last day scored", "sc-lastday"], ["Premarket movers", "sc-premarket-movers"], ["Gaps", "sc-gaps"], ["52-week highs and lows", "sc-52-week"], ["Insider buys", "sc-insider-buys"], ["Replay", "sc-how-the-flags"], ["Past flags", "sc-how-past"]]) {
      const el = body.querySelector('[id^="' + pre + '"]');
      if (el) nav.append(h("button", { type: "button", text: label, onclick: () => el.scrollIntoView({ behavior: "smooth", block: "start" }) }));
    }
    body.prepend(guide());
    body.prepend(nav);
    const ld = lastDayCard(d);
    if (ld) body.prepend(ld);
    body.append(h("p", { class: "sub", text: "Limits: Alpaca's free feed leaves out the newest 15 minutes and some thin stocks; headlines come from one feed (Benzinga) and miss small-company filings, trading halts and social media; a split-adjusted history cannot see every spin-off. A headline near a move is a lead, not proof of the reason. This page is a record, not a recommendation." }));
  }

  async function load() {
    if (S.loading) return;
    S.loading = true;
    try {
      const r = await fetch("daily-scan.json?t=" + Date.now(), { cache: "no-store" });
      if (!r.ok) throw new Error("missing");
      S.data = await r.json();
      try { const q = await fetch("daily-scan-replay.json?t=" + Date.now(), { cache: "no-store" }); S.replay = q.ok ? await q.json() : null; } catch (err) { S.replay = null; }
      draw();
    } catch (err) {
      $("#sc-lede").textContent = "No scan yet. Run  /usr/bin/python3 -I tools/daily_scan.py  in the dashboard folder (it also runs by itself at 6:00 AM Seattle time on weekdays).";
    }
    S.loading = false;
  }
  window.Scan = { show() { load(); } };
})();
