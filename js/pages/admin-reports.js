// js/pages/admin-reports.js
// Admin Portal: หน้ารายงาน/Dashboard (Phase 4) - สรุป OT/เวลาทำงาน/มาสาย/ขาดงาน/turnover
// อ่านข้อมูลจาก SQL Views ที่สร้างไว้ใน database/35_reporting_views_powerbi.sql เท่านั้น
// (read-only aggregation - ไม่มี write logic ใดๆ ในหน้านี้ ไม่แตะ Payroll Engine calculation logic)

const COMPANY_ID = 'comp_kc_clean'; // ระบบ single-tenant ในตอนนี้ (เหมือน pattern เดิมทั่วทั้งระบบ)

let otSummaryRows = [];
let otSortState = { key: 'total_ot_hours', dir: 'desc' };
let attendanceSummaryRows = [];

// เก็บ instance ของ Chart.js แต่ละแท็บไว้ทำลายทิ้งก่อนวาดใหม่ (กัน canvas ซ้อนกัน)
let overviewTrendChart = null;
let otTrendChart = null;
let turnoverTrendChart = null;

function toISODate(d) { return d.toISOString().slice(0, 10); }

document.addEventListener('DOMContentLoaded', () => {
    const today = new Date().toISOString().slice(0, 10);
    document.getElementById('overviewDate').value = today;

    const thisMonth = today.slice(0, 7);
    document.getElementById('attendanceMonth').value = thisMonth;

    const from = new Date();
    from.setDate(from.getDate() - 6);
    document.getElementById('otFromDate').value = from.toISOString().slice(0, 10);
    document.getElementById('otToDate').value = today;

    loadSiteFilterOptions();
    loadAllReports();
});

function loadAllReports() {
    loadOverview();
    loadOtSummary();
    loadAttendanceSummary();
    loadTurnoverSummary();
}

// ============================================================
// Tab switching
// ============================================================
function switchReportTab(tab) {
    ['overview', 'ot', 'attendance', 'turnover', 'powerbi'].forEach(t => {
        const btn = document.getElementById(`tabBtn-${t}`);
        const view = document.getElementById(`tabView-${t}`);
        if (t === tab) {
            btn.classList.remove('tab-inactive'); btn.classList.add('tab-active');
            view.classList.remove('hidden');
        } else {
            btn.classList.remove('tab-active'); btn.classList.add('tab-inactive');
            view.classList.add('hidden');
        }
    });
}

function fmtNum(n, decimals = 1) {
    return Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

async function loadSiteFilterOptions() {
    const sel = document.getElementById('otSiteFilter');
    try {
        const { data, error } = await supabaseClient.from('clients').select('id, client_name').order('client_name');
        if (error) throw error;
        (data || []).forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = c.client_name;
            sel.appendChild(opt);
        });
    } catch (e) {
        console.error('loadSiteFilterOptions error', e);
    }
}

