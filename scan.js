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
      `<rect class="pl-band" y="${Tp}" height="${H - Tp - B}" fill="currentColor" opacity=".07" style="display:none"/>` +
      `<polyline points="${poly}" fill="none" stroke="#1f7a4d" stroke-width="1.8"/>` + hours +
      `<line class="pl-cur" y1="${Tp}" y2="${H - B}" stroke="currentColor" opacity=".6" style="display:none"/><circle class="pl-dot" r="3" fill="#1f7a4d" style="display:none"/></svg>`;
    const box = h("div", { class: "pl" });
    box.innerHTML = svg;
    hoverPrices(box, m, X, W, L, R);
    box.append(h("div", { class: "sub", style: "margin:0", text: "Price every 5 minutes, 1:00 to 6:30 AM Seattle on " + dayLabel(day) + " (" + px(lo) + " to " + px(hi) + "). Hover or touch the chart for the price at that moment and the hour's open, close, low and high. Dashed line: previous close of " + px(m.prev) + ". Blue marks: a headline about the stock came out; orange marks: an SEC filing was accepted." }));
    return box;
  }
  /* Hover or touch the chart: the price at that moment, and the open, close, low and high of that clock hour. */
  const hourName = mn => clock(mn).replace(":00", "");
  function hoverPrices(box, m, X, W, L, R) {
    const svg = box.querySelector("svg"), band = svg.querySelector(".pl-band"), cur = svg.querySelector(".pl-cur"), dot = svg.querySelector(".pl-dot");
    const tip = h("div", { class: "pl-tip" });
    tip.hidden = true;
    box.append(tip);
    svg.style.cursor = "crosshair";
    const hide = () => { tip.hidden = true; band.style.display = cur.style.display = dot.style.display = "none"; };
    const show = ev => {
      const r = svg.getBoundingClientRect(), vx = (ev.clientX - r.left) / r.width * W, mn = T0 + (vx - L) / (W - L - R) * (T1 - T0);
      if (mn < T0 || mn > T1) return hide();
      let pt = m.series[0];
      for (const x of m.series) { if (x[0] <= mn) pt = x; else break; }
      const a = Math.min(300 + 60, Math.floor(pt[0] / 60) * 60), b = a === 360 ? T1 : a + 60;
      const inHour = m.series.filter(x => x[0] >= a && x[0] < (a === 360 ? T1 + 1 : a + 60)), prices = inHour.map(x => x[1]);
      const chg = m.prev ? pct(pt[1] / m.prev - 1, 1) + " vs previous close" : "";
      band.setAttribute("x", X(a)); band.setAttribute("width", X(b) - X(a)); band.style.display = "";
      cur.setAttribute("x1", X(pt[0])); cur.setAttribute("x2", X(pt[0])); cur.style.display = "";
      dot.setAttribute("cx", X(pt[0])); dot.setAttribute("cy", svg.querySelector("polyline").points.getItem(m.series.indexOf(pt)).y); dot.style.display = "";
      tip.replaceChildren(h("div", { style: "font-weight:650", text: hourName(a) + " – " + (a === 360 ? "6:30 AM" : hourName(b)) }),
        h("div", { text: "At " + clock(pt[0]) + ": " + px(pt[1]) + (chg ? " (" + chg + ")" : "") }),
        inHour.length ? h("div", { class: "sub", style: "margin:0", text: "This hour: " + px(inHour[0][1]) + " → " + px(inHour[inHour.length - 1][1]) + " · low " + px(Math.min(...prices)) + " · high " + px(Math.max(...prices)) }) : h("div", { class: "sub", style: "margin:0", text: "No trades this hour" }));
      tip.hidden = false;
      const br = box.getBoundingClientRect(), x = ev.clientX - br.left;
      tip.style.left = (x > br.width / 2 ? Math.max(0, x - tip.offsetWidth - 14) : x + 14) + "px";
    };
    svg.addEventListener("pointermove", show);
    svg.addEventListener("pointerdown", show);
    svg.addEventListener("pointerleave", hide);
  }
  /* ----- "Before this morning:" opens a panel: the last 60 sessions with volume, the numbers behind them, and where to read more ----- */
  const shortDay = d => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const symFor = (m, sep) => m.s.replace(/[.\-]/g, sep);
  function beforeFact(m) {
    const text = "closed " + px(m.prev != null ? m.prev : m.close) + " on " + dayLabel(m.prevDay) + (m.prevVol != null ? " on " + big(m.prevVol) + " shares" + (m.avgVol ? " (usual " + big(m.avgVol) + ")" : "") : "");
    const btn = h("button", { type: "button", class: "bm-btn", "aria-expanded": "false", title: "Open the last 60 sessions, the numbers behind them, and places to read more" },
      h("span", { class: "bm-chev", text: "▸" }), h("b", { text: " Before this morning: " }), text, h("span", { class: "bm-hint", text: "click to dig deeper" }));
    const li = h("li", { class: "bm" }, btn);
    let panel = null;
    btn.addEventListener("click", ev => {
      ev.stopPropagation();
      if (!panel) { panel = beforePanel(m); li.append(panel); } else panel.hidden = !panel.hidden;
      btn.setAttribute("aria-expanded", String(!panel.hidden));
      btn.querySelector(".bm-chev").textContent = panel.hidden ? "▸" : "▾";
    });
    return li;
  }
  const ap = (x, d) => pct(Math.abs(x), d).replace("+", "");                        // a size, without a sign
  const med = a => { const q = [...a].sort((x, y) => x - y), k = q.length; return k % 2 ? q[(k - 1) / 2] : (q[k / 2 - 1] + q[k / 2]) / 2; };
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const upDown = x => (x > 0 ? "up " : x < 0 ? "down " : "unchanged ");
  /* every number about the 60 sessions, worked out once, so the sentences and the cells agree */
  function bmStats(H, m) {
    const n = H.d.length, last = n - 1, c = H.c, rets = c.slice(1).map((v, i) => (c[i] ? v / c[i] - 1 : 0));
    const sma = k => mean(c.slice(-Math.min(k, n))), absMed = med(rets.map(Math.abs)) || 0.0001;
    const hiI = c.indexOf(Math.max(...c)), loI = c.indexOf(Math.min(...c)), vI = H.v.indexOf(Math.max(...H.v));
    const maxUp = Math.max(...rets), maxDn = Math.min(...rets), upI = rets.indexOf(maxUp) + 1, dnI = rets.indexOf(maxDn) + 1;
    return { n, last, rets, absMed, sma20: sma(20), sma50: n >= 50 ? sma(50) : null, hiI, loI, vI, maxUp, maxDn, upI, dnI,
      ydChg: rets[rets.length - 1], upDays: rets.filter(x => x > 0.0005).length, dnDays: rets.filter(x => x < -0.0005).length,
      big: rets.filter(x => Math.abs(x) >= 0.10).length, bigVol: m.avgVol ? H.v.filter(v => v >= 3 * m.avgVol).length : null,
      ch20: n > 20 && c[last - 20] ? c[last] / c[last - 20] - 1 : null, chAll: c[0] ? c[last] / c[0] - 1 : null };
  }
  /* the plain-words story, from fixed rules (no AI): what the 60 sessions show, and where this morning's price sits in them */
  function bmPlain(H, m, x) {
    const c = H.c, cl = c[x.last], out = [], avg = m.avgVol, at = m.hi52 != null && m.lo52 != null && m.hi52 > m.lo52 ? (cl - m.lo52) / (m.hi52 - m.lo52) : null;
    let t = "Over these " + x.n + " sessions (" + shortDay(H.d[0]) + " to " + shortDay(H.d[x.last]) + ") the price went from " + px(c[0]) + " to " + px(cl) + ": " + upDown(x.chAll) + ap(x.chAll, 0) + ". ";
    t += x.hiI === x.last ? "Yesterday's close was the highest of the stretch. " : "The highest close was " + px(c[x.hiI]) + " on " + shortDay(H.d[x.hiI]) + ", so a buyer at that close is " + upDown(cl / c[x.hiI] - 1) + ap(cl / c[x.hiI] - 1, 0) + " now. ";
    t += x.loI === x.last ? "Yesterday's close was the lowest of the stretch." : "The lowest close was " + px(c[x.loI]) + " on " + shortDay(H.d[x.loI]) + ".";
    out.push(t);
    const a20 = cl >= x.sma20, a50 = x.sma50 == null ? null : cl >= x.sma50;
    let tr = "Yesterday's close of " + px(cl) + " is " + (a20 ? "above" : "below") + " its 20-session average (" + px(x.sma20) + ")" + (a50 == null ? "" : " and " + (a50 === a20 ? "also " : "but ") + (a50 ? "above" : "below") + " its 50-session average (" + px(x.sma50) + ")") + ". ";
    tr += a50 == null ? "" : a20 && a50 ? "A price above its recent averages means it has mostly been trading higher lately." : !a20 && !a50 ? "A price under its recent averages means it has mostly been trading lower lately." : "The two averages disagree, so the last month and the longer stretch point different ways.";
    out.push(tr);
    out.push("On a typical day it moves about " + ap(x.absMed, 1) + " (the middle of the " + x.rets.length + " daily moves). The biggest jump was " + pct(x.maxUp, 0) + " on " + shortDay(H.d[x.upI]) + " and the biggest drop " + pct(x.maxDn, 0) + " on " + shortDay(H.d[x.dnI]) + ". Yesterday's " + pct(x.ydChg, 1) + " was " +
      (Math.abs(x.ydChg) < 0.6 * x.absMed ? "a quieter day than usual" : Math.abs(x.ydChg) > 1.6 * x.absMed ? "a bigger move than usual (about " + (Math.abs(x.ydChg) / x.absMed).toFixed(1) + " times a typical day)" : "an ordinary day") + ".");
    if (avg) {
      let v = "A usual day is about " + big(avg) + " shares, " + (avg < 100000 ? "which is thinly traded: a small number of buyers or sellers can move the price a lot." : avg >= 5000000 ? "which is heavily traded, so single orders move the price less." : "which is a middling amount of trading.") + " ";
      v += x.bigVol ? x.bigVol + " of the " + x.n + " days had at least 3 times the usual shares; the busiest was " + shortDay(H.d[x.vI]) + " with " + big(H.v[x.vI]) + " (" + (H.v[x.vI] / avg).toFixed(0) + " times usual)" + (x.vI > 0 && c[x.vI - 1] ? ", when the price moved " + pct(c[x.vI] / c[x.vI - 1] - 1, 0) + ". " : ". ") : "No day in the stretch had even 3 times the usual shares; the busiest was " + shortDay(H.d[x.vI]) + ". ";
      if (x.vI > 0 && c[x.vI - 1]) v += Math.abs(c[x.vI] / c[x.vI - 1] - 1) < 0.02 ? "Lots of shares changing hands while the price stayed put means plenty of buying and selling without the price going anywhere." : "Heavy trading together with a big price move means many people were on the same side that day.";
      out.push(v);
    }
    if (m.last != null && m.lastPct != null) {
      const higher = c.filter(v => v > m.last).length, jump = m.lastPct;
      let k = "This morning's premarket price of " + px(m.last) + " is " + pct(jump, 0) + " from yesterday's close, about " + (Math.abs(jump) / x.absMed).toFixed(0) + " times a typical day's move. ";
      k += jump > 0 ? (higher === 0 ? "That is above every close of the last " + x.n + " sessions. " : higher <= 3 ? "Only " + higher + " of the last " + x.n + " closes were higher. " : higher + " of the last " + x.n + " closes were higher. ") + (jump > x.maxUp ? "It is a bigger one-day jump than any in the stretch." : "The biggest jump in the stretch was " + pct(x.maxUp, 0) + ".")
        : (c.filter(v => v < m.last).length === 0 ? "That is below every close of the last " + x.n + " sessions. " : "") + (jump < x.maxDn ? "It is a bigger one-day drop than any in the stretch." : "The biggest drop in the stretch was " + pct(x.maxDn, 0) + ".");
      out.push(k);
    }
    if (at != null) out.push("Over the past year it has ranged from " + px(m.lo52) + " to " + px(m.hi52) + "; yesterday's close sits " + (at < 0.2 ? "near the bottom" : at > 0.8 ? "near the top" : "in the middle") + " of that range (" + Math.round(Math.min(Math.max(at, 0), 1) * 100) + "% of the way up).");
    out.push("These are facts about past prices. They do not say why the price moved or what it will do next.");
    return out;
  }
  /* ----- yesterday, minute by minute: when the shares traded, how big the trades were, and what public data can and cannot say about who bought ----- */
  const SESSIONS = [["Before the open", "1:00 to 6:30 AM", 0, 11, "#8da2c7"], ["Regular session", "6:30 AM to 1:00 PM", 11, 24, "#2d6cdf"], ["After the close", "1:00 to 5:00 PM", 24, 32, "#b08bd8"]];
  const sessOf = pm => (pm < 390 ? "before the open" : pm < 780 ? "regular session" : "after the close");
  const bucketName = i => clock(60 + i * 30) + " to " + clock(90 + i * 30);
  function yChart(Y, tot) {
    const W = 600, Ht = 112, L = 8, R = 8, Tp = 16, axis = 16, bw = (W - L - R) / 32, vmax = Math.max(...Y.b.map(b => (b ? b[0] : 0)), 1), top = Ht - axis;
    const X = i => L + i * bw, Hh = v => v / vmax * (top - Tp - 4);
    const band = SESSIONS.map(([name, , a, z, col]) => `<rect x="${X(a)}" y="${Tp - 12}" width="${(z - a) * bw}" height="${top - Tp + 12}" fill="${col}" opacity=".10"/><text x="${X(a) + 4}" y="${Tp - 3}" font-size="9" fill="currentColor" opacity=".7">${name}</text>`).join("");
    const bars = Y.b.map((b, i) => { if (!b) return ""; const col = SESSIONS.find(q => i >= q[2] && i < q[3])[4], hh = Math.max(Hh(b[0]), 1);
      return `<rect x="${(X(i) + 1.5).toFixed(1)}" y="${(top - hh).toFixed(1)}" width="${(bw - 3).toFixed(1)}" height="${hh.toFixed(1)}" fill="${col}" opacity=".9"/>`; }).join("");
    const ticks = [[0, "1 AM"], [6, "4 AM"], [11, "6:30 AM"], [20, "11 AM"], [24, "1 PM"], [32, "5 PM"]].map(([i, t]) => `<text x="${X(i).toFixed(1)}" y="${Ht - 3}" font-size="9" fill="currentColor" opacity=".55" text-anchor="${i === 0 ? "start" : i === 32 ? "end" : "middle"}">${t}</text>`).join("");
    const box = h("div", { class: "pl" });
    box.innerHTML = `<svg viewBox="0 0 ${W} ${Ht}" width="100%" style="max-width:${W}px;height:auto;cursor:crosshair" role="img" aria-label="Shares traded yesterday by half hour, Seattle time">` + band + `<rect class="yc-hi" y="${Tp - 12}" height="${top - Tp + 12}" fill="currentColor" opacity=".1" style="display:none"/>` + bars + ticks + `</svg>`;
    const svg = box.querySelector("svg"), hi = svg.querySelector(".yc-hi"), tip = h("div", { class: "pl-tip" });
    tip.hidden = true;
    box.append(tip);
    const hide = () => { tip.hidden = true; hi.style.display = "none"; };
    const show = ev => {
      const r = svg.getBoundingClientRect(), vx = (ev.clientX - r.left) / r.width * W, i = Math.floor((vx - L) / bw);
      if (i < 0 || i > 31) return hide();
      const b = Y.b[i];
      hi.setAttribute("x", X(i)); hi.setAttribute("width", bw); hi.style.display = "";
      tip.replaceChildren(h("div", { style: "font-weight:650", text: bucketName(i) + " Seattle time" }), h("div", { class: "sub", style: "margin:0", text: SESSIONS.find(q => i >= q[2] && i < q[3])[0] }),
        b ? h("div", { text: big(b[0]) + " shares (" + Math.round(b[0] / tot * 100) + "% of the day) in " + fmt(b[1]) + " trades" }) : h("div", { text: "No trades in this half hour" }),
        b ? h("div", { class: "sub", style: "margin:0", text: "Price " + px(b[3]) + " high, " + px(b[4]) + " low · " + px(b[2]) + " at the start, " + px(b[5]) + " at the end" }) : null,
        b && b[1] ? h("div", { class: "sub", style: "margin:0", text: "Average trade about " + fmt(Math.round(b[0] / b[1])) + " shares" }) : null);
      tip.hidden = false;
      const br = box.getBoundingClientRect(), px_ = ev.clientX - br.left;
      tip.style.left = (px_ > br.width / 2 ? Math.max(0, px_ - tip.offsetWidth - 14) : px_ + 14) + "px";
    };
    svg.addEventListener("pointermove", show); svg.addEventListener("pointerdown", show); svg.addEventListener("pointerleave", hide);
    return box;
  }
  function ySection(m, H, x, Y, kv, times) {
    const c = H.c, last = x.last, day = H.d[last], vDay = H.v[last], avg = m.avgVol, tot = Y.shares || 1, cov = tot / vDay;
    const part = (a, z) => Y.b.slice(a, z).reduce((q, b) => q + (b ? b[0] : 0), 0), pcs = SESSIONS.map(q => part(q[2], q[3]));
    const busyHalf = Y.b.reduce((bi, b, i) => ((b ? b[0] : 0) > (Y.b[bi] ? Y.b[bi][0] : 0) ? i : bi), 0), avgTrade = Y.trades ? tot / Y.trades : 0;
    const at = (pm, price) => px(price) + " at " + clock(pm), dateLine = dayLabel(day) + ", " + day.slice(0, 4);
    const sizeHint = avgTrade < 100 ? "mostly small trades, the kind many individual investors make" : avgTrade < 400 ? "a mix of small and mid-sized trades" : "bigger trades on average, which can come from funds, or from traders splitting a big order into pieces";
    const vsVwap = c[last] / Y.vwap - 1;
    const plain = [
      dateLine + ": " + m.s + " traded " + big(vDay) + " shares" + (Y.trades ? " in about " + fmt(Y.trades) + " separate trades" : "") + (avg ? " (" + times(vDay, avg) + ")" : "") + ". Times below are Seattle time; the market is open 6:30 AM to 1:00 PM.",
      "The first trade was " + at(Y.first[0], Y.first[1]) + " (" + sessOf(Y.first[0]) + ") and the last " + at(Y.last[0], Y.last[1]) + " (" + sessOf(Y.last[0]) + "). " + (Y.regOpen != null ? "The regular session opened at " + px(Y.regOpen) + ". " : "") +
        "The day's high was " + at(Y.hi[0], Y.hi[1]) + " (" + sessOf(Y.hi[0]) + ") and its low " + at(Y.lo[0], Y.lo[1]) + " (" + sessOf(Y.lo[0]) + "). The regular session closed at " + px(c[last]) + ", " + upDown(x.ydChg) + ap(x.ydChg, 1) + " from the day before.",
      "When the shares traded: " + SESSIONS.map((q, i) => (pcs[i] > 0 && pcs[i] / tot < 0.005 ? "under 1%" : Math.round(pcs[i] / tot * 100) + "%") + " " + q[0].toLowerCase()).join(", ") + ". The busiest half hour was " + bucketName(busyHalf) + " (" + big(Y.b[busyHalf][0]) + " shares). The busiest single minute was " + clock(Y.busy[0]) + ", with " + big(Y.busy[1]) + " shares in " + fmt(Y.busy[2]) + " trades" + ([390, 779, 780].includes(Y.busy[0]) ? ", a minute that is often busy because the market's opening and closing prices are set then" : "") + ".",
      "The average trade was about " + fmt(Math.round(avgTrade)) + " shares (about " + px(avgTrade * Y.vwap) + " per trade): " + sizeHint + ". That is a hint about who is trading, never proof.",
      "The average price paid, weighting each trade by its size, was " + px(Y.vwap) + ". The close of " + px(c[last]) + " was " + ap(vsVwap, 1) + (vsVwap < 0 ? " below" : " above") + " it, so someone who bought at the day's average price and held to the close is " + upDown(vsVwap) + ap(vsVwap, 1) + "."
    ];
    if (cov < 0.97) plain.push("The timeline adds up to " + big(tot) + " of the day's " + big(vDay) + " shares; the rest are trades the price feed counts in the daily total but leaves out of its minute-by-minute data.");
    const fl = (m.filings || []).filter(f => /^(3|4|5|144|SC 13[DG].*|SCHEDULE 13[DG].*)$/i.test(f.form || ""));
    const who = h("div", { class: "bm-who" }, h("div", { class: "k", text: "Who bought these shares?" }),
      h("p", { text: "Public data cannot say. Trades are anonymous: an exchange matches a buyer with a seller without publishing names, and every share one person bought was sold by someone else at that same moment. The buyers could be individuals, funds, or market makers (firms that stand ready to buy and sell all day). Even the timeline above only shows when shares traded and in what size, not who was on either side." }),
      h("p", { text: "Names appear only in the filings that owners must make. These are the places to look:" }),
      h("ul", { class: "bm-links" },
        h("li", {}, h("b", { text: "Insiders " }), "(executives, directors, owners of 10% or more) report their own buys and sells within 2 business days on a Form 4. ", m.cik ? link("https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=" + m.cik + "&type=4&owner=include&count=40", "Form 4 filings ↗") : null, m.cik ? "  ·  " : "", link("https://finance.yahoo.com/quote/" + encodeURIComponent(symFor(m, "-")) + "/insider-transactions", "Insider transactions ↗")),
        h("li", {}, h("b", { text: "Big owners " }), "(5% or more of the company) file a Schedule 13D or 13G. ", m.cik ? link("https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=" + m.cik + "&type=SC+13&owner=include&count=40", "13D and 13G filings ↗") : null),
        h("li", {}, h("b", { text: "Funds and institutions " }), "report what they hold once a quarter on a Form 13F, up to 45 days late, so it shows who owned shares, not who bought yesterday. ", link("https://finance.yahoo.com/quote/" + encodeURIComponent(symFor(m, "-")) + "/holders", "Major holders ↗"))),
      h("p", { class: "sub", style: "margin:6px 0 0", text: fl.length ? "In the 3 days before the scan this company filed " + fl.map(f => f.form + " on " + shortDay(f.t.slice(0, 10))).join(", ") + ": reports about owners. They are listed under \"SEC filings\" lower on this card." : "In the 3 days before the scan this company filed no owner reports (no Form 3, 4, 5 or 13D/G), so nothing public names a buyer or seller from around then." }));
    const cells = [
      kv("Regular session opened", Y.regOpen != null ? px(Y.regOpen) : "–", "The first price when the regular session began at 6:30 AM Seattle time."),
      kv("Day's high", px(Y.hi[1]), clock(Y.hi[0]) + ", " + sessOf(Y.hi[0]) + ". The highest price any trade was made at."),
      kv("Day's low", px(Y.lo[1]), clock(Y.lo[0]) + ", " + sessOf(Y.lo[0]) + ". The lowest price any trade was made at."),
      kv("Closed", px(c[last]) + " " + (x.ydChg > 0 ? "▲ " : x.ydChg < 0 ? "▼ " : "") + pct(x.ydChg, 1), "The last price of the regular session (1:00 PM Seattle time), and the change from the day before."),
      kv("Shares traded", big(vDay), avg ? times(vDay, avg) + ": compared with a usual day of " + big(avg) + ". Over 1× means more trading than normal." : "How many shares changed hands."),
      kv("Number of trades", fmt(Y.trades), "Each trade can be a few shares or thousands. More trades usually means more people involved."),
      kv("Average trade", fmt(Math.round(avgTrade)) + " shares", "About " + px(avgTrade * Y.vwap) + " per trade: " + sizeHint + "."),
      kv("Busiest minute", clock(Y.busy[0]), big(Y.busy[1]) + " shares in " + fmt(Y.busy[2]) + " trades (" + Math.round(Y.busy[1] / tot * 100) + "% of the day)."),
      kv("Average price paid", px(Y.vwap), "The average price per share over everything that traded that day (bigger trades count for more). Roughly what an average buyer paid.")
    ];
    return [h("div", { class: "bm-h", text: "Yesterday: " + dateLine }),
      h("div", { class: "mv-plain", style: "margin:4px 0 10px" }, h("div", { class: "k", text: "Yesterday in plain words" }), plain.map(t => h("p", { text: t }))),
      h("div", { class: "sub", style: "margin:0 0 4px", text: "When the " + big(tot) + " shares traded, in half-hour steps (Seattle time). Taller bar = more shares. Hover or touch a bar for the price and trade sizes in that half hour." }), yChart(Y, tot),
      h("div", { class: "mv-dl bm-grid" }, cells), who];
  }
  function beforePanel(m) {
    const H0 = S.hist && S.hist.s && S.hist.s[m.s], k = H0 ? H0.d.filter(d => d <= m.prevDay).length : 0;
    const H = k >= 5 ? { d: H0.d.slice(0, k), c: H0.c.slice(0, k), h: H0.h.slice(0, k), l: H0.l.slice(0, k), v: H0.v.slice(0, k) } : null;
    const kv = (label, v, note) => h("div", {}, h("div", { class: "k", text: label }), h("div", { class: "v" }, v), note ? h("div", { class: "sub", style: "margin:2px 0 0;white-space:normal", text: note }) : null);
    const times = (v, avg) => (avg ? (v / avg >= 10 ? fmt(Math.round(v / avg)) : (v / avg).toFixed(1)) + "× usual" : "");
    const group = (title, cells) => cells.length ? [h("div", { class: "bm-h", text: title }), h("div", { class: "mv-dl bm-grid" }, cells)] : [];
    const panel = h("div", { class: "bm-panel" }), tone = x => (x > 0 ? "▲ " : x < 0 ? "▼ " : "");
    const yest = [], trend = [], vol = [], year = []; let ysec = null;
    if (H) {
      const x = bmStats(H, m), c = H.c, last = x.last;
      panel.append(h("div", { class: "mv-plain", style: "margin:0 0 10px" }, h("div", { class: "k", text: "What these " + x.n + " sessions say, in plain words" }), bmPlain(H, m, x).map(t => h("p", { text: t }))));
      panel.append(h("div", { class: "sub", style: "margin:0 0 4px", text: "The chart: the green line is each day's closing price. The bars underneath are the shares traded that day (green if the price closed higher than the day before, red if lower). The grey dashed line is the 20-session average price" + (m.last != null ? "; the blue dashed line is this morning's premarket price" : "") + (m.avgVol ? "; the grey dashed line over the bars is a usual day's volume" : "") + ". Hover or touch any day." }), bmChart(H, m, x));
      const Y = H0.y && H0.y.day === H.d[last] ? H0.y : null;
      if (Y) ysec = ySection(m, H, x, Y, kv, times);
      else {
        yest.push(kv("Close (" + shortDay(H.d[last]) + ")", px(c[last]) + " " + tone(x.ydChg) + pct(x.ydChg, 1), "The last price of the day, and the change from the day before."));
        yest.push(kv("Range that day", px(H.l[last]) + " to " + px(H.h[last]), "The lowest and highest price it traded at during the day. A wide range means the price swung a lot."));
        yest.push(kv("Shares traded", big(H.v[last]), m.avgVol ? times(H.v[last], m.avgVol) + ": compared with a usual day of " + big(m.avgVol) + ". Over 1× means more trading than normal." : "How many shares changed hands."));
      }
      trend.push(kv("Typical day's move", ap(x.absMed, 1), "How far it usually moves in one day. Biggest jump " + pct(x.maxUp, 0) + " (" + shortDay(H.d[x.upI]) + "), biggest drop " + pct(x.maxDn, 0) + " (" + shortDay(H.d[x.dnI]) + ")."));
      trend.push(kv("Change over the stretch", pct(x.chAll, 0) + (x.ch20 != null ? " · last 20 sessions " + pct(x.ch20, 0) : ""), "From the first close in the chart to yesterday's, and over the last 20 sessions (about one month)."));
      trend.push(kv("Closing high", px(c[x.hiI]), shortDay(H.d[x.hiI]) + (x.hiI === last ? " (yesterday)" : ". Someone who bought at that close is " + upDown(c[last] / c[x.hiI] - 1) + ap(c[last] / c[x.hiI] - 1, 0) + " at yesterday's close.")));
      trend.push(kv("Closing low", px(c[x.loI]), shortDay(H.d[x.loI]) + (x.loI === last ? " (yesterday)" : ". Yesterday's close is " + upDown(c[last] / c[x.loI] - 1) + ap(c[last] / c[x.loI] - 1, 0) + " from it.")));
      trend.push(kv("Average closing price", "20 sessions " + px(x.sma20) + (x.sma50 != null ? " · 50 sessions " + px(x.sma50) : ""), "Yesterday's close is " + (c[last] >= x.sma20 ? "above" : "below") + " the 20-session average. Above means it has lately been trading higher than the recent norm; below, lower."));
      trend.push(kv("Up days and down days", x.upDays + " up · " + x.dnDays + " down", "Days the close was higher or lower than the day before" + (x.rets.length - x.upDays - x.dnDays ? " (" + (x.rets.length - x.upDays - x.dnDays) + " unchanged)" : "") + "."));
      trend.push(kv("Days that moved 10% or more", x.big + " of " + x.rets.length, x.big ? "A jumpy stock: it has made a move like this " + x.big + " time" + (x.big === 1 ? "" : "s") + " in the stretch." : "None: it has not made a move like this in the stretch, so a big move this morning is unusual for it."));
      vol.push(kv("A usual day", m.avgVol ? big(m.avgVol) + " shares" : "–", "The average of the 20 sessions before yesterday. Few shares means a small number of people can move the price."));
      vol.push(kv("Busiest day", big(H.v[x.vI]) + " shares", shortDay(H.d[x.vI]) + (m.avgVol ? " · " + times(H.v[x.vI], m.avgVol) : "") + (x.vI > 0 && c[x.vI - 1] ? " · the price moved " + pct(c[x.vI] / c[x.vI - 1] - 1, 0) + " that day." : ".")));
      if (x.bigVol != null) vol.push(kv("Days with 3× the usual shares", x.bigVol + " of " + x.n, "Days when far more people than normal traded it, which is usually when something was going on."));
    } else panel.append(h("div", { class: "sub", style: "margin:0 0 6px", text: "The daily price history for this stock was not saved with this scan. The numbers and links below still work." }));
    if (m.hi52 != null && m.lo52 != null) {
      const at = m.hi52 > m.lo52 ? ((m.prev != null ? m.prev : m.close) - m.lo52) / (m.hi52 - m.lo52) : null;
      year.push(kv("52-week range", px(m.lo52) + " to " + px(m.hi52), "The lowest and highest price in the past year (low " + (m.lo52Day ? shortDay(m.lo52Day) : "–") + ", high " + (m.hi52Day ? shortDay(m.hi52Day) : "–") + ")."));
      if (at != null) year.push(kv("Where yesterday's close sat", Math.round(Math.min(Math.max(at, 0), 1) * 100) + "% of the way up", "0% is the year's low and 100% its high. " + (at < 0.2 ? "Near the bottom of the year's range." : at > 0.8 ? "Near the top of the year's range." : "Middle of the year's range.")));
      year.push(kv("From the 52-week high", ap((m.prev != null ? m.prev : m.close) / m.hi52 - 1, 0) + " below", "How far yesterday's close was under the year's highest price."));
    }
    panel.append(...(ysec || group("Yesterday", yest)), ...group("The price over these " + (H ? H.d.length : 60) + " sessions", trend), ...group("Trading volume (shares traded)", vol), ...group("The past year", year));
    const y = symFor(m, "-"), L = (href, t, why) => h("li", {}, link(href, t + " ↗"), h("span", { class: "sub", style: "margin:0", text: " " + why }));
    panel.append(h("div", { style: "margin-top:12px" }, h("b", { text: "Dig deeper: " }), h("span", { class: "sub", style: "margin:0", text: "these open other websites in a new tab" }),
      h("ul", { class: "bm-links" },
        L("https://finance.yahoo.com/quote/" + encodeURIComponent(y), "Yahoo Finance", "price, company profile, numbers about the business"),
        L("https://finance.yahoo.com/quote/" + encodeURIComponent(y) + "/key-statistics", "Key statistics", "how many shares exist, shares sold short, valuation"),
        L("https://finviz.com/quote.ashx?t=" + encodeURIComponent(y), "Finviz", "one page of ratios, short interest, insider trades and news"),
        L("https://www.tradingview.com/symbols/" + encodeURIComponent(symFor(m, "-")) + "/", "TradingView", "bigger charts, with any time span you pick"),
        m.cik ? L("https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=" + m.cik + "&owner=include&count=40", "Every SEC filing", "the company's own reports, including share offerings and insider trades") : null,
        L("https://www.google.com/search?tbm=nws&q=" + encodeURIComponent(m.s + " stock"), "News search", "what is being written about it right now"))));
    return panel;
  }
  function bmChart(H, m, x) {
    const n = H.d.length, W = 600, Ht = 190, L = 54, R = 8, Tp = 10, VH = 46, axis = 16, top = Ht - axis - VH - 8, halo = "paint-order:stroke;stroke:var(--surface);stroke-width:3px";
    const lo = Math.min(...H.l, m.last != null ? m.last : Infinity), hi = Math.max(...H.h, m.last != null ? m.last : -Infinity), span = hi - lo || 1, avgV = m.avgVol || 0, vmax = Math.max(...H.v, avgV) || 1;
    const X = i => L + i / Math.max(n - 1, 1) * (W - L - R), Y = v => Tp + (1 - (v - lo) / span) * (top - Tp), bw = Math.max((W - L - R) / n * 0.7, 1.5), VY = v => Ht - axis - Math.max(v / vmax * VH, 0);
    const line = H.c.map((v, i) => X(i).toFixed(1) + "," + Y(v).toFixed(1)).join(" ");
    const vol = H.v.map((v, i) => { const hh = Math.max(v / vmax * VH, v ? 1 : 0), up = i === 0 || H.c[i] >= H.c[i - 1];
      return `<rect x="${(X(i) - bw / 2).toFixed(1)}" y="${(Ht - axis - hh).toFixed(1)}" width="${bw.toFixed(1)}" height="${hh.toFixed(1)}" fill="${up ? "#1f7a4d" : "#c0392b"}" opacity=".55"/>`; }).join("");
    const tick = (i, anchor) => `<text x="${X(i).toFixed(1)}" y="${Ht - 3}" font-size="9" fill="currentColor" opacity=".55" text-anchor="${anchor}">${shortDay(H.d[i])}</text>`;
    const note = (i, text, above) => { const a = i < n * 0.2 ? "start" : i > n * 0.8 ? "end" : "middle"; return `<text x="${X(i).toFixed(1)}" y="${(Y(H.c[i]) + (above ? -7 : 13)).toFixed(1)}" font-size="9" fill="currentColor" opacity=".8" text-anchor="${a}" style="${halo}">${text}</text><circle cx="${X(i).toFixed(1)}" cy="${Y(H.c[i]).toFixed(1)}" r="2.6" fill="var(--surface)" stroke="currentColor" stroke-width="1.2"/>`; };
    const yAvg = Y(x.sma20), yNow = m.last != null ? Y(m.last) : null, closeLabels = Math.abs(yAvg - (yNow == null ? -99 : yNow)) < 11;
    const ref = `<line x1="${L}" x2="${W - R}" y1="${yAvg.toFixed(1)}" y2="${yAvg.toFixed(1)}" stroke="currentColor" opacity=".4" stroke-dasharray="4 3"/>` +
      `<text x="${L + 3}" y="${(yAvg + (closeLabels && yAvg > yNow ? 10 : -3)).toFixed(1)}" font-size="9" fill="currentColor" opacity=".75" style="${halo}">20-session average ${px(x.sma20)}</text>` +
      (yNow == null ? "" : `<line x1="${L}" x2="${W - R}" y1="${yNow.toFixed(1)}" y2="${yNow.toFixed(1)}" stroke="#2d6cdf" opacity=".8" stroke-dasharray="2 3"/><text x="${W - R - 2}" y="${(yNow + (closeLabels && yNow > yAvg ? 10 : -3)).toFixed(1)}" font-size="9" fill="#2d6cdf" text-anchor="end" style="${halo}">this morning ${px(m.last)} (premarket)</text>`);
    const volRef = avgV ? `<line x1="${L}" x2="${W - R}" y1="${VY(avgV).toFixed(1)}" y2="${VY(avgV).toFixed(1)}" stroke="currentColor" opacity=".45" stroke-dasharray="4 3"/><text x="${L - 4}" y="${(VY(avgV) + 3).toFixed(1)}" font-size="9" fill="currentColor" opacity=".7" text-anchor="end">usual ${big(avgV)}</text>` : "";
    const svgText = `<svg viewBox="0 0 ${W} ${Ht}" width="100%" style="max-width:${W}px;height:auto;cursor:crosshair" role="img" aria-label="Closing price and volume, last ${n} sessions">` +
      `<text x="${L - 4}" y="${Tp + 8}" font-size="9" fill="currentColor" opacity=".6" text-anchor="end">${px(hi)}</text><text x="${L - 4}" y="${top}" font-size="9" fill="currentColor" opacity=".6" text-anchor="end">${px(lo)}</text>` +
      `<line x1="${L}" x2="${W - R}" y1="${top + 4}" y2="${top + 4}" stroke="currentColor" opacity=".15"/>` +
      `<rect class="bm-band" y="${Tp}" height="${Ht - axis - Tp}" fill="currentColor" opacity=".07" style="display:none"/>` + vol + volRef + ref +
      `<polyline points="${line}" fill="none" stroke="#1f7a4d" stroke-width="1.8"/><circle cx="${X(n - 1).toFixed(1)}" cy="${Y(H.c[n - 1]).toFixed(1)}" r="3" fill="#1f7a4d"/>` +
      (x.hiI !== n - 1 ? note(x.hiI, "high " + px(H.c[x.hiI]), true) : "") + (x.loI !== n - 1 && x.loI !== x.hiI ? note(x.loI, "low " + px(H.c[x.loI]), false) : "") +
      tick(0, "start") + tick(Math.floor((n - 1) / 2), "middle") + tick(n - 1, "end") + `<circle class="bm-dot" r="3.5" fill="#1f7a4d" style="display:none"/></svg>`;
    const box = h("div", { class: "pl" });
    box.innerHTML = svgText;
    const svg = box.querySelector("svg"), band = svg.querySelector(".bm-band"), dot = svg.querySelector(".bm-dot"), tip = h("div", { class: "pl-tip" });
    tip.hidden = true;
    box.append(tip);
    const hide = () => { tip.hidden = true; band.style.display = dot.style.display = "none"; };
    const show = ev => {
      const r = svg.getBoundingClientRect(), vx = (ev.clientX - r.left) / r.width * W;
      if (vx < L - 4 || vx > W - R + 4) return hide();
      const i = Math.min(Math.max(Math.round((vx - L) / (W - L - R) * (n - 1)), 0), n - 1), chg = i > 0 && H.c[i - 1] ? H.c[i] / H.c[i - 1] - 1 : null;
      band.setAttribute("x", X(i) - bw); band.setAttribute("width", bw * 2); band.style.display = "";
      dot.setAttribute("cx", X(i)); dot.setAttribute("cy", Y(H.c[i])); dot.style.display = "";
      tip.replaceChildren(h("div", { style: "font-weight:650", text: dayLabel(H.d[i]) }),
        h("div", { text: "Close " + px(H.c[i]) + (chg == null ? "" : " (" + pct(chg, 1) + " on the day)") }),
        h("div", { class: "sub", style: "margin:0", text: "Range " + px(H.l[i]) + " to " + px(H.h[i]) }),
        h("div", { class: "sub", style: "margin:0", text: big(H.v[i]) + " shares" + (m.avgVol ? " (" + (H.v[i] / m.avgVol >= 10 ? fmt(Math.round(H.v[i] / m.avgVol)) : (H.v[i] / m.avgVol).toFixed(1)) + "× usual)" : "") }),
        m.last != null ? h("div", { class: "sub", style: "margin:0", text: "This morning's " + px(m.last) + " is " + pct(m.last / H.c[i] - 1, 0) + " from this close" }) : null);
      tip.hidden = false;
      const br = box.getBoundingClientRect(), px_ = ev.clientX - br.left;
      tip.style.left = (px_ > br.width / 2 ? Math.max(0, px_ - tip.offsetWidth - 14) : px_ + 14) + "px";
    };
    svg.addEventListener("pointermove", show); svg.addEventListener("pointerdown", show); svg.addEventListener("pointerleave", hide);
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
    if (m.prevDay) facts.push(beforeFact(m));
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
  const liveEl = sym => (PUBLIC ? null : h("span", { class: "lv", "data-live": sym }));
  const toggle = (m, day) => h("span", { style: "display:block" }, toggleBtn(m, day), liveEl(m.s));
  const toggleBtn = (m, day) => h("button", { class: "link", type: "button", style: "font-weight:650", title: "Open the evidence for " + m.s, text: "▸ " + m.s, onclick: ev => { const b = ev.currentTarget, tr = b.closest("tr").nextElementSibling; if (tr && tr.classList.contains("scan-detail")) { tr.hidden = !tr.hidden; b.textContent = (tr.hidden ? "▸ " : "▾ ") + m.s; } } });

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
  .lv{display:inline-block;font-size:12.5px;font-weight:650;font-variant-numeric:tabular-nums;border-radius:6px;padding:1px 7px;margin-top:3px;white-space:nowrap}
  .lv:empty{display:none} .lv.up{color:var(--up)} .lv.down{color:var(--down)} .lv small{font-weight:500;color:var(--muted);margin-left:5px}
  .lv.tick-up{animation:lvup 1.1s ease-out} .lv.tick-down{animation:lvdown 1.1s ease-out}
  @keyframes lvup{from{background:color-mix(in srgb,var(--up) 35%,transparent)}to{background:transparent}}
  @keyframes lvdown{from{background:color-mix(in srgb,var(--down) 35%,transparent)}to{background:transparent}}
  .lv-bar{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:8px 14px;margin:0 0 14px;font-size:13px;box-shadow:0 2px 10px rgba(0,0,0,.06)}
  .lv-dot{width:9px;height:9px;border-radius:50%;background:var(--axis);display:inline-block;margin-right:6px}
  .lv-bar.on .lv-dot{background:var(--up);animation:lvpulse 1.6s infinite}
  @keyframes lvpulse{50%{opacity:.35}}
  .lv-bar button{font:inherit;font-size:12.5px;border:1px solid var(--border);background:var(--wash);color:var(--ink);padding:3px 11px;border-radius:8px;cursor:pointer;margin-left:auto}
  .bm-btn{font:inherit;color:inherit;text-align:left;background:none;border:0;padding:0;cursor:pointer;line-height:inherit}
  .bm-btn:hover b,.bm-btn:focus-visible b{text-decoration:underline}
  .bm-chev{display:inline-block;width:1.1em;color:var(--s1);font-size:13px} .bm-hint{color:var(--s1);font-size:12px;font-weight:650;background:var(--wash);border-radius:999px;padding:1px 9px;margin-left:4px;white-space:nowrap}
  .bm-panel{margin:8px 0 10px -18px;padding:12px 14px;border:1px solid var(--border);border-radius:12px;background:var(--surface)}
  .bm-who{margin:12px 0 4px;padding:10px 14px;border:1px solid var(--border);border-radius:10px;background:var(--wash)} .bm-who .k{font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)} .bm-who p{margin:6px 0}
  .bm-h{margin:14px 0 4px;font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)} .bm-grid{margin-top:2px} .bm-links{margin:4px 0 0;padding-left:18px} .bm-links li{margin:2px 0}
  li.bm{list-style:none;margin-left:-18px}
  .pl{position:relative}
  .pl-tip{position:absolute;top:0;z-index:4;pointer-events:none;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:6px 10px;font-size:12px;line-height:1.4;box-shadow:0 4px 14px rgba(0,0,0,.18);white-space:nowrap}
  .pl-tip[hidden]{display:none}
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
      h("div", { class: "mv-px" }, h("span", { class: "a" }, px(m.prev), h("i", { text: "→" }), px(m.last)), h("span", { class: "b", text: dayLabel(m.prevDay) + " close → " + dayAt(day, m.lastAt) }), liveEl(m.s)),
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

  /* ----- live prices: the local dashboard server reads Alpaca every few seconds (real-time IEX trades, else the 15-minute-delayed ones). The public copy has no server, so it shows none. ----- */
  const LIVE = { timer: null, paused: false, bar: null };
  function liveBar() {
    const b = h("div", { class: "lv-bar" }, h("span", {}, h("i", { class: "lv-dot" }), h("b", { text: "Live prices" })), h("span", { class: "lv-msg", text: "connecting…" }),
      h("button", { type: "button", text: "Pause", onclick: ev => { LIVE.paused = !LIVE.paused; ev.currentTarget.textContent = LIVE.paused ? "Resume" : "Pause"; b.classList.toggle("on", !LIVE.paused); if (!LIVE.paused) pollLive(); } }));
    LIVE.bar = b;
    return b;
  }
  const liveMsg = (t, on) => { if (!LIVE.bar) return; LIVE.bar.querySelector(".lv-msg").textContent = t; LIVE.bar.classList.toggle("on", !!on && !LIVE.paused); };
  function paintLive(d) {
    let n = 0, late = 0;
    for (const el of document.querySelectorAll("#tab-scan [data-live]")) {
      const q = d.quotes[el.dataset.live];
      if (!q) { el.replaceChildren(); continue; }
      n++; if (q.src !== "live") late++;
      const chg = q.pc ? q.p / q.pc - 1 : null, was = Number(el.dataset.p || 0);
      el.className = "lv " + (chg == null ? "" : chg > 0 ? "up" : chg < 0 ? "down" : "");
      el.replaceChildren("Now " + px(q.p) + (chg == null ? "" : " " + (chg > 0 ? "▲ " : chg < 0 ? "▼ " : "") + pct(chg, 1)), h("small", { text: q.src === "live" ? "" : "15 min behind" }));
      el.title = "Last trade " + new Date(q.t).toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles" }) + " Seattle time (" + (q.src === "live" ? "real-time IEX trade" : "15-minute-delayed consolidated trade") + "). The percent is the change from the previous close.";
      if (was && was !== q.p) { const k = q.p > was ? "tick-up" : "tick-down"; el.classList.add(k); }
      el.dataset.p = q.p;
    }
    const at = new Date(d.at).toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit", second: "2-digit" });
    liveMsg(n + " stocks · updated " + at + " Seattle time · " + (d.open ? "market open" : "market closed or not open yet: showing the last trade") + (late ? " · " + late + " are 15 minutes behind (no recent real-time trade)" : "") + " · prices refresh every 10 seconds", d.open);
  }
  async function pollLive() {
    if (PUBLIC || LIVE.paused || document.hidden || !LIVE.bar || !LIVE.bar.isConnected) return;
    try {
      const r = await fetch("/api/scanquotes", { cache: "no-store" });
      if (!r.ok) throw new Error("status " + r.status);
      paintLive(await r.json());
    } catch (err) { liveMsg("not available right now (" + err.message + "); the dashboard server may be off", false); }
  }
  function startLive() {
    clearInterval(LIVE.timer);
    if (PUBLIC) return;
    pollLive();
    LIVE.timer = setInterval(pollLive, 10000);
    if (!LIVE.hooked) { LIVE.hooked = true; document.addEventListener("visibilitychange", () => { if (!document.hidden) pollLive(); }); }
  }

  /* ---- Price cards at the top of the scan page, side by side: one per stock in QUOTES. Each reads its own file (see tools/flkr_quote.py, tools/publish_flkr.py).
     To add a stock: add it to SYMBOLS in tools/flkr_quote.py and QUOTES in tools/publish_flkr.py, then add a line here. korea: the fund follows the Seoul market. ---- */
  const QUOTE_BASE = PUBLIC ? "https://raw.githubusercontent.com/viraone/daily-market-scan/quotes/" : "";
  const QUOTES = [{ sym: "FLKR", file: "flkr.json", korea: true }, { sym: "SOFI", file: "sofi.json" }].map(q => Object.assign(q, { el: null, data: null, failed: false, range: "d1" }));
  const FK = { timer: null, hooked: false, gid: 0, row: null };
  const flkrN = v => (typeof v === "number" && isFinite(v) ? v : null);
  const FLKR_CSS = `
.fk-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,520px),1fr));gap:14px;margin-bottom:14px}
.fk{padding:20px 22px 16px;border-radius:14px;overflow:hidden;container-type:inline-size}
.fk > header.fk-head{display:flex;align-items:center;justify-content:space-between;gap:10px 14px;flex-wrap:wrap;margin:0}
.fk-id{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;min-width:0}
.fk-sym{font-size:15px;font-weight:750;letter-spacing:.05em}
.fk-name{color:var(--ink2);font-size:13px}
.fk-ex{font-size:11px;color:var(--muted);border:1px solid var(--border);border-radius:5px;padding:1px 6px}
.fk-state{display:inline-flex;align-items:center;gap:7px;font-size:12px;font-weight:650;background:var(--pill);border-radius:999px;padding:4px 12px 4px 10px}
.fk-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--muted);flex:none}
.fk-dot.on,.fk-state.live .fk-dot{background:var(--up)}
.fk-state.live .fk-dot{animation:fkpulse 2s infinite}
.fk-state.ext .fk-dot{background:#d99a1c}
@keyframes fkpulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--up) 55%,transparent)}70%,100%{box-shadow:0 0 0 7px transparent}}
.fk-body{display:grid;grid-template-columns:minmax(0,1.9fr) minmax(250px,1fr);gap:28px;margin-top:16px;align-items:start}
.fk-body.solo{grid-template-columns:minmax(0,1fr)}
.fk-main,.fk-side{min-width:0}
.fk-hero{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.fk-price{font-size:48px;line-height:1.02;font-weight:700;letter-spacing:-.025em;font-variant-numeric:tabular-nums}
.fk-chg{display:inline-flex;align-items:center;font-size:15px;font-weight:650;border-radius:9px;padding:5px 11px;font-variant-numeric:tabular-nums;white-space:nowrap}
.fk-chg.up{background:color-mix(in srgb,var(--up) 14%,transparent);color:var(--up)}
.fk-chg.down{background:color-mix(in srgb,var(--down) 14%,transparent);color:var(--down)}
.fk-chg.flat{background:var(--wash);color:var(--ink2)}
.fk-sub{margin:7px 0 0;color:var(--ink2);font-size:13px}
.fk-muted{color:var(--muted)}
.fk-night{margin:14px 0 0;padding:12px 14px;border-radius:12px;background:var(--wash);border:1px dashed var(--border)}
.fk-night-t{font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--ink2);margin:0 0 8px}
.fk-nrow{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.fk-nrow small{display:block;font-size:11.5px;color:var(--muted)}
.fk-nrow b{font-size:16px;font-weight:650;font-variant-numeric:tabular-nums}
.fk-night p{margin:9px 0 0;font-size:12px;color:var(--muted);line-height:1.45}
.fk-chart{margin-top:18px}
.fk-chart-top{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap}
.fk-h{margin:0;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.fk-seg{display:inline-flex;background:var(--wash);border-radius:10px;padding:3px}
.fk-seg button{font:inherit;font-size:12px;font-weight:650;color:var(--ink2);background:none;border:0;border-radius:8px;padding:5px 12px;cursor:pointer}
.fk-seg button:hover{color:var(--ink)}
.fk-seg button[aria-pressed="true"]{background:var(--surface);color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.16)}
.fk-seg button:focus-visible{outline:2px solid var(--ink2);outline-offset:1px}
.fk-svgwrap{position:relative;color:var(--ink)}
.fk-svg{display:block;width:100%;height:auto;overflow:visible;touch-action:pan-y}
.fk-halo{animation:fkhalo 2.2s ease-out infinite;transform-box:fill-box;transform-origin:center}
@keyframes fkhalo{from{opacity:.55;transform:scale(1)}to{opacity:0;transform:scale(3)}}
.fk-tip{position:absolute;top:0;z-index:3;pointer-events:none;background:var(--ink);color:var(--page);border-radius:9px;padding:7px 10px;font-size:12px;line-height:1.4;white-space:nowrap;box-shadow:0 6px 18px rgba(0,0,0,.28)}
.fk-tip b{display:block;font-size:14px}
.fk-note{margin:8px 0 0;font-size:11.5px;color:var(--muted);line-height:1.45}
.fk-side{display:flex;flex-direction:column;gap:20px}
.fk-rb-top{display:flex;justify-content:space-between;gap:8px;font-size:12.5px;color:var(--ink2)}
.fk-rb-track{position:relative;height:6px;border-radius:99px;margin:10px 0 6px;background:linear-gradient(90deg,color-mix(in srgb,var(--down) 42%,var(--wash)),color-mix(in srgb,var(--up) 42%,var(--wash)))}
.fk-rb-dot{position:absolute;top:50%;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:var(--ink);border:2.5px solid var(--surface);box-shadow:0 1px 4px rgba(0,0,0,.3)}
.fk-rb-ends{display:flex;justify-content:space-between;gap:8px;font-variant-numeric:tabular-nums}
.fk-rb-ends b{font-size:13px;font-weight:650}
.fk-rb-ends small{display:block;font-size:11px;color:var(--muted)}
.fk-rb-ends .r{text-align:right}
.fk-stats{margin:0}
.fk-stats > div{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:9px 0;border-top:1px solid var(--border);font-size:13px}
.fk-stats dt{color:var(--ink2)}
.fk-stats dd{margin:0;text-align:right;font-weight:650;font-variant-numeric:tabular-nums}
.fk-stats dd small{display:block;font-weight:400;font-size:11.5px;color:var(--muted)}
.fk-stats .up{color:var(--up)}.fk-stats .down{color:var(--down)}
.fk-ext{margin-top:22px}
.fk-ext .fk-fine{margin:4px 0 10px}
.fk-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px}
.fk-tile{border:1px solid var(--border);border-radius:12px;padding:11px 13px;background:var(--surface)}
.fk-tile-top{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px;color:var(--ink2)}
.fk-tile-top b{color:var(--ink);font-weight:650}
.fk-mini{font-size:11.5px;font-weight:650;border-radius:6px;padding:1px 7px;font-variant-numeric:tabular-nums}
.fk-mini.up{background:color-mix(in srgb,var(--up) 14%,transparent);color:var(--up)}
.fk-mini.down{background:color-mix(in srgb,var(--down) 14%,transparent);color:var(--down)}
.fk-mini.flat{background:var(--wash);color:var(--ink2)}
.fk-tile-px{font-size:21px;font-weight:700;margin:6px 0 3px;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.fk-tile small{display:block;font-size:11.5px;color:var(--muted);font-variant-numeric:tabular-nums}
.fk-footer{margin-top:20px;padding-top:13px;border-top:1px solid var(--border)}
.fk-foot{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;font-size:12px;color:var(--muted)}
.fk-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--border);border-radius:999px;padding:2px 10px;color:var(--ink2)}
.fk-chip.warn{background:color-mix(in srgb,#d99a1c 16%,transparent);border-color:color-mix(in srgb,#d99a1c 45%,transparent);color:var(--ink)}
.fk-fine{margin:9px 0 0;font-size:11.5px;color:var(--muted);line-height:1.5}
@media (max-width:820px){.fk-body{grid-template-columns:minmax(0,1fr)}.fk-price{font-size:40px}.fk{padding:16px 14px 14px}.fk-nrow{grid-template-columns:repeat(2,minmax(0,1fr))}}
@container (max-width:760px){.fk-body{grid-template-columns:minmax(0,1fr)}}
@container (max-width:480px){.fk-price{font-size:40px}.fk-nrow{grid-template-columns:repeat(2,minmax(0,1fr))}}
.fk-est{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;border:1px solid var(--border);border-radius:6px;padding:3px 8px;color:var(--ink2);background:var(--wash)}
@media (prefers-reduced-motion:reduce){.fk-state.live .fk-dot,.fk-halo{animation:none}}
`;
  function flkrCss() {
    if (document.getElementById("flkr-css")) return;
    const st = document.createElement("style");
    st.id = "flkr-css";
    st.textContent = FLKR_CSS;
    document.head.append(st);
  }
  function flkrWhen(iso) {
    if (!iso || isNaN(Date.parse(iso))) return "–";
    return new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", hour: "numeric", minute: "2-digit" }) + " Seattle time";
  }
  const flkrTime = t => new Date(t * 1000).toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", hour: "numeric", minute: "2-digit" });
  const flkrDay = t => new Date(t * 1000).toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });   // daily bars are stamped at midnight Eastern, the same date in UTC
  const flkrKey = t => new Date(t * 1000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const flkrWeekday = t => new Date(t * 1000).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short" });
  function flkrPart(t) {
    const m = new Date(t * 1000).toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: false }).split(":");
    const hm = (+m[0] % 24) * 60 + (+m[1] || 0);
    return hm < 570 ? "premarket" : hm >= 960 ? "after hours" : "regular session";
  }
  function flkrDelta(ratio, amount) {
    const cls = ratio == null ? "flat" : ratio > 0 ? "up" : ratio < 0 ? "down" : "flat";
    const arrow = ratio > 0 ? "▲ " : ratio < 0 ? "▼ " : "";
    const amt = amount == null ? "" : (amount > 0 ? "+" : amount < 0 ? "−" : "") + px(Math.abs(amount)) + " ";
    return [cls, arrow + amt + (amount == null ? pct(ratio, 2) : "(" + pct(ratio, 2) + ")")];
  }

  function flkrNight(o) {
    const bid = flkrN(o.bid), ask = flkrN(o.ask), mid = flkrN(o.mid);
    if (bid == null || ask == null || mid == null || mid <= 0) return null;
    const cell = (label, value) => h("div", {}, h("small", { text: label }), h("b", { text: value }));
    return h("div", { class: "fk-night" }, h("p", { class: "fk-night-t", text: "Overnight · indicative only" }),
      h("div", { class: "fk-nrow" }, cell("Live bid", px(bid)), cell("Midpoint", px(mid)), cell("Live ask", px(ask)), cell("Gap", ((ask - bid) / mid * 100).toFixed(1) + "%")),
      h("p", { text: "As of " + flkrWhen(o.time) + ". A wide gap between bid and ask means almost no one is trading it, so the midpoint is a rough guide, not a price you could trade at." }));
  }

  function flkrRangeBar(label, tag, low, high, price, lowSub, highSub) {
    const track = h("div", { class: "fk-rb-track" });
    if (price != null && high > low) {
      const pos = Math.min(100, Math.max(0, (price - low) / (high - low) * 100));
      track.append(h("i", { class: "fk-rb-dot", style: "left:" + pos.toFixed(1) + "%", title: price < low || price > high ? "The latest price is outside this range" : null }));
    }
    return h("div", {}, h("div", { class: "fk-rb-top" }, h("span", { text: label }), h("span", { class: "fk-muted", text: tag || "" })), track,
      h("div", { class: "fk-rb-ends" }, h("span", {}, h("b", { text: px(low) }), lowSub ? h("small", { text: lowSub }) : null),
        h("span", { class: "r" }, h("b", { text: px(high) }), highSub ? h("small", { text: highSub }) : null)));
  }
  function flkrSide(d, price) {
    const day = d.day || {}, close = d.close || {}, year = d.year || {};
    const parts = [];
    const dayTag = day.partial ? "today so far" : (day.date ? dayLabel(day.date) : "");
    if (flkrN(day.low) != null && flkrN(day.high) != null) parts.push(flkrRangeBar("Day's range", dayTag, day.low, day.high, price, "Low", "High"));
    if (flkrN(year.low) != null && flkrN(year.high) != null) parts.push(flkrRangeBar("52-week range", "", year.low, year.high, price, year.lowDate ? dayLabel(year.lowDate) : "", year.highDate ? dayLabel(year.highDate) : ""));
    const rows = [];
    const row = (label, value, subText) => rows.push(h("div", {}, h("dt", { text: label }), h("dd", {}, value, subText ? h("small", { text: subText }) : null)));
    if (flkrN(close.price) != null) row("Previous close", px(close.price), close.date ? dayLabel(close.date) : "");
    if (flkrN(day.open) != null) row("Open", px(day.open), dayTag);
    if (flkrN(day.volume) != null) row("Shares traded", fmt(day.volume), flkrN(year.avgVolume30) != null ? "usual " + fmt(year.avgVolume30) + " a day" : dayTag);
    if (price != null && flkrN(year.high) != null && year.high > 0) {
      const r = price / year.high - 1;
      row("From the 52-week high", h("span", { class: r < 0 ? "down" : r > 0 ? "up" : "", text: (r > 0 ? "▲ " : r < 0 ? "▼ " : "") + pct(r, 1) }), "high " + px(year.high));
    }
    if (rows.length) parts.push(h("dl", { class: "fk-stats" }, ...rows));
    return parts.length ? h("aside", { class: "fk-side" }, ...parts) : null;
  }

  function flkrExtended(d) {
    if (!Array.isArray(d.extended) || !d.extended.length) return null;
    const tiles = d.extended.slice(0, 4).map(e => {
      const change = flkrN(e.change), cls = change == null || change === 0 ? "flat" : change > 0 ? "up" : "down";
      const range = flkrN(e.low) != null && flkrN(e.high) != null ? px(e.low) + " – " + px(e.high) : "–";
      return h("div", { class: "fk-tile" },
        h("div", { class: "fk-tile-top" }, h("span", {}, h("b", { text: String(e.session || "") }), " · " + (e.date ? dayLabel(e.date) : "")),
          change == null ? null : h("span", { class: "fk-mini " + cls, text: (change > 0 ? "▲ " : change < 0 ? "▼ " : "") + pct(change / 100, 2) })),
        h("div", { class: "fk-tile-px", text: px(flkrN(e.last)) }),
        h("small", { text: "Range " + range }),
        h("small", { text: flkrN(e.volume) == null ? "" : fmt(e.volume) + " shares" }));
    });
    return h("section", { class: "fk-ext" }, h("h3", { class: "fk-h", text: "Premarket and after hours" }),
      h("p", { class: "fk-fine", text: "Premarket is 1:00 to 6:30 AM Seattle time and after hours is 1:00 to 5:00 PM. Few shares trade then, so one trade can move the price a lot. Premarket change is from the previous day's close; after-hours change is from that day's close." }),
      h("div", { class: "fk-tiles" }, ...tiles));
  }

  function flkrKorea() {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", weekday: "short", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(now).reduce((a, x) => (a[x.type] = x.value, a), {});
    const hour = parts.hour === "24" ? 0 : +parts.hour, mins = hour * 60 + (+parts.minute);
    const weekend = parts.weekday === "Sat" || parts.weekday === "Sun";
    const date = now.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
    const f = iso => new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", hour: "numeric", minute: "2-digit" });
    return { open: !weekend && mins >= 540 && mins < 930, openStr: f(date + "T09:00:00+09:00"), closeStr: f(date + "T15:30:00+09:00") };
  }
  function flkrFoot(q, d) {
    const k = q.korea ? flkrKorea() : null;
    const stale = Date.now() - Date.parse(d.builtAt) > 20 * 60000;
    return h("footer", { class: "fk-footer" },
      h("div", { class: "fk-foot" },
        k ? h("span", { class: "fk-chip" }, h("i", { class: "fk-dot" + (k.open ? " on" : "") }), "Seoul market " + (k.open ? "open" : "closed")) : null,
        h("span", { text: "Updated " + flkrWhen(d.builtAt) }),
        h("span", { text: "Trades " + (d.delayMinutes || 15) + " min behind · refreshes every minute" }),
        stale ? h("span", { class: "fk-chip warn", text: "Updater may be off: the newest update is over 20 minutes old" }) : null,
        q.failed ? h("span", { class: "fk-chip warn", text: "Last refresh failed; showing the previous numbers" }) : null),
      h("p", { class: "fk-fine", text: k ? "Seoul trades 9:00 AM to 3:30 PM Seoul time, which is " + k.openStr + " to " + k.closeStr + " Seattle time. The fund holds South Korean stocks, so its overnight price tends to follow how they trade there. Korean holidays are not accounted for. A record of prices, not advice."
        : "Overnight (5:00 PM to 1:00 AM Seattle time) the price is the stock's own newest trade on the overnight venue, where few shares trade. Market holidays are not accounted for. A record of prices, not advice." }));
  }

  function flkrChartParts(q, series, keys, redraw, width) {
    const names = { d1: "Last session", d5: "5 days", m1: "1 month" };
    const notes = { d1: "One point per 5 minutes that had trades, from premarket through after hours. The faded part of the line is premarket and after hours; the dashed line is the previous close. Quiet stretches are skipped.",
      d5: "The last 5 trading days, one point per 5 minutes that had trades. Days sit side by side, so the overnight gaps are removed.", m1: "Daily closing prices over the last month." };
    const seg = h("div", { class: "fk-seg", role: "group", "aria-label": "Chart range" });
    for (const k of keys) seg.append(h("button", { type: "button", text: names[k], "aria-pressed": String(k === q.range), onclick: () => { q.range = k; redraw(); } }));
    const top = h("div", { class: "fk-chart-top" }, h("h3", { class: "fk-h", text: "Price" }), seg);

    const cur = series[q.range], P = cur.points, n = P.length;
    // the canvas is as wide as the space the chart has (340 to 760), so the axis text is never shrunk or blown up; before the card is on the page the window decides
    const narrow = width ? width < 520 : window.innerWidth < 620;
    const W = width ? Math.max(340, Math.min(760, Math.round(width))) : (narrow ? 380 : 760), H = narrow ? 240 : 250, L = 6, R = narrow ? 54 : 58, Tp = 12, B = 26;
    const hiP = Math.max(...P.map(p => p[1])), loP = Math.min(...P.map(p => p[1]));
    const vals = [hiP, loP].concat(cur.ref != null ? [cur.ref] : []);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (lo === hi) { lo -= 0.5; hi += 0.5; } else { const pad = (hi - lo) * 0.08; lo -= pad; hi += pad; }
    const X = i => L + (W - L - R) * i / (n - 1), Y = v => Tp + (1 - (v - lo) / (hi - lo)) * (H - Tp - B);
    const col = "var(" + (P[n - 1][1] >= (cur.ref != null ? cur.ref : P[0][1]) ? "--up" : "--down") + ")";
    const gid = "fkg" + (++FK.gid);
    const f1 = v => v.toFixed(1);
    const runs = [];
    let run = [0];
    for (let i = 1; i < n; i++) { if (P[i][2] === P[i - 1][2]) run.push(i); else { runs.push(run); run = [i]; } }
    runs.push(run);
    const lines = runs.map((r, ri) => {
      const idx = ri < runs.length - 1 ? r.concat([runs[ri + 1][0]]) : r;
      return `<polyline points="${idx.map(i => f1(X(i)) + "," + f1(Y(P[i][1]))).join(" ")}" fill="none" stroke-linejoin="round" stroke-linecap="round" stroke-width="2" style="stroke:${col}"${P[r[0]][2] === 1 ? ' opacity=".45"' : ""}/>`;
    }).join("");
    const area = `<path d="M${f1(X(0))},${H - B} ${P.map((p, i) => "L" + f1(X(i)) + "," + f1(Y(p[1]))).join(" ")} L${f1(X(n - 1))},${H - B} Z" fill="url(#${gid})"/>`;
    const grid = [hiP, (hiP + loP) / 2, loP].map(v => `<line x1="${L}" x2="${W - R}" y1="${f1(Y(v))}" y2="${f1(Y(v))}" stroke="currentColor" opacity=".08"/>`).join("");
    const refLine = cur.ref == null ? "" : `<line x1="${L}" x2="${W - R}" y1="${f1(Y(cur.ref))}" y2="${f1(Y(cur.ref))}" stroke="currentColor" opacity=".4" stroke-dasharray="4 4"/><text x="${L + 2}" y="${f1(Y(cur.ref) - 5)}" font-size="11" fill="currentColor" opacity=".6">prev close ${px(cur.ref)}</text>`;
    const yLab = `<text x="${W - R + 8}" y="${f1(Y(hiP) + 4)}" font-size="11" fill="currentColor" opacity=".6">${px(hiP)}</text><text x="${W - R + 8}" y="${f1(Y(loP) + 4)}" font-size="11" fill="currentColor" opacity=".6">${px(loP)}</text>`;
    let xLab = "";
    if (q.range === "d5") {
      for (let i = 0; i < n; i++) {
        if (i === 0 || flkrKey(P[i][0]) !== flkrKey(P[i - 1][0])) {
          xLab += (i ? `<line x1="${f1(X(i))}" x2="${f1(X(i))}" y1="${Tp}" y2="${H - B}" stroke="currentColor" opacity=".12"/>` : "") + `<text x="${f1(X(i) + 4)}" y="${H - 8}" font-size="11" fill="currentColor" opacity=".6">${flkrWeekday(P[i][0])}</text>`;
        }
      }
    } else {
      const fmtAx = q.range === "m1" ? flkrDay : flkrTime;
      xLab = `<text x="${L}" y="${H - 8}" font-size="11" fill="currentColor" opacity=".6">${fmtAx(P[0][0])}</text><text x="${W - R}" y="${H - 8}" font-size="11" fill="currentColor" opacity=".6" text-anchor="end">${fmtAx(P[n - 1][0])}</text>`;
    }
    const ex = f1(X(n - 1)), ey = f1(Y(P[n - 1][1]));
    const endDot = `<circle class="fk-halo" cx="${ex}" cy="${ey}" r="4" style="fill:${col}"/><circle cx="${ex}" cy="${ey}" r="4" stroke="var(--surface)" stroke-width="1.5" style="fill:${col}"/>`;
    const svgText = `<svg class="fk-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${q.sym} price chart"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:${col};stop-opacity:.26"/><stop offset="1" style="stop-color:${col};stop-opacity:0"/></linearGradient></defs>` +
      grid + area + refLine + lines + yLab + xLab + endDot +
      `<line class="fk-cur" y1="${Tp}" y2="${H - B}" stroke="currentColor" opacity=".35" style="display:none"/><circle class="fk-hdot" r="4.5" stroke="var(--surface)" stroke-width="2" style="fill:${col};display:none"/></svg>`;
    const wrap = h("div", { class: "fk-svgwrap" });
    wrap.innerHTML = svgText;   // only numbers formatted above, px() text and Intl-formatted times go into this string
    const svg = wrap.querySelector("svg"), curLine = svg.querySelector(".fk-cur"), dot = svg.querySelector(".fk-hdot"), tip = h("div", { class: "fk-tip" });
    tip.hidden = true;
    wrap.append(tip);
    const hide = () => { tip.hidden = true; curLine.style.display = dot.style.display = "none"; };
    const show = ev => {
      const r = svg.getBoundingClientRect(), vx = (ev.clientX - r.left) / r.width * W;
      if (vx < L - 6 || vx > W - R + 6) return hide();
      const i = Math.min(Math.max(Math.round((vx - L) / (W - L - R) * (n - 1)), 0), n - 1), p = P[i];
      curLine.setAttribute("x1", f1(X(i))); curLine.setAttribute("x2", f1(X(i))); curLine.style.display = "";
      dot.setAttribute("cx", f1(X(i))); dot.setAttribute("cy", f1(Y(p[1]))); dot.style.display = "";
      const lines2 = [h("b", { text: px(p[1]) }), h("span", { text: q.range === "m1" ? flkrDay(p[0]) : flkrTime(p[0]) + " · " + flkrPart(p[0]) })];
      if (q.range === "d1" && cur.ref != null) lines2.push(h("div", { text: pct((p[1] - cur.ref) / cur.ref, 2) + " vs the previous close" }));
      tip.replaceChildren(...lines2);
      tip.hidden = false;
      const br = wrap.getBoundingClientRect(), cx = ev.clientX - br.left;
      tip.style.left = (cx > br.width / 2 ? Math.max(0, cx - tip.offsetWidth - 14) : cx + 14) + "px";
    };
    svg.addEventListener("pointermove", show); svg.addEventListener("pointerdown", show); svg.addEventListener("pointerleave", hide);
    return [top, wrap, h("p", { class: "fk-note", text: notes[q.range] })];
  }
  function flkrChart(q, d) {
    const series = {};
    for (const k of ["d1", "d5", "m1"]) {
      const raw = d.chart && d.chart[k];
      if (!raw || !Array.isArray(raw.points)) continue;
      const pts = raw.points.map(p => {
        if (!Array.isArray(p)) return null;
        const t = flkrN(p[0]), v = flkrN(p[1]);
        return t == null || v == null ? null : [t, v, p[2] ? 1 : 0];
      }).filter(Boolean);
      if (pts.length >= 2) series[k] = { points: pts, ref: flkrN(raw.ref) };
    }
    const keys = Object.keys(series);
    if (!keys.length) return null;
    if (!series[q.range]) q.range = keys[0];
    const box = h("div", { class: "fk-chart" });
    box.redraw = () => box.replaceChildren(...flkrChartParts(q, series, keys, box.redraw, box.clientWidth));   // drawn by paintQuote once the box is in the card, so it can be measured
    return box;
  }

  function flkrEstimate(d, est, o) {
    const cell = (label, value) => h("div", {}, h("small", { text: label }), h("b", { text: value }));
    const paras = [], sym = String(d.symbol || "");
    if (d.last && flkrN(d.last.price) != null) paras.push(h("p", { text: sym + "'s own last trade was " + px(d.last.price) + " at " + flkrWhen(d.last.time) + "." }));
    paras.push(h("p", { text: String(est.name || est.symbol) + " (" + est.symbol + ") holds the same kind of South Korean stocks and trades through the night. " + (flkrN(est.correlation) != null && flkrN(est.sessions) != null ? "Over the last " + est.sessions + " sessions the daily moves of the two lined up almost exactly (correlation " + est.correlation.toFixed(3) + (flkrN(est.gapPct) != null ? ", typically within " + est.gapPct.toFixed(2) + "% of each other a day" : "") + "). " : "") + "The estimate applies " + est.symbol + "'s move since its close to " + sym + "'s close. It is not a price you could trade at." }));
    if (o && flkrN(o.bid) != null && flkrN(o.ask) != null) paras.push(h("p", { text: "The overnight venue's own bid and ask for " + sym + " is " + px(o.bid) + " to " + px(o.ask) + ", too wide to use." }));
    return h("div", { class: "fk-night" },
      h("p", { class: "fk-night-t", text: "Estimated, not a trade" }),
      h("div", { class: "fk-nrow" }, cell(est.symbol + " now", px(flkrN(est.proxyPrice))), cell(est.symbol + " close", px(flkrN(est.proxyClose))), cell(est.symbol + " move", flkrN(est.proxyMovePct) == null ? "–" : pct(est.proxyMovePct / 100, 2)), cell(sym + " estimate", px(flkrN(est.price)))),
      ...paras);
  }

  function paintQuote(q) {
    if (!q.el) return;
    const d = q.data;
    if (!d || typeof d !== "object") {
      q.el.replaceChildren(h("p", { class: "fk-sub", text: q.failed ? q.sym + " price is not available right now." : "Loading the " + q.sym + " price…" }));
      return;
    }
    // the headline is the stock's own last trade, unless it has an estimate (FLKR: from EWY, a sister South Korea fund that trades overnight) made 30+ minutes after it
    const est = d.estimate && typeof d.estimate.symbol === "string" && flkrN(d.estimate.price) != null && !isNaN(Date.parse(d.estimate.time)) ? d.estimate : null;
    const useEst = !!est && (!d.last || Date.parse(est.time) > Date.parse(d.last.time) + 30 * 60000);
    const night = !useEst && d.overnight && flkrN(d.overnight.mid) != null && (!d.last || Date.parse(d.overnight.time) > Date.parse(d.last.time)) ? d.overnight : null;
    const price = flkrN(useEst ? est.price : night ? night.mid : (d.last ? d.last.price : null));
    const close = d.close ? flkrN(d.close.price) : null;
    const ratio = price != null && close ? (price - close) / close : null;
    const [cls, chipText] = flkrDelta(ratio, ratio == null ? null : price - close);
    const state = d.session === "Market open" ? "live" : d.session === "Closed" ? "" : "ext";
    const head = h("header", { class: "fk-head" },
      h("div", { class: "fk-id" }, h("span", { class: "fk-sym", text: String(d.symbol || q.sym) }), h("span", { class: "fk-name", text: String(d.name || "") }), typeof d.exchange === "string" ? h("span", { class: "fk-ex", text: d.exchange }) : null),
      h("span", { class: "fk-state " + state }, h("i", { class: "fk-dot" }), String(d.session || "")));
    const main = h("div", { class: "fk-main" },
      h("div", { class: "fk-hero" }, h("div", { class: "fk-price", text: px(price) }), ratio == null ? null : h("span", { class: "fk-chg " + cls, text: chipText }), useEst ? h("span", { class: "fk-est", title: "Estimated from " + est.symbol + "'s trades, not a " + q.sym + " trade", text: "Estimate" }) : null),
      h("p", { class: "fk-sub", text: useEst ? "Estimated from " + est.symbol + "'s latest " + String(est.session || "").toLowerCase() + " trade · " + flkrWhen(est.time) : night ? "Overnight · indicative midpoint of the live bid and ask" : (d.last ? d.last.session + " · last trade " + flkrWhen(d.last.time) : "No trade yet") }),
      close != null ? h("p", { class: "fk-sub fk-muted", text: "Change is from the regular close of " + px(close) + (d.close.date ? ", " + dayLabel(d.close.date) : "") }) : null);
    const nightBox = useEst ? flkrEstimate(d, est, d.overnight) : (night ? flkrNight(night) : null);
    if (nightBox) main.append(nightBox);
    const chart = flkrChart(q, d);
    if (chart) main.append(chart);
    const side = flkrSide(d, price);
    q.el.replaceChildren(head, h("div", { class: "fk-body" + (side ? "" : " solo") }, main, side), flkrExtended(d), flkrFoot(q, d));
    if (chart) chart.redraw();
  }
  async function pollQuote(q) {
    try {
      const r = await fetch(QUOTE_BASE + q.file + "?t=" + Date.now(), { cache: "no-store" });
      if (!r.ok) throw new Error("status " + r.status);
      q.data = await r.json();
      q.failed = false;
    } catch (err) { q.failed = true; }
    paintQuote(q);
  }
  function pollQuotes() {
    if (document.hidden) return;
    QUOTES.forEach(pollQuote);
  }
  function quotesRow() {
    flkrCss();
    if (!FK.row) {
      for (const q of QUOTES) q.el = h("div", { class: "card fk", id: "sc-" + q.sym.toLowerCase() });
      FK.row = h("div", { class: "fk-row" }, ...QUOTES.map(q => q.el));
      if (window.ResizeObserver) {   // a chart is drawn for the width it had; when its card changes width (window resized, phone turned), draw it again
        const ro = new ResizeObserver(entries => {
          for (const e of entries) {
            const w = Math.round(e.contentRect.width), chart = e.target.querySelector(".fk-chart");
            if (e.target.fkWidth === w) continue;
            e.target.fkWidth = w;
            if (chart && chart.redraw) requestAnimationFrame(() => { if (chart.isConnected) chart.redraw(); });
          }
        });
        for (const q of QUOTES) ro.observe(q.el);
      }
    }
    QUOTES.forEach(paintQuote);
    clearInterval(FK.timer);
    FK.timer = setInterval(pollQuotes, 60000);
    pollQuotes();
    if (!FK.hooked) {
      FK.hooked = true;
      document.addEventListener("visibilitychange", () => { if (!document.hidden) pollQuotes(); });
    }
    return FK.row;
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
    if (!PUBLIC) body.prepend(liveBar());
    body.prepend(quotesRow());
    body.append(h("p", { class: "sub", text: "Limits: Alpaca's free feed leaves out the newest 15 minutes and some thin stocks; headlines come from one feed (Benzinga) and miss small-company filings, trading halts and social media; a split-adjusted history cannot see every spin-off. A headline near a move is a lead, not proof of the reason. This page is a record, not a recommendation." }));
    startLive();
  }

  async function load() {
    if (S.loading) return;
    S.loading = true;
    try {
      const r = await fetch("daily-scan.json?t=" + Date.now(), { cache: "no-store" });
      if (!r.ok) throw new Error("missing");
      S.data = await r.json();
      try { const q = await fetch("daily-scan-replay.json?t=" + Date.now(), { cache: "no-store" }); S.replay = q.ok ? await q.json() : null; } catch (err) { S.replay = null; }
      try { const q = await fetch("daily-history.json?t=" + Date.now(), { cache: "no-store" }); S.hist = q.ok ? await q.json() : null; } catch (err) { S.hist = null; }
      draw();
    } catch (err) {
      $("#sc-lede").textContent = "No scan yet. Run  /usr/bin/python3 -I tools/daily_scan.py  in the dashboard folder (it also runs by itself at 6:00 AM Seattle time on weekdays).";
    }
    S.loading = false;
  }
  window.Scan = { show() { load(); } };
})();
