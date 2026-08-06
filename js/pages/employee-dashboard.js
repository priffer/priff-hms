let streamInstance = null;
let currentLatitude = null;
let currentLongitude = null;
let clockInterval = null;

document.addEventListener('DOMContentLoaded', () => {
    checkEmployeeSession();
    startClock();
});

// 🔔 ฟังก์ชันแจ้งเตือนแบบโมเดิร์น (แทน window.alert เก่า)
function showToast(message, duration = 3000) {
    const toast = document.getElementById('globalToast');
    const msgSpan = document.getElementById('toastMessage');
    if (!toast || !msgSpan) return;
    
    msgSpan.textContent = message;
    toast.classList.remove('hidden');
    toast.classList.add('flex');
    
    setTimeout(() => {
        toast.classList.add('hidden');
        toast.classList.remove('flex');
    }, duration);
}

// Session handling: use Supabase Auth + user_profiles instead of legacy localStorage
async function checkEmployeeSession() {
    try {
        // If auth-guard has run, window.currentUserProfile should be set; otherwise try fetching via helper
        let profile = window.currentUserProfile;
        if (!profile && window.PriffAuthGuard && typeof window.PriffAuthGuard.getCurrentUserProfile === 'function') {
            profile = await window.PriffAuthGuard.getCurrentUserProfile();
            window.currentUserProfile = profile;
        }
        if (!profile) {
            window.location.href = 'employee-login.html';
            return;
        }
        document.getElementById('empNameDisplay').textContent = profile.display_name || profile.full_name || 'พนักงาน';
        document.getElementById('empIdDisplay').textContent = profile.employee_emp_id || profile.emp_id || '';
        advanceEligibleCache = await computeAdvanceEligibility(profile);
        applyAdvanceEligibilityUI();
    } catch (err) {
        console.error("Session/profile error", err);
        // Fallback: redirect to login
        window.location.href = 'employee-login.html';
    }
}

// ขอเบิกเงินล่วงหน้า: จำกัดเฉพาะพนักงานปฏิบัติการที่ผูกไซต์ลูกค้าประจำแล้ว (primary_client_id
// สำหรับ role employee, หรือมีไซต์ที่ดูแลอย่างน้อย 1 ไซต์ผ่าน supervisor_client_assignments
// สำหรับ role supervisor) พนักงานออฟฟิศ (ไม่ผูกไซต์) จะเห็นปุ่มแบบจางลงพร้อมป้ายอธิบาย
// แทนที่จะซ่อนปุ่มไปเลย เพื่อไม่ให้สับสนว่าเป็น bug - บังคับจริงอีกชั้นที่ RLS
// (database/11_advance_payment_eligibility.sql, public.is_site_assigned_employee())
let advanceEligibleCache = false;

async function computeAdvanceEligibility(profile) {
    if (!profile) return false;
    if (profile.primary_client_id) return true;
    if (profile.role === 'supervisor') {
        try {
            const { count, error } = await supabaseClient
                .from('supervisor_client_assignments')
                .select('id', { count: 'exact', head: true })
                .eq('user_profile_id', profile.id);
            if (error) throw error;
            return (count || 0) > 0;
        } catch (err) {
            console.error('computeAdvanceEligibility (supervisor) error', err);
            return false;
        }
    }
    return false;
}

function isAdvanceEligible() {
    return advanceEligibleCache;
}

function applyAdvanceEligibilityUI() {
    const btn = document.getElementById('advanceCardBtn');
    const badge = document.getElementById('advanceEligibilityBadge');
    if (!btn) return;
    if (!isAdvanceEligible()) {
        btn.classList.add('opacity-50', 'grayscale', 'hover:!translate-y-0', 'hover:!shadow-none');
        if (badge) badge.classList.remove('hidden');
    } else {
        btn.classList.remove('opacity-50', 'grayscale', 'hover:!translate-y-0', 'hover:!shadow-none');
        if (badge) badge.classList.add('hidden');
    }
}

function startClock() {
    const timeDisplay = document.getElementById('currentTimeDisplay');
    const dateDisplay = document.getElementById('currentDateDisplay');
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };

    setInterval(() => {
        const now = new Date();
        if (timeDisplay) timeDisplay.textContent = now.toLocaleTimeString('th-TH', { hour12: false });
        if (dateDisplay) dateDisplay.textContent = now.toLocaleDateString('th-TH', options);
    }, 1000);
}

// 🌐 โหลดรายชื่อไซต์งานลูกค้าจากตาราง clients มาให้พนักงานเลือก
async function loadWorkSites() {
    const select = document.getElementById('workSiteSelect');
    if (!select) return;
    
    try {
        const { data, error } = await supabaseClient
            .from('clients')
            .select('id, client_name');
            
        if (error) throw error;
        
        select.innerHTML = '<option value="">-- เลือกสถานที่ปฏิบัติงาน --</option>';
        if (data && data.length > 0) {
            data.forEach(site => {
                const opt = document.createElement('option');
                opt.value = site.id;
                opt.textContent = site.client_name;
                select.appendChild(opt);
            });
        } else {
            select.innerHTML = '<option value="">❌ ไม่มีรายชื่อไซต์งานในระบบ</option>';
        }
    } catch (err) {
        console.error("Error loading sites:", err);
        select.innerHTML = '<option value="">❌ โหลดข้อมูลผิดพลาด</option>';
    }
}

