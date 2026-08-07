// js/pages/tv-dashboard.js
// Live TV Dashboard - Real-time monitoring for command center
// Design goals (per owner feedback): plain big numbers over graphics, exactly ONE chart,
// light/calm color theme matching the rest of the app, and an attention list that stays
// a fixed, bounded size no matter how many client sites exist (never overflows the screen).
const COMPANY_ID = 'comp_kc_clean';
const POLL_FALLBACK_MS = 30000; // safety-net refresh in case the Realtime socket silently drops on a long-running TV kiosk
const AUTO_RELOAD_MS = 6 * 60 * 60 * 1000; // hard page reload every 6h to avoid memory/WS drift on a screen left on 24/7
const ATTENTION_LIST_MAX = 5; // show at most this many flagged sites; rest are summarized as "+N more"
const FEED_LIST_MAX = 8;
let tvTrendChart = null;

// Clock
setInterval(() => {
    const now = new Date();
    document.getElementById('clockTime').textContent = now.toLocaleTimeString('th-TH', { hour12: false });
    document.getElementById('clockDate').textContent = now.toLocaleDateString('th-TH', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
}, 1000);

document.addEventListener('DOMContentLoaded', () => {
    loadDashboardData();
    setupRealtimeSubscription();
    setInterval(loadDashboardData, POLL_FALLBACK_MS);
    setTimeout(() => window.location.reload(), AUTO_RELOAD_MS);
});

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
    } else {
        document.exitFullscreen();
    }
}

const toISODate = (d) => {
    const tzOffset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tzOffset).toISOString().slice(0, 10);
};

// Main Data Loader
async function loadDashboardData() {
    const todayDate = new Date();
    const yesterdayDate = new Date(todayDate);
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const today = toISODate(todayDate);
    const yesterday = toISODate(yesterdayDate);
    const trendStart = new Date();
    trendStart.setDate(trendStart.getDate() - 6);

    try {
        const [todayRes, yesterdayRes, staffRes, sitesRes, trendRes] = await Promise.all([
            supabaseClient.from('v_attendance_daily_summary').select('*').eq('company_id', COMPANY_ID).eq('work_date', today),
            supabaseClient.from('v_attendance_daily_summary').select('*').eq('company_id', COMPANY_ID).eq('work_date', yesterday),
            supabaseClient.from('employees').select('id', { count: 'exact', head: true }).eq('company_id', COMPANY_ID).in('status', ['active', 'hired']),
            supabaseClient.from('clients').select('id', { count: 'exact', head: true }),
            supabaseClient
                .from('v_attendance_daily_summary')
                .select('work_date, present_count')
                .eq('company_id', COMPANY_ID)
                .gte('work_date', toISODate(trendStart))
                .lte('work_date', today)
        ]);

        if (todayRes.error) throw todayRes.error;
        if (yesterdayRes.error) throw yesterdayRes.error;
        if (staffRes.error) throw staffRes.error;
        if (sitesRes.error) throw sitesRes.error;
        if (trendRes.error) throw trendRes.error;

        const todayRows = todayRes.data || [];
        const yesterdayRows = yesterdayRes.data || [];
        const totalActiveStaff = staffRes.count || 0;
        const totalSites = sitesRes.count || 0;

        updateBigNumbers(todayRows, yesterdayRows, totalActiveStaff, totalSites);
        renderAttentionList(todayRows);
        renderTrendChart(trendRes.data || [], trendStart, todayDate);

        // Load recent check-ins for the feed only on first load, then realtime takes over
        if (document.getElementById('tvFeedList').children.length <= 1) {
            loadRecentFeed();
        }

        updateLastSyncLabel();
    } catch (e) {
        console.error('loadDashboardData error:', e);
    }
}

function updateLastSyncLabel() {
    const el = document.getElementById('lastSyncLabel');
    if (!el) return;
    const now = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    el.textContent = `ซิงก์ล่าสุด ${now}`;
}

