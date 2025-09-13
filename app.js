/* Spending Dashboard (stable build with robust click-to-toggle)
 * - Robust merchant name cleaning
 * - Bucketized categories
 * - Adaptive time bucketing (daily <=45 days, else monthly)
 * - Click-to-filter on pie (category) and bar (merchant) with TOGGLE behavior
 * - Preserve current filters when changing Top-N merchants
 */

// ======= CSV LAYOUT =======
const CONFIG = {
    columns: {date: "Date", desc: "Description", amount: "Amount", category: "Category"},
    ignoreRows: 0,
    flipSigns: false,
    absAmounts: true,
    categoryPie: {minShare: 0.05, maxSlices: 8, otherLabel: "Other"},
    bucketRules: [{
        label: "Groceries",
        pattern: /(grocery|grocer|supermarket|whole\s*foods|trader\s*joe|market\b(?!place))/i
    }, {
        label: "Restaurants",
        pattern: /(restaurant|bar|cafe|coffee|fast\s*food|diner|pizza|wings|chicken|starbucks|chipotle|grubhub|ubereats|ubere?)/i
    }, {
        label: "Shopping/Retail",
        pattern: /(retail|shopping|store|department|target|walmart|wal-?mart|shein|uniqlo|\bh&m\b|clothing|fashion|apparel|jewelry|fragrance|marketplace|internet\s*purchase|online|amazon)/i
    }, {label: "Subscriptions", pattern: /(subscription|spotify|netflix|prime\b|membership|service\s*fee)/i}, {
        label: "Transport/Fuel",
        pattern: /(fuel|gas|petrol|shell|exxon|exxonmobil|citgo|transport|taxi|rideshare|lyft|uber|metro|train|amtrak|nouria)/i
    }, {
        label: "Travel",
        pattern: /(hotel|lodging|airline|flight|delta|southwest|jetblue|booking|airbnb|travel)/i
    }, {
        label: "Health/Pharmacy",
        pattern: /(pharmacy|cvs|walgreens|health|clinic|medical|drugstore)/i
    }, {
        label: "Entertainment",
        pattern: /(entertainment|cinema|movie|concert|event|gametime|lime|theatre|theater)/i
    }, {
        label: "Education",
        pattern: /(education|school|tuition|course|books?|mcgraw|wall\s*street\s*prep)/i
    }, {label: "Services", pattern: /(services?\b|barber|repair|vip\b|business\s*services)/i}, {
        label: "Utilities",
        pattern: /(utility|electric|water|internet\s*bill|phone\s*bill|mobile\s*bill)/i
    }, {label: "Other", pattern: /.*/i},],
};
// ==========================

// State
let ROWS = [];
let TABLE = null;
let charts = {time: null, category: null, merchant: null};
let TOP_N = 10;

// Tracked filters (kept in sync with dropdowns)
let CURRENT_BUCKET_FILTER = "";
let CURRENT_MERCHANT_FILTER = "";

// Helpers
const $ = (sel) => document.querySelector(sel);
const fmtCurrency = (n) => n.toLocaleString(undefined, {style: "currency", currency: "USD", maximumFractionDigits: 2});

const parseDate = (v) => {
    if (!v) return null;
    const cands = [() => new Date(v), () => {
        const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(String(v).trim());
        if (!m) return null;
        const [_, mm, dd, yy] = m;
        return new Date(yy.length === 2 ? "20" + yy : yy, mm - 1, dd);
    }, () => {
        const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(v).trim());
        if (!m) return null;
        const [_, yyyy, mm, dd] = m;
        return new Date(yyyy, mm - 1, dd);
    },];
    for (const f of cands) {
        const d = f();
        if (d && !isNaN(d)) return d;
    }
    return null;
};

