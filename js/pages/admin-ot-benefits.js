// js/pages/admin-ot-benefits.js
// Admin Portal: ตรวจสอบคำขอโอทีชั้น admin/payroll (pending_admin_review + fallback ไม่มีหัวหน้างาน),
// ตั้งค่าเพดานชั่วโมงโอที (ot_policy_settings), และจัดการสวัสดิการรายพนักงาน
// (employee_benefit_assignments + employees.sso_hospital_*)

const COMPANY_ID = 'comp_kc_clean'; // ระบบ single-tenant ในตอนนี้ (เหมือน pattern เดิมทั่วทั้งระบบ)

document.addEventListener('DOMContentLoaded', () => {
    loadOtAdminReview();

    const policyForm = document.getElementById('otPolicyForm');
    if (policyForm) {
        loadOtPolicySettings();
        policyForm.addEventListener('submit', saveOtPolicySettings);
    }

    const empSelect = document.getElementById('benefitsEmployeeSelect');
    if (empSelect) {
        loadEmployeesForBenefitsSelect();
        empSelect.addEventListener('change', onBenefitsEmployeeChange);
    }
});

// ============================================================
// Tab switching
// ============================================================
function switchAdminTab(tab) {
    ['ot', 'policy', 'benefits'].forEach(t => {
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

// ============================================================
// TAB 1: คำขอโอทีรอตรวจสอบชั้น admin/payroll
// ครอบคลุม 2 กรณี: (1) resolved_approver_role='admin' status='pending' (fallback ไม่มีหัวหน้างาน)
// (2) status='pending_admin_review' (หัวหน้างานอนุมัติแล้วแต่เกินเพดาน ต้องตรวจสอบเพิ่ม)
// ============================================================
const otAdminStatusLabel = {
    pending: '<span class="bg-amber-100 text-amber-700 px-2 py-1 text-xs font-bold border border-amber-300">รอ admin (ไม่มีหัวหน้างาน)</span>',
    pending_admin_review: '<span class="bg-red-100 text-red-700 px-2 py-1 text-xs font-bold border border-red-300">เกินเพดาน - รอตรวจสอบ</span>'
};

async function loadOtAdminReview() {
    const tbody = document.getElementById('otReviewTableBody');
    tbody.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-slate-500">⏳ กำลังโหลดข้อมูล...</td></tr>';
    try {
        const { data, error } = await supabaseClient
            .from('ot_requests')
            .select('*, employees(full_name, emp_id)')
            .eq('company_id', COMPANY_ID)
            .in('status', ['pending_admin_review'])
            .order('created_at', { ascending: true });
        if (error) throw error;

        const { data: fallbackData, error: fallbackErr } = await supabaseClient
            .from('ot_requests')
            .select('*, employees(full_name, emp_id)')
            .eq('company_id', COMPANY_ID)
            .eq('status', 'pending')
            .eq('resolved_approver_role', 'admin')
            .order('created_at', { ascending: true });
        if (fallbackErr) throw fallbackErr;

        const merged = [...(data || []), ...(fallbackData || [])];
        if (merged.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-slate-500">ไม่มีคำขอโอทีที่ต้องตรวจสอบในขณะนี้</td></tr>';
            return;
        }
        tbody.innerHTML = merged.map(item => `
            <tr class="border-b border-[#e6edf7] hover:bg-kcsoft transition-colors">
                <td class="p-4">${item.employees?.full_name || item.emp_id} <span class="text-slate-400 font-mono text-xs">(${item.employees?.emp_id || item.emp_id})</span></td>
                <td class="p-4">${item.work_date}<br><span class="text-slate-500 text-xs">${item.requested_hours} ชม. (${item.requested_start || '--:--'}-${item.requested_end || '--:--'})</span></td>
                <td class="p-4 text-slate-600">${item.reason || '-'}</td>
                <td class="p-4 text-xs text-slate-600">สัปดาห์: ${item.projected_weekly_ot_hours ?? '-'} ชม.<br>เดือน: ${item.projected_monthly_ot_hours ?? '-'} ชม.</td>
                <td class="p-4 text-center">${otAdminStatusLabel[item.status] || item.status}</td>
                <td class="p-4 text-center">
                    <div class="flex gap-2 justify-center">
                        <button onclick="approveOtAdmin('${item.id}')" class="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 text-xs font-bold shadow-sm transition-colors cursor-pointer">✅ อนุมัติ</button>
                        <button onclick="openOtRejectModal('${item.id}')" class="rounded-xl bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 text-xs font-bold shadow-sm transition-colors cursor-pointer">❌ ปฏิเสธ</button>
                    </div>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('loadOtAdminReview error', err);
        tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-red-500">❌ โหลดข้อมูลผิดพลาด: ${err.message}</td></tr>`;
    }
}

async function approveOtAdmin(requestId) {
    if (!confirm('ยืนยันอนุมัติคำขอโอทีนี้?')) return;
    try {
        const { error } = await supabaseClient
            .from('ot_requests')
            .update({ status: 'approved', admin_reviewed_at: new Date().toISOString() })
            .eq('id', requestId);
        if (error) throw error;
        alert('✅ อนุมัติคำขอสำเร็จ');
        await loadOtAdminReview();
    } catch (err) {
        console.error('approveOtAdmin error', err);
        alert('❌ อนุมัติไม่สำเร็จ: ' + err.message);
    }
}

function openOtRejectModal(requestId) {
    document.getElementById('otRejectRequestId').value = requestId;
    document.getElementById('otRejectReason').value = '';
    document.getElementById('otRejectModal').classList.remove('hidden');
    document.getElementById('otRejectModal').classList.add('flex');
}
function closeOtRejectModal() {
    document.getElementById('otRejectModal').classList.add('hidden');
    document.getElementById('otRejectModal').classList.remove('flex');
}
async function confirmRejectOt() {
    const requestId = document.getElementById('otRejectRequestId').value;
    const reason = document.getElementById('otRejectReason').value.trim();
    try {
        const { error } = await supabaseClient
            .from('ot_requests')
            .update({ status: 'rejected', rejection_reason: reason || null, admin_reviewed_at: new Date().toISOString() })
            .eq('id', requestId);
        if (error) throw error;
        alert('✅ บันทึกการปฏิเสธสำเร็จ');
        closeOtRejectModal();
        await loadOtAdminReview();
    } catch (err) {
        console.error('confirmRejectOt error', err);
        alert('❌ ดำเนินการไม่สำเร็จ: ' + err.message);
    }
}

// ============================================================
// TAB 2: ตั้งค่าเพดานโอที (ot_policy_settings)
// ============================================================
async function loadOtPolicySettings() {
    try {
        const { data, error } = await supabaseClient
            .from('ot_policy_settings')
            .select('*')
            .eq('company_id', COMPANY_ID)
            .single();
        if (error) throw error;
        document.getElementById('policyDailyMax').value = data.daily_max_hours;
        document.getElementById('policyWeeklyMax').value = data.weekly_max_hours;
        document.getElementById('policyMonthlyMax').value = data.monthly_max_hours;
    } catch (err) {
        console.error('loadOtPolicySettings error', err);
        alert('❌ โหลดการตั้งค่าไม่สำเร็จ: ' + err.message);
    }
}

async function saveOtPolicySettings(e) {
    e.preventDefault();
    const dailyMax = parseFloat(document.getElementById('policyDailyMax').value);
    const weeklyMax = parseFloat(document.getElementById('policyWeeklyMax').value);
    const monthlyMax = parseFloat(document.getElementById('policyMonthlyMax').value);
    try {
        const { error } = await supabaseClient
            .from('ot_policy_settings')
            .update({
                daily_max_hours: dailyMax,
                weekly_max_hours: weeklyMax,
                monthly_max_hours: monthlyMax,
                updated_at: new Date().toISOString()
            })
            .eq('company_id', COMPANY_ID);
        if (error) throw error;
        alert('✅ บันทึกการตั้งค่าสำเร็จ');
    } catch (err) {
        console.error('saveOtPolicySettings error', err);
        alert('❌ บันทึกไม่สำเร็จ: ' + err.message);
    }
}

// ============================================================
// TAB 3: สวัสดิการพนักงาน
// ============================================================
let benefitTypesCache = [];

async function loadEmployeesForBenefitsSelect() {
    const select = document.getElementById('benefitsEmployeeSelect');
    try {
        const { data, error } = await supabaseClient
            .from('employees')
            .select('id, emp_id, full_name')
            .not('emp_id', 'is', null)
            .order('full_name', { ascending: true });
        if (error) throw error;
        select.innerHTML = '<option value="">-- เลือกพนักงาน --</option>' +
            (data || []).map(e => `<option value="${e.id}">${e.full_name} (${e.emp_id})</option>`).join('');
    } catch (err) {
        console.error('loadEmployeesForBenefitsSelect error', err);
    }

    try {
        const { data: types, error: typesErr } = await supabaseClient
            .from('benefit_types')
            .select('*')
            .eq('company_id', COMPANY_ID)
            .eq('is_active', true)
            .order('code', { ascending: true });
        if (typesErr) throw typesErr;
        benefitTypesCache = types || [];
    } catch (err) {
        console.error('load benefit_types error', err);
    }
}

async function onBenefitsEmployeeChange() {
    const employeeId = document.getElementById('benefitsEmployeeSelect').value;
    const editArea = document.getElementById('benefitsEditArea');
    if (!employeeId) { editArea.classList.add('hidden'); return; }
    editArea.classList.remove('hidden');
    editArea.dataset.employeeId = employeeId;

    try {
        const { data, error } = await supabaseClient
            .from('employees')
            .select('sso_hospital_name, sso_hospital_code, sso_registered_at')
            .eq('id', employeeId)
            .single();
        if (error) throw error;
        document.getElementById('benefitsSsoHospitalName').value = data.sso_hospital_name || '';
        document.getElementById('benefitsSsoHospitalCode').value = data.sso_hospital_code || '';
        document.getElementById('benefitsSsoRegisteredAt').value = data.sso_registered_at || '';
    } catch (err) {
        console.error('load employee sso info error', err);
    }

    await loadBenefitsAssignmentList(employeeId);
}

async function saveSsoHospitalInfo() {
    const employeeId = document.getElementById('benefitsEditArea').dataset.employeeId;
    if (!employeeId) return;
    const hospitalName = document.getElementById('benefitsSsoHospitalName').value.trim() || null;
    const hospitalCode = document.getElementById('benefitsSsoHospitalCode').value.trim() || null;
    const registeredAt = document.getElementById('benefitsSsoRegisteredAt').value || null;
    try {
        const { error } = await supabaseClient
            .from('employees')
            .update({ sso_hospital_name: hospitalName, sso_hospital_code: hospitalCode, sso_registered_at: registeredAt })
            .eq('id', employeeId);
        if (error) throw error;
        alert('✅ บันทึกข้อมูลประกันสังคมสำเร็จ');
    } catch (err) {
        console.error('saveSsoHospitalInfo error', err);
        alert('❌ บันทึกไม่สำเร็จ: ' + err.message);
    }
}

async function loadBenefitsAssignmentList(employeeId) {
    const listEl = document.getElementById('benefitsAssignmentList');
    listEl.innerHTML = '<p class="text-center text-slate-400 text-sm py-4">กำลังโหลดข้อมูล...</p>';
    try {
        const { data: assignments, error } = await supabaseClient
            .from('employee_benefit_assignments')
            .select('*')
            .eq('employee_id', employeeId)
            .is('effective_to', null);
        if (error) throw error;

        const activeTypeIds = new Set((assignments || []).map(a => a.benefit_type_id));

        listEl.innerHTML = benefitTypesCache.map(type => {
            const isActive = activeTypeIds.has(type.id);
            const assignment = (assignments || []).find(a => a.benefit_type_id === type.id);
            return `
                <div class="flex items-center justify-between rounded-xl border border-[#e6edf7] p-3 bg-white">
                    <div>
                        <p class="text-sm font-bold text-kcdark">${type.name_th}</p>
                        <p class="text-xs text-slate-500">${type.description || ''}</p>
                    </div>
                    ${isActive
                        ? `<button onclick="removeBenefitAssignment('${assignment.id}', '${employeeId}')" class="rounded-xl bg-red-100 text-red-700 border border-red-200 px-3 py-1.5 text-xs font-bold hover:bg-red-200 transition-colors cursor-pointer">✅ ได้รับอยู่ - เอาออก</button>`
                        : `<button onclick="addBenefitAssignment('${type.id}', '${employeeId}')" class="rounded-xl bg-kclight text-kcdark px-3 py-1.5 text-xs font-bold hover:bg-[#e6edf7] transition-colors cursor-pointer">+ เพิ่มให้พนักงานนี้</button>`}
                </div>
            `;
        }).join('') || '<p class="text-center text-slate-400 text-sm py-4">ยังไม่มีประเภทสวัสดิการในระบบ</p>';
    } catch (err) {
        console.error('loadBenefitsAssignmentList error', err);
        listEl.innerHTML = `<p class="text-center text-red-500 text-sm py-4">โหลดข้อมูลไม่สำเร็จ: ${err.message}</p>`;
    }
}

async function addBenefitAssignment(benefitTypeId, employeeId) {
    try {
        const { error } = await supabaseClient
            .from('employee_benefit_assignments')
            .insert([{ company_id: COMPANY_ID, employee_id: employeeId, benefit_type_id: benefitTypeId }]);
        if (error) throw error;
        await loadBenefitsAssignmentList(employeeId);
    } catch (err) {
        console.error('addBenefitAssignment error', err);
        alert('❌ เพิ่มไม่สำเร็จ: ' + err.message);
    }
}

// "เอาออก" = ปิดผลด้วย effective_to = วันนี้ (ไม่ hard delete เพื่อรักษาประวัติว่าเคยได้รับสวัสดิการนี้ช่วงไหน)
async function removeBenefitAssignment(assignmentId, employeeId) {
    if (!confirm('ยืนยันเอาสวัสดิการนี้ออกจากพนักงานคนนี้?')) return;
    try {
        const { error } = await supabaseClient
            .from('employee_benefit_assignments')
            .update({ effective_to: new Date().toISOString().slice(0, 10) })
            .eq('id', assignmentId);
        if (error) throw error;
        await loadBenefitsAssignmentList(employeeId);
    } catch (err) {
        console.error('removeBenefitAssignment error', err);
        alert('❌ ดำเนินการไม่สำเร็จ: ' + err.message);
    }
}