// ============================================================
// TAB 1: ภาพรวมวันนี้ (v_attendance_daily_summary)
// ============================================================
async function loadOverview() {
    const date = document.getElementById('overviewDate').value;
    const tbody = document.getElementById('overviewTableBody');
    const cards = document.getElementById('overviewCards');
    tbody.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-slate-500">⏳ กำลังโหลดข้อมูล...</td></tr>';
    try {
        const { data, error } = await supabaseClient
            .from('v_attendance_daily_summary')
            .select('*')
            .eq('company_id', COMPANY_ID)
            .eq('work_date', date);
        if (error) throw error;

        const rows = data || [];
        const totalPresent = rows.reduce((s, r) => s + Number(r.present_count || 0), 0);
        const totalLate = rows.reduce((s, r) => s + Number(r.late_count || 0), 0);
        const totalOtEmp = rows.reduce((s, r) => s + Number(r.ot_employee_count || 0), 0);
        const totalOtHours = rows.reduce((s, r) => s + Number(r.total_ot_hours || 0), 0);

        cards.innerHTML = `
            <div class="rounded-2xl border border-[#e6edf7] bg-kcsoft p-4 text-center">
                <p class="text-xs text-slate-500 font-bold">มาทำงาน</p>
                <p class="text-2xl font-extrabold text-kcblue">${totalPresent}</p>
            </div>
            <div class="rounded-2xl border border-[#e6edf7] bg-kcsoft p-4 text-center">
                <p class="text-xs text-slate-500 font-bold">มาสาย</p>
                <p class="text-2xl font-extrabold text-amber-600">${totalLate}</p>
            </div>
            <div class="rounded-2xl border border-[#e6edf7] bg-kcsoft p-4 text-center">
                <p class="text-xs text-slate-500 font-bold">ทำ OT (คน)</p>
                <p class="text-2xl font-extrabold text-kcdark">${totalOtEmp}</p>
            </div>
            <div class="rounded-2xl border border-[#e6edf7] bg-kcsoft p-4 text-center">
                <p class="text-xs text-slate-500 font-bold">ชม. OT รวม</p>
                <p class="text-2xl font-extrabold text-kcdark">${fmtNum(totalOtHours)}</p>
            </div>`;

        if (rows.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-slate-500">ไม่มีข้อมูลการลงเวลาในวันที่เลือก</td></tr>';
            return;
        }
        tbody.innerHTML = rows.map(r => `
            <tr class="border-b border-[#e6edf7] hover:bg-kcsoft transition-colors">
                <td class="p-3">${r.client_name || '-'}</td>
                <td class="p-3 text-right">${r.present_count}</td>
                <td class="p-3 text-right">${r.late_count}${r.late_unresolved_count > 0 ? ` <span class="text-xs text-slate-400">(+${r.late_unresolved_count} ไม่ทราบ)</span>` : ''}</td>
                <td class="p-3 text-right">${r.ot_employee_count}</td>
                <td class="p-3 text-right">${fmtNum(r.total_hours_worked)}</td>
                <td class="p-3 text-right">${fmtNum(r.total_ot_hours)}</td>
            </tr>
        `).join('');

        loadOverviewTrend(date);
    } catch (e) {
        console.error('loadOverview error', e);
        tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-red-500">เกิดข้อผิดพลาด: ${e.message}</td></tr>`;
    }
}

// เทรนด์ 7 วันล่าสุด (นับรวมทุกไซต์งาน) สิ้นสุดที่วันที่เลือกไว้ในแท็บนี้
async function loadOverviewTrend(endDateStr) {
    const end = new Date(endDateStr);
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    try {
        const { data, error } = await supabaseClient
            .from('v_attendance_daily_summary')
            .select('work_date, present_count, late_count, total_ot_hours')
            .eq('company_id', COMPANY_ID)
            .gte('work_date', toISODate(start))
            .lte('work_date', toISODate(end));
        if (error) throw error;

        const byDate = {};
        (data || []).forEach(r => {
            const d = r.work_date;
            if (!byDate[d]) byDate[d] = { present: 0, late: 0, ot: 0 };
            byDate[d].present += Number(r.present_count || 0);
            byDate[d].late += Number(r.late_count || 0);
            byDate[d].ot += Number(r.total_ot_hours || 0);
        });

        const labels = [];
        const presentData = [], lateData = [], otData = [];
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const key = toISODate(d);
            labels.push(new Date(key).toLocaleDateString('th-TH', { day: '2-digit', month: 'short' }));
            const v = byDate[key] || { present: 0, late: 0, ot: 0 };
            presentData.push(v.present);
            lateData.push(v.late);
            otData.push(Number(v.ot.toFixed(1)));
        }

        const ctx = document.getElementById('overviewTrendChart');
        if (overviewTrendChart) overviewTrendChart.destroy();
        overviewTrendChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    { label: 'มาทำงาน (คน)', data: presentData, borderColor: '#165DFF', backgroundColor: '#165DFF22', tension: 0.3, yAxisID: 'y' },
                    { label: 'มาสาย (คน)', data: lateData, borderColor: '#F59E0B', backgroundColor: '#F59E0B22', tension: 0.3, yAxisID: 'y' },
                    { label: 'ชม. OT รวม', data: otData, borderColor: '#0F2B73', backgroundColor: '#0F2B7322', tension: 0.3, yAxisID: 'y1' }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    y: { position: 'left', beginAtZero: true, title: { display: true, text: 'จำนวนคน' } },
                    y1: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, title: { display: true, text: 'ชั่วโมง OT' } }
                }
            }
        });
    } catch (e) {
        console.error('loadOverviewTrend error', e);
    }
}