// 📸 🛰️ เปิดระบบกล้องเช็คอินและติดตามพิกัด GPS
async function openTimestampCamera() {
    const modal = document.getElementById('cameraModal');
    const video = document.getElementById('webcamVideo');
    const snapBtn = document.getElementById('snapBtn');
    
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
    
    await loadWorkSites();
    startCameraClock();

    // 1. เรียกเปิดกล้องสด (รองรับทั้งกล้องหน้ามือถือและคอมพิวเตอร์)
    try {
        streamInstance = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "user" },
            audio: false
        });
        if (video) video.srcObject = streamInstance;
    } catch (err) {
        console.error("Camera error:", err);
        showToast("❌ ไม่สามารถเข้าถึงกล้องถ่ายรูปได้ กรุณาอนุญาตสิทธิ์การใช้กล้อง");
    }

    // 2. เรียกจับพิกัด GPS จากดาวเทียมบนโทรศัพท์มือถือ
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                currentLatitude = position.coords.latitude;
                currentLongitude = position.coords.longitude;
                
                document.getElementById('gpsStatusText').textContent = `🛰️ GPS: ${currentLatitude.toFixed(5)}, ${currentLongitude.toFixed(5)}`;
                
                // เมื่อ GPS พร้อมใช้งาน ปลดล็อกให้กดบันทึกเวลาได้
                if (snapBtn) {
                    snapBtn.disabled = false;
                    snapBtn.classList.remove('opacity-50', 'cursor-not-allowed');
                }
            },
            (err) => {
                console.error("GPS error:", err);
                document.getElementById('gpsStatusText').textContent = "❌ GPS: ไม่สามารถเข้าถึงตำแหน่งได้";
                showToast("⚠️ กรุณาเปิด GPS/ระบุตำแหน่งบนโทรศัพท์มือถือของคุณ");
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    } else {
        document.getElementById('gpsStatusText').textContent = "❌ ระบบไม่รองรับ GPS";
    }
}

function startCameraClock() {
    const camTimeText = document.getElementById('cameraTimeText');
    if (clockInterval) clearInterval(clockInterval);
    clockInterval = setInterval(() => {
        if (camTimeText) camTimeText.textContent = `⏱️ เวลา: ${new Date().toLocaleTimeString('th-TH', { hour12: false })}`;
    }, 1000);
}

// ✕ ปิดกล้องและเคลียร์หน่วยความจำ
function closeTimestampCamera() {
    const modal = document.getElementById('cameraModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
    if (streamInstance) {
        streamInstance.getTracks().forEach(track => track.stop());
    }
    if (clockInterval) clearInterval(clockInterval);
}

// 📌 💾 ประมวลผลภาพถ่าย บีบอัด อัปโหลด และส่งข้อมูลเข้าตาราง attendance_logs
async function processAttendance() {
    const siteSelect = document.getElementById('workSiteSelect');
    const clientId = siteSelect ? siteSelect.value : '';
    const remarkInput = document.getElementById('employeeRemark').value.trim();
    
    if (!clientId) {
        showToast("⚠️ กรุณาเลือกสถานที่ปฏิบัติงานก่อนบันทึกเวลา");
        return;
    }

    // read current user profile populated by auth-guard
    const emp = window.currentUserProfile || null;
    if (!emp) return;

    const now = new Date();
    const workDate = now.toISOString().split('T')[0];
    const currentTimeString = now.toLocaleTimeString('th-TH', { hour12: false });
    const finalRemark = `GPS: ${currentLatitude}, ${currentLongitude} ${remarkInput ? '| หมายเหตุพนง: ' + remarkInput : ''}`;

    try {
        showToast("⏳ กำลังบีบอัดรูปภาพและบันทึกข้อมูล...");
        const snapBtn = document.getElementById('snapBtn');
        if(snapBtn) { snapBtn.disabled = true; snapBtn.classList.add('opacity-50'); }

        // --- 📸 ส่วนที่ 1: แคปรูปจากวิดีโอและบีบอัด (Client-Side Compression) ---
        const video = document.getElementById('webcamVideo');
        const canvas = document.getElementById('captureCanvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        // แปลงภาพเป็น Blob (JPEG คุณภาพ 60% เพื่อลดขนาดไฟล์จาก 3MB เหลือ ~150KB)
        const imageBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.6));

        // --- 🗂️ ส่วนที่ 2: จัดระเบียบชื่อไฟล์และโฟลเดอร์ ---
        // รูปแบบ: 2026-07-15/client_001/KC260501001_173000.jpg
        const timeForFile = currentTimeString.replace(/:/g, '');
        const filePath = `${workDate}/${clientId}/${emp.emp_id}_${timeForFile}.jpg`;

        // อัปโหลดขึ้น Supabase Storage
        const { data: uploadData, error: uploadError } = await supabaseClient
            .storage
            .from('attendance_photos')
            .upload(filePath, imageBlob, {
                cacheControl: '3600',
                upsert: false
            });

        if (uploadError) throw new Error("อัปโหลดรูปภาพล้มเหลว: " + uploadError.message);

        // ดึง Public URL ของรูปที่เพิ่งอัปโหลดเสร็จ
        const { data: publicUrlData } = supabaseClient.storage.from('attendance_photos').getPublicUrl(filePath);
        const photoUrl = publicUrlData.publicUrl;

        // --- 💾 ส่วนที่ 3: บันทึกข้อมูลลง Database ---
        const { data: existingLog, error: checkError } = await supabaseClient
            .from('attendance_logs')
            .select('*')
            .eq('emp_id', emp.emp_id)
            .eq('work_date', workDate)
            .maybeSingle();

        if (checkError) throw checkError;

        if (!existingLog) {
            // Check-In ใหม่
            const { error: insertError } = await supabaseClient
                .from('attendance_logs')
                .insert([{
                    emp_id: emp.emp_id,
                    client_id: clientId,
                    work_date: workDate,
                    check_in: currentTimeString,
                    status: 'present',
                    check_in_method: 'mobile',
                    manual_override_reason: finalRemark,
                    photo_url: photoUrl // บันทึกลิงก์รูปลงฐานข้อมูล
                }]);
            if (insertError) throw insertError;
            showToast("✅ บันทึกเวลาเข้างานและรูปถ่ายสำเร็จ!");
        } else if (existingLog && !existingLog.check_out) {
            // Check-Out 
            let updatePayload = { 
                check_out: currentTimeString,
                photo_url: photoUrl // อัปเดตรูปใหม่เป็นตอนออกงาน
            };
            if (remarkInput) {
                updatePayload.manual_override_reason = existingLog.manual_override_reason + " | แจ้งตอนออก: " + remarkInput;
                updatePayload.status = 'flagged';
            }

            const { error: updateError } = await supabaseClient
                .from('attendance_logs')
                .update(updatePayload)
                .eq('id', existingLog.id);
            if (updateError) throw updateError;
            showToast("✅ บันทึกเวลาออกงานและรูปถ่ายสำเร็จ!");
        } else {
            showToast("⚠️ คุณได้ลงเวลาทำงานของวันนี้ครบถ้วนแล้ว");
        }

        setTimeout(() => {
            closeTimestampCamera();
            document.getElementById('employeeRemark').value = "";
        }, 1500);

    } catch (err) {
        console.error("System error:", err);
        showToast("❌ เกิดข้อผิดพลาด: " + err.message);
    } finally {
        const snapBtn = document.getElementById('snapBtn');
        if(snapBtn) { snapBtn.disabled = false; snapBtn.classList.remove('opacity-50'); }
    }
}

