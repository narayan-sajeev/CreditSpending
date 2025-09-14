/* === Spending Dashboard (clean build) === */
// Config
const CONFIG = {
    columns: {date: "Date", desc: "Description", amount: "Amount", category: "Category"},
    ignoreRows: 0,
    flipSigns: false,
    absAmounts: false,
    categoryPie: {minShare: 0.05, maxSlices: 8, otherLabel: "Other"},
};

// Stable category colors (cool spectrum) + fallback; merchants use dominant bucket color
const CATEGORY_COLORS = {
    "Restaurants": "#6B4EFF",
    "Shopping/Retail": "#00CCAE",
    "Transport/Fuel": "#F59E0B",
    "Entertainment": "#EF4444",
    "Groceries": "#10B981",
    "Utilities": "#3B82F6",
    "Education": "#22D3EE",
    "Services": "#A78BFA",
    "Health/Pharmacy": "#8B5CF6",
    "Travel": "#F43F5E",
    "Subscriptions": "#F97316",
    "Other": "#94A3B8"
};
const __FALLBACK_COOL = ["#6B4EFF", "#5F7AFF", "#4E8FFF", "#3BA6FF", "#22B7F5", "#0BC2BE", "#00CCAE", "#17B7CE", "#2F9EEF", "#5076FF", "#23ABDF", "#00B7FF"];

function __hash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = (h << 5) - h + str.charCodeAt(i);
        h |= 0;
    }
    return Math.abs(h);
}

function getCategoryColor(label) {
    const key = String(label || "Other");
    if (CATEGORY_COLORS[key]) return CATEGORY_COLORS[key];
    const idx = __hash(key) % __FALLBACK_COOL.length;
    return __FALLBACK_COOL[idx];
}

// Helpers
const $ = (sel) => document.querySelector(sel);

function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&#39;');
}

const fmtCurrency = (n) => n.toLocaleString(undefined, {style: "currency", currency: "USD", maximumFractionDigits: 2});

function parseDate(v) {
    if (!v) return null;
    const c1 = () => new Date(v);
    const c2 = () => {
        const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(String(v).trim());
        if (!m) return null;
        const [_, mm, dd, yy] = m;
        return new Date(yy.length === 2 ? "20" + yy : yy, mm - 1, dd);
    };
    const c3 = () => {
        const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(v).trim());
        if (!m) return null;
        const [_, yyyy, mm, dd] = m;
        return new Date(yyyy, mm - 1, dd);
    };
    for (const f of [c1, c2, c3]) {
        const d = f();
        if (d && !isNaN(d)) return d;
    }
    return null;
}

// Conservative name cleaning
// --- Minimal merchant name cleaning (letters only, title case, strip Apple Pay) ---
function cleanDescription(desc) {
    if (desc == null) return "(No Description)";
    let s = String(desc).normalize("NFKC");

    // Remove Apple Pay tokens and variants like "Aplpay"
    s = s.replace(/\b(aplpay|apple\s*pay)\b/gi, " ");

    // Replace all non-letters with spaces
    s = s.replace(/[^A-Za-z]+/g, " ");

    // Collapse whitespace
    s = s.replace(/\s+/g, " ").trim();

    if (!s) return "(No Description)";

    // Title Case
    return s
        .split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");
}


function bucketizeCategory(raw) {
    const s = String(raw || "").toLowerCase();
    const rules = [["Groceries", /(grocery|grocer|supermarket|market\b(?!place))/i], ["Restaurants", /(restaurant|bar|cafe|coffee|pizza|wings|chicken|chipotle|grubhub|ubereats|ubere?)/i], ["Shopping/Retail", /(retail|shopping|store|department|target|walmart|shein|uniqlo|\bh&m\b|clothing|fashion|apparel|jewelry|fragrance|marketplace|internet\s*purchase|online|amazon)/i], ["Subscriptions", /(subscription|spotify|netflix|prime|membership|service\s*fee)/i], ["Transport/Fuel", /(fuel|gas|shell|exxon|exxonmobil|citgo|transport|taxi|rideshare|lyft|uber|metro|train|amtrak|nouria)/i], ["Travel", /(hotel|lodging|airline|flight|delta|southwest|jetblue|booking|airbnb|travel)/i], ["Health/Pharmacy", /(pharmacy|cvs|walgreens|health|clinic|medical|drugstore)/i], ["Entertainment", /(entertainment|cinema|movie|concert|event|gametime|lime|theatre|theater)/i], ["Education", /(education|school|tuition|course|books?|mcgraw|wall\s*street\s*prep)/i], ["Services", /(services?\b|barber|repair|vip\b|business\s*services)/i], ["Utilities", /(utility|electric|water|internet\s*bill|phone\s*bill|mobile\s*bill)/i],];
    for (const [label, pat] of rules) if (pat.test(s)) return label;
    return "Other";
}