// ============================================================
// TAB 2: สรุป OT (v_ot_summary_daily)
// ============================================================
async function loadOtSummary() {
    const from = document.getElementById('otFromDate').value;
    const to = document.getElementById('otToDate').value;
    const siteId = document.getElementById('otSiteFilter').value;
    const tbody = document.getElementById('otTableBody');
    tbody.innerHTML = '<tr><td colspan="7" class="p-8 text-center text-slate-500">⏳ กำลังโหลดข้อมูล...</td></tr>';
    try {
        let q = supabaseClient
            .from('v_ot_summary_daily')
            .select('*')
            .eq('company_id', COMPANY_ID)
            .gte('work_date', from)
            .lte('work_date', to);
        if (siteId) q = q.eq('client_id', siteId);
        const { data, error } = await q;
        if (error) throw error;

        // รวมยอดต่อคนต่อไซต์ตลอดช่วงที่เลือก (view เป็นรายวัน - รวมฝั่ง client เพื่อจัดอันดับได้)
        const grouped = {};
        (data || []).forEach(r => {
            const key = `${r.employee_id}|${r.client_id || ''}`;
            if (!grouped[key]) {
                grouped[key] = {
                    emp_id: r.emp_id, full_name: r.full_name, client_name: r.client_name || '-',
                    ot15_hours: 0, ot2_hours: 0, ot3_hours: 0, total_ot_hours: 0, total_ot_amount: 0
                };
            }
            grouped[key].ot15_hours += Number(r.ot15_hours || 0);
            grouped[key].ot2_hours += Number(r.ot2_hours || 0);
            grouped[key].ot3_hours += Number(r.ot3_hours || 0);
            grouped[key].total_ot_hours += Number(r.total_ot_hours || 0);
            grouped[key].total_ot_amount += Number(r.total_ot_amount || 0);
        });
        otSummaryRows = Object.values(grouped);
        renderOtTable();
        renderOtTrendChart(data || [], from, to);
    } catch (e) {
        console.error('loadOtSummary error', e);
        tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-red-500">เกิดข้อผิดพลาด: ${e.message}</td></tr>`;
    }
}

// กราฟแนวโน้มชั่วโมง OT รายวันรวมทุกคน (ตามไซต์งานที่กรอง) ในช่วงวันที่เลือก
function renderOtTrendChart(rows, fromStr, toStr) {
    const byDate = {};
    rows.forEach(r => {
        const d = r.work_date;
        byDate[d] = (byDate[d] || 0) + Number(r.total_ot_hours || 0);
    });

    const labels = [];
    const otData = [];
    for (let d = new Date(fromStr); d <= new Date(toStr); d.setDate(d.getDate() + 1)) {
        const key = toISODate(d);
        labels.push(new Date(key).toLocaleDateString('th-TH', { day: '2-digit', month: 'short' }));
        otData.push(Number((byDate[key] || 0).toFixed(1)));
    }

    const ctx = document.getElementById('otTrendChart');
    if (otTrendChart) otTrendChart.destroy();
    otTrendChart = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: [{ label: 'ชม. OT รวม/วัน', data: otData, backgroundColor: '#165DFF99', borderRadius: 4 }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { y: { beginAtZero: true, title: { display: true, text: 'ชั่วโมง' } } },
            plugins: { legend: { display: false } }
        }
    });
}

function sortOtTable(key) {
    if (otSortState.key === key) {
        otSortState.dir = otSortState.dir === 'asc' ? 'desc' : 'asc';
    } else {
        otSortState = { key, dir: 'desc' };
    }
    renderOtTable();
}