// ⚙️ ระบบออกจากระบบ
function logoutEmployee() {
    const modal = document.getElementById('logoutConfirmModal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
}
function cancelLogout() {
    const modal = document.getElementById('logoutConfirmModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}
async function confirmLogout() {
    // Use PriffAuthGuard signOut to clear Supabase session and redirect
    try {
        if (window.PriffAuthGuard && typeof window.PriffAuthGuard.signOut === 'function') {
            await window.PriffAuthGuard.signOut();
        } else if (supabaseClient && supabaseClient.auth) {
            await supabaseClient.auth.signOut();
            window.location.href = 'employee-login.html';
        } else {
            window.location.href = 'employee-login.html';
        }
    } catch (err) {
        console.error('Sign out error', err);
        window.location.href = 'employee-login.html';
    }
}

// ============================================================
// 💸 ขอเบิกเงินล่วงหน้า (advance_payments)
// ============================================================
function statusBadgeHtml(status) {
    const map = {
        pending: '<span class="inline-block bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2.5 py-1 text-[11px] font-bold">⏳ รอดำเนินการ</span>',
        approved: '<span class="inline-block bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2.5 py-1 text-[11px] font-bold">✅ อนุมัติแล้ว</span>',
        rejected: '<span class="inline-block bg-red-50 text-red-600 border border-red-200 rounded-full px-2.5 py-1 text-[11px] font-bold">❌ ไม่อนุมัติ</span>',
        cancelled: '<span class="inline-block bg-slate-100 text-slate-500 border border-slate-200 rounded-full px-2.5 py-1 text-[11px] font-bold">ยกเลิกแล้ว</span>'
    };
    return map[status] || `<span class="inline-block bg-slate-100 text-slate-500 border border-slate-200 rounded-full px-2.5 py-1 text-[11px] font-bold">${status}</span>`;
}

async function openAdvanceModal() {
    const modal = document.getElementById('advanceModal');
    const form = document.getElementById('advanceForm');
    const notice = document.getElementById('advanceIneligibleNotice');
    const eligible = isAdvanceEligible();
    if (form) form.classList.toggle('hidden', !eligible);
    if (notice) notice.classList.toggle('hidden', eligible);
    if (modal) { modal.classList.remove('hidden'); modal.classList.add('flex'); }
    await loadAdvanceHistory();
}
function closeAdvanceModal() {
    const modal = document.getElementById('advanceModal');
    if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
}

async function loadAdvanceHistory() {
    const listEl = document.getElementById('advanceHistoryList');
    const emp = window.currentUserProfile;
    if (!listEl || !emp || !emp.emp_id) {
        if (listEl) listEl.innerHTML = '<p class="text-center text-red-500 text-sm py-6">ไม่พบรหัสพนักงานของคุณ กรุณาติดต่อผู้ดูแลระบบ</p>';
        return;
    }
    try {
        const list = await window.EmployeeSelfService.getMyAdvancePayments(emp.emp_id);
        if (!list || list.length === 0) {
            listEl.innerHTML = '<p class="text-center text-slate-400 text-sm py-6">ยังไม่มีประวัติการขอเบิกเงินล่วงหน้า</p>';
            return;
        }
        listEl.innerHTML = list.map(item => `
            <div class="rounded-2xl border border-[#e6edf7] bg-[#f7faff] p-4">
                <div class="flex justify-between items-start mb-1">
                    <div>
                        <p class="text-xs text-slate-500 font-bold">${new Date(item.created_at).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                        <p class="text-lg font-extrabold text-kcdark mt-0.5">฿${Number(item.amount).toLocaleString()}</p>
                    </div>
                    ${statusBadgeHtml(item.status)}
                </div>
                ${item.employee_remark ? `<p class="text-xs text-slate-600 mt-1">หมายเหตุ: ${item.employee_remark}</p>` : ''}
                ${item.transfer_slip_url ? `<a href="${item.transfer_slip_url}" target="_blank" class="text-xs font-bold text-kcblue hover:underline">📄 ดูสลิปโอนเงิน</a>` : ''}
            </div>
        `).join('');
    } catch (err) {
        console.error('loadAdvanceHistory error', err);
        listEl.innerHTML = '<p class="text-center text-red-500 text-sm py-6">โหลดข้อมูลไม่สำเร็จ</p>';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('advanceForm');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const emp = window.currentUserProfile;
            const amountInput = document.getElementById('advanceAmount');
            const remarkInput = document.getElementById('advanceRemark');
            const btn = document.getElementById('advanceSubmitBtn');
            const amount = Number(amountInput.value);
            if (!emp || !emp.emp_id) { showToast('⚠️ ไม่พบรหัสพนักงานของคุณ'); return; }
            if (!isAdvanceEligible()) { showToast('⚠️ ฟีเจอร์นี้เปิดให้เฉพาะพนักงานปฏิบัติการที่ประจำไซต์ลูกค้าเท่านั้น'); return; }
            if (!amount || amount <= 0) { showToast('⚠️ กรุณากรอกจำนวนเงินให้ถูกต้อง'); return; }

            btn.disabled = true; btn.classList.add('opacity-50');
            try {
                await window.EmployeeSelfService.createAdvancePaymentRequest({
                    empId: emp.emp_id,
                    companyId: emp.company_id,
                    amount,
                    remark: remarkInput.value.trim()
                });
                showToast('✅ ส่งคำขอเบิกเงินล่วงหน้าสำเร็จ รอการอนุมัติ');
                form.reset();
                await loadAdvanceHistory();
            } catch (err) {
                console.error('createAdvancePaymentRequest error', err);
                showToast('❌ ส่งคำขอไม่สำเร็จ: ' + err.message);
            } finally {
                btn.disabled = false; btn.classList.remove('opacity-50');
            }
        });
    }
});

