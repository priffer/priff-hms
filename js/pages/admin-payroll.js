// js/pages/admin-payroll.js
// Admin Portal: จัดการรอบเงินเดือน (payroll_periods/payroll_runs), รันคำนวณ (fn_run_payroll_period),
// ดูรายละเอียดต่อพนักงาน (payroll_lines/payroll_line_details), อนุมัติ/mark paid, และแก้ไขอัตรา (payroll_rates)

const COMPANY_ID = 'comp_kc_clean'; // ระบบ single-tenant ในตอนนี้ (เหมือน pattern เดิมทั่วทั้งระบบ)

document.addEventListener('DOMContentLoaded', () => {
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
                ? `${run.run_name || run.id.slice(0, 8)} <span class="text-xs text-slate-400">(${run.status})</span>`
                : '<span class="text-slate-400">ยังไม่รัน</span>';
            const netTotal = run ? fmtMoney(run.total_net_amount) + ' บาท' : '-';
            return `
            <tr class="border-t border-[#e6edf7]">
                <td class="p-3 font-bold">${fmtDate(p.period_start)} - ${fmtDate(p.period_end)}</td>
                <td class="p-3">${p.period_type === 'monthly' ? 'รายเดือน' : 'รายวัน'}</td>
                <td class="p-3">${fmtDate(p.pay_date)}</td>
                <td class="p-3 text-center">${periodStatusLabel[p.status] || p.status}</td>
                <td class="p-3">${runInfo}</td>
                <td class="p-3 text-right">${netTotal}</td>
                <td class="p-3 text-center whitespace-nowrap">
                    <button onclick="runPayrollForPeriod('${p.id}')" class="bg-kcblue text-white px-3 py-1.5 text-xs font-bold hover:bg-kcdark transition-colors cursor-pointer rounded-lg mr-1">▶️ รันคำนวณ</button>
                    <button onclick="viewPeriodInLinesTab('${run ? run.id : ''}')" ${run ? '' : 'disabled'} class="border border-[#e6edf7] bg-white text-slate-700 px-3 py-1.5 text-xs font-bold hover:bg-kclight transition-colors cursor-pointer rounded-lg disabled:opacity-40 disabled:cursor-not-allowed">🧾 ดูรายละเอียด</button>
                </td>
            </tr>`;
        }).join('');
    } catch (err) {
        console.error(err);
        tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-red-600">เกิดข้อผิดพลาด: ${err.message}</td></tr>`;
    }
}

function openCreatePeriodModal() {
    document.getElementById('newPeriodType').value = 'monthly';
    document.getElementById('newPeriodStart').value = '';
    document.getElementById('newPeriodEnd').value = '';
    document.getElementById('newPeriodPayDate').value = '';
    document.getElementById('createPeriodModal').classList.remove('hidden');
    document.getElementById('createPeriodModal').classList.add('flex');
}
function closeCreatePeriodModal() {
    document.getElementById('createPeriodModal').classList.add('hidden');
    document.getElementById('createPeriodModal').classList.remove('flex');
}

async function confirmCreatePeriod() {
    const period_type = document.getElementById('newPeriodType').value;
    const period_start = document.getElementById('newPeriodStart').value;
    const period_end = document.getElementById('newPeriodEnd').value;
    const pay_date = document.getElementById('newPeriodPayDate').value || null;

    if (!period_start || !period_end) {
        alert('กรุณากรอกวันเริ่มงวดและวันสิ้นงวด');
        return;
    }
    if (period_end < period_start) {
        alert('วันสิ้นงวดต้องไม่ก่อนวันเริ่มงวด');
        return;
    }

    try {
        const { data: { user } } = await supabaseClient.auth.getUser();
        const { error } = await supabaseClient
            .from('payroll_periods')
            .insert({
                company_id: COMPANY_ID,
                period_type,
                period_start,
                period_end,
                pay_date,
                status: 'open',
                created_by: user ? user.id : null,
            });
        if (error) throw error;
        closeCreatePeriodModal();
        loadPayrollPeriods();
    } catch (err) {
        alert('เกิดข้อผิดพลาด: ' + err.message);
    }
}

