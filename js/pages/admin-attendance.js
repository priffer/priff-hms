document.addEventListener('DOMContentLoaded', () => {
    loadAttendanceLogs();
    loadClientsForAdmin();
});

const attendanceLogById = new Map();

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatBreakSource(source) {
    if (source === 'manual') return 'manual';
    if (source === 'policy') return 'policy';
    return '-';
}

// 🌐 ดึงประวัติการลงเวลาทั้งหมด
async function loadAttendanceLogs() {
    const tbody = document.getElementById('logsTableBody');
    tbody.innerHTML = '<tr><td colspan="8" class="p-8 text-center text-slate-500">⏳ กำลังโหลดข้อมูล...</td></tr>';

    try {
        // ดึงข้อมูลเรียงจากวันล่าสุด
        const { data, error } = await supabaseClient
            .from('attendance_logs')
            .select('*')
            .order('work_date', { ascending: false })
            .order('check_in', { ascending: false });

        if (error) throw error;

        tbody.innerHTML = '';
        attendanceLogById.clear();

        if (!data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="p-8 text-center text-slate-500">ไม่มีประวัติการลงเวลา</td></tr>';
            return;
        }

        data.forEach(log => {
            attendanceLogById.set(log.id, log);
            const tr = document.createElement('tr');
            tr.className = 'border-b border-[#e6edf7] hover:bg-kcsoft transition-colors';

            // ตรวจสอบสถานะว่าติดธงแดงหรือไม่
            const isFlagged = log.status === 'flagged';
            const statusBadge = isFlagged
                ? '<span class="bg-red-100 text-red-700 px-2 py-1 text-xs font-bold rounded-full border border-red-200">🔴 รอตรวจสอบ</span>'
                : '<span class="bg-green-100 text-green-700 px-2 py-1 text-xs font-bold rounded-full border border-green-200">✅ ปกติ</span>';

            const breakLabel = log.break_minutes == null
                ? '-'
                : `${escapeHtml(log.break_minutes)} <span class="text-xs text-slate-400">(${formatBreakSource(log.break_source)})</span>`;

            const reviewBtn = isFlagged
                ? `<button onclick="openReviewModal('${log.id}')" class="rounded-xl bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 text-xs font-bold shadow-sm transition-colors cursor-pointer">ตรวจสอบ</button>`
                : '';

            const actionBtn = `
                <div class="flex flex-wrap items-center justify-center gap-2">
                    ${reviewBtn}
                    <button onclick="openBreakModal('${log.id}')" class="rounded-xl border border-[#e6edf7] bg-white text-kcdark px-3 py-1.5 text-xs font-bold hover:bg-kclight transition-colors cursor-pointer">แก้ไขเบรก</button>
                </div>
            `;

            tr.innerHTML = `
                <td class="p-4">${escapeHtml(log.work_date)}</td>
                <td class="p-4 font-mono font-bold text-kcblue">${escapeHtml(log.emp_id)}</td>
                <td class="p-4 text-slate-600">${escapeHtml(log.client_id)}</td>
                <td class="p-4 font-mono">${escapeHtml(log.check_in || '-')} / ${escapeHtml(log.check_out || '-')}</td>
                <td class="p-4 text-center font-mono">${log.total_hours == null ? '-' : escapeHtml(log.total_hours)}</td>
                <td class="p-4 text-center font-mono">${breakLabel}</td>
                <td class="p-4 text-center">${statusBadge}</td>
                <td class="p-4 text-center">${actionBtn}</td>
            `;
            tbody.appendChild(tr);
        });

    } catch (err) {
        console.error("Error fetching logs:", err);
        tbody.innerHTML = `<tr><td colspan="8" class="p-8 text-center text-red-500">❌ โหลดข้อมูลผิดพลาด: ${escapeHtml(err.message)}</td></tr>`;
    }
}

// 🌐 โหลดรายชื่อไซต์งานทั้งหมดใส่ใน Dropdown ของหน้าต่างแก้ไข
async function loadClientsForAdmin() {
    const select = document.getElementById('adminSiteSelect');
    try {
        const { data, error } = await supabaseClient.from('clients').select('id, client_name');
        if (error) throw error;

        select.innerHTML = '<option value="">-- เลือกสถานที่ที่ถูกต้อง --</option>';
        data.forEach(site => {
            const opt = document.createElement('option');
            opt.value = site.id;
            opt.textContent = site.client_name;
            select.appendChild(opt);
        });
    } catch (err) {
        console.error("Error loading clients:", err);
    }
}

// 🔍 เปิดหน้าต่างตรวจสอบ
async function openReviewModal(logId) {
    const log = attendanceLogById.get(logId);
    if (!log) {
        await PriffConfirm.alert('ไม่พบข้อมูลการลงเวลานี้', { variant: 'error' });
        return;
    }

    document.getElementById('currentLogId').value = log.id;
    document.getElementById('adminSiteSelect').value = log.client_id || '';

    // จัดการข้อความ
    document.getElementById('modalRemark').textContent = log.manual_override_reason || 'ไม่มีการแจ้งหมายเหตุเพิ่มเติม';

    // จัดการรูปภาพ
    const photoUrl = log.photo_url;
    const imgEl = document.getElementById('modalPhoto');
    const noPhotoEl = document.getElementById('modalNoPhoto');
    if (photoUrl) {
        imgEl.src = photoUrl;
        imgEl.classList.remove('hidden');
        noPhotoEl.classList.add('hidden');
    } else {
        imgEl.classList.add('hidden');
        noPhotoEl.classList.remove('hidden');
    }

    document.getElementById('reviewModal').classList.remove('hidden');
    document.getElementById('reviewModal').classList.add('flex');
}