function renderOtTable() {
    const tbody = document.getElementById('otTableBody');
    if (otSummaryRows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="p-8 text-center text-slate-500">ไม่มีข้อมูล OT ในช่วงที่เลือก</td></tr>';
        return;
    }
    const { key, dir } = otSortState;
    const sorted = [...otSummaryRows].sort((a, b) => {
        const va = a[key], vb = b[key];
        if (typeof va === 'string') return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
        return dir === 'asc' ? va - vb : vb - va;
    });
    tbody.innerHTML = sorted.map(r => `
        <tr class="border-b border-[#e6edf7] hover:bg-kcsoft transition-colors">
            <td class="p-3">${r.full_name || '-'} <span class="text-slate-400 font-mono text-xs">(${r.emp_id})</span></td>
            <td class="p-3">${r.client_name}</td>
            <td class="p-3 text-right">${fmtNum(r.ot15_hours)}</td>
            <td class="p-3 text-right">${fmtNum(r.ot2_hours)}</td>
            <td class="p-3 text-right">${fmtNum(r.ot3_hours)}</td>
            <td class="p-3 text-right font-bold">${fmtNum(r.total_ot_hours)}</td>
            <td class="p-3 text-right">${fmtNum(r.total_ot_amount, 2)}</td>
        </tr>
    `).join('');
}

function exportOtCsv() {
    if (otSummaryRows.length === 0) { alert('ไม่มีข้อมูลให้ export'); return; }
    const header = ['รหัสพนักงาน', 'ชื่อ', 'ไซต์งาน', 'OT 1.5x (ชม.)', 'OT 2x (ชม.)', 'OT 3x (ชม.)', 'รวม (ชม.)', 'มูลค่า OT (บาท)'];
    const lines = otSummaryRows.map(r => [r.emp_id, r.full_name, r.client_name, r.ot15_hours, r.ot2_hours, r.ot3_hours, r.total_ot_hours, r.total_ot_amount]);
    downloadCsv(`OT_summary_${document.getElementById('otFromDate').value}_${document.getElementById('otToDate').value}.csv`, header, lines);
}

// ============================================================
// TAB 3: มาสาย/ขาดงาน (v_attendance_absence_summary)
// ============================================================
async function loadAttendanceSummary() {
    const monthInput = document.getElementById('attendanceMonth').value; // YYYY-MM
    const monthStart = `${monthInput}-01`;
    const tbody = document.getElementById('attendanceTableBody');
    tbody.innerHTML = '<tr><td colspan="8" class="p-8 text-center text-slate-500">⏳ กำลังโหลดข้อมูล...</td></tr>';
    try {
        const { data, error } = await supabaseClient
            .from('v_attendance_absence_summary')
            .select('*')
            .eq('company_id', COMPANY_ID)
            .eq('month_start', monthStart)
            .order('full_name');
        if (error) throw error;

        attendanceSummaryRows = data || [];
        if (attendanceSummaryRows.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="p-8 text-center text-slate-500">ไม่มีข้อมูลในเดือนที่เลือก (เฉพาะพนักงานที่มีกะงานผูกไว้เท่านั้น)</td></tr>';
            return;
        }
        tbody.innerHTML = attendanceSummaryRows.map(r => `
            <tr class="border-b border-[#e6edf7] hover:bg-kcsoft transition-colors">
                <td class="p-3">${r.full_name || '-'} <span class="text-slate-400 font-mono text-xs">(${r.emp_id})</span></td>
                <td class="p-3 text-right">${r.expected_workdays}</td>
                <td class="p-3 text-right">${r.worked_days}</td>
                <td class="p-3 text-right">${fmtNum(r.leave_days, 2)}</td>
                <td class="p-3 text-right ${r.absence_days > 0 ? 'text-red-600 font-bold' : ''}">${fmtNum(r.absence_days, 2)}</td>
                <td class="p-3 text-right">${r.late_count}</td>
                <td class="p-3 text-right">${r.late_rate_pct !== null ? fmtNum(r.late_rate_pct, 2) + '%' : '-'}</td>
                <td class="p-3 text-right text-slate-400">${r.late_unresolved_count}</td>
            </tr>
        `).join('');
    } catch (e) {
        console.error('loadAttendanceSummary error', e);
        tbody.innerHTML = `<tr><td colspan="8" class="p-8 text-center text-red-500">เกิดข้อผิดพลาด: ${e.message}</td></tr>`;
    }
}