async function runPayrollForPeriod(periodId) {
    if (!confirm('ยืนยันการรันคำนวณเงินเดือนสำหรับรอบนี้? ระบบจะสร้าง payroll run ใหม่และคำนวณค่าแรง/OT/ประกันสังคม/ภาษี/หักเบิกล่วงหน้าให้ทุกคน')) return;
    try {
        const { data: { user } } = await supabaseClient.auth.getUser();
        const { data, error } = await supabaseClient.rpc('fn_run_payroll_period', {
            p_period_id: periodId,
            p_created_by: user ? user.id : null,
        });
        if (error) throw error;
        alert('รันคำนวณเงินเดือนสำเร็จ (run_id: ' + data + ')');
        loadPayrollPeriods();
        loadRunsForSelect();
    } catch (err) {
        alert('เกิดข้อผิดพลาดขณะรันคำนวณ: ' + err.message);
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
// TAB 2: รายละเอียดต่อพนักงาน (payroll_lines / payroll_line_details)
// ============================================================
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

async function loadPayrollLines(runId) {
    currentLinesRunId = runId || null;
    const tbody = document.getElementById('linesTableBody');
    const summaryBar = document.getElementById('linesSummaryBar');
    if (!runId) {
        tbody.innerHTML = '<tr><td colspan="10" class="p-8 text-center text-slate-500">กรุณาเลือก payroll run ด้านบน</td></tr>';
        summaryBar.classList.add('hidden');
        return;
    }
    tbody.innerHTML = '<tr><td colspan="10" class="p-8 text-center text-slate-500">⏳ กำลังโหลดข้อมูล...</td></tr>';
    try {
        const { data, error } = await supabaseClient
            .from('payroll_lines')
            .select('*, employees(full_name, emp_id)')
            .eq('payroll_run_id', runId)
            .order('emp_id', { ascending: true });
        if (error) throw error;

        if (!data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="10" class="p-8 text-center text-slate-500">ไม่มีข้อมูลใน run นี้</td></tr>';
            summaryBar.classList.add('hidden');
            return;
        }

        const totalGross = data.reduce((s, l) => s + Number(l.gross_pay || 0), 0);
        const totalNet = data.reduce((s, l) => s + Number(l.net_pay || 0), 0);
        const needsReviewCount = data.filter(l => l.pay_status === 'needs_review').length;
        summaryBar.classList.remove('hidden');
        summaryBar.innerHTML = `
            <div class="bg-kclight rounded-xl p-3"><p class="text-xs text-slate-500 font-bold">จำนวนพนักงาน</p><p class="text-lg font-bold text-kcdark">${data.length}</p></div>
            <div class="bg-kclight rounded-xl p-3"><p class="text-xs text-slate-500 font-bold">รายได้รวม</p><p class="text-lg font-bold text-kcdark">${fmtMoney(totalGross)}</p></div>
            <div class="bg-kclight rounded-xl p-3"><p class="text-xs text-slate-500 font-bold">สุทธิรวม</p><p class="text-lg font-bold text-kcblue">${fmtMoney(totalNet)}</p></div>
            <div class="${needsReviewCount > 0 ? 'bg-red-50 border border-red-200' : 'bg-kclight'} rounded-xl p-3"><p class="text-xs text-slate-500 font-bold">ต้องตรวจสอบ</p><p class="text-lg font-bold ${needsReviewCount > 0 ? 'text-red-600' : 'text-kcdark'}">${needsReviewCount}</p></div>
        `;

        tbody.innerHTML = data.map(l => {
            const otTotal = Number(l.overtime_amount || 0);
            const emp = l.employees;
            const canApprove = l.pay_status === 'pending';
            const canMarkPaid = l.pay_status === 'approved';
            return `
            <tr class="border-t border-[#e6edf7] ${l.pay_status === 'needs_review' ? 'bg-red-50/50' : ''}">
                <td class="p-3 font-bold">${emp ? emp.full_name : l.emp_id} <span class="text-xs text-slate-400 block">${l.emp_id}</span></td>
                <td class="p-3 text-right">${fmtMoney(l.base_salary)}</td>
                <td class="p-3 text-right">${fmtMoney(otTotal)}</td>
                <td class="p-3 text-right font-bold">${fmtMoney(l.gross_pay)}</td>
                <td class="p-3 text-right text-red-600">-${fmtMoney(l.social_security_employee)}</td>
                <td class="p-3 text-right text-red-600">-${fmtMoney(l.withholding_tax)}</td>
                <td class="p-3 text-right text-red-600">-${fmtMoney(l.advance_deduction)}</td>
                <td class="p-3 text-right font-bold text-kcblue">${fmtMoney(l.net_pay)}</td>
                <td class="p-3 text-center">${payStatusLabel[l.pay_status] || l.pay_status}</td>
                <td class="p-3 text-center whitespace-nowrap">
                    <button onclick="viewLineDetail('${l.id}')" class="border border-[#e6edf7] bg-white text-slate-700 px-2 py-1 text-xs font-bold hover:bg-kclight transition-colors cursor-pointer rounded-lg mb-1">🔍 ดู</button>
                    ${canApprove ? `<button onclick="approveLine('${l.id}')" class="bg-emerald-600 text-white px-2 py-1 text-xs font-bold hover:bg-emerald-700 transition-colors cursor-pointer rounded-lg mb-1">✅ อนุมัติ</button>` : ''}
                    ${canMarkPaid ? `<button onclick="markLinePaid('${l.id}')" class="bg-kcblue text-white px-2 py-1 text-xs font-bold hover:bg-kcdark transition-colors cursor-pointer rounded-lg mb-1">💸 จ่ายแล้ว</button>` : ''}
                </td>
            </tr>`;
        }).join('');
    } catch (err) {
        console.error(err);
        tbody.innerHTML = `<tr><td colspan="10" class="p-8 text-center text-red-600">เกิดข้อผิดพลาด: ${err.message}</td></tr>`;
    }
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
                        <td class="p-1">${d.description || d.detail_type}</td>
                        <td class="p-1 text-right">${d.quantity != null ? d.quantity : '-'}</td>
                        <td class="p-1 text-right">${d.rate != null ? fmtMoney(d.rate) : '-'}</td>
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
        alert('เกิดข้อผิดพลาด: ' + err.message);
    }
}
function closeLineDetailModal() {
    document.getElementById('lineDetailModal').classList.add('hidden');
    document.getElementById('lineDetailModal').classList.remove('flex');
}

async function approveLine(lineId) {
    if (!confirm('ยืนยันอนุมัติรายการเงินเดือนนี้?')) return;
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
        alert('เกิดข้อผิดพลาด: ' + err.message);
    }
}