// ============================================================
// 🏖️ ขออนุมัติลางาน (leave_requests)
// ============================================================
function countLeaveDays(startStr, endStr) {
    const start = new Date(startStr);
    const end = new Date(endStr);
    const diffMs = end.setHours(0,0,0,0) - start.setHours(0,0,0,0);
    return Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1;
}

async function openLeaveModal() {
    const modal = document.getElementById('leaveModal');
    if (modal) { modal.classList.remove('hidden'); modal.classList.add('flex'); }
    await loadLeaveTypes();
    await loadLeaveHistory();
    await loadLeaveBalanceSummary();
}
function closeLeaveModal() {
    const modal = document.getElementById('leaveModal');
    if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
}

const leaveTypeColorClass = {
    sick: 'border-rose-200 bg-rose-50',
    personal: 'border-amber-200 bg-amber-50',
    annual: 'border-emerald-200 bg-emerald-50',
    maternity: 'border-pink-200 bg-pink-50',
    ordination: 'border-violet-200 bg-violet-50',
    unpaid: 'border-slate-200 bg-slate-50'
};

async function loadLeaveBalanceSummary() {
    const yearEl = document.getElementById('leaveBalanceYear');
    const containerEl = document.getElementById('leaveBalanceSummary');
    const emp = window.currentUserProfile;
    if (yearEl) yearEl.textContent = new Date().getFullYear() + 543; // แสดงเป็น พ.ศ. ให้ตรงกับส่วนอื่นของ ESS
    if (!containerEl) return;
    if (!emp || !emp.employee_id || !emp.emp_id) {
        containerEl.innerHTML = '<p class="col-span-2 text-center text-red-500 text-sm py-4">ไม่พบรหัสพนักงานของคุณ กรุณาติดต่อผู้ดูแลระบบ</p>';
        return;
    }
    try {
        const summary = await window.EmployeeSelfService.getMyLeaveBalanceSummary(emp.employee_id, emp.emp_id);
        if (!summary || summary.length === 0) {
            containerEl.innerHTML = '<p class="col-span-2 text-center text-slate-400 text-sm py-4">ยังไม่มีข้อมูลประเภทการลา</p>';
            return;
        }
        containerEl.innerHTML = summary.map(item => `
            <div class="rounded-xl border ${leaveTypeColorClass[item.code] || 'border-[#e6edf7] bg-[#f7faff]'} p-3">
                <p class="text-xs font-bold text-slate-700">${item.nameTh}</p>
                <p class="text-lg font-extrabold text-kcdark mt-0.5">${item.remaining === null ? '∞' : item.remaining}<span class="text-xs font-normal text-slate-500"> / ${item.entitled === null ? 'ไม่จำกัด' : item.entitled} วัน</span></p>
                ${item.used > 0 ? `<p class="text-[11px] text-slate-400 mt-0.5">ใช้ไปแล้ว ${item.used} วัน</p>` : ''}
            </div>
        `).join('');
    } catch (err) {
        console.error('loadLeaveBalanceSummary error', err);
        containerEl.innerHTML = '<p class="col-span-2 text-center text-red-500 text-sm py-4">โหลดข้อมูลไม่สำเร็จ</p>';
    }
}

async function loadLeaveTypes() {
    const select = document.getElementById('leaveTypeSelect');
    if (!select) return;
    try {
        const types = await window.EmployeeSelfService.getLeaveTypes();
        select.innerHTML = '<option value="">-- เลือกประเภทการลา --</option>';
        (types || []).forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = `${t.name_th}${t.is_paid ? '' : ' (ไม่รับค่าจ้าง)'}`;
            select.appendChild(opt);
        });
    } catch (err) {
        console.error('loadLeaveTypes error', err);
        select.innerHTML = '<option value="">❌ โหลดประเภทการลาไม่สำเร็จ</option>';
    }
}