// State
let ROWS = [];
let TABLE = null;
let charts = {time: null, category: null, merchant: null};
let TOP_N = 10;
let CURRENT_BUCKET_FILTER = "";
let CURRENT_MERCHANT_FILTER = "";
let __FILTER_APPLYING = false;

// Data shaping

// ---- Refund-aware shaping ----
// Returns an object with:
//   rowsForGraphs: rows excluding negatives and charge/refund pairs that cancel exactly by amount
//   rowsForKPIs:   all rows (positives and negatives) for totals/avg
function splitRefundAware(rows) {
    const negMap = new Map(); // absAmount -> count
    for (const r of rows) {
        if (r.amount <= 0) continue;
        if (r.amount < 0) {
            const a = Math.abs(r.amount).toFixed(2);
            negMap.set(a, (negMap.get(a) || 0) + 1);
        }
    }
    const rowsForGraphs = [];
    for (const r of rows) {
        if (r.amount < 0) continue; // never graph negatives
        const a = Math.abs(r.amount).toFixed(2);
        const n = negMap.get(a) || 0;
        if (n > 0) {
            negMap.set(a, n - 1);
            continue;
        } // drop matched charge
        rowsForGraphs.push(r);
    }
    return {rowsForGraphs, rowsForKPIs: rows};
}

function normalizeRows(rawRows) {
    const map = CONFIG.columns;
    const out = [];
    for (const r of rawRows) {
        const d = parseDate((r[map.date] ?? "").toString().trim());
        const descRaw = (r[map.desc] ?? "").toString().trim();
        let amtStr = (r[map.amount] ?? "").toString().trim().replace(/[^0-9.\-]/g, "");
        if (amtStr === "") continue;
        let amt = parseFloat(amtStr);
        if (CONFIG.flipSigns) amt = -amt;
        if (CONFIG.absAmounts) amt = Math.abs(amt);
        const rawCat = (map.category ? (r[map.category] ?? "").toString().trim() : "") || "(Uncategorized)";
        if (!d || isNaN(amt)) continue;
        const desc = cleanDescription(descRaw);
        out.push({
            date: d,
            description: desc,
            rawDescription: descRaw,
            amount: amt,
            rawCategory: rawCat,
            bucket: bucketizeCategory(rawCat)
        });
    }
    out.sort((a, b) => a.date - b.date);
    return out;
}

