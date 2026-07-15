document.addEventListener('DOMContentLoaded', () => {
    loadAttendanceLogs();
    loadClientsForAdmin();
});

// 🌐 ดึงประวัติการลงเวลาทั้งหมด
async function loadAttendanceLogs() {
    const tbody = document.getElementById('logsTableBody');
    tbody.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-gray-500">⏳ กำลังโหลดข้อมูล...</td></tr>';

    try {
        // ดึงข้อมูลเรียงจากวันล่าสุด
        const { data, error } = await supabaseClient
            .from('attendance_logs')
            .select('*')
            .order('work_date', { ascending: false })
            .order('check_in', { ascending: false });

        if (error) throw error;

        tbody.innerHTML = '';

        if (!data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-gray-500">ไม่มีประวัติการลงเวลา</td></tr>';
            return;
        }

        data.forEach(log => {
            const tr = document.createElement('tr');
            tr.className = 'border-b border-gray-100 hover:bg-gray-50 transition-colors';

            // ตรวจสอบสถานะว่าติดธงแดงหรือไม่
            const isFlagged = log.status === 'flagged';
            const statusBadge = isFlagged 
                ? '<span class="bg-red-100 text-red-700 px-2 py-1 text-xs font-bold border border-red-200">🔴 รอตรวจสอบ</span>'
                : '<span class="bg-green-100 text-green-700 px-2 py-1 text-xs font-bold border border-green-200">✅ ปกติ</span>';

            // ปุ่มจัดการ
            const actionBtn = isFlagged
                ? `<button onclick="openReviewModal('${log.id}', '${log.client_id}', '${log.photo_url || ''}', '${log.manual_override_reason || ''}')" class="bg-red-600 hover:bg-red-700 text-white px-3 py-1 text-xs font-bold shadow-sm">ตรวจสอบ</button>`
                : `<button class="bg-gray-100 text-gray-400 px-3 py-1 text-xs font-bold cursor-not-allowed">สมบูรณ์</button>`;

            tr.innerHTML = `
                <td class="p-4">${log.work_date}</td>
                <td class="p-4 font-mono font-bold text-kcblue">${log.emp_id}</td>
                <td class="p-4 text-gray-600">${log.client_id}</td>
                <td class="p-4 font-mono">${log.check_in || '-'} / ${log.check_out || '-'}</td>
                <td class="p-4 text-center">${statusBadge}</td>
                <td class="p-4 text-center">${actionBtn}</td>
            `;
            tbody.appendChild(tr);
        });

    } catch (err) {
        console.error("Error fetching logs:", err);
        tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-red-500">❌ โหลดข้อมูลผิดพลาด: ${err.message}</td></tr>`;
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
function openReviewModal(logId, currentClientId, photoUrl, remark) {
    document.getElementById('currentLogId').value = logId;
    document.getElementById('adminSiteSelect').value = currentClientId;
    
    // จัดการข้อความ
    document.getElementById('modalRemark').textContent = remark || 'ไม่มีการแจ้งหมายเหตุเพิ่มเติม';

    // จัดการรูปภาพ
    const imgEl = document.getElementById('modalPhoto');
    const noPhotoEl = document.getElementById('modalNoPhoto');
    if (photoUrl && photoUrl !== 'null') {
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

// ✅ ยืนยันการแก้ไขข้อมูลและเคลียร์สถานะธงแดง
async function saveAdminCorrection() {
    const logId = document.getElementById('currentLogId').value;
    const newClientId = document.getElementById('adminSiteSelect').value;

    if (!newClientId) {
        alert("กรุณาเลือกไซต์งานที่ถูกต้อง");
        return;
    }

    if (confirm("ยืนยันการแก้ไขไซต์งานและอนุมัติการลงเวลานี้ใช่หรือไม่?")) {
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
            
            alert("✅ บันทึกการแก้ไขสำเร็จ!");
            closeReviewModal();
            loadAttendanceLogs(); // รีเฟรชตารางใหม่
            
        } catch (err) {
            console.error("Error updating log:", err);
            alert("❌ เกิดข้อผิดพลาด: " + err.message);
        }
    }
}