async function loadLeaveHistory() {
    const listEl = document.getElementById('leaveHistoryList');
    const emp = window.currentUserProfile;
    if (!listEl || !emp || !emp.emp_id) {
        if (listEl) listEl.innerHTML = '<p class="text-center text-red-500 text-sm py-6">ไม่พบรหัสพนักงานของคุณ กรุณาติดต่อผู้ดูแลระบบ</p>';
        return;
    }
    try {
        const list = await window.EmployeeSelfService.getMyLeaveRequests(emp.emp_id);
        if (!list || list.length === 0) {
            listEl.innerHTML = '<p class="text-center text-slate-400 text-sm py-6">ยังไม่มีประวัติการลางาน</p>';
            return;
        }
        listEl.innerHTML = list.map(item => `
            <div class="rounded-2xl border border-[#e6edf7] bg-[#f7faff] p-4">
                <div class="flex justify-between items-start mb-1">
                    <div>
                        <p class="text-sm font-bold text-kcdark">${item.leave_types?.name_th || 'การลา'}</p>
                        <p class="text-xs text-slate-500 mt-0.5">${item.start_date} ถึง ${item.end_date} (${item.total_days} วัน)</p>
                    </div>
                    ${statusBadgeHtml(item.status)}
                </div>
                ${item.reason ? `<p class="text-xs text-slate-600 mt-2">เหตุผล: ${item.reason}</p>` : ''}
                ${item.status === 'pending' ? `<button onclick="cancelMyLeaveRequest('${item.id}')" class="mt-2 text-xs font-bold text-red-500 hover:underline cursor-pointer">ยกเลิกคำขอนี้</button>` : ''}
            </div>
        `).join('');
    } catch (err) {
        console.error('loadLeaveHistory error', err);
        listEl.innerHTML = '<p class="text-center text-red-500 text-sm py-6">โหลดข้อมูลไม่สำเร็จ</p>';
    }
}

async function cancelMyLeaveRequest(id) {
    const emp = window.currentUserProfile;
    if (!emp || !emp.emp_id) return;
    try {
        await window.EmployeeSelfService.cancelLeaveRequest(id, emp.emp_id);
        showToast('✅ ยกเลิกคำขอลางานสำเร็จ');
        await loadLeaveHistory();
    } catch (err) {
        console.error('cancelMyLeaveRequest error', err);
        showToast('❌ ยกเลิกไม่สำเร็จ: ' + err.message);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('leaveForm');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const emp = window.currentUserProfile;
            const leaveTypeId = document.getElementById('leaveTypeSelect').value;
            const startDate = document.getElementById('leaveStartDate').value;
            const endDate = document.getElementById('leaveEndDate').value;
            const reason = document.getElementById('leaveReason').value.trim();
            const btn = document.getElementById('leaveSubmitBtn');

            if (!emp || !emp.emp_id || !emp.employee_id) { showToast('⚠️ ไม่พบข้อมูลพนักงานของคุณ'); return; }
            if (!leaveTypeId) { showToast('⚠️ กรุณาเลือกประเภทการลา'); return; }
            if (!startDate || !endDate) { showToast('⚠️ กรุณาเลือกวันที่ลา'); return; }
            const totalDays = countLeaveDays(startDate, endDate);
            if (totalDays <= 0) { showToast('⚠️ ช่วงวันที่ลาไม่ถูกต้อง'); return; }

            btn.disabled = true; btn.classList.add('opacity-50');
            try {
                await window.EmployeeSelfService.createLeaveRequest({
                    empId: emp.emp_id,
                    employeeId: emp.employee_id,
                    companyId: emp.company_id,
                    leaveTypeId,
                    startDate,
                    endDate,
                    totalDays,
                    reason
                });
                showToast('✅ ส่งคำขอลางานสำเร็จ รอการอนุมัติ');
                form.reset();
                await loadLeaveHistory();
            } catch (err) {
                console.error('createLeaveRequest error', err);
                showToast('❌ ส่งคำขอไม่สำเร็จ: ' + err.message);
            } finally {
                btn.disabled = false; btn.classList.remove('opacity-50');
            }
        });
    }
});

// ============================================================
// 📄 สลิปเงินเดือน (payroll_payslips)
// ============================================================
async function openPayslipModal() {
    const modal = document.getElementById('payslipModal');
    if (modal) { modal.classList.remove('hidden'); modal.classList.add('flex'); }
    await loadPayslips();
}
function closePayslipModal() {
    const modal = document.getElementById('payslipModal');
    if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
}