function exportAttendanceCsv() {
    if (attendanceSummaryRows.length === 0) { alert('ไม่มีข้อมูลให้ export'); return; }
    const header = ['รหัสพนักงาน', 'ชื่อ', 'วันที่ควรมา', 'มาทำงานจริง', 'วันลา', 'ขาดงาน (วัน)', 'มาสาย (ครั้ง)', 'อัตรามาสาย (%)', 'ไม่ทราบ (คำนวณไม่ได้)'];
    const lines = attendanceSummaryRows.map(r => [r.emp_id, r.full_name, r.expected_workdays, r.worked_days, r.leave_days, r.absence_days, r.late_count, r.late_rate_pct ?? '', r.late_unresolved_count]);
    downloadCsv(`Attendance_summary_${document.getElementById('attendanceMonth').value}.csv`, header, lines);
}

// ============================================================
// TAB 4: อัตราลาออก (v_turnover_summary)
// ============================================================
async function loadTurnoverSummary() {
    const tbody = document.getElementById('turnoverTableBody');
    tbody.innerHTML = '<tr><td colspan="2" class="p-8 text-center text-slate-500">⏳ กำลังโหลดข้อมูล...</td></tr>';
    try {
        const { data, error } = await supabaseClient
            .from('v_turnover_summary')
            .select('*')
            .eq('company_id', COMPANY_ID)
            .order('month_start', { ascending: false });
        if (error) throw error;

        if (!data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="2" class="p-8 text-center text-slate-500">ยังไม่มีข้อมูลการลาออกที่บันทึกไว้ (employee_movements)</td></tr>';
            renderTurnoverTrendChart([]);
            return;
        }
        tbody.innerHTML = data.map(r => `
            <tr class="border-b border-[#e6edf7] hover:bg-kcsoft transition-colors">
                <td class="p-3">${new Date(r.month_start).toLocaleDateString('th-TH', { year: 'numeric', month: 'long' })}</td>
                <td class="p-3 text-right font-bold">${r.resignation_count}</td>
            </tr>
        `).join('');
        renderTurnoverTrendChart(data);
    } catch (e) {
        console.error('loadTurnoverSummary error', e);
        tbody.innerHTML = `<tr><td colspan="2" class="p-8 text-center text-red-500">เกิดข้อผิดพลาด: ${e.message}</td></tr>`;
    }
}

// กราฟแนวโน้มลาออกรายเดือน (เรียงเก่า -> ใหม่ ให้อ่านเทรนด์ง่าย)
function renderTurnoverTrendChart(rows) {
    const sorted = [...rows].sort((a, b) => new Date(a.month_start) - new Date(b.month_start));
    const labels = sorted.map(r => new Date(r.month_start).toLocaleDateString('th-TH', { year: '2-digit', month: 'short' }));
    const data = sorted.map(r => Number(r.resignation_count || 0));

    const ctx = document.getElementById('turnoverTrendChart');
    if (turnoverTrendChart) turnoverTrendChart.destroy();
    turnoverTrendChart = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets: [{ label: 'จำนวนคนลาออก', data, borderColor: '#DC2626', backgroundColor: '#DC262622', tension: 0.3, fill: true }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
            plugins: { legend: { display: false } }
        }
    });
}

// ============================================================
// CSV export helper (ใช้ร่วมกันทุก tab - ใส่ BOM เพื่อให้ Excel เปิดภาษาไทยถูกต้อง)
// ============================================================
function downloadCsv(filename, header, rows) {
    const escapeCell = v => {
        const s = String(v ?? '');
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [header, ...rows].map(row => row.map(escapeCell).join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