async function markLinePaid(lineId) {
    if (!confirm('ยืนยันว่าจ่ายเงินให้พนักงานคนนี้แล้ว?')) return;
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
        alert('เกิดข้อผิดพลาด: ' + err.message);
    }
}

async function approveAllReadyLines() {
    if (!currentLinesRunId) { alert('กรุณาเลือก payroll run ก่อน'); return; }
    if (!confirm('ยืนยันอนุมัติทุกรายการที่ไม่มีสถานะ "ต้องตรวจสอบ" ใน run นี้?')) return;
    try {
        const { data: lines, error: fetchErr } = await supabaseClient
            .from('payroll_lines')
            .select('id')
            .eq('payroll_run_id', currentLinesRunId)
            .eq('pay_status', 'pending');
        if (fetchErr) throw fetchErr;
        if (!lines || lines.length === 0) { alert('ไม่มีรายการที่รออนุมัติ'); return; }
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
        alert('เกิดข้อผิดพลาด: ' + err.message);
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
};

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
                <td class="p-3 text-right">${r.rate_type.startsWith('social_security') ? (Number(r.rate_value) * 100).toFixed(2) + '%' : Number(r.rate_value).toFixed(2) + 'x'}</td>
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
        alert('กรุณากรอกค่าอัตราและวันที่มีผลให้ครบถ้วน');
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
        alert('เกิดข้อผิดพลาด: ' + err.message);
    }
}