async function loadPayslips() {
    const listEl = document.getElementById('payslipList');
    const emp = window.currentUserProfile;
    if (!listEl || !emp || !emp.employee_id) {
        if (listEl) listEl.innerHTML = '<p class="text-center text-red-500 text-sm py-6">ไม่พบข้อมูลพนักงานของคุณ กรุณาติดต่อผู้ดูแลระบบ</p>';
        return;
    }
    try {
        const list = await window.EmployeeSelfService.getMyPayslips(emp.employee_id);
        if (!list || list.length === 0) {
            listEl.innerHTML = `
                <div class="text-center py-10">
                    <div class="text-4xl mb-3">🗓️</div>
                    <p class="text-slate-500 font-bold text-sm">ยังไม่มีสลิปเงินเดือนให้แสดง</p>
                    <p class="text-slate-400 text-xs mt-1">ระบบจะแสดงสลิปหลังจากฝ่ายบัญชีประมวลผลรอบการจ่ายเงินเดือนแล้ว</p>
                </div>`;
            return;
        }
        listEl.innerHTML = list.map(item => `
            <div class="rounded-2xl border border-[#e6edf7] bg-[#f7faff] p-4">
                <div class="flex justify-between items-start mb-2">
                    <div>
                        <p class="text-sm font-bold text-kcdark">รอบวันที่ ${item.payslip_date}</p>
                        <p class="text-xs text-slate-500 mt-0.5">เลขที่สลิป: ${item.payslip_number}</p>
                    </div>
                    <span class="inline-block bg-[#eef5ff] text-kcblue border border-kcblue/20 rounded-full px-2.5 py-1 text-[11px] font-bold">${item.status}</span>
                </div>
                <div class="grid grid-cols-3 gap-2 text-center text-xs">
                    <div><p class="text-slate-400">รายรับรวม</p><p class="font-bold text-emerald-600">฿${Number(item.gross_amount).toLocaleString()}</p></div>
                    <div><p class="text-slate-400">รายการหัก</p><p class="font-bold text-red-500">฿${Number(item.deduction_amount).toLocaleString()}</p></div>
                    <div><p class="text-slate-400">ยอดสุทธิ</p><p class="font-bold text-kcdark">฿${Number(item.net_amount).toLocaleString()}</p></div>
                </div>
                ${item.payslip_url ? `<a href="${item.payslip_url}" target="_blank" class="block mt-3 text-xs font-bold text-kcblue hover:underline">📄 ดูสลิปฉบับเต็ม</a>` : ''}
            </div>
        `).join('');
    } catch (err) {
        console.error('loadPayslips error', err);
        listEl.innerHTML = '<p class="text-center text-red-500 text-sm py-6">โหลดข้อมูลไม่สำเร็จ</p>';
    }
}

// ============================================================
// 🕒 ประวัติลงเวลา (attendance_logs)
// ============================================================
async function openAttendanceHistoryModal() {
    const modal = document.getElementById('attendanceHistoryModal');
    if (modal) { modal.classList.remove('hidden'); modal.classList.add('flex'); }
    await loadAttendanceHistory();
}
function closeAttendanceHistoryModal() {
    const modal = document.getElementById('attendanceHistoryModal');
    if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
}

const attendanceStatusLabel = {
    present: '<span class="inline-block bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2.5 py-1 text-[11px] font-bold">ปกติ</span>',
    flagged: '<span class="inline-block bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2.5 py-1 text-[11px] font-bold">มีหมายเหตุ</span>',
    absent: '<span class="inline-block bg-red-50 text-red-600 border border-red-200 rounded-full px-2.5 py-1 text-[11px] font-bold">ขาดงาน</span>'
};

async function loadAttendanceHistory() {
    const listEl = document.getElementById('attendanceHistoryList');
    const emp = window.currentUserProfile;
    if (!listEl || !emp || !emp.emp_id) {
        if (listEl) listEl.innerHTML = '<p class="text-center text-red-500 text-sm py-6">ไม่พบรหัสพนักงานของคุณ กรุณาติดต่อผู้ดูแลระบบ</p>';
        return;
    }
    try {
        const list = await window.EmployeeSelfService.getMyAttendanceHistory(emp.emp_id, { limit: 30 });
        if (!list || list.length === 0) {
            listEl.innerHTML = '<p class="text-center text-slate-400 text-sm py-6">ยังไม่มีประวัติการลงเวลา</p>';
            return;
        }
        listEl.innerHTML = list.map(item => `
            <div class="rounded-2xl border border-[#e6edf7] bg-[#f7faff] p-4">
                <div class="flex justify-between items-start mb-1">
                    <div>
                        <p class="text-sm font-bold text-kcdark">${new Date(item.work_date).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                        <p class="text-xs text-slate-500 mt-0.5">${item.clients?.client_name || 'ไม่ระบุไซต์งาน'}</p>
                    </div>
                    ${attendanceStatusLabel[item.status] || ''}
                </div>
                <div class="flex gap-4 text-xs mt-2">
                    <p><span class="text-slate-400">เข้างาน:</span> <span class="font-bold text-slate-700">${item.check_in || '--:--'}</span></p>
                    <p><span class="text-slate-400">ออกงาน:</span> <span class="font-bold text-slate-700">${item.check_out || '--:--'}</span></p>
                </div>
            </div>
        `).join('');
    } catch (err) {
        console.error('loadAttendanceHistory error', err);
        listEl.innerHTML = '<p class="text-center text-red-500 text-sm py-6">โหลดข้อมูลไม่สำเร็จ</p>';
    }
}

// ============================================================
// 📢 ประกาศบริษัท & ปฏิทินวันหยุด (announcements / company_holidays / client_holidays)
// ============================================================
function formatHolidayDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('th-TH', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}

async function loadAnnouncementTeaser() {
    const teaserEl = document.getElementById('announcementTeaser');
    if (!teaserEl || !window.AnnouncementService) return;
    try {
        const list = await window.AnnouncementService.getPublishedAnnouncements(1);
        if (list && list.length > 0) {
            teaserEl.textContent = `📌 ${list[0].title}`;
        }
    } catch (err) {
        console.error('loadAnnouncementTeaser error', err);
    }
}

async function openAnnouncementsModal() {
    const modal = document.getElementById('announcementsModal');
    if (modal) { modal.classList.remove('hidden'); modal.classList.add('flex'); }
    switchAnnouncementTab('feed');
}
function closeAnnouncementsModal() {
    const modal = document.getElementById('announcementsModal');
    if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
}