function buildTimeSeries(rows) {
    if (!rows.length) return {labels: [], data: [], mode: "none"};
    const minD = rows[0].date;
    const maxD = rows[rows.length - 1].date;
    const spanDays = Math.max(1, Math.round((maxD - minD) / (1000 * 60 * 60 * 24)));
    if (spanDays <= 60) {
        const byDay = new Map();
        for (const r of rows) {
            if (r.amount <= 0) continue;
            const k = r.date.toISOString().slice(0, 10);
            byDay.set(k, (byDay.get(k) || 0) + r.amount);
        }
        const labels = [], data = [];
        const d = new Date(minD);
        while (d <= maxD) {
            const k = d.toISOString().slice(0, 10);
            labels.push(k);
            data.push(byDay.get(k) || 0);
            d.setDate(d.getDate() + 1);
        }
        return {labels, data, mode: "daily"};
    } else if (spanDays <= 180) {
        const start = new Date(minD);
        start.setHours(0, 0, 0, 0);
        const day = (start.getDay() + 6) % 7;
        start.setDate(start.getDate() - day);
        const end = new Date(maxD);
        end.setHours(0, 0, 0, 0);
        const byWeek = new Map();
        for (const r of rows) {
            const d = new Date(r.date);
            d.setHours(0, 0, 0, 0);
            const off = (d.getDay() + 6) % 7;
            d.setDate(d.getDate() - off);
            const k = d.toISOString().slice(0, 10);
            byWeek.set(k, (byWeek.get(k) || 0) + r.amount);
        }
        const labels = [], data = [];
        const w = new Date(start);
        while (w <= end) {
            const k = w.toISOString().slice(0, 10);
            labels.push(k);
            data.push(byWeek.get(k) || 0);
            w.setDate(w.getDate() + 7);
        }
        return {labels, data, mode: "weekly"};
    } else {
        const byMonth = new Map();
        for (const r of rows) {
            const k = `${r.date.getFullYear()}-${String(r.date.getMonth() + 1).padStart(2, "0")}`;
            byMonth.set(k, (byMonth.get(k) || 0) + r.amount);
        }
        const labels = [], data = [];
        const cur = new Date(minD.getFullYear(), minD.getMonth(), 1);
        const end = new Date(maxD.getFullYear(), maxD.getMonth(), 1);
        while (cur <= end) {
            const k = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`;
            labels.push(k);
            data.push(byMonth.get(k) || 0);
            cur.setMonth(cur.getMonth() + 1);
        }
        return {labels, data, mode: "monthly"};
    }
}

function buildCategoryData(rows) {
    const byCat = new Map();
    let total = 0;
    for (const r of rows) {
        if (r.amount <= 0) continue;
        const k = r.bucket;
        byCat.set(k, (byCat.get(k) || 0) + r.amount);
        total += r.amount;
    }
    let entries = Array.from(byCat.entries()).sort((a, b) => b[1] - a[1]);
    const minShare = Math.max(0, Math.min(1, CONFIG.categoryPie.minShare));
    const maxSlices = Math.max(3, CONFIG.categoryPie.maxSlices);
    const otherLabel = CONFIG.categoryPie.otherLabel;
    let kept = [], otherSum = 0;
    for (const [cat, val] of entries) {
        const share = total ? val / total : 0;
        if (share < minShare) otherSum += val; else kept.push([cat, val]);
    }
    if (kept.length > maxSlices - 1) {
        const head = kept.slice(0, maxSlices - 1);
        const tail = kept.slice(maxSlices - 1);
        otherSum += tail.reduce((s, [, v]) => s + v, 0);
        kept = head;
    }
    const labels = kept.map(([c]) => c);
    const data = kept.map(([, v]) => v);
    if (otherSum > 0) {
        labels.push(otherLabel);
        data.push(otherSum);
    }
    return {labels, data, total};
}

function buildMerchantData(rows, topN) {
    const byM = new Map();
    const byMBuckets = new Map();
    for (const r of rows) {
        byM.set(r.description, (byM.get(r.description) || 0) + r.amount);
        const bmap = byMBuckets.get(r.description) || {};
        bmap[r.bucket] = (bmap[r.bucket] || 0) + r.amount;
        byMBuckets.set(r.description, bmap);
    }
    const sorted = Array.from(byM.entries()).sort((a, b) => b[1] - a[1]).slice(0, topN);
    const labels = sorted.map(x => x[0]);
    const data = sorted.map(x => x[1]);
    const colors = labels.map(m => {
        const bmap = byMBuckets.get(m) || {};
        const topBucket = Object.entries(bmap).sort((a, b) => b[1] - a[1])[0]?.[0] || "Other";
        return getCategoryColor(topBucket);
    });
    return {labels, data, colors};
}

// KPIs
function setKPIs(rows) {
    const total = rows.reduce((a, r) => a + r.amount, 0);
    const avg = rows.length ? rows.reduce((a, r) => a + Math.abs(r.amount), 0) / rows.length : 0;
    const byM = {};
    for (const r of rows) byM[r.description] = (byM[r.description] || 0) + r.amount;
    const top = Object.entries(byM).sort((a, b) => b[1] - a[1])[0];
    $("#kpiTotal").textContent = fmtCurrency(total);
    $("#kpiCount").textContent = String(rows.length);
    $("#kpiAvg").textContent = fmtCurrency(avg);
    $("#kpiTopMerchant").textContent = top ? top[0] : "—";
    $("#kpiTopMerchantSpend").textContent = top ? fmtCurrency(top[1]) : "";
}

// Charts
let __MERCHANT_CANVAS_H = -1;

function adjustMerchantChartHeight(n) {
    const MIN = 220, PER = 22, MAX = 520;
    const target = Math.max(MIN, Math.min(MAX, Math.round(MIN + PER * Math.max(0, n - 5))));
    const cv = document.getElementById("merchantChart");
    if (!cv) return;
    if (__MERCHANT_CANVAS_H === target) return;
    __MERCHANT_CANVAS_H = target;
    cv.height = target;
    cv.style.height = target + "px";
}

function renderCharts(rows) {
    for (const k of Object.keys(charts)) {
        if (charts[k]) {
            charts[k].destroy();
            charts[k] = null;
        }
    }
    if (!rows.length) return;

    const t = buildTimeSeries(rows);
    let cat = buildCategoryData(rows);
    const mer = buildMerchantData(rows, TOP_N);
    adjustMerchantChartHeight(mer.labels.length);

    const timeCanvas = $("#timeChart");
    const catCanvas = $("#categoryChart");
    if (timeCanvas) {
        window.__TIME_CANVAS_H = window.__TIME_CANVAS_H ?? -1;
        if (__TIME_CANVAS_H !== 90) {
            timeCanvas.height = 90;
            timeCanvas.style.height = "90px";
            __TIME_CANVAS_H = 210;
        }
    }
    if (catCanvas) {
        window.__CAT_CANVAS_H = window.__CAT_CANVAS_H ?? -1;
        if (__CAT_CANVAS_H !== 100) {
            catCanvas.height = 100;
            catCanvas.style.height = "100px";
            __CAT_CANVAS_H = 240;
        }
    }

    if (!cat.labels.length) cat = {labels: ["None"], data: [0], total: 0};

    Chart.defaults.animation = false;
    Chart.defaults.transitions = Chart.defaults.transitions || {};
    Chart.defaults.transitions.active = {animation: {duration: 0}};
    Chart.defaults.resizeDelay = 0;
    Chart.defaults.maintainAspectRatio = false;

    charts.time = new Chart($("#timeChart"), {
        type: "line", data: {
            labels: t.labels, datasets: [{
                label: t.mode === "monthly" ? "Monthly Spend" : (t.mode === "weekly" ? "Weekly Spend" : "Daily Spend"),
                data: t.data,
                tension: 0.35,
                fill: true,
                borderColor: getCategoryColor("Restaurants"),
                backgroundColor: "rgba(34,216,245,.18)"
            }]
        }, options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            resizeDelay: 0,
            interaction: {mode: 'nearest', intersect: false},
            scales: {y: {ticks: {callback: (v) => fmtCurrency(v)}}},
            plugins: {legend: {display: false}},
            onClick: (evt) => {
                const points = charts.time.getElementsAtEventForMode(evt, 'nearest', {intersect: true}, true);
                if (!points || !points.length) return;
                const idx = points[0].index;
                const label = charts.time.data.labels[idx];
                if (t.mode === "monthly") {
                    const parts = String(label).split("-");
                    const yyyy = parseInt(parts[0], 10);
                    const mm = parseInt(parts[1], 10);
                    const from = new Date(yyyy, mm - 1, 1);
                    const to = new Date(yyyy, mm, 0);
                    $("#fromDate").value = from.toISOString().slice(0, 10);
                    $("#toDate").value = to.toISOString().slice(0, 10);
                } else {
                    if (ROWS.length) {
                        const min = ROWS[0].date, max = ROWS[ROWS.length - 1].date;
                        $("#fromDate").value = min.toISOString().slice(0, 10);
                        $("#toDate").value = max.toISOString().slice(0, 10);
                    }
                }
                safeApplyFilters();
            }
        }
    });

    charts.category = new Chart($("#categoryChart"), {
        type: "doughnut", data: {
            labels: cat.labels, datasets: [{
                label: "Spend", data: cat.data, backgroundColor: cat.labels.map(l => getCategoryColor(l))
            }]
        }, options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            resizeDelay: 0,
            interaction: {mode: 'nearest', intersect: true},
            cutout: "68%",
            plugins: {legend: {position: "bottom"}},
            onClick: (evt, activeEls) => {
                if (!activeEls || !activeEls.length) return;
                const idx = activeEls[0].index;
                const clicked = String(charts.category.data.labels[idx] || "").trim();
                const other = String(CONFIG.categoryPie.otherLabel).toLowerCase();
                const catSel = document.getElementById("categoryFilter");
                if (!catSel) return;
                if (String(clicked).toLowerCase() === other) {
                    CURRENT_BUCKET_FILTER = (catSel.value === CONFIG.categoryPie.otherLabel) ? "" : CONFIG.categoryPie.otherLabel;
                } else {
                    CURRENT_BUCKET_FILTER = (catSel.value === clicked) ? "" : clicked;
                }
                catSel.value = CURRENT_BUCKET_FILTER;
                safeApplyFilters();
            }
        }
    });

    charts.merchant = new Chart($("#merchantChart"), {
        type: "bar", data: {
            labels: mer.labels, datasets: [{
                label: "Spend",
                data: mer.data,
                backgroundColor: mer.colors,
                barThickness: 24,
                maxBarThickness: 32,
                categoryPercentage: 0.8,
                barPercentage: 0.9
            }]
        }, options: {
            indexAxis: "y",
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            resizeDelay: 0,
            interaction: {mode: 'nearest', intersect: true},
            scales: {x: {ticks: {callback: (v) => fmtCurrency(v)}}},
            plugins: {legend: {display: false}},
            onClick: (evt, activeEls) => {
                if (!activeEls || !activeEls.length) return;
                const idx = activeEls[0].index;
                const clicked = String(charts.merchant.data.labels[idx] || "").trim();
                const merchSel = document.getElementById("merchantFilter");
                if (!merchSel) return;
                CURRENT_MERCHANT_FILTER = (merchSel.value === clicked) ? "" : clicked;
                merchSel.value = CURRENT_MERCHANT_FILTER;
                safeApplyFilters();
            }
        }
    });
}

// Table
function renderTable(rows) {
    const tbody = $("#txTable tbody");
    if (TABLE) {
        TABLE.destroy();
        TABLE = null;
    }
    tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${r.date.toISOString().slice(0, 10)}</td>
      <td><span class="desc" data-bs-toggle="tooltip" data-bs-placement="top" title="RAW: ${escapeHtml(r.rawDescription)}">${r.description}</span></td>
      <td>${r.bucket}</td>
      <td class="text-end">${fmtCurrency(r.amount)}</td>
    </tr>
  `).join("");
    TABLE = new DataTable('#txTable', {
        paging: true,
        pageLength: 25,
        lengthMenu: [25, 50, 100],
        order: [[3, 'desc']],
        searching: true,
        info: true,
        responsive: true
    });
    [...document.querySelectorAll('[data-bs-toggle="tooltip"]')].forEach(el => new bootstrap.Tooltip(el));
}

// Filters UI + badges
function populateCategoryFilter(rows) {
    const uniq = [...new Set(rows.map(r => r.bucket))].sort();
    const sel = $("#categoryFilter");
    sel.innerHTML = `<option value="">All</option>` + uniq.map(c => `<option value="${c}">${c}</option>`).join("");
    if (CURRENT_BUCKET_FILTER && uniq.includes(CURRENT_BUCKET_FILTER)) sel.value = CURRENT_BUCKET_FILTER; else if (!CURRENT_BUCKET_FILTER) sel.value = "";
}

function populateMerchantFilter(rows, selectedBucket, desired = "") {
    let pool = rows;
    if (selectedBucket) pool = pool.filter(r => r.bucket === selectedBucket);
    const uniq = [...new Set(pool.map(r => r.description))].sort();
    const sel = $("#merchantFilter");
    const old = desired || CURRENT_MERCHANT_FILTER || (sel ? sel.value : "");
    sel.innerHTML = `<option value="">All</option>` + uniq.map(m => `<option value="${m}">${m}</option>`).join("");
    if (old && uniq.includes(old)) sel.value = old; else sel.value = "";
    CURRENT_MERCHANT_FILTER = sel.value;
}

function renderActiveFilters() {
    const wrap = document.getElementById("activeFilters");
    if (!wrap) return;
    wrap.innerHTML = "";
    const cat = CURRENT_BUCKET_FILTER;
    const mer = CURRENT_MERCHANT_FILTER;
    if (!cat && !mer) return;
    if (cat) {
        const span = document.createElement("span");
        span.className = "filter-badge";
        span.innerHTML = `<i class="bi bi-ui-checks-grid me-1"></i> Category: ${escapeHtml(cat)} <button class="btn-clear">×</button>`;
        span.querySelector(".btn-clear").addEventListener("click", () => {
            CURRENT_BUCKET_FILTER = "";
            const el = document.getElementById("categoryFilter");
            if (el) el.value = "";
            safeApplyFilters();
        });
        wrap.appendChild(span);
    }
    if (mer) {
        const span = document.createElement("span");
        span.className = "filter-badge";
        span.innerHTML = `<i class="bi bi-shop me-1"></i> Merchant: ${escapeHtml(mer)} <button class="btn-clear">×</button>`;
        span.querySelector(".btn-clear").addEventListener("click", () => {
            CURRENT_MERCHANT_FILTER = "";
            const el = document.getElementById("merchantFilter");
            if (el) el.value = "";
            safeApplyFilters();
        });
        wrap.appendChild(span);
    }
}

function updateHeaderFilterHints() {
    const cat = CURRENT_BUCKET_FILTER || "";
    const mer = CURRENT_MERCHANT_FILTER || "";
    const t = document.getElementById("hdrTimeFilter");
    const c = document.getElementById("hdrCatFilter");
    const m = document.getElementById("hdrMerFilter");
    const parts = [];
    if (cat) parts.push(`Category: ${escapeHtml(cat)}`);
    if (mer) parts.push(`Merchant: ${escapeHtml(mer)}`);
    const text = parts.join(" • ");
    if (t) t.innerHTML = text;
    if (c) c.innerHTML = text;
    if (m) m.innerHTML = text;
}

function updateFilterSummary() {
    const from = document.getElementById("fromDate")?.value || "";
    const to = document.getElementById("toDate")?.value || "";
    const cat = CURRENT_BUCKET_FILTER || "";
    const mer = CURRENT_MERCHANT_FILTER || "";
    const upd = (id, val) => {
        const el = document.querySelector(id + " .val");
        if (el) el.textContent = val || "All";
    };
    upd("#chipDate", (from || to) ? `${from || "…"} → ${to || "…"} ` : "All");
    upd("#chipCategory", cat || "All");
    upd("#chipMerchant", mer || "All");
}

// Apply filters
function __applyFiltersCore() {
    const from = parseDate($("#fromDate").value);
    const to = parseDate($("#toDate").value);
    const bucket = $("#categoryFilter").value;
    const merch = $("#merchantFilter").value;

    CURRENT_BUCKET_FILTER = bucket;
    CURRENT_MERCHANT_FILTER = merch;

    populateCategoryFilter(ROWS);
    populateMerchantFilter(ROWS, CURRENT_BUCKET_FILTER, CURRENT_MERCHANT_FILTER);

    const filtered = ROWS.filter(r => {
        if (from && r.date < from) return false;
        if (to && r.date > to) return false;
        if (CURRENT_BUCKET_FILTER && r.bucket !== CURRENT_BUCKET_FILTER) return false;
        if (CURRENT_MERCHANT_FILTER && r.description !== CURRENT_MERCHANT_FILTER) return false;
        return true;
    });
    const __splitF = splitRefundAware(filtered);
    setKPIs(__splitF.rowsForKPIs);
    renderCharts(__splitF.rowsForGraphs);
    renderTable(filtered);
    renderActiveFilters();
    updateHeaderFilterHints();
    updateFilterSummary();
}

function applyFilters() {
    return __applyFiltersCore();
}

function clearDateFilters() {
    const fromEl = document.getElementById("fromDate");
    const toEl = document.getElementById("toDate");
    if (fromEl) fromEl.value = "";
    if (toEl) toEl.value = "";
    safeApplyFilters();
}

function safeApplyFilters() {
    if (__FILTER_APPLYING) return;
    try {
        __FILTER_APPLYING = true;
        return __applyFiltersCore();
    } catch (e) {
        console.error("applyFilters error:", e);
        alert("Filter error: " + (e && e.message ? e.message : e));
    } finally {
        __FILTER_APPLYING = false;
    }
}

// Hydrate & CSV
function hydrateUI(rows) {
    ROWS = rows;
    populateCategoryFilter(ROWS);
    populateMerchantFilter(ROWS, $("#categoryFilter").value || "", $("#merchantFilter").value || "");

    if (ROWS.length) {
        const min = ROWS[0].date, max = ROWS[ROWS.length - 1].date;
        $("#fromDate").value = min.toISOString().slice(0, 10);
        $("#toDate").value = max.toISOString().slice(0, 10);
    } else {
        $("#fromDate").value = "";
        $("#toDate").value = "";
    }

    const __split = splitRefundAware(ROWS);
    setKPIs(__split.rowsForKPIs);
    renderCharts(__split.rowsForGraphs);
    renderTable(ROWS);
    renderActiveFilters();
    updateHeaderFilterHints();
    updateFilterSummary();
}

function handleCSVFile(file) {
    Papa.parse(file, {
        header: true, skipEmptyLines: "greedy", complete: (res) => {
            if (!res || !res.data || !res.data.length) {
                alert("No rows found in the CSV.");
                return;
            }
            const rows = res.data.slice(CONFIG.ignoreRows);
            const cleaned = normalizeRows(rows);
            if (!cleaned.length) {
                alert("No valid rows after parsing. Check CONFIG.columns.");
                return;
            }
            hydrateUI(cleaned);
        }, error: (err) => alert("Failed to parse CSV: " + err.message),
    });
}

// DOM ready
function lockChartHeights() {
    const t = document.getElementById("timeChart");
    if (t) {
        t.height = 210;
        t.style.height = "210px";
    }
    const c = document.getElementById("categoryChart");
    if (c) {
        c.height = 240;
        c.style.height = "240px";
    }
}

window.addEventListener("DOMContentLoaded", () => {
    lockChartHeights();
    const fileEl = document.getElementById("fileInput");
    if (fileEl) {
        fileEl.addEventListener("change", (e) => {
            const f = (e.target && e.target.files) ? e.target.files[0] : null;
            if (f) handleCSVFile(f);
        });
    }
    // Merchant count dropdown
    const dd = document.getElementById("topNMerchantsDropdown");
    document.querySelectorAll(".merchant-count").forEach((el) => {
        el.addEventListener("click", (e) => {
            const target = e.currentTarget || e.target;
            const dv = target.getAttribute("data-value");
            const val = parseInt(dv, 10);
            if (!isNaN(val)) {
                TOP_N = Math.max(5, Math.min(50, val));
                if (dd) dd.textContent = "Show " + TOP_N;
                safeApplyFilters();
            }
        });
    });
    // Top-level filters
    ["categoryFilter", "merchantFilter", "fromDate", "toDate"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener("change", safeApplyFilters);
    });
    // Clear date button(s)
    const cdb = document.getElementById("btnClearDate");
    if (cdb) cdb.addEventListener("click", clearDateFilters);
    document.addEventListener("click", (e) => {
        const t = e.target;
        if (t && t.matches('[data-clear="date"]')) {
            e.preventDefault();
            clearDateFilters();
        }
    });
});