// Merchant/Description Cleaner
function cleanDescription(desc) {
    if (!desc) return "(No Description)";
    let s = String(desc);

    // whitespace
    s = s.replace(/\s+/g, " ").trim();

    // payment/aggregator prefixes
    s = s.replace(/^(?:apple\s*pay|aplpay|aplp?ay|google\s*pay|venmo|paypal|pp\*|square\*|bt\*|tst\*|olo\*|sq\*)\s*/i, "");

    // drop trailing city/state
    s = s.replace(/\s+[-,]?\s*[A-Za-z .&'()]+,\s*[A-Z]{2}\s*$/i, "");
    s = s.replace(/\s+[-,]?\s*[A-Za-z .&'()]+\s+[A-Z]{2}\s*$/i, "");

    // strip store/address numbers & code-like tails
    s = s.replace(/\s+(?:#|No\.?)?\s*\d{2,5}\s*$/i, "");
    s = s.replace(/\s+[A-Za-z]*\d{3,}[A-Za-z]*\s*$/i, "");

    // unify punctuation
    s = s.replace(/\*/g, " ").replace(/[?]+/g, "").replace(/’/g, "'").replace(/\s{2,}/g, " ").trim();

    // canonical brands
    const mapRules = [[/amazon\s*marke?t?place.*?/i, "Amazon"], [/amazon\.?com/i, "Amazon"], [/amzn\s*mkp/i, "Amazon"], [/amzn\b/i, "Amazon"], [/wal-?mart/i, "Walmart"], [/\bh&m\b/i, "H&M"], [/uniqlo/i, "Uniqlo"], [/shein[\s\.]*\.?com/i, "SHEIN"], [/shein\b/i, "SHEIN"], [/cvs\/?pharmacy/i, "CVS"], [/cvs\s*pharmacy/i, "CVS"], [/walgreens/i, "Walgreens"], [/starbucks/i, "Starbucks"], [/chipotle/i, "Chipotle"], [/grubhub/i, "Grubhub"], [/uber\s*(?:eats)?/i, "Uber"], [/lyft/i, "Lyft"], [/shell/i, "Shell"], [/exxon(?:mobil)?/i, "ExxonMobil"], [/nouria/i, "Nouria"], [/whole\s*foods/i, "Whole Foods"], [/trader\s*joe'?s/i, "Trader Joe's"], [/sweet\s*green|sweetgreen/i, "Sweetgreen"], [/openai/i, "OpenAI"], [/pressed\s*cafe/i, "Pressed Cafe"], [/wings\s*over/i, "Wings Over"], [/lime\b/i, "Lime"], [/domino'?s/i, "Domino's"], [/ted'?s/i, "Ted's"], [/da\s*andrea/i, "Da Andrea"], [/mumbai\s*spice/i, "Mumbai Spice"], [/sichuan\s*gourmet/i, "Sichuan Gourmet"], [/vip\s*barber/i, "VIP Barber Shop"], [/mcgraw\s*hill/i, "McGraw Hill"], [/the\s*skin\s*alchem/i, "The Skin Alchemist"],];
    for (const [pat, to] of mapRules) s = s.replace(pat, to);

    // titlecase then restore brand caps
    const preserve = new Set(["CVS", "Uber", "Lyft", "Shell", "ExxonMobil", "Whole Foods", "Trader Joe's", "Uniqlo", "Sweetgreen", "OpenAI", "Amazon", "Starbucks", "Chipotle", "Grubhub", "Target", "SHEIN", "Walmart", "H&M", "VIP Barber Shop", "McGraw Hill", "The Skin Alchemist", "Pressed Cafe", "Wings Over", "Lime", "Domino's", "Ted's", "Da Andrea", "Mumbai Spice", "Sichuan Gourmet"]);
    s = s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    for (const brand of preserve) {
        const re = new RegExp("\\b" + brand.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&") + "\\b", "gi");
        s = s.replace(re, brand);
    }

    // collapse duplicated words
    s = s.replace(/\b(\w+)(\s+\1\b)+/gi, "$1").trim();

    if (s.length <= 1 || /^the$/i.test(s)) s = String(desc).replace(/\*/g, " ").replace(/\s+/g, " ").trim();
    return s || "(No Description)";
}

// Bucketizer
function bucketizeCategory(raw) {
    const s = String(raw || "").toLowerCase();
    for (const rule of CONFIG.bucketRules) if (rule.pattern.test(s)) return rule.label;
    return "Other";
}

// Normalize
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
        out.push({date: d, description: desc, amount: amt, rawCategory: rawCat, bucket: bucketizeCategory(rawCat)});
    }
    out.sort((a, b) => a.date - b.date);
    return out;
}

// KPIs
function setKPIs(rows) {
    const total = rows.reduce((a, r) => a + r.amount, 0);
    const avg = rows.length ? total / rows.length : 0;
    const byM = {};
    for (const r of rows) byM[r.description] = (byM[r.description] || 0) + r.amount;
    const top = Object.entries(byM).sort((a, b) => b[1] - a[1])[0];
    $("#kpiTotal").textContent = fmtCurrency(total);
    $("#kpiCount").textContent = String(rows.length);
    $("#kpiAvg").textContent = fmtCurrency(avg);
    $("#kpiTopMerchant").textContent = top ? top[0] : "—";
    $("#kpiTopMerchantSpend").textContent = top ? fmtCurrency(top[1]) : "";
}

// Time series (adaptive)
function buildTimeSeries(rows) {
    if (!rows.length) return {labels: [], data: []};
    const minD = rows[0].date;
    const maxD = rows[rows.length - 1].date;
    const spanDays = Math.max(1, Math.round((maxD - minD) / (1000 * 60 * 60 * 24)));
    if (spanDays <= 45) {
        const byDay = new Map();
        for (const r of rows) {
            const k = r.date.toISOString().slice(0, 10);
            byDay.set(k, (byDay.get(k) || 0) + r.amount);
        }
        const labels = Array.from(byDay.keys()).sort();
        const data = labels.map(k => byDay.get(k));
        return {labels, data};
    } else {
        const byMonth = new Map();
        for (const r of rows) {
            const k = `${r.date.getFullYear()}-${String(r.date.getMonth() + 1).padStart(2, "0")}`;
            byMonth.set(k, (byMonth.get(k) || 0) + r.amount);
        }
        const labels = Array.from(byMonth.keys()).sort();
        const data = labels.map(k => byMonth.get(k));
        return {labels, data};
    }
}

// Category + Merchant builders
function buildCategoryData(rows) {
    const byCat = new Map();
    let total = 0;
    for (const r of rows) {
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
    for (const r of rows) byM.set(r.description, (byM.get(r.description) || 0) + r.amount);
    const sorted = Array.from(byM.entries()).sort((a, b) => b[1] - a[1]).slice(0, topN);
    return {labels: sorted.map(x => x[0]), data: sorted.map(x => x[1])};
}

// Chart helpers
function adjustMerchantChartHeight(n) {
    const base = 120, per = 28, maxH = 1200, minH = 160;
    const h = Math.max(minH, Math.min(maxH, Math.round(base + per * n)));
    const cv = document.getElementById("merchantChart");
    if (cv) cv.style.height = h + "px";
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
    const cat = buildCategoryData(rows);
    const mer = buildMerchantData(rows, TOP_N);
    adjustMerchantChartHeight(mer.labels.length);

    charts.time = new Chart($("#timeChart"), {
        type: "line",
        data: {labels: t.labels, datasets: [{label: "Monthly Spend", data: t.data, tension: 0.35, fill: true}]},
        options: {
            maintainAspectRatio: false,
            scales: {y: {ticks: {callback: (v) => fmtCurrency(v)}}},
            plugins: {legend: {display: false}}
        },
    });

    charts.category = new Chart($("#categoryChart"), {
        type: "doughnut", data: {labels: cat.labels, datasets: [{label: "Spend", data: cat.data}]}, options: {
            maintainAspectRatio: false,
            cutout: "55%",
            plugins: {legend: {position: "bottom"}},
            onClick: (evt, activeEls) => {
                if (!activeEls || !activeEls.length) return;
                const idx = activeEls[0].index;
                const clicked = String(charts.category.data.labels[idx] ?? "").trim();
                const other = CONFIG.categoryPie.otherLabel;
                const sel = document.getElementById("categoryFilter");
                if (!sel) return;
                // Toggle logic against tracked state (case-insensitive)
                const cur = String(CURRENT_BUCKET_FILTER || "").trim();
                if (clicked === other) {
                    if (cur !== "") {
                        CURRENT_BUCKET_FILTER = "";
                        sel.value = "";
                        applyFilters();
                    }
                    return;
                }
                if (clicked.toLowerCase() === cur.toLowerCase()) {
                    CURRENT_BUCKET_FILTER = "";
                    sel.value = ""; // clear
                } else {
                    CURRENT_BUCKET_FILTER = clicked;
                    sel.value = clicked;
                }
                applyFilters();
            }
        },
    });

    charts.merchant = new Chart($("#merchantChart"), {
        type: "bar", data: {
            labels: mer.labels, datasets: [{
                label: "Spend",
                data: mer.data,
                barThickness: 22,
                maxBarThickness: 30,
                categoryPercentage: 0.8,
                barPercentage: 0.9
            }]
        }, options: {
            indexAxis: "y",
            maintainAspectRatio: false,
            scales: {x: {ticks: {callback: (v) => fmtCurrency(v)}}},
            plugins: {legend: {display: false}},
            onClick: (evt, activeEls) => {
                if (!activeEls || !activeEls.length) return;
                const idx = activeEls[0].index;
                const clicked = String(charts.merchant.data.labels[idx] ?? "").trim();
                const sel = document.getElementById("merchantFilter");
                if (!sel) return;
                const cur = String(CURRENT_MERCHANT_FILTER || "").trim();
                if (clicked.toLowerCase() === cur.toLowerCase()) {
                    CURRENT_MERCHANT_FILTER = "";
                    sel.value = "";
                } else {
                    CURRENT_MERCHANT_FILTER = clicked;
                    sel.value = clicked;
                }
                applyFilters();
            }
        },
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
      <td>${r.description}</td>
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
}

// Filters
function populateCategoryFilter(rows) {
    const uniq = [...new Set(rows.map(r => r.bucket))].sort();
    const sel = $("#categoryFilter");
    sel.innerHTML = `<option value="">All</option>` + uniq.map(c => `<option value="${c}">${c}</option>`).join("");
    // Keep dropdown in sync with tracked value
    sel.value = CURRENT_BUCKET_FILTER || "";
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

function applyFilters() {
    const from = parseDate($("#fromDate").value);
    const to = parseDate($("#toDate").value);
    const bucket = $("#categoryFilter").value;
    const merchantBefore = $("#merchantFilter").value;

    // Sync tracked vars from dropdowns before we rebuild options
    CURRENT_BUCKET_FILTER = bucket;
    CURRENT_MERCHANT_FILTER = merchantBefore;

    // refresh merchant list while preserving selection
    populateMerchantFilter(ROWS, CURRENT_BUCKET_FILTER, CURRENT_MERCHANT_FILTER);
    populateCategoryFilter(ROWS); // reassert dropdown matches tracked (no change in options count expected)

    const merchant = $("#merchantFilter").value;

    const filtered = ROWS.filter(r => {
        if (from && r.date < from) return false;
        if (to && r.date > to) return false;
        if (CURRENT_BUCKET_FILTER && r.bucket !== CURRENT_BUCKET_FILTER) return false;
        if (merchant && r.description !== merchant) return false;
        return true;
    });

    setKPIs(filtered);
    renderCharts(filtered);
    renderTable(filtered);
}

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

    setKPIs(ROWS);
    renderCharts(ROWS);
    renderTable(ROWS);
}

// File handling
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

// Events
window.addEventListener("DOMContentLoaded", () => {
    const fileEl = document.getElementById("fileInput");
    if (fileEl) fileEl.addEventListener("change", (e) => {
        const f = e.target.files?.[0];
        if (f) handleCSVFile(f);
    });

    // Top-N dropdown
    const dd = document.getElementById("topNMerchantsDropdown");
    document.querySelectorAll(".merchant-count").forEach((el) => {
        el.addEventListener("click", (e) => {
            const val = parseInt(e.target.getAttribute("data-value"), 10);
            if (!isNaN(val)) {
                TOP_N = Math.max(5, Math.min(50, val));
                if (dd) dd.textContent = "Show " + TOP_N;
                applyFilters();
            }
        });
    });

    // Auto-apply on filter changes and keep tracked vars in sync
    const catSel = document.getElementById("categoryFilter");
    const merchSel = document.getElementById("merchantFilter");
    const fromEl = document.getElementById("fromDate");
    const toEl = document.getElementById("toDate");
    if (catSel) catSel.addEventListener("change", () => {
        CURRENT_BUCKET_FILTER = catSel.value;
        applyFilters();
    });
    if (merchSel) merchSel.addEventListener("change", () => {
        CURRENT_MERCHANT_FILTER = merchSel.value;
        applyFilters();
    });
    if (fromEl) fromEl.addEventListener("change", applyFilters);
    if (toEl) toEl.addEventListener("change", applyFilters);
});