function switchAnnouncementTab(tab) {
    const feedBtn = document.getElementById('annTab-feed');
    const holidaysBtn = document.getElementById('annTab-holidays');
    const feedView = document.getElementById('announcementFeedView');
    const holidaysView = document.getElementById('announcementHolidayView');
    const activeCls = ['bg-kcblue', 'text-white'];
    const inactiveCls = ['bg-[#f7faff]', 'text-slate-600', 'border', 'border-[#e6edf7]'];

    if (tab === 'feed') {
        feedView.classList.remove('hidden');
        holidaysView.classList.add('hidden');
        feedBtn.classList.add(...activeCls);
        feedBtn.classList.remove(...inactiveCls);
        holidaysBtn.classList.remove(...activeCls);
        holidaysBtn.classList.add(...inactiveCls);
        loadAnnouncementFeed();
    } else {
        holidaysView.classList.remove('hidden');
        feedView.classList.add('hidden');
        holidaysBtn.classList.add(...activeCls);
        holidaysBtn.classList.remove(...inactiveCls);
        feedBtn.classList.remove(...activeCls);
        feedBtn.classList.add(...inactiveCls);
        loadHolidayCalendar();
    }
}

const announcementCategoryLabel = {
    general: '📰 ทั่วไป',
    policy: '📋 ระเบียบ',
    benefit: '🎁 สวัสดิการ',
    safety: '🦺 ความปลอดภัย'
};

// เก็บ cache รายการประกาศที่โหลดล่าสุดไว้ในหน่วยความจำ เพื่อให้เปิดหน้ารายละเอียดได้ทันทีโดยไม่ต้อง fetch ซ้ำ
let announcementCache = {};

async function loadAnnouncementFeed() {
    const listEl = document.getElementById('announcementFeedView');
    if (!listEl) return;
    listEl.innerHTML = '<p class="text-center text-slate-400 text-sm py-6">กำลังโหลดข้อมูล...</p>';
    try {
        const list = await window.AnnouncementService.getPublishedAnnouncements(20);
        if (!list || list.length === 0) {
            listEl.innerHTML = '<p class="text-center text-slate-400 text-sm py-6">ยังไม่มีประกาศในขณะนี้</p>';
            return;
        }
        announcementCache = {};
        list.forEach(item => { announcementCache[item.id] = item; });

        listEl.innerHTML = list.map(item => `
            <div onclick="openAnnouncementDetail('${item.id}')" class="rounded-2xl border ${item.is_pinned ? 'border-kcyellow bg-[#fff9ec]' : 'border-[#e6edf7] bg-[#f7faff]'} p-4 cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all">
                <div class="flex justify-between items-start gap-2 mb-1">
                    <p class="text-sm font-bold text-kcdark">${item.is_pinned ? '📌 ' : ''}${item.title}</p>
                    <span class="shrink-0 text-[11px] font-bold text-slate-400">${announcementCategoryLabel[item.category] || item.category}</span>
                </div>
                <p class="text-xs text-slate-600 line-clamp-2">${item.body}</p>
                <div class="flex justify-between items-center mt-2">
                    <p class="text-[11px] text-slate-400">${new Date(item.published_at).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                    <span class="text-xs font-bold text-kcblue">${item.attachment_url ? '📎 มีไฟล์แนบ · ' : ''}อ่านต่อ →</span>
                </div>
            </div>
        `).join('');
    } catch (err) {
        console.error('loadAnnouncementFeed error', err);
        listEl.innerHTML = '<p class="text-center text-red-500 text-sm py-6">โหลดข้อมูลไม่สำเร็จ</p>';
    }
}

