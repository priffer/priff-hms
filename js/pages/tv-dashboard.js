// js/pages/tv-dashboard.js
// Live TV Dashboard - Real-time monitoring for command center
const COMPANY_ID = 'comp_kc_clean';
const POLL_FALLBACK_MS = 30000; // safety-net refresh in case the Realtime socket silently drops on a long-running TV kiosk
const AUTO_RELOAD_MS = 6 * 60 * 60 * 1000; // hard page reload every 6h to avoid memory/WS drift on a screen left on 24/7
let tvTrendChart = null;
let tvSiteChart = null;
let tvAttendanceGauge = null;

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

    try {
        const [todayRes, yesterdayRes, staffRes, sitesRes, trendRes] = await Promise.all([
            supabaseClient.from('v_attendance_daily_summary').select('*').eq('company_id', COMPANY_ID).eq('work_date', today),
            supabaseClient.from('v_attendance_daily_summary').select('*').eq('company_id', COMPANY_ID).eq('work_date', yesterday),
            supabaseClient.from('employees').select('id', { count: 'exact', head: true }).eq('company_id', COMPANY_ID).in('status', ['active', 'hired']),
            supabaseClient.from('clients').select('id', { count: 'exact', head: true }),
            (() => {
                const start = new Date();
                start.setDate(start.getDate() - 6);
                return supabaseClient
                    .from('v_attendance_daily_summary')
                    .select('work_date, present_count, late_count')
                    .eq('company_id', COMPANY_ID)
                    .gte('work_date', toISODate(start))
                    .lte('work_date', today);
            })()
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
        renderSiteChart(todayRows);
        renderAttentionList(todayRows, totalSites);

        const trendStart = new Date();
        trendStart.setDate(trendStart.getDate() - 6);
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
    document.getElementById('tvAttendanceRatePct').textContent = totalActiveStaff > 0 ? `${rate}%` : '-';
    renderAttendanceGauge(rate);
}

// higherIsBad: true when an increase vs yesterday should be shown in red (e.g. late count, OT hours)
function renderTrendBadge(id, delta, higherIsBad) {
    const el = document.getElementById(id);
    if (!el) return;
    if (!isFinite(delta) || delta === 0) {
        el.textContent = '± เท่าเดิม';
        el.className = 'text-xs font-bold mb-1 text-slate-500';
        return;
    }
    const isBad = higherIsBad ? delta > 0 : delta < 0;
    const arrow = delta > 0 ? '▲' : '▼';
    const displayVal = Math.abs(delta) % 1 === 0 ? Math.abs(delta) : Math.abs(delta).toFixed(1);
    el.textContent = `${arrow} ${displayVal} จากเมื่อวาน`;
    el.className = `text-xs font-bold mb-1 ${isBad ? 'text-red-400' : 'text-emerald-400'}`;
}

function renderAttendanceGauge(ratePct) {
    const color = ratePct >= 90 ? '#34d399' : ratePct >= 70 ? '#fbbf24' : '#f87171'; // emerald / amber / red
    const ctx = document.getElementById('tvAttendanceGauge');
    if (tvAttendanceGauge) tvAttendanceGauge.destroy();
    tvAttendanceGauge = new Chart(ctx, {
        type: 'doughnut',
        data: {
            datasets: [{
                data: [ratePct, 100 - ratePct],
                backgroundColor: [color, 'rgba(148,163,184,0.15)'],
                borderWidth: 0,
                circumference: 360,
                rotation: -90
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            cutout: '75%',
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            animation: { animateRotate: true }
        }
    });
}

// Attention panel: ranks sites with visible attendance problems (late arrivals today) so a manager
// glancing at the TV knows exactly where to intervene, instead of scanning the raw table.
function renderAttentionList(rows, totalSites) {
    const container = document.getElementById('tvAttentionList');
    const flagged = rows
        .filter(r => Number(r.late_count || 0) > 0)
        .sort((a, b) => Number(b.late_count) - Number(a.late_count))
        .slice(0, 4);

    if (flagged.length === 0) {
        container.innerHTML = `<div class="text-center text-emerald-400 text-sm py-4 font-semibold">✅ ทุกไซต์งานปกติดี ไม่มีการมาสาย</div>`;
        return;
    }

    container.innerHTML = flagged.map(r => {
        const rate = r.present_count > 0 ? Math.round((r.late_count / r.present_count) * 100) : 0;
        return `
            <div class="flex items-center justify-between bg-red-500/10 border border-red-500/25 rounded-xl px-3 py-2">
                <div class="min-w-0">
                    <p class="font-bold text-slate-200 truncate">${r.client_name || 'ไม่ระบุไซต์'}</p>
                    <p class="text-xs text-red-300/80">มาสาย ${r.late_count} คน (${rate}% ของคนที่มา)</p>
                </div>
                <span class="text-2xl font-black text-red-400 tabular-nums shrink-0 ml-3">${r.late_count}</span>
            </div>
        `;
    }).join('');
}

// Simple counter animation
function animateValue(id, end) {
    const el = document.getElementById(id);
    const start = parseInt(el.textContent) || 0;
    if (start === end) {
        el.textContent = end;
        return;
    }
    const duration = 1000;
    const startTime = performance.now();
    
    // Highlight flash
    el.classList.add('text-white');
    setTimeout(() => el.classList.remove('text-white'), 300);

    function step(now) {
        const p = Math.min((now - startTime) / duration, 1);
        el.textContent = Math.floor(start + (end - start) * p);
        if (p < 1) requestAnimationFrame(step);
        else el.textContent = end;
    }
    requestAnimationFrame(step);
}

// Chart.js global defaults for dark theme
Chart.defaults.color = '#94a3b8'; // text-slate-400
Chart.defaults.borderColor = '#334155'; // border-slate-700

function renderSiteChart(rows) {
    const labels = [];
    const data = [];
    const bgColors = [];
    
    // Sort by present count desc
    const sorted = [...rows].sort((a,b) => b.present_count - a.present_count).slice(0, 10); // Top 10
    
    sorted.forEach((r, i) => {
        labels.push(r.client_name || 'ไม่ระบุ');
        data.push(r.present_count);
        // Gradient of blues
        const opacity = Math.max(0.4, 1 - (i * 0.08));
        bgColors.push(`rgba(56, 189, 248, ${opacity})`);
    });

    const ctx = document.getElementById('tvSiteChart');
    if (tvSiteChart) tvSiteChart.destroy();
    tvSiteChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'มาทำงาน',
                data,
                backgroundColor: bgColors,
                borderRadius: 6,
                borderWidth: 0
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            indexAxis: 'y', // Horizontal bar is better for names
            plugins: { legend: { display: false } },
            scales: {
                x: { beginAtZero: true, grid: { color: '#334155' } },
                y: { grid: { display: false } }
            }
        }
    });
}

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
    
    const gradient = ctx.getContext('2d').createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, 'rgba(56, 189, 248, 0.5)');
    gradient.addColorStop(1, 'rgba(56, 189, 248, 0.0)');

    tvTrendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'มาทำงานรวม (คน)',
                data,
                borderColor: '#38bdf8', // blue-400
                backgroundColor: gradient,
                borderWidth: 3,
                tension: 0.4,
                fill: true,
                pointBackgroundColor: '#0f172a',
                pointBorderColor: '#38bdf8',
                pointBorderWidth: 2,
                pointRadius: 4,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, grid: { color: '#334155' } },
                x: { grid: { display: false } }
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
            .limit(10);
            
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
    
    // Parse time
    let timeStr = '';
    if (record.check_in) {
        timeStr = record.check_in.slice(0, 5); // HH:mm
    } else {
        timeStr = new Date(record.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    }

    const empName = record.employees ? record.employees.full_name : record.emp_id;
    const clientName = record.clients ? record.clients.client_name : 'ไม่ระบุไซต์';
    
    const isLate = record.is_late === true;
    const statusColor = isLate ? 'bg-amber-500/10 border-amber-500/40 text-amber-400' : 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400';
    const statusIcon = isLate ? '⚠️ สาย' : '✅ ตรงเวลา';

    const div = document.createElement('div');
    div.className = `feed-item-enter p-3 rounded-xl border ${statusColor} flex justify-between items-center`;
    
    div.innerHTML = `
        <div class="flex items-center gap-3 overflow-hidden">
            <div class="text-sm font-bold opacity-80 shrink-0 w-12">${timeStr}</div>
            <div class="truncate">
                <div class="font-bold text-slate-200 truncate">${empName}</div>
                <div class="text-xs opacity-70 truncate">${clientName}</div>
            </div>
        </div>
        <div class="text-xs font-bold px-2 py-1 rounded-lg bg-black/20 shrink-0">
            ${statusIcon}
        </div>
    `;

    // Add to top
    if (list.firstChild) {
        list.insertBefore(div, list.firstChild);
    } else {
        list.appendChild(div);
    }

    // Trigger animation
    if (highlight) {
        showToast(`พนักงานใหม่เช็คอิน: ${empName}`);
    }

    // Keep max 10 items
    while (list.children.length > 10) {
        list.removeChild(list.lastChild);
    }
}

