// js/pages/admin-payroll.js
// Admin Portal: จัดการรอบเงินเดือน (payroll_periods/payroll_runs), รันคำนวณ (fn_run_payroll_period),
// ดูรายละเอียดต่อพนักงาน (payroll_lines/payroll_line_details), อนุมัติ/mark paid, และแก้ไขอัตรา (payroll_rates)

const COMPANY_ID = 'comp_kc_clean'; // ระบบ single-tenant ในตอนนี้ (เหมือน pattern เดิมทั่วทั้งระบบ)

async function uiConfirm(message, options) {
    return window.PriffConfirm.confirm(message, options);
}
async function uiAlert(message, options) {
    return window.PriffConfirm.alert(message, options);
}

let currentUserRole = null;

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const profile = await window.PriffAuthGuard.getCurrentUserProfile();
        currentUserRole = profile ? profile.role : null;
    } catch (e) {
        console.error('โหลด role ผู้ใช้ไม่สำเร็จ', e);
    }
    loadPayrollPeriods();

    const runSelect = document.getElementById('linesRunSelect');
    if (runSelect) {
        loadRunsForSelect();
        runSelect.addEventListener('change', () => loadPayrollLines(runSelect.value));
    }
});

// ============================================================
// Tab switching
// ============================================================
function switchPayrollTab(tab) {
    ['periods', 'lines', 'rates'].forEach(t => {
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
    if (tab === 'lines') loadRunsForSelect();
    if (tab === 'rates') loadPayrollRates();
}

function fmtMoney(n) {
    return Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(d) {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
}

// ============================================================
// TAB 1: รอบเงินเดือน (payroll_periods + payroll_runs)
// ============================================================
const periodStatusLabel = {
    draft: '<span class="bg-slate-100 text-slate-600 px-2 py-1 text-xs font-bold border border-slate-300 rounded-lg">แบบร่าง</span>',
    open: '<span class="bg-blue-100 text-blue-700 px-2 py-1 text-xs font-bold border border-blue-300 rounded-lg">เปิดรอบ</span>',
    submitted: '<span class="bg-amber-100 text-amber-700 px-2 py-1 text-xs font-bold border border-amber-300 rounded-lg">ส่งตรวจแล้ว</span>',
    approved: '<span class="bg-emerald-100 text-emerald-700 px-2 py-1 text-xs font-bold border border-emerald-300 rounded-lg">อนุมัติแล้ว</span>',
    locked: '<span class="bg-slate-700 text-white px-2 py-1 text-xs font-bold border border-slate-700 rounded-lg">🔒 ล็อกแล้ว</span>',
    closed: '<span class="bg-emerald-100 text-emerald-700 px-2 py-1 text-xs font-bold border border-emerald-300 rounded-lg">ปิดรอบแล้ว</span>',
};

async function loadPayrollPeriods() {
    const tbody = document.getElementById('periodsTableBody');
    tbody.innerHTML = '<tr><td colspan="7" class="p-8 text-center text-slate-500">⏳ กำลังโหลดข้อมูล...</td></tr>';
    try {
        const { data: periods, error } = await supabaseClient
            .from('payroll_periods')
            .select('*')
            .eq('company_id', COMPANY_ID)
            .order('period_start', { ascending: false });
        if (error) throw error;

        if (!periods || periods.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="p-8 text-center text-slate-500">ยังไม่มีรอบเงินเดือน</td></tr>';
            return;
        }

        const periodIds = periods.map(p => p.id);
        const { data: runs } = await supabaseClient
            .from('payroll_runs')
            .select('*')
            .in('period_id', periodIds)
            .order('created_at', { ascending: false });

        const latestRunByPeriod = {};
        (runs || []).forEach(r => {
            if (!latestRunByPeriod[r.period_id]) latestRunByPeriod[r.period_id] = r;
        });

        tbody.innerHTML = periods.map(p => {
            const run = latestRunByPeriod[p.id];
            const runInfo = run
                ? `<button type="button" onclick="viewPeriodInLinesTab('${run.id}')" class="text-left text-kcblue font-bold hover:text-kcdark hover:underline cursor-pointer">
                    ${run.run_name || run.id.slice(0, 8)}
                    <span class="block text-xs text-slate-400 font-normal">สถานะ ${run.status} · เปิดรายละเอียด →</span>
                   </button>`
                : '<span class="text-slate-400">ยังไม่รัน</span>';
            const netTotal = run ? fmtMoney(run.total_net_amount) + ' บาท' : '-';

            // สิทธิ์ตามขั้นตอน (บังคับจริงในฟังก์ชัน SQL ด้วย - นี่แค่ซ่อนปุ่มที่กดแล้วจะ error อยู่ดี)
            const canRun = p.status === 'open' || p.status === 'draft';
            const canSubmit = p.status === 'open' && currentUserRole === 'payroll' && run;
            const canApprove = p.status === 'submitted' && currentUserRole === 'admin';
            const canReject = p.status === 'submitted' && currentUserRole === 'admin';
            const canLock = p.status === 'approved' && currentUserRole === 'admin';

            let actionBtns = '';
            if (canRun) {
                actionBtns += `<button onclick="runPayrollForPeriod('${p.id}')" class="bg-kcblue text-white px-3 py-1.5 text-xs font-bold hover:bg-kcdark transition-colors cursor-pointer rounded-lg mr-1 mb-1">▶️ รันคำนวณ</button>`;
            }
            actionBtns += `<button onclick="viewPeriodInLinesTab('${run ? run.id : ''}')" ${run ? '' : 'disabled'} class="border border-[#e6edf7] bg-white text-slate-700 px-3 py-1.5 text-xs font-bold hover:bg-kclight transition-colors cursor-pointer rounded-lg disabled:opacity-40 disabled:cursor-not-allowed mr-1 mb-1">🧾 ดูรายละเอียด</button>`;
            if (canSubmit) {
                actionBtns += `<button onclick="submitPeriod('${p.id}')" class="bg-amber-500 text-white px-3 py-1.5 text-xs font-bold hover:bg-amber-600 transition-colors cursor-pointer rounded-lg mr-1 mb-1">📤 ส่งตรวจ</button>`;
            }
            if (canApprove) {
                actionBtns += `<button onclick="approvePeriod('${p.id}')" class="bg-emerald-600 text-white px-3 py-1.5 text-xs font-bold hover:bg-emerald-700 transition-colors cursor-pointer rounded-lg mr-1 mb-1">✅ อนุมัติงวด</button>`;
            }
            if (canReject) {
                actionBtns += `<button onclick="rejectPeriod('${p.id}')" class="bg-red-100 text-red-700 border border-red-300 px-3 py-1.5 text-xs font-bold hover:bg-red-200 transition-colors cursor-pointer rounded-lg mr-1 mb-1">↩️ ส่งกลับแก้ไข</button>`;
            }
            if (canLock) {
                actionBtns += `<button onclick="lockPeriod('${p.id}')" class="bg-slate-700 text-white px-3 py-1.5 text-xs font-bold hover:bg-slate-800 transition-colors cursor-pointer rounded-lg mr-1 mb-1">🔒 ล็อกงวด (จ่ายแล้ว)</button>`;
            }

            return `
            <tr class="border-t border-[#e6edf7]">
                <td class="p-3 font-bold">${fmtDate(p.period_start)} - ${fmtDate(p.period_end)}</td>
                <td class="p-3">${periodTypeLabel[p.period_type] || p.period_type}</td>
                <td class="p-3">${fmtDate(p.pay_date)}</td>
                <td class="p-3 text-center">${periodStatusLabel[p.status] || p.status}</td>
                <td class="p-3">${runInfo}</td>
                <td class="p-3 text-right">${netTotal}</td>
                <td class="p-3 text-center whitespace-nowrap">${actionBtns}</td>
            </tr>`;
        }).join('');
    } catch (err) {
        console.error(err);
        tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-red-600">เกิดข้อผิดพลาด: ${err.message}</td></tr>`;
    }
}

const periodTypeLabel = { monthly: 'รายเดือน', semimonthly: 'กึ่งเดือน', daily: 'รายวัน' };

async function generateNextPeriod(periodType) {
    const label = periodTypeLabel[periodType] || periodType;
    if (!(await uiConfirm(`ยืนยันสร้างงวด "${label}" ถัดไปให้อัตโนมัติตามกฎที่ตั้งไว้?`))) return;
    try {
        const { data: { user } } = await supabaseClient.auth.getUser();
        const { data, error } = await supabaseClient.rpc('fn_generate_next_payroll_period', {
            p_company_id: COMPANY_ID,
            p_period_type: periodType,
            p_created_by: user ? user.id : null,
        });
        if (error) throw error;
        await uiAlert(`สร้างงวด "${label}" สำเร็จ`);
        loadPayrollPeriods();
    } catch (err) {
        await uiAlert('เกิดข้อผิดพลาด: ' + err.message);
    }
}

async function runPayrollForPeriod(periodId) {
    if (!(await uiConfirm('ยืนยันการรันคำนวณเงินเดือนสำหรับรอบนี้? ระบบจะคำนวณค่าแรง/OT/ประกันสังคม/ภาษี/หักเบิกล่วงหน้า (reuse draft run ของงวดนี้ถ้ามีอยู่แล้ว)'))) return;
    try {
        const { data: { user } } = await supabaseClient.auth.getUser();
        const { data, error } = await supabaseClient.rpc('fn_run_payroll_period', {
            p_period_id: periodId,
            p_created_by: user ? user.id : null,
        });
        if (error) throw error;
        await uiAlert('รันคำนวณเงินเดือนสำเร็จ (run_id: ' + data + ')');
        loadPayrollPeriods();
        loadRunsForSelect();
    } catch (err) {
        await uiAlert('เกิดข้อผิดพลาดขณะรันคำนวณ: ' + err.message);
    }
}

function viewPeriodInLinesTab(runId) {
    if (!runId) return;
    switchPayrollTab('lines');
    setTimeout(async () => {
        await loadRunsForSelect();
        const sel = document.getElementById('linesRunSelect');
        sel.value = runId;
        loadPayrollLines(runId);
    }, 50);
}

// ============================================================
// Payroll period approval workflow: open -> submitted -> approved -> locked
//   (+ "ส่งกลับแก้ไข": submitted -> open) - บังคับสิทธิ์จริงในฟังก์ชัน SQL (SECURITY DEFINER)
// ============================================================
async function submitPeriod(periodId) {
    if (!(await uiConfirm('ยืนยันส่งงวดนี้ให้ admin ตรวจสอบ? ต้องอนุมัติรายการพนักงานให้ครบทุกคนก่อนถึงจะส่งได้'))) return;
    try {
        const { error } = await supabaseClient.rpc('fn_payroll_period_submit', { p_period_id: periodId });
        if (error) throw error;
        await uiAlert('ส่งงวดเงินเดือนเรียบร้อย รอ admin ตรวจสอบ');
        loadPayrollPeriods();
    } catch (err) {
        await uiAlert('เกิดข้อผิดพลาด: ' + err.message);
    }
}

async function approvePeriod(periodId) {
    if (!(await uiConfirm('ยืนยันอนุมัติงวดเงินเดือนนี้?'))) return;
    try {
        const { error } = await supabaseClient.rpc('fn_payroll_period_approve', { p_period_id: periodId });
        if (error) throw error;
        await uiAlert('อนุมัติงวดเงินเดือนเรียบร้อย');
        loadPayrollPeriods();
    } catch (err) {
        await uiAlert('เกิดข้อผิดพลาด: ' + err.message);
    }
}

async function rejectPeriod(periodId) {
    const reason = prompt('เหตุผลที่ส่งกลับแก้ไข (ถ้ามี):', '');
    if (reason === null) return; // กด cancel
    if (!(await uiConfirm('ยืนยันส่งงวดนี้กลับให้เจ้าหน้าที่ payroll แก้ไข? รายการที่อนุมัติแล้วทั้งหมดจะกลับเป็น "รอตรวจสอบ"'))) return;
    try {
        const { error } = await supabaseClient.rpc('fn_payroll_period_reject', { p_period_id: periodId, p_reason: reason || null });
        if (error) throw error;
        await uiAlert('ส่งงวดกลับแก้ไขเรียบร้อย');
        loadPayrollPeriods();
    } catch (err) {
        await uiAlert('เกิดข้อผิดพลาด: ' + err.message);
    }
}

async function lockPeriod(periodId) {
    if (!(await uiConfirm('ยืนยันล็อกงวดนี้? หลังล็อกแล้วจะแก้ไข attendance/เงินเดือนของงวดนี้ไม่ได้อีก (ใช้เมื่อจ่ายเงินจริงแล้วเท่านั้น)'))) return;
    try {
        const { error } = await supabaseClient.rpc('fn_payroll_period_lock', { p_period_id: periodId });
        if (error) throw error;
        await uiAlert('ล็อกงวดเงินเดือนเรียบร้อย');
        loadPayrollPeriods();
    } catch (err) {
        await uiAlert('เกิดข้อผิดพลาด: ' + err.message);
    }
}

// ============================================================
// TAB 2: รายละเอียดต่อพนักงาน (payroll_lines / payroll_line_details)
// ============================================================
let payrollRunsById = {};

async function loadRunsForSelect() {
    const sel = document.getElementById('linesRunSelect');
    const prevValue = sel.value;
    try {
        const { data, error } = await supabaseClient
            .from('payroll_runs')
            .select('*, payroll_periods(period_start, period_end, period_type)')
            .eq('company_id', COMPANY_ID)
            .order('created_at', { ascending: false });
        if (error) throw error;
        payrollRunsById = {};
        (data || []).forEach(r => { payrollRunsById[r.id] = r; });
        sel.innerHTML = '<option value="">-- เลือก payroll run --</option>' + (data || []).map(r => {
            const pd = r.payroll_periods;
            const label = pd ? `${fmtDate(pd.period_start)} - ${fmtDate(pd.period_end)}` : r.id.slice(0, 8);
            return `<option value="${r.id}">${label} (${r.status}) - ${fmtMoney(r.total_net_amount)} บาท</option>`;
        }).join('');
        if (prevValue) sel.value = prevValue;
    } catch (err) {
        console.error(err);
    }
}

const payStatusLabel = {
    pending: '<span class="bg-slate-100 text-slate-600 px-2 py-1 text-xs font-bold border border-slate-300 rounded-lg">รอตรวจสอบ</span>',
    needs_review: '<span class="bg-red-100 text-red-700 px-2 py-1 text-xs font-bold border border-red-300 rounded-lg">⚠️ ต้องตรวจสอบ (OT เกิน 36 ชม./สัปดาห์)</span>',
    approved: '<span class="bg-blue-100 text-blue-700 px-2 py-1 text-xs font-bold border border-blue-300 rounded-lg">อนุมัติแล้ว</span>',
    paid: '<span class="bg-emerald-100 text-emerald-700 px-2 py-1 text-xs font-bold border border-emerald-300 rounded-lg">จ่ายแล้ว</span>',
};

let currentLinesRunId = null;
let currentLinesData = null;
let showZeroNetPayLines = false;
let linesViewMode = 'by_employee'; // 'by_employee' | 'by_site'
let currentEmpSitesByEmp = null; // Map emp_id -> [{ clientId, clientName, days }]
let currentSiteAggRunId = null;
let siteAggLoading = false;

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function getVisiblePayrollLines() {
    const data = currentLinesData || [];
    return showZeroNetPayLines ? data : data.filter(l => Number(l.net_pay || 0) !== 0);
}

function toggleShowZeroNetPayLines(checked) {
    showZeroNetPayLines = !!checked;
    renderLinesView();
}

function setLinesViewMode(mode) {
    if (mode !== 'by_employee' && mode !== 'by_site') return;
    linesViewMode = mode;
    const empBtn = document.getElementById('linesViewBtn-by_employee');
    const siteBtn = document.getElementById('linesViewBtn-by_site');
    const empPanel = document.getElementById('linesByEmployeePanel');
    const sitePanel = document.getElementById('linesBySitePanel');
    const active = 'px-3 py-1.5 text-sm font-bold rounded-lg bg-white text-kcblue shadow-sm cursor-pointer border-0';
    const inactive = 'px-3 py-1.5 text-sm font-bold rounded-lg text-slate-500 hover:text-kcdark cursor-pointer border-0 bg-transparent';
    if (empBtn) empBtn.className = mode === 'by_employee' ? active : inactive;
    if (siteBtn) siteBtn.className = mode === 'by_site' ? active : inactive;
    if (empPanel) empPanel.classList.toggle('hidden', mode !== 'by_employee');
    if (sitePanel) sitePanel.classList.toggle('hidden', mode !== 'by_site');
    renderLinesView();
}

function renderLinesSummaryBar(visible) {
    const summaryBar = document.getElementById('linesSummaryBar');
    if (!summaryBar) return;
    if (!currentLinesRunId) {
        summaryBar.classList.add('hidden');
        return;
    }
    if ((currentLinesData || []).length === 0) {
        summaryBar.classList.add('hidden');
        return;
    }
    if (visible.length === 0) {
        summaryBar.classList.remove('hidden');
        summaryBar.innerHTML = `
            <div class="bg-kclight rounded-xl p-3"><p class="text-xs text-slate-500 font-bold">จำนวนพนักงาน</p><p class="text-lg font-bold text-kcdark">0</p></div>
            <div class="bg-kclight rounded-xl p-3"><p class="text-xs text-slate-500 font-bold">รายได้รวม</p><p class="text-lg font-bold text-kcdark">${fmtMoney(0)}</p></div>
            <div class="bg-kclight rounded-xl p-3"><p class="text-xs text-slate-500 font-bold">สุทธิรวม</p><p class="text-lg font-bold text-kcblue">${fmtMoney(0)}</p></div>
            <div class="bg-kclight rounded-xl p-3"><p class="text-xs text-slate-500 font-bold">ต้องตรวจสอบ</p><p class="text-lg font-bold text-kcdark">0</p></div>
        `;
        return;
    }
    const totalGross = visible.reduce((s, l) => s + Number(l.gross_pay || 0), 0);
    const totalNet = visible.reduce((s, l) => s + Number(l.net_pay || 0), 0);
    const needsReviewCount = visible.filter(l => l.pay_status === 'needs_review').length;
    summaryBar.classList.remove('hidden');
    summaryBar.innerHTML = `
        <div class="bg-kclight rounded-xl p-3"><p class="text-xs text-slate-500 font-bold">จำนวนพนักงาน</p><p class="text-lg font-bold text-kcdark">${visible.length}</p></div>
        <div class="bg-kclight rounded-xl p-3"><p class="text-xs text-slate-500 font-bold">รายได้รวม</p><p class="text-lg font-bold text-kcdark">${fmtMoney(totalGross)}</p></div>
        <div class="bg-kclight rounded-xl p-3"><p class="text-xs text-slate-500 font-bold">สุทธิรวม</p><p class="text-lg font-bold text-kcblue">${fmtMoney(totalNet)}</p></div>
        <div class="${needsReviewCount > 0 ? 'bg-red-50 border border-red-200' : 'bg-kclight'} rounded-xl p-3"><p class="text-xs text-slate-500 font-bold">ต้องตรวจสอบ</p><p class="text-lg font-bold ${needsReviewCount > 0 ? 'text-red-600' : 'text-kcdark'}">${needsReviewCount}</p></div>
    `;
}

function lineActionButtonsHtml(l) {
    const canApprove = l.pay_status === 'pending';
    const canMarkPaid = l.pay_status === 'approved';
    return `
        <button onclick="viewLineDetail('${l.id}')" class="border border-[#e6edf7] bg-white text-slate-700 px-2 py-1 text-xs font-bold hover:bg-kclight transition-colors cursor-pointer rounded-lg">🔍 ดู</button>
        ${canApprove ? `<button onclick="approveLine('${l.id}')" class="bg-emerald-600 text-white px-2 py-1 text-xs font-bold hover:bg-emerald-700 transition-colors cursor-pointer rounded-lg">✅ อนุมัติ</button>` : ''}
        ${canMarkPaid ? `<button onclick="markLinePaid('${l.id}')" class="bg-kcblue text-white px-2 py-1 text-xs font-bold hover:bg-kcdark transition-colors cursor-pointer rounded-lg">💸 จ่ายแล้ว</button>` : ''}
    `;
}

function renderPayrollLinesTable() {
    const tbody = document.getElementById('linesTableBody');
    if (!tbody) return;
    if (!currentLinesRunId) {
        tbody.innerHTML = '<tr><td colspan="10" class="p-8 text-center text-slate-500">กรุณาเลือก payroll run ด้านบน</td></tr>';
        renderLinesSummaryBar([]);
        return;
    }
    const data = currentLinesData || [];
    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="p-8 text-center text-slate-500">ไม่มีข้อมูลใน run นี้</td></tr>';
        renderLinesSummaryBar([]);
        return;
    }

    const visible = getVisiblePayrollLines();
    renderLinesSummaryBar(visible);

    if (visible.length === 0) {
        const hiddenCount = data.length;
        tbody.innerHTML = `<tr><td colspan="10" class="p-8 text-center text-slate-500">ไม่มีพนักงานที่มีรายได้ในงวดนี้ (${hiddenCount} คนถูกซ่อน — เปิด "แสดงพนักงานที่ไม่มีรายได้ในงวดนี้" เพื่อดู)</td></tr>`;
        return;
    }

    tbody.innerHTML = visible.map(l => {
        const otTotal = Number(l.overtime_amount || 0);
        const emp = l.employees;
        return `
        <tr class="border-t border-[#e6edf7] ${l.pay_status === 'needs_review' ? 'bg-red-50/50' : ''}">
            <td class="p-3 font-bold">${emp ? escapeHtml(emp.full_name) : escapeHtml(l.emp_id)} <span class="text-xs text-slate-400 block">${escapeHtml(l.emp_id)}</span></td>
            <td class="p-3 text-right">${fmtMoney(l.base_salary)}</td>
            <td class="p-3 text-right">${fmtMoney(otTotal)}</td>
            <td class="p-3 text-right font-bold">${fmtMoney(l.gross_pay)}</td>
            <td class="p-3 text-right text-red-600">-${fmtMoney(l.social_security_employee)}</td>
            <td class="p-3 text-right text-red-600">-${fmtMoney(l.withholding_tax)}</td>
            <td class="p-3 text-right text-red-600">-${fmtMoney(l.advance_deduction)}</td>
            <td class="p-3 text-right font-bold text-kcblue">${fmtMoney(l.net_pay)}</td>
            <td class="p-3 text-center">${payStatusLabel[l.pay_status] || l.pay_status}</td>
            <td class="p-3 text-center whitespace-nowrap">${lineActionButtonsHtml(l)}</td>
        </tr>`;
    }).join('');
}

function buildSiteViewModel(visibleLines, empSitesByEmp) {
    const sitesMap = new Map(); // clientId -> { clientId, clientName, employees: [], totalNet }
    const orphans = [];

    for (const line of visibleLines) {
        const sites = empSitesByEmp.get(line.emp_id) || [];
        if (sites.length === 0) {
            orphans.push(line);
            continue;
        }
        for (const site of sites) {
            if (!sitesMap.has(site.clientId)) {
                sitesMap.set(site.clientId, {
                    clientId: site.clientId,
                    clientName: site.clientName,
                    employees: [],
                    totalNet: 0,
                });
            }
            const card = sitesMap.get(site.clientId);
            const otherSites = sites
                .filter(s => s.clientId !== site.clientId)
                .map(s => ({ name: s.clientName, days: s.days }));
            card.employees.push({
                line,
                daysAtThisSite: site.days,
                otherSites,
            });
            card.totalNet += Number(line.net_pay || 0);
        }
    }

    const sites = Array.from(sitesMap.values()).sort((a, b) => b.totalNet - a.totalNet);
    for (const site of sites) {
        site.employees.sort((a, b) => {
            const na = (a.line.employees && a.line.employees.full_name) || a.line.emp_id;
            const nb = (b.line.employees && b.line.employees.full_name) || b.line.emp_id;
            return String(na).localeCompare(String(nb), 'th');
        });
    }
    return { sites, orphans };
}

async function loadSiteAttendanceForRun(runId) {
    if (!runId || !currentLinesData) {
        currentEmpSitesByEmp = new Map();
        currentSiteAggRunId = runId || null;
        return;
    }
    if (currentSiteAggRunId === runId && currentEmpSitesByEmp) return;

    const run = payrollRunsById[runId];
    const period = run && run.payroll_periods;
    if (!period || !period.period_start || !period.period_end) {
        throw new Error('ไม่พบช่วงวันที่ของงวดเงินเดือนสำหรับ run นี้');
    }

    const empIds = [...new Set((currentLinesData || []).map(l => l.emp_id).filter(Boolean))];
    const empSitesByEmp = new Map();
    empIds.forEach(id => empSitesByEmp.set(id, []));

    if (empIds.length === 0) {
        currentEmpSitesByEmp = empSitesByEmp;
        currentSiteAggRunId = runId;
        return;
    }

    const { data: logs, error: logErr } = await supabaseClient
        .from('attendance_logs')
        .select('emp_id, client_id, work_date')
        .eq('company_id', COMPANY_ID)
        .gte('work_date', period.period_start)
        .lte('work_date', period.period_end)
        .in('emp_id', empIds)
        .not('client_id', 'is', null);
    if (logErr) throw logErr;

    // emp_id -> client_id -> Set(work_date)
    const daySets = new Map();
    for (const row of logs || []) {
        if (!row.emp_id || !row.client_id) continue;
        if (!daySets.has(row.emp_id)) daySets.set(row.emp_id, new Map());
        const byClient = daySets.get(row.emp_id);
        if (!byClient.has(row.client_id)) byClient.set(row.client_id, new Set());
        byClient.get(row.client_id).add(row.work_date);
    }

    const clientIds = [...new Set(
        [...daySets.values()].flatMap(byClient => [...byClient.keys()])
    )];
    const nameById = new Map();
    if (clientIds.length > 0) {
        const { data: clients, error: clientErr } = await supabaseClient
            .from('clients')
            .select('id, client_name')
            .in('id', clientIds);
        if (clientErr) throw clientErr;
        (clients || []).forEach(c => nameById.set(c.id, c.client_name || c.id));
    }

    for (const [empId, byClient] of daySets.entries()) {
        const sites = [...byClient.entries()]
            .map(([clientId, dates]) => ({
                clientId,
                clientName: nameById.get(clientId) || clientId,
                days: dates.size,
            }))
            .sort((a, b) => b.days - a.days || String(a.clientName).localeCompare(String(b.clientName), 'th'));
        empSitesByEmp.set(empId, sites);
    }

    currentEmpSitesByEmp = empSitesByEmp;
    currentSiteAggRunId = runId;
}

function renderPayrollLinesBySite() {
    const panel = document.getElementById('linesBySitePanel');
    if (!panel) return;

    if (!currentLinesRunId) {
        panel.innerHTML = '<div class="rounded-xl border border-[#e6edf7] bg-white p-8 text-center text-slate-500">กรุณาเลือก payroll run ด้านบน</div>';
        renderLinesSummaryBar([]);
        return;
    }
    const data = currentLinesData || [];
    if (data.length === 0) {
        panel.innerHTML = '<div class="rounded-xl border border-[#e6edf7] bg-white p-8 text-center text-slate-500">ไม่มีข้อมูลใน run นี้</div>';
        renderLinesSummaryBar([]);
        return;
    }

    const visible = getVisiblePayrollLines();
    renderLinesSummaryBar(visible);

    if (visible.length === 0) {
        panel.innerHTML = `<div class="rounded-xl border border-[#e6edf7] bg-white p-8 text-center text-slate-500">ไม่มีพนักงานที่มีรายได้ในงวดนี้ (${data.length} คนถูกซ่อน — เปิด "แสดงพนักงานที่ไม่มีรายได้ในงวดนี้" เพื่อดู)</div>`;
        return;
    }

    if (siteAggLoading) {
        panel.innerHTML = '<div class="rounded-xl border border-[#e6edf7] bg-white p-8 text-center text-slate-500">⏳ กำลังโหลดข้อมูลไซต์งาน...</div>';
        return;
    }

    const { sites, orphans } = buildSiteViewModel(visible, currentEmpSitesByEmp || new Map());

    if (sites.length === 0 && orphans.length === 0) {
        panel.innerHTML = '<div class="rounded-xl border border-[#e6edf7] bg-white p-8 text-center text-slate-500">ไม่พบข้อมูลไซต์งานในงวดนี้</div>';
        return;
    }

    const renderEmpRow = (entry) => {
        const l = entry.line;
        const emp = l.employees;
        const badges = (entry.otherSites || []).map(s =>
            `<span class="inline-block bg-amber-50 text-amber-800 border border-amber-200 text-[11px] font-bold px-2 py-0.5 rounded-lg">+ ${escapeHtml(s.name)} ${s.days} วัน</span>`
        ).join(' ');
        const daysLabel = entry.daysAtThisSite != null
            ? `<span class="text-xs text-slate-400 font-normal">${entry.daysAtThisSite} วันที่ไซต์นี้</span>`
            : '';
        return `
            <div class="flex flex-wrap items-center justify-between gap-2 border-t border-[#e6edf7] px-4 py-3 ${l.pay_status === 'needs_review' ? 'bg-red-50/50' : ''}">
                <div class="min-w-0">
                    <p class="font-bold text-sm text-kcdark">${emp ? escapeHtml(emp.full_name) : escapeHtml(l.emp_id)}
                        <span class="text-xs text-slate-400 font-normal ml-1">${escapeHtml(l.emp_id)}</span>
                        ${daysLabel ? `<span class="ml-2">${daysLabel}</span>` : ''}
                    </p>
                    <div class="flex flex-wrap gap-1 mt-1">${badges}</div>
                    <div class="mt-1">${payStatusLabel[l.pay_status] || l.pay_status}</div>
                </div>
                <div class="flex items-center gap-2 flex-wrap justify-end">
                    <span class="font-bold text-kcblue text-sm whitespace-nowrap">${fmtMoney(l.net_pay)}</span>
                    <div class="flex gap-1 flex-wrap justify-end">${lineActionButtonsHtml(l)}</div>
                </div>
            </div>`;
    };

    const siteCardsHtml = sites.map(site => `
        <div class="rounded-xl border border-[#e6edf7] bg-white overflow-hidden">
            <div class="bg-kclight px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                <h3 class="font-bold text-kcdark text-sm">${escapeHtml(site.clientName)}</h3>
                <span class="text-xs font-bold text-slate-500">${site.employees.length} คนที่มาทำงาน</span>
            </div>
            ${site.employees.map(renderEmpRow).join('')}
        </div>
    `).join('');

    const orphanCardHtml = orphans.length > 0 ? `
        <div class="rounded-xl border border-dashed border-slate-300 bg-white overflow-hidden">
            <div class="bg-slate-50 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                <h3 class="font-bold text-slate-600 text-sm">ไม่มีข้อมูลไซต์งาน</h3>
                <span class="text-xs font-bold text-slate-500">${orphans.length} คน</span>
            </div>
            ${orphans.map(line => renderEmpRow({ line, daysAtThisSite: null, otherSites: [] })).join('')}
        </div>
    ` : '';

    const noteHtml = sites.some(s => s.employees.some(e => e.otherSites && e.otherSites.length > 0))
        ? `<p class="text-xs text-slate-500">หมายเหตุ: พนักงานที่ทำงานหลายไซต์จะโชว์ยอดสุทธิเต็มจำนวนในทุกไซต์ (ไม่ใช่การแบ่งเงิน) — ดู badge สีเหลืองเพื่อรู้ไซต์อื่นในงวดเดียวกัน</p>`
        : '';

    panel.innerHTML = noteHtml + siteCardsHtml + orphanCardHtml;
}

async function renderLinesView() {
    if (linesViewMode === 'by_site') {
        if (currentLinesRunId && currentLinesData && currentSiteAggRunId !== currentLinesRunId) {
            siteAggLoading = true;
            renderPayrollLinesBySite();
            try {
                await loadSiteAttendanceForRun(currentLinesRunId);
            } catch (err) {
                console.error(err);
                const panel = document.getElementById('linesBySitePanel');
                if (panel) {
                    panel.innerHTML = `<div class="rounded-xl border border-[#e6edf7] bg-white p-8 text-center text-red-600">เกิดข้อผิดพลาดขณะโหลดไซต์งาน: ${escapeHtml(err.message)}</div>`;
                }
                siteAggLoading = false;
                return;
            }
            siteAggLoading = false;
        }
        renderPayrollLinesBySite();
        return;
    }
    renderPayrollLinesTable();
}

async function loadPayrollLines(runId) {
    currentLinesRunId = runId || null;
    currentLinesData = null;
    currentEmpSitesByEmp = null;
    currentSiteAggRunId = null;
    const tbody = document.getElementById('linesTableBody');
    const summaryBar = document.getElementById('linesSummaryBar');
    const sitePanel = document.getElementById('linesBySitePanel');
    if (!runId) {
        renderLinesView();
        return;
    }
    if (tbody) tbody.innerHTML = '<tr><td colspan="10" class="p-8 text-center text-slate-500">⏳ กำลังโหลดข้อมูล...</td></tr>';
    if (sitePanel && linesViewMode === 'by_site') {
        sitePanel.innerHTML = '<div class="rounded-xl border border-[#e6edf7] bg-white p-8 text-center text-slate-500">⏳ กำลังโหลดข้อมูล...</div>';
    }
    if (summaryBar) summaryBar.classList.add('hidden');
    try {
        const { data, error } = await supabaseClient
            .from('payroll_lines')
            .select('*, employees(full_name, emp_id)')
            .eq('payroll_run_id', runId)
            .order('emp_id', { ascending: true });
        if (error) throw error;
        currentLinesData = data || [];
        await renderLinesView();
    } catch (err) {
        console.error(err);
        currentLinesData = null;
        if (tbody) tbody.innerHTML = `<tr><td colspan="10" class="p-8 text-center text-red-600">เกิดข้อผิดพลาด: ${err.message}</td></tr>`;
        if (sitePanel) sitePanel.innerHTML = `<div class="rounded-xl border border-[#e6edf7] bg-white p-8 text-center text-red-600">เกิดข้อผิดพลาด: ${escapeHtml(err.message)}</div>`;
    }
}

// แถวที่ quantity/rate เป็น placeholder (qty=1 คงที่) — แสดง "-" ไม่โชว์ตัวเลขหลอก
const DETAIL_QTY_RATE_PLACEHOLDER_TYPES = new Set(['social_security', 'withholding_tax', 'advance']);

function formatLineDetailDescription(d) {
    let desc = d.description || d.detail_type || '';
    if (d.detail_type === 'base') {
        desc = desc
            .replace(/\(\s*daily\s*\)/i, '(รายวัน)')
            .replace(/\(\s*monthly\s*\)/i, '(รายเดือน)');
    }
    return desc;
}

function formatLineDetailQuantity(d) {
    if (DETAIL_QTY_RATE_PLACEHOLDER_TYPES.has(d.detail_type)) return '-';
    return d.quantity != null ? d.quantity : '-';
}

function formatLineDetailRate(d) {
    if (DETAIL_QTY_RATE_PLACEHOLDER_TYPES.has(d.detail_type)) return '-';
    // ค่าจ้างพื้นฐาน: แสดงอัตรารายวัน (amount/วัน) ให้ qty × อัตรา = มูลค่า ไม่ใช้ hourly แบบ derived
    if (d.detail_type === 'base' && d.quantity != null && Number(d.quantity) !== 0) {
        return fmtMoney(Number(d.amount) / Number(d.quantity));
    }
    return d.rate != null ? fmtMoney(d.rate) : '-';
}

async function viewLineDetail(lineId) {
    try {
        const { data: line, error: lineErr } = await supabaseClient
            .from('payroll_lines')
            .select('*, employees(full_name, emp_id)')
            .eq('id', lineId)
            .single();
        if (lineErr) throw lineErr;
        const { data: details, error: detErr } = await supabaseClient
            .from('payroll_line_details')
            .select('*')
            .eq('payroll_line_id', lineId)
            .order('detail_type', { ascending: true });
        if (detErr) throw detErr;

        document.getElementById('lineDetailModalTitle').textContent = `🧾 ${line.employees ? line.employees.full_name : line.emp_id} (${line.emp_id})`;
        const body = document.getElementById('lineDetailModalBody');
        const remarksHtml = line.remarks
            ? `<div class="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-xs font-bold mb-3">⚠️ ${line.remarks}</div>`
            : '';
        body.innerHTML = remarksHtml + `
            <table class="w-full text-sm">
                <thead><tr class="text-slate-500 text-xs"><th class="text-left p-1">รายการ</th><th class="text-right p-1">จำนวน</th><th class="text-right p-1">อัตรา</th><th class="text-right p-1">มูลค่า</th></tr></thead>
                <tbody>
                ${(details || []).map(d => `
                    <tr class="border-t border-[#e6edf7]">
                        <td class="p-1">${formatLineDetailDescription(d)}</td>
                        <td class="p-1 text-right">${formatLineDetailQuantity(d)}</td>
                        <td class="p-1 text-right">${formatLineDetailRate(d)}</td>
                        <td class="p-1 text-right font-bold ${Number(d.amount) < 0 ? 'text-red-600' : 'text-slate-800'}">${fmtMoney(d.amount)}</td>
                    </tr>`).join('')}
                </tbody>
                <tfoot>
                    <tr class="border-t-2 border-kcblue"><td class="p-1 font-bold" colspan="3">สุทธิ (Net Pay)</td><td class="p-1 text-right font-bold text-kcblue text-base">${fmtMoney(line.net_pay)}</td></tr>
                </tfoot>
            </table>
        `;
        document.getElementById('lineDetailModal').classList.remove('hidden');
        document.getElementById('lineDetailModal').classList.add('flex');
    } catch (err) {
        await uiAlert('เกิดข้อผิดพลาด: ' + err.message);
    }
}
function closeLineDetailModal() {
    document.getElementById('lineDetailModal').classList.add('hidden');
    document.getElementById('lineDetailModal').classList.remove('flex');
}

async function approveLine(lineId) {
    if (!(await uiConfirm('ยืนยันอนุมัติรายการเงินเดือนนี้?'))) return;
    try {
        const { error } = await supabaseClient
            .from('payroll_lines')
            .update({ pay_status: 'approved', updated_at: new Date().toISOString() })
            .eq('id', lineId);
        if (error) throw error;
        await supabaseClient
            .from('payroll_payslips')
            .update({ status: 'approved', updated_at: new Date().toISOString() })
            .eq('payroll_line_id', lineId);
        loadPayrollLines(currentLinesRunId);
    } catch (err) {
        await uiAlert('เกิดข้อผิดพลาด: ' + err.message);
    }
}

async function markLinePaid(lineId) {
    if (!(await uiConfirm('ยืนยันว่าจ่ายเงินให้พนักงานคนนี้แล้ว?'))) return;
    try {
        const { error } = await supabaseClient
            .from('payroll_lines')
            .update({ pay_status: 'paid', updated_at: new Date().toISOString() })
            .eq('id', lineId);
        if (error) throw error;
        await supabaseClient
            .from('payroll_payslips')
            .update({ status: 'paid', updated_at: new Date().toISOString() })
            .eq('payroll_line_id', lineId);
        loadPayrollLines(currentLinesRunId);
    } catch (err) {
        await uiAlert('เกิดข้อผิดพลาด: ' + err.message);
    }
}

async function approveAllReadyLines() {
    if (!currentLinesRunId) { await uiAlert('กรุณาเลือก payroll run ก่อน'); return; }
    if (!(await uiConfirm('ยืนยันอนุมัติทุกรายการที่ไม่มีสถานะ "ต้องตรวจสอบ" ใน run นี้?'))) return;
    try {
        const { data: lines, error: fetchErr } = await supabaseClient
            .from('payroll_lines')
            .select('id')
            .eq('payroll_run_id', currentLinesRunId)
            .eq('pay_status', 'pending');
        if (fetchErr) throw fetchErr;
        if (!lines || lines.length === 0) { await uiAlert('ไม่มีรายการที่รออนุมัติ'); return; }
        const ids = lines.map(l => l.id);
        const { error } = await supabaseClient
            .from('payroll_lines')
            .update({ pay_status: 'approved', updated_at: new Date().toISOString() })
            .in('id', ids);
        if (error) throw error;
        await supabaseClient
            .from('payroll_payslips')
            .update({ status: 'approved', updated_at: new Date().toISOString() })
            .in('payroll_line_id', ids);
        loadPayrollLines(currentLinesRunId);
    } catch (err) {
        await uiAlert('เกิดข้อผิดพลาด: ' + err.message);
    }
}

// ============================================================
// TAB 3: อัตรา/เพดาน (payroll_rates)
// ============================================================
const rateTypeLabel = {
    ot_15: 'OT 1.5x (วันทำงานปกติ)',
    ot_2: 'OT 2.0x (วันหยุดประจำสัปดาห์)',
    ot_3: 'OT 3.0x (วันนักขัตฤกษ์)',
    social_security_employee: 'ประกันสังคม (ฝั่งพนักงาน)',
    social_security_employer: 'ประกันสังคม (ฝั่งนายจ้าง)',
    freelance_withholding_tax: 'หัก ณ ที่จ่าย ฟรีแลนซ์/จ็อบพิเศษ (คงที่)',
    night_shift_differential: 'ค่ากะดึก (% เพิ่มจากค่าแรง/วันฐาน)',
};
const percentRateTypes = ['social_security_employee', 'social_security_employer', 'freelance_withholding_tax', 'night_shift_differential'];

async function loadPayrollRates() {
    const tbody = document.getElementById('ratesTableBody');
    tbody.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-slate-500">⏳ กำลังโหลดข้อมูล...</td></tr>';
    try {
        const today = new Date().toISOString().slice(0, 10);
        const { data, error } = await supabaseClient
            .from('payroll_rates')
            .select('*')
            .eq('company_id', COMPANY_ID)
            .lte('effective_from', today)
            .order('effective_from', { ascending: false });
        if (error) throw error;

        // เอาแถวล่าสุดต่อ rate_type (effective_from ล่าสุดที่ไม่เกินวันนี้)
        const latestByType = {};
        (data || []).forEach(r => {
            if (!latestByType[r.rate_type]) latestByType[r.rate_type] = r;
        });
        const rows = Object.values(latestByType);

        if (rows.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-slate-500">ยังไม่มีอัตราที่ตั้งค่าไว้</td></tr>';
            return;
        }

        tbody.innerHTML = rows.map(r => `
            <tr class="border-t border-[#e6edf7]">
                <td class="p-3 font-bold">${rateTypeLabel[r.rate_type] || r.rate_type}</td>
                <td class="p-3 text-right">${percentRateTypes.includes(r.rate_type) ? (Number(r.rate_value) * 100).toFixed(2) + '%' : Number(r.rate_value).toFixed(2) + 'x'}</td>
                <td class="p-3 text-right">${r.social_security_max_cap != null ? fmtMoney(r.social_security_max_cap) + ' บาท' : '-'}</td>
                <td class="p-3">${fmtDate(r.effective_from)}</td>
                <td class="p-3 text-center">
                    <button onclick='openEditRateModal(${JSON.stringify(r)})' class="border border-[#e6edf7] bg-white text-slate-700 px-3 py-1.5 text-xs font-bold hover:bg-kclight transition-colors cursor-pointer rounded-lg">✏️ แก้ไข</button>
                </td>
            </tr>`).join('');
    } catch (err) {
        console.error(err);
        tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-red-600">เกิดข้อผิดพลาด: ${err.message}</td></tr>`;
    }
}

function openEditRateModal(rate) {
    document.getElementById('editRateType').value = rate.rate_type;
    document.getElementById('editRateModalTitle').textContent = '⚙️ แก้ไข: ' + (rateTypeLabel[rate.rate_type] || rate.rate_type);
    document.getElementById('editRateValue').value = rate.rate_value;
    document.getElementById('editRateCap').value = rate.social_security_max_cap != null ? rate.social_security_max_cap : '';
    document.getElementById('editRateEffectiveFrom').value = new Date().toISOString().slice(0, 10);
    document.getElementById('editRateModal').classList.remove('hidden');
    document.getElementById('editRateModal').classList.add('flex');
}
function closeEditRateModal() {
    document.getElementById('editRateModal').classList.add('hidden');
    document.getElementById('editRateModal').classList.remove('flex');
}

async function confirmEditRate() {
    const rate_type = document.getElementById('editRateType').value;
    const rate_value = parseFloat(document.getElementById('editRateValue').value);
    const capRaw = document.getElementById('editRateCap').value;
    const social_security_max_cap = capRaw === '' ? null : parseFloat(capRaw);
    const effective_from = document.getElementById('editRateEffectiveFrom').value;

    if (isNaN(rate_value) || !effective_from) {
        await uiAlert('กรุณากรอกค่าอัตราและวันที่มีผลให้ครบถ้วน');
        return;
    }
    try {
        const rate_multiplier = rate_type.startsWith('ot_') ? rate_value : null;
        // เก็บประวัติ: insert แถวใหม่แทนการแก้ไขของเดิม (effective_from ใหม่)
        const { error } = await supabaseClient
            .from('payroll_rates')
            .insert({
                company_id: COMPANY_ID,
                rate_type,
                rate_value,
                rate_multiplier,
                social_security_max_cap,
                effective_from,
            });
        if (error) throw error;
        closeEditRateModal();
        loadPayrollRates();
    } catch (err) {
        await uiAlert('เกิดข้อผิดพลาด: ' + err.message);
    }
}