function updateBigNumbers(rows, yesterdayRows, totalActiveStaff, totalSites) {
    const totalPresent = rows.reduce((s, r) => s + Number(r.present_count || 0), 0);
    const totalLate = rows.reduce((s, r) => s + Number(r.late_count || 0), 0);
    const totalOtHours = rows.reduce((s, r) => s + Number(r.total_ot_hours || 0), 0);
    const activeSites = rows.filter(r => Number(r.present_count || 0) > 0).length;

    const yTotalLate = yesterdayRows.reduce((s, r) => s + Number(r.late_count || 0), 0);
    const yTotalOtHours = yesterdayRows.reduce((s, r) => s + Number(r.total_ot_hours || 0), 0);

    animateValue('tvTotalPresent', totalPresent);
    animateValue('tvTotalLate', totalLate);
    animateValue('tvActiveSites', activeSites);
    document.getElementById('tvTotalActiveStaff').textContent = totalActiveStaff;
    document.getElementById('tvTotalSites').textContent = totalSites;
    document.getElementById('tvTotalOtHours').textContent = totalOtHours.toFixed(1);

    renderTrendBadge('tvLateTrend', totalLate - yTotalLate, true);
    renderTrendBadge('tvOtTrend', totalOtHours - yTotalOtHours, true);

    const rate = totalActiveStaff > 0 ? Math.min(100, Math.round((totalPresent / totalActiveStaff) * 100)) : 0;
    const rateEl = document.getElementById('tvAttendanceRatePct');
    const cardEl = document.getElementById('tvRateCard');
    rateEl.textContent = totalActiveStaff > 0 ? `${rate}%` : '-';

    // Plain text color-coding instead of a gauge chart: green/amber/red conveys status at a glance
    const colorClass = rate >= 90 ? 'text-emerald-600' : rate >= 70 ? 'text-amber-600' : 'text-red-600';
    const cardBgClass = rate >= 90 ? 'bg-emerald-50 border-emerald-100' : rate >= 70 ? 'bg-amber-50 border-amber-100' : 'bg-red-50 border-red-100';
    rateEl.className = `tv-hero-num font-black tabular-nums ${colorClass}`;
    cardEl.className = `rounded-2xl p-5 shadow-sm border ${cardBgClass}`;
}

// higherIsBad: true when an increase vs yesterday should be shown as a caution color (e.g. late count, OT hours)
function renderTrendBadge(id, delta, higherIsBad) {
    const el = document.getElementById(id);
    if (!el) return;
    if (!isFinite(delta) || delta === 0) {
        el.textContent = '± เท่ากับเมื่อวาน';
        el.className = 'text-sm font-bold mt-1 text-slate-400';
        return;
    }
    const isBad = higherIsBad ? delta > 0 : delta < 0;
    const arrow = delta > 0 ? '▲' : '▼';
    const displayVal = Math.abs(delta) % 1 === 0 ? Math.abs(delta) : Math.abs(delta).toFixed(1);
    el.textContent = `${arrow} ${displayVal} จากเมื่อวาน`;
    el.className = `text-sm font-bold mt-1 ${isBad ? 'text-red-500' : 'text-emerald-600'}`;
}

// Attention panel: ranks sites with visible attendance problems (late arrivals today) so a manager
// glancing at the TV knows exactly where to intervene, instead of scanning a raw table.
// Capped at ATTENTION_LIST_MAX rows regardless of how many total sites are flagged (e.g. 100
// client sites all with late arrivals still only render 5 rows + a one-line "+N more" summary),
// so this panel can never overflow the screen.
function renderAttentionList(rows) {
    const container = document.getElementById('tvAttentionList');
    const summaryEl = document.getElementById('tvAttentionSummary');
    const allFlagged = rows
        .filter(r => Number(r.late_count || 0) > 0)
        .sort((a, b) => Number(b.late_count) - Number(a.late_count));

    if (allFlagged.length === 0) {
        summaryEl.textContent = '';
        container.innerHTML = `<div class="text-center text-emerald-600 text-sm py-4 font-semibold">✅ ทุกไซต์งานปกติดี ไม่มีการมาสาย</div>`;
        return;
    }

    summaryEl.textContent = `${allFlagged.length} ไซต์`;
    const shown = allFlagged.slice(0, ATTENTION_LIST_MAX);
    const remaining = allFlagged.length - shown.length;

    let html = shown.map(r => {
        const rate = r.present_count > 0 ? Math.round((r.late_count / r.present_count) * 100) : 0;
        return `
            <div class="flex items-center justify-between bg-red-50 rounded-xl px-3 py-2">
                <div class="min-w-0">
                    <p class="font-bold text-slate-700 truncate">${r.client_name || 'ไม่ระบุไซต์'}</p>
                    <p class="text-xs text-red-500">มาสาย ${r.late_count} คน (${rate}% ของคนที่มา)</p>
                </div>
                <span class="text-xl font-black text-red-500 tabular-nums shrink-0 ml-3">${r.late_count}</span>
            </div>
        `;
    }).join('');

    if (remaining > 0) {
        html += `<p class="text-center text-slate-400 text-xs font-semibold pt-1">และอีก ${remaining} ไซต์ที่มีคนมาสาย</p>`;
    }
    container.innerHTML = html;
}

// Simple counter animation
function animateValue(id, end) {
    const el = document.getElementById(id);
    const start = parseInt(el.textContent) || 0;
    if (start === end) {
        el.textContent = end;
        return;
    }
    const duration = 800;
    const startTime = performance.now();

    function step(now) {
        const p = Math.min((now - startTime) / duration, 1);
        el.textContent = Math.floor(start + (end - start) * p);
        if (p < 1) requestAnimationFrame(step);
        else el.textContent = end;
    }
    requestAnimationFrame(step);
}

// Chart.js light theme defaults (single chart on this page)
Chart.defaults.color = '#64748b'; // slate-500
Chart.defaults.font.family = "'Sarabun', sans-serif";
Chart.defaults.borderColor = '#eef2f9';

