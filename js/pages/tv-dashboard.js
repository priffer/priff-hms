// js/pages/tv-dashboard.js
// Live TV Dashboard - Real-time monitoring for command center
const COMPANY_ID = 'comp_kc_clean';
let tvTrendChart = null;
let tvSiteChart = null;

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
});

const toISODate = (d) => {
    const tzOffset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tzOffset).toISOString().slice(0, 10);
};

// Main Data Loader
async function loadDashboardData() {
    const today = toISODate(new Date());
    try {
        // 1. Load today's summary (v_attendance_daily_summary)
        const { data: todayData, error: todayErr } = await supabaseClient
            .from('v_attendance_daily_summary')
            .select('*')
            .eq('company_id', COMPANY_ID)
            .eq('work_date', today);
            
        if (todayErr) throw todayErr;

        updateBigNumbers(todayData || []);
        renderSiteChart(todayData || []);

        // 2. Load 7-day trend
        const start = new Date();
        start.setDate(start.getDate() - 6);
        const { data: trendData, error: trendErr } = await supabaseClient
            .from('v_attendance_daily_summary')
            .select('work_date, present_count, late_count')
            .eq('company_id', COMPANY_ID)
            .gte('work_date', toISODate(start))
            .lte('work_date', today);
            
        if (trendErr) throw trendErr;
        renderTrendChart(trendData || [], start, new Date());

        // 3. Load recent 15 check-ins for the feed (only on first load, then realtime takes over)
        if (document.getElementById('tvFeedList').children.length <= 1) {
            loadRecentFeed();
        }

    } catch (e) {
        console.error('loadDashboardData error:', e);
    }
}

function updateBigNumbers(rows) {
    const totalPresent = rows.reduce((s, r) => s + Number(r.present_count || 0), 0);
    const totalLate = rows.reduce((s, r) => s + Number(r.late_count || 0), 0);
    const totalOtEmp = rows.reduce((s, r) => s + Number(r.ot_employee_count || 0), 0);
    
    // Count active sites (where present > 0)
    const activeSites = rows.filter(r => Number(r.present_count || 0) > 0).length;

    animateValue('tvTotalPresent', totalPresent);
    animateValue('tvTotalLate', totalLate);
    animateValue('tvTotalOtEmp', totalOtEmp);
    animateValue('tvActiveSites', activeSites);
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
    const statusColor = isLate ? 'bg-amber-500/20 border-amber-500/50 text-amber-400' : 'bg-blue-500/20 border-blue-500/50 text-blue-400';
    const statusIcon = isLate ? '⚠️ สาย' : '✅ เข้างาน';

    const div = document.createElement('div');
    div.className = `p-3 rounded-xl border ${statusColor} flex justify-between items-center transition-all duration-500 transform translate-x-0 opacity-100`;
    if (highlight) {
        div.classList.add('-translate-x-full', 'opacity-0'); // start state for anim
    }
    
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
        requestAnimationFrame(() => {
            div.classList.remove('-translate-x-full', 'opacity-0');
        });
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