function showToast(msg) {
    const toast = document.getElementById('tvToast');
    document.getElementById('tvToastMsg').textContent = msg;
    toast.classList.remove('translate-y-[200%]');
    
    // Auto hide
    setTimeout(() => {
        toast.classList.add('translate-y-[200%]');
    }, 4000);
}

// Supabase Realtime Subscription
function setupRealtimeSubscription() {
    const statusEl = document.getElementById('feedStatus');
    
    const channel = supabaseClient.channel('tv-dashboard')
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'attendance_logs' },
            async (payload) => {
                const record = payload.new;
                
                // Fetch joined data for the new row to get names
                const { data } = await supabaseClient
                    .from('attendance_logs')
                    .select('*, employees(full_name), clients(client_name)')
                    .eq('id', record.id)
                    .single();
                    
                if (data) {
                    addFeedItem(data, true);
                }
                
                // Reload aggregate data to update big numbers and charts
                loadDashboardData();
            }
        )
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                statusEl.textContent = '🟢 เชื่อมต่อแล้ว (Live)';
                statusEl.className = 'text-xs font-bold px-2 py-1 rounded bg-green-500/20 text-green-400 border border-green-500/30';
            } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
                statusEl.textContent = '🔴 ขาดการเชื่อมต่อ';
                statusEl.className = 'text-xs font-bold px-2 py-1 rounded bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse';
            }
        });
}