function renderTrendChart(rows, start, end) {
    const byDate = {};
    rows.forEach(r => {
        if (!byDate[r.work_date]) byDate[r.work_date] = 0;
        byDate[r.work_date] += Number(r.present_count || 0);
    });

    const labels = [];
    const data = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const key = toISODate(d);
        labels.push(new Date(key).toLocaleDateString('th-TH', { day: '2-digit', month: 'short' }));
        data.push(byDate[key] || 0);
    }

    const ctx = document.getElementById('tvTrendChart');
    if (tvTrendChart) tvTrendChart.destroy();

    const gradient = ctx.getContext('2d').createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(22, 93, 255, 0.18)');
    gradient.addColorStop(1, 'rgba(22, 93, 255, 0.0)');

    tvTrendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'มาทำงาน (คน)',
                data,
                borderColor: '#165DFF', // kcblue
                backgroundColor: gradient,
                borderWidth: 3,
                tension: 0.35,
                fill: true,
                pointBackgroundColor: '#fff',
                pointBorderColor: '#165DFF',
                pointBorderWidth: 2,
                pointRadius: 5,
                pointHoverRadius: 7
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, grid: { color: '#eef2f9' }, ticks: { font: { size: 13 } } },
                x: { grid: { display: false }, ticks: { font: { size: 13 } } }
            }
        }
    });
}

// ============================================================
// Realtime Feed
// ============================================================
async function loadRecentFeed() {
    try {
        const { data, error } = await supabaseClient
            .from('attendance_logs')
            .select(`
                id, work_date, check_in, is_late, created_at, emp_id,
                employees(full_name),
                clients(client_name)
            `)
            .order('created_at', { ascending: false })
            .limit(FEED_LIST_MAX);

        if (error) throw error;

        const list = document.getElementById('tvFeedList');
        list.innerHTML = '';
        (data || []).forEach(r => addFeedItem(r, false));
    } catch (e) {
        console.error('loadRecentFeed error', e);
    }
}

function addFeedItem(record, highlight = true) {
    const list = document.getElementById('tvFeedList');

    let timeStr = '';
    if (record.check_in) {
        timeStr = record.check_in.slice(0, 5); // HH:mm
    } else {
        timeStr = new Date(record.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    }

    const empName = record.employees ? record.employees.full_name : record.emp_id;
    const clientName = record.clients ? record.clients.client_name : 'ไม่ระบุไซต์';

    const isLate = record.is_late === true;
    const dotColor = isLate ? 'bg-amber-400' : 'bg-emerald-400';
    const statusText = isLate ? 'สาย' : 'ตรงเวลา';
    const statusTextColor = isLate ? 'text-amber-600' : 'text-emerald-600';

    const div = document.createElement('div');
    div.className = 'feed-item-enter py-2.5 flex items-center gap-3';
    div.innerHTML = `
        <span class="w-2 h-2 rounded-full ${dotColor} shrink-0"></span>
        <div class="text-sm font-bold text-slate-400 shrink-0 w-11 tabular-nums">${timeStr}</div>
        <div class="min-w-0 flex-1">
            <div class="font-bold text-slate-700 truncate">${empName}</div>
            <div class="text-xs text-slate-400 truncate">${clientName}</div>
        </div>
        <div class="text-xs font-bold ${statusTextColor} shrink-0">${statusText}</div>
    `;

    if (list.firstChild) {
        list.insertBefore(div, list.firstChild);
    } else {
        list.appendChild(div);
    }

    if (highlight) {
        showToast(`พนักงานใหม่เช็คอิน: ${empName}`);
    }

    while (list.children.length > FEED_LIST_MAX) {
        list.removeChild(list.lastChild);
    }
}

function showToast(msg) {
    const toast = document.getElementById('tvToast');
    document.getElementById('tvToastMsg').textContent = msg;
    toast.classList.remove('translate-y-[200%]');

    setTimeout(() => {
        toast.classList.add('translate-y-[200%]');
    }, 4000);
}

// Supabase Realtime Subscription
function setupRealtimeSubscription() {
    const statusEl = document.getElementById('feedStatus');

    supabaseClient.channel('tv-dashboard')
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'attendance_logs' },
            async (payload) => {
                const record = payload.new;

                const { data } = await supabaseClient
                    .from('attendance_logs')
                    .select('*, employees(full_name), clients(client_name)')
                    .eq('id', record.id)
                    .single();

                if (data) {
                    addFeedItem(data, true);
                }

                // Reload aggregate data to update big numbers and the chart
                loadDashboardData();
            }
        )
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                statusEl.textContent = '🟢 เชื่อมต่อแล้ว';
                statusEl.className = 'text-xs font-bold px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 whitespace-nowrap';
            } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
                statusEl.textContent = '🔴 ขาดการเชื่อมต่อ';
                statusEl.className = 'text-xs font-bold px-3 py-1.5 rounded-full bg-red-50 text-red-600 border border-red-200 whitespace-nowrap animate-pulse';
            }
        });
}