// 📄 เปิดหน้ารายละเอียดประกาศแบบเต็ม (สไตล์อ่านหน้ากระดาษ) จาก cache ที่โหลดไว้แล้ว
function openAnnouncementDetail(id) {
    const item = announcementCache[id];
    if (!item) return;

    const modal = document.getElementById('announcementDetailModal');
    const categoryEl = document.getElementById('annDetailCategory');
    const titleEl = document.getElementById('annDetailTitle');
    const dateEl = document.getElementById('annDetailDate');
    const bodyEl = document.getElementById('annDetailBody');
    const attachmentEl = document.getElementById('annDetailAttachment');
    if (!modal || !categoryEl || !titleEl || !dateEl || !bodyEl || !attachmentEl) return;

    categoryEl.textContent = `${item.is_pinned ? '📌 ปักหมุด · ' : ''}${announcementCategoryLabel[item.category] || item.category}`;
    titleEl.textContent = item.title;
    dateEl.textContent = `เผยแพร่เมื่อ ${new Date(item.published_at).toLocaleDateString('th-TH', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}`;
    bodyEl.textContent = item.body;

    if (item.attachment_url) {
        const isPdf = /\.pdf(\?|$)/i.test(item.attachment_url);
        const isImage = /\.(png|jpe?g|webp|gif)(\?|$)/i.test(item.attachment_url);
        let previewHtml = '';
        if (isPdf) {
            previewHtml = `
                <div class="rounded-xl border border-[#e6edf7] overflow-hidden bg-[#f7faff]">
                    <iframe src="${item.attachment_url}#toolbar=0" class="w-full h-[60vh] md:h-[65vh]" title="เอกสารแนบ"></iframe>
                </div>
                <p class="text-xs text-slate-400 mt-2">หากไฟล์ไม่แสดงผล (เช่น เปิดผ่านแอปแชท) ให้กดลิงก์ด้านล่างเพื่อเปิด/ดาวน์โหลดโดยตรง</p>`;
        } else if (isImage) {
            previewHtml = `<img src="${item.attachment_url}" alt="ไฟล์แนบ" class="w-full rounded-xl border border-[#e6edf7]">`;
        }
        attachmentEl.innerHTML = `
            ${previewHtml}
            <a href="${item.attachment_url}" target="_blank" rel="noopener" class="mt-4 inline-flex items-center gap-2 rounded-full bg-kcblue text-white text-sm font-bold px-5 py-2.5 hover:bg-kcdark transition-colors">
                📎 เปิดแบบเต็มจอ / ดาวน์โหลดไฟล์แนบ
            </a>`;
        attachmentEl.classList.remove('hidden');
    } else {
        attachmentEl.innerHTML = '';
        attachmentEl.classList.add('hidden');
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeAnnouncementDetail() {
    const modal = document.getElementById('announcementDetailModal');
    if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
}


// เรนเดอร์รายการวันหยุด (ใช้ร่วมกันทั้งปฏิทินบริษัทและปฏิทินไซต์)
function renderHolidayList(holidays, colorClass) {
    if (!holidays || holidays.length === 0) {
        return '<p class="text-center text-slate-400 text-sm py-3">ยังไม่มีวันหยุดที่กำลังจะถึง</p>';
    }
    return holidays.map(h => `
        <div class="flex justify-between items-center rounded-xl border ${colorClass} px-3 py-2">
            <span class="text-xs font-bold text-slate-700">${h.name_th}</span>
            <span class="text-xs text-slate-400 shrink-0">${formatHolidayDate(h.holiday_date)}</span>
        </div>
    `).join('');
}

async function loadHolidayCalendar() {
    const containerEl = document.getElementById('holidayCalendarContainer');
    const noteEl = document.getElementById('holidayScopeNote');
    if (containerEl) containerEl.innerHTML = '<p class="text-center text-slate-400 text-sm py-6">กำลังโหลดข้อมูล...</p>';
    if (noteEl) noteEl.classList.add('hidden');

    try {
        const profile = window.currentUserProfile || null;
        const result = await window.AnnouncementService.getMyEffectiveHolidayCalendar(profile);

        let noteText = '';
        let html = '';

        if (result.scope === 'site') {
            // ประจำไซต์ลูกค้า 1 ไซต์ -> ใช้ปฏิทินไซต์นั้น "แทนที่" ปฏิทินบริษัททั้งหมด
            const site = result.sites[0];
            noteText = `📍 คุณประจำไซต์งาน "${site.clientName}" — วันหยุดของคุณยึดตามปฏิทินไซต์นี้เท่านั้น (ไม่ใช่ปฏิทินบริษัท)`;
            html = `
                <div>
                    <h4 class="text-sm font-bold text-slate-800 mb-3 border-l-4 border-emerald-400 pl-3">วันหยุดไซต์ "${site.clientName}"</h4>
                    <div class="space-y-2">${renderHolidayList(site.holidays, 'border-[#cdeedd] bg-[#f0fbf5]')}</div>
                </div>`;
        } else if (result.scope === 'multi-site') {
            // Supervisor ดูแลหลายไซต์ -> แสดงแยกเป็นกลุ่มตามไซต์ ไซต์ไหนยังไม่ตั้งปฏิทิน ให้ fallback เป็นปฏิทินบริษัท
            noteText = `📍 คุณดูแล ${result.sites.length} ไซต์งาน — แต่ละไซต์มีปฏิทินวันหยุดของตัวเอง (ไซต์ที่ยังไม่ตั้งค่าจะใช้ปฏิทินบริษัทไปก่อน)`;
            html = result.sites.map(site => `
                <div>
                    <h4 class="text-sm font-bold text-slate-800 mb-3 border-l-4 border-emerald-400 pl-3">
                        วันหยุดไซต์ "${site.clientName}"${site.holidays === null ? ' <span class="text-[11px] font-normal text-slate-400">(ยังไม่ตั้งปฏิทิน ใช้ปฏิทินบริษัทแทน)</span>' : ''}
                    </h4>
                    <div class="space-y-2">${renderHolidayList(site.holidays || result.companyHolidays, 'border-[#cdeedd] bg-[#f0fbf5]')}</div>
                </div>
            `).join('');
        } else {
            // scope === 'company': พนักงานออฟฟิศ หรือ fallback เพราะไซต์ยังไม่ตั้งปฏิทิน
            noteText = result.usingCompanyFallback
                ? '📍 ไซต์งานของคุณยังไม่ได้ตั้งปฏิทินวันหยุดของตัวเอง จึงแสดงปฏิทินบริษัทไปก่อน'
                : '📍 คุณเป็นพนักงานออฟฟิศ (ไม่ได้ประจำไซต์ลูกค้า) — วันหยุดยึดตามปฏิทินบริษัท';
            html = `
                <div>
                    <h4 class="text-sm font-bold text-slate-800 mb-3 border-l-4 border-kcyellow pl-3">วันหยุดบริษัท</h4>
                    <div class="space-y-2">${renderHolidayList(result.companyHolidays, 'border-[#e6edf7] bg-[#f7faff]')}</div>
                </div>`;
        }

        if (noteEl) { noteEl.textContent = noteText; noteEl.classList.remove('hidden'); }
        if (containerEl) containerEl.innerHTML = html;
    } catch (err) {
        console.error('loadHolidayCalendar error', err);
        if (containerEl) containerEl.innerHTML = '<p class="text-center text-red-500 text-sm py-6">โหลดข้อมูลไม่สำเร็จ</p>';
    }
}