function closeReviewModal() {
    document.getElementById('reviewModal').classList.add('hidden');
    document.getElementById('reviewModal').classList.remove('flex');
}

async function openBreakModal(logId) {
    const log = attendanceLogById.get(logId);
    if (!log) {
        await PriffConfirm.alert('ไม่พบข้อมูลการลงเวลานี้', { variant: 'error' });
        return;
    }

    document.getElementById('breakLogId').value = log.id;
    document.getElementById('breakMinutesInput').value = log.break_minutes == null ? '' : String(log.break_minutes);
    document.getElementById('breakModalMeta').textContent =
        `${log.work_date || '-'} · ${log.emp_id || '-'} · ${log.check_in || '-'} / ${log.check_out || '-'} · สุทธิ ${log.total_hours == null ? '-' : log.total_hours} ชม.`;
    document.getElementById('breakModalSource').textContent =
        `แหล่งเบรกปัจจุบัน: ${formatBreakSource(log.break_source)}`;

    document.getElementById('breakModal').classList.remove('hidden');
    document.getElementById('breakModal').classList.add('flex');
}

function closeBreakModal() {
    document.getElementById('breakModal').classList.add('hidden');
    document.getElementById('breakModal').classList.remove('flex');
}

async function resolveBreakUpdatedBy() {
    try {
        const profile = await window.PriffAuthGuard?.getCurrentUserProfile?.();
        return profile?.id || null;
    } catch (err) {
        console.warn('Could not resolve profile for break_updated_by', err);
        return null;
    }
}

async function saveBreakMinutes() {
    const logId = document.getElementById('breakLogId').value;
    const rawMinutes = document.getElementById('breakMinutesInput').value;
    const breakMinutes = Number(rawMinutes);

    if (rawMinutes === '' || !Number.isFinite(breakMinutes) || !Number.isInteger(breakMinutes)) {
        await PriffConfirm.alert('กรุณาระบุเบรกเป็นจำนวนเต็มนาที', { variant: 'error' });
        return;
    }
    if (breakMinutes < 0 || breakMinutes > 1440) {
        await PriffConfirm.alert('เบรกต้องอยู่ระหว่าง 0–1440 นาที', { variant: 'error' });
        return;
    }

    if (!(await PriffConfirm.confirm(`ยืนยันตั้งเบรก ${breakMinutes} นาที (manual) ใช่หรือไม่?`))) return;

    try {
        const breakUpdatedBy = await resolveBreakUpdatedBy();
        const payload = {
            break_minutes: breakMinutes,
            break_source: 'manual',
        };
        if (breakUpdatedBy) payload.break_updated_by = breakUpdatedBy;

        const { error } = await supabaseClient
            .from('attendance_logs')
            .update(payload)
            .eq('id', logId);

        if (error) throw error;

        await PriffConfirm.alert('บันทึกเบรกสำเร็จ');
        closeBreakModal();
        loadAttendanceLogs();
    } catch (err) {
        console.error('Error updating break minutes:', err);
        await PriffConfirm.alert('เกิดข้อผิดพลาด: ' + err.message, { variant: 'error' });
    }
}

async function resetBreakToPolicy() {
    const logId = document.getElementById('breakLogId').value;
    if (!(await PriffConfirm.confirm('ยืนยันให้ระบบคำนวณเบรกตาม policy อัตโนมัติอีกครั้งใช่หรือไม่?'))) return;

    try {
        // Clearing source lets the BEFORE trigger re-apply company policy.
        const { error } = await supabaseClient
            .from('attendance_logs')
            .update({
                break_source: null,
                break_updated_by: null,
            })
            .eq('id', logId);

        if (error) throw error;

        await PriffConfirm.alert('กลับไปใช้ break policy แล้ว');
        closeBreakModal();
        loadAttendanceLogs();
    } catch (err) {
        console.error('Error resetting break to policy:', err);
        await PriffConfirm.alert('เกิดข้อผิดพลาด: ' + err.message, { variant: 'error' });
    }
}

// ✅ ยืนยันการแก้ไขข้อมูลและเคลียร์สถานะธงแดง
async function saveAdminCorrection() {
    const logId = document.getElementById('currentLogId').value;
    const newClientId = document.getElementById('adminSiteSelect').value;

    if (!newClientId) {
        await PriffConfirm.alert('กรุณาเลือกไซต์งานที่ถูกต้อง', { variant: 'error' });
        return;
    }

    if (!(await PriffConfirm.confirm('ยืนยันการแก้ไขไซต์งานและอนุมัติการลงเวลานี้ใช่หรือไม่?'))) return;

    try {
        // อัปเดตตาราง: เปลี่ยน client_id และเปลี่ยนสถานะกลับเป็น present
        const { error } = await supabaseClient
            .from('attendance_logs')
            .update({
                client_id: newClientId,
                status: 'present',
                manual_override_reason: 'Resolved by Admin' // ล้างค่าหรือใส่โน้ตแอดมินทับ
            })
            .eq('id', logId);

        if (error) throw error;

        await PriffConfirm.alert('บันทึกการแก้ไขสำเร็จ!');
        closeReviewModal();
        loadAttendanceLogs(); // รีเฟรชตารางใหม่
    } catch (err) {
        console.error('Error updating log:', err);
        await PriffConfirm.alert('เกิดข้อผิดพลาด: ' + err.message, { variant: 'error' });
    }
}
