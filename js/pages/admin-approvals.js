// js/pages/admin-approvals.js
// Admin Portal: อนุมัติคำขอลา (leave_requests - บริษัททั้งหมด, สำรอง/ตรวจสอบซ้ำกับหัวหน้างานฝั่ง ESS)
// และคำขอแก้ไขเวลา (attendance_correction_requests - เฉพาะ fallback ที่พนักงานไม่มีหัวหน้างานประจำไซต์)
// ใช้ window.EmployeeSelfService (js/services/employeeSelfService.js) ร่วมกับฝั่ง ESS แทนการเขียนซ้ำ

document.addEventListener('DOMContentLoaded', () => {
    loadLeaveApprovals();
});

function switchApprovalTab(tab) {
    ['leave', 'correction'].forEach(t => {
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
    if (tab === 'correction') loadCorrectionApprovals();
}

function fmtDateTh(d) {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ============================================================
// TAB 1: คำขอลา
// ============================================================
async function loadLeaveApprovals() {
    const listEl = document.getElementById('leaveApprovalList');
    listEl.innerHTML = '<p class="text-center text-slate-400 text-sm py-6 font-bold">⏳ กำลังโหลดข้อมูล...</p>';
    try {
        const list = await window.EmployeeSelfService.getPendingLeaveApprovals();
        if (!list || list.length === 0) {
            listEl.innerHTML = '<p class="text-center text-slate-400 text-sm py-6 font-bold">ไม่มีคำขอลาที่รออนุมัติในขณะนี้</p>';
            return;
        }
        listEl.innerHTML = list.map(item => `
            <div class="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <p class="text-sm font-bold text-kcdark">🏖️ ${item.employees?.full_name || item.emp_id} <span class="text-xs text-slate-400 font-mono">(${item.employees?.emp_id || item.emp_id})</span></p>
                <p class="text-xs text-slate-500 mt-0.5">${item.leave_types?.name_th || 'ลา'} — ${fmtDateTh(item.start_date)} ถึง ${fmtDateTh(item.end_date)} (${item.total_days} วัน)</p>
                <p class="text-xs text-slate-600 mt-1">เหตุผล: ${item.reason || '-'}</p>
                ${item.attachment_url ? `<a href="${item.attachment_url}" target="_blank" class="text-xs font-bold text-kcblue hover:underline">📎 ดูหลักฐาน</a>` : ''}
                <div class="flex gap-2 mt-3">
                    <button onclick="approveApprovalItem('${item.id}', 'leave')" class="bg-emerald-600 text-white px-3 py-1.5 text-xs font-bold hover:bg-emerald-700 border-0 cursor-pointer rounded-full transition-colors">✅ อนุมัติ</button>
                    <button onclick="openApprovalRejectModal('${item.id}', 'leave')" class="bg-red-500 text-white px-3 py-1.5 text-xs font-bold hover:bg-red-600 border-0 cursor-pointer rounded-full transition-colors">❌ ไม่อนุมัติ</button>
                </div>
            </div>
        `).join('');
    } catch (err) {
        console.error('loadLeaveApprovals error', err);
        listEl.innerHTML = `<p class="text-center text-red-500 text-sm py-6">❌ โหลดข้อมูลผิดพลาด: ${err.message}</p>`;
    }
}

// ============================================================
// TAB 2: คำขอแก้ไขเวลา (fallback - ไม่มีหัวหน้างาน)
// ============================================================
async function loadCorrectionApprovals() {
    const listEl = document.getElementById('correctionApprovalList');
    listEl.innerHTML = '<p class="text-center text-slate-400 text-sm py-6 font-bold">⏳ กำลังโหลดข้อมูล...</p>';
    try {
        const list = await window.EmployeeSelfService.getPendingCorrectionApprovalsAdminFallback();
        if (!list || list.length === 0) {
            listEl.innerHTML = '<p class="text-center text-slate-400 text-sm py-6 font-bold">ไม่มีคำขอแก้ไขเวลาที่รออนุมัติในขณะนี้</p>';
            return;
        }
        listEl.innerHTML = list.map(item => `
            <div class="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <p class="text-sm font-bold text-kcdark">✏️ ${item.employees?.full_name || item.emp_id} <span class="text-xs text-slate-400 font-mono">(${item.employees?.emp_id || item.emp_id})</span></p>
                <p class="text-xs text-slate-500 mt-0.5">วันที่ ${fmtDateTh(item.work_date)} — ขอเป็น ${item.requested_check_in || '--:--'} ถึง ${item.requested_check_out || '--:--'}${item.clients?.client_name ? ` — ไซต์: ${item.clients.client_name}` : ''}</p>
                <p class="text-xs text-slate-600 mt-1">เหตุผล: ${item.reason}</p>
                ${item.attachment_url ? `<a href="${item.attachment_url}" target="_blank" class="text-xs font-bold text-kcblue hover:underline">📎 ดูหลักฐาน</a>` : ''}
                <div class="flex gap-2 mt-3">
                    <button onclick="approveApprovalItem('${item.id}', 'correction')" class="bg-emerald-600 text-white px-3 py-1.5 text-xs font-bold hover:bg-emerald-700 border-0 cursor-pointer rounded-full transition-colors">✅ อนุมัติ</button>
                    <button onclick="openApprovalRejectModal('${item.id}', 'correction')" class="bg-red-500 text-white px-3 py-1.5 text-xs font-bold hover:bg-red-600 border-0 cursor-pointer rounded-full transition-colors">❌ ไม่อนุมัติ</button>
                </div>
            </div>
        `).join('');
    } catch (err) {
        console.error('loadCorrectionApprovals error', err);
        listEl.innerHTML = `<p class="text-center text-red-500 text-sm py-6">❌ โหลดข้อมูลผิดพลาด: ${err.message}</p>`;
    }
}

// ============================================================
// Approve / Reject (ใช้ร่วมกันทั้ง 2 แท็บ แยก routing ด้วย type)
// ============================================================
async function approveApprovalItem(id, type) {
    if (!confirm('ยืนยันอนุมัติคำขอนี้?')) return;
    try {
        if (type === 'leave') {
            await window.EmployeeSelfService.approveLeaveRequest(id, window.currentUserProfile?.id);
        } else {
            await window.EmployeeSelfService.approveCorrectionRequest(id);
        }
        if (type === 'leave') { await loadLeaveApprovals(); } else { await loadCorrectionApprovals(); }
    } catch (err) {
        console.error('approveApprovalItem error', err);
        alert('❌ อนุมัติไม่สำเร็จ: ' + err.message);
    }
}

function openApprovalRejectModal(id, type) {
    document.getElementById('approvalRejectRequestId').value = id;
    document.getElementById('approvalRejectType').value = type;
    document.getElementById('approvalRejectReason').value = '';
    document.getElementById('approvalRejectModal').classList.remove('hidden');
    document.getElementById('approvalRejectModal').classList.add('flex');
}
function closeApprovalRejectModal() {
    document.getElementById('approvalRejectModal').classList.add('hidden');
    document.getElementById('approvalRejectModal').classList.remove('flex');
}

async function confirmRejectApproval() {
    const id = document.getElementById('approvalRejectRequestId').value;
    const type = document.getElementById('approvalRejectType').value;
    const reason = document.getElementById('approvalRejectReason').value.trim();
    try {
        if (type === 'leave') {
            await window.EmployeeSelfService.rejectLeaveRequest(id, reason);
        } else {
            await window.EmployeeSelfService.rejectCorrectionRequest(id, reason);
        }
        closeApprovalRejectModal();
        if (type === 'leave') { await loadLeaveApprovals(); } else { await loadCorrectionApprovals(); }
    } catch (err) {
        console.error('confirmRejectApproval error', err);
        alert('❌ ดำเนินการไม่สำเร็จ: ' + err.message);
    }
}
