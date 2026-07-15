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

function checkEmployeeSession() {
    const sessionData = localStorage.getItem('priff_emp_session');
    if (!sessionData) {
        window.location.href = 'employee-login.html';
        return;
    }
    try {
        const emp = JSON.parse(sessionData);
        document.getElementById('empNameDisplay').textContent = emp.full_name;
        document.getElementById('empIdDisplay').textContent = emp.emp_id;
    } catch (err) {
        console.error("Session corrupted", err);
        confirmLogout(); 
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

// 📌 💾 ประมวลผลภาพถ่ายลายน้ำและส่งข้อมูลเข้าตาราง attendance_logs (อัปเดตรองรับระบบแจ้งปัญหา)
async function processAttendance() {
    const siteSelect = document.getElementById('workSiteSelect');
    const clientId = siteSelect ? siteSelect.value : '';
    const remarkInput = document.getElementById('employeeRemark').value.trim(); // ดึงข้อความหมายเหตุ
    
    if (!clientId) {
        showToast("⚠️ กรุณาเลือกสถานที่ปฏิบัติงานก่อนบันทึกเวลา");
        return;
    }

    const sessionData = localStorage.getItem('priff_emp_session');
    if (!sessionData) return;
    const emp = JSON.parse(sessionData);

    const now = new Date();
    const workDate = now.toISOString().split('T')[0];
    const currentTimeString = now.toLocaleTimeString('th-TH', { hour12: false });
    
    // รวมพิกัด GPS และหมายเหตุเข้าด้วยกัน เพื่อส่งให้แอดมิน
    const finalRemark = `GPS: ${currentLatitude}, ${currentLongitude} ${remarkInput ? '| หมายเหตุพนง: ' + remarkInput : ''}`;

    try {
        showToast("⏳ กำลังบันทึกเวลาทำงาน...");

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
                    manual_override_reason: finalRemark // บันทึกหมายเหตุลงฐานข้อมูล
                }]);

            if (insertError) throw insertError;
            showToast("✅ บันทึกเวลาเข้างาน (Check-In) สำเร็จ!");
        } else if (existingLog && !existingLog.check_out) {
            // Check-Out 
            // หากมีการพิมพ์หมายเหตุมาตอนออกงาน ให้บันทึกทับเพื่อเตือนแอดมิน
            let updatePayload = { check_out: currentTimeString };
            if (remarkInput) {
                updatePayload.manual_override_reason = existingLog.manual_override_reason + " | แจ้งตอนออก: " + remarkInput;
                updatePayload.status = 'flagged'; // เปลี่ยนสถานะเป็น flagged ให้เด้งเตือนสีแดงหน้าแอดมิน
            }

            const { error: updateError } = await supabaseClient
                .from('attendance_logs')
                .update(updatePayload)
                .eq('id', existingLog.id);

            if (updateError) throw updateError;
            showToast("✅ บันทึกเวลาออกงาน (Check-Out) สำเร็จ!");
        } else {
            showToast("⚠️ คุณได้ลงเวลาทำงานของวันนี้ครบถ้วนแล้ว");
        }

        setTimeout(() => {
            closeTimestampCamera();
            document.getElementById('employeeRemark').value = ""; // เคลียร์ช่องข้อความ
        }, 1500);

    } catch (err) {
        console.error("Attendance log error:", err);
        showToast("❌ เกิดข้อผิดพลาด: " + err.message);
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
function confirmLogout() {
    localStorage.removeItem('priff_emp_session');
    window.location.href = 'employee-login.html';
}