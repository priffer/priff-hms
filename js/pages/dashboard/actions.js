async function submitInterviewSchedule(id) {
    const date = document.getElementById('intDate').value;
    const time = document.getElementById('intTime').value;
    const type = document.getElementById('intType').value;

    if (!date || !time) {
        alert('กรุณากรอกวันที่และเวลาสำหรับการสัมภาษณ์ให้ครบถ้วนก่อนครับ');
        return;
    }

    try {
        await CandidateService.updateCandidateData(id, {
            status: 'interview',
            interview_date: date,
            interview_time: time,
            interview_type: type
        });
        
        alert('บันทึกเวลานัดหมายสัมภาษณ์และแจ้งสถานะเรียบร้อยแล้วครับ');
        closeModal();
        fetchEmployees();
    } catch (err) {
        alert('เกิดข้อผิดพลาดในการบันทึกข้อมูลนัดหมาย: ' + err.message);
    }
}

async function updateStatus(id, newStatus) {
    if (!confirm(`ยืนยันการเปลี่ยนสถานะเป็น: ${newStatus}?`)) return;
    try {
        await CandidateService.updateCandidateData(id, { status: newStatus });
        closeModal(); 
        fetchEmployees();
    } catch (err) {
        alert('เปลี่ยนสถานะไม่สำเร็จ: ' + err.message);
    }
}

async function updateRemarks(id) {
    const text = document.getElementById('remarksInput').value;
    try {
        await CandidateService.updateCandidateData(id, { admin_remarks: text });
        alert('บันทึกโน้ตเรียบร้อย');
    } catch (err) {
        alert('บันทึกโน้ตไม่สำเร็จ: ' + err.message);
    }
}

async function processHiring(id) {
    const startDate = document.getElementById('startDateInput').value;
    if (!startDate) {
        alert('กรุณาระบุวันที่เริ่มงานด้วยครับ');
        return;
    }

    if (!confirm('ยืนยันรับคนนี้เข้าทำงาน? ระบบจะออกรหัสพนักงานให้อัตโนมัติ')) return;
    
    try {
        const { data: settings, error: fetchErr } = await supabaseClient
            .from('system_settings')
            .select('setting_value')
            .eq('setting_key', 'LAST_EMP_RUN_NO')
            .single();
            
        if (fetchErr) throw new Error('ไม่สามารถดึงข้อมูล Running No. ได้');

        let currentRun = parseInt(settings.setting_value || '0', 10);
        currentRun += 1; 
        const runStr = currentRun.toString().padStart(3, '0'); 
        
        const now = new Date();
        const yy = now.getFullYear().toString().slice(-2); 
        const mm = (now.getMonth() + 1).toString().padStart(2, '0'); 
        const dd = now.getDate().toString().padStart(2, '0'); 

        const newEmpId = `KC${yy}${mm}${dd}${runStr}`; 

        await CandidateService.updateCandidateData(id, { 
            status: 'hired', 
            emp_id: newEmpId,
            available_start_date: startDate
        });

        await supabaseClient
            .from('system_settings')
            .update({ setting_value: runStr })
            .eq('setting_key', 'LAST_EMP_RUN_NO');

        alert(`รับเข้าทำงานเรียบร้อย!\nรหัสพนักงานใหม่คือ: ${newEmpId}`);
        closeModal(); 
        fetchEmployees();
        
    } catch (error) {
        alert(error.message);
    }
}

async function handleLogout() {
    if (typeof supabaseClient !== 'undefined' && supabaseClient.auth) {
        await supabaseClient.auth.signOut();
    }
    window.location.href = 'login.html';
}

async function updateStartDate(id) {
    const newDate = document.getElementById('editStartDateInput').value;
    if (!newDate) {
        alert('กรุณาระบุวันที่เริ่มงานใหม่ด้วยครับ');
        return;
    }

    try {
        await CandidateService.updateCandidateData(id, { available_start_date: newDate });
        alert('อัปเดตวันที่เริ่มงานเรียบร้อยแล้ว');
        closeModal();
        fetchEmployees(); // รีเฟรชตารางเพื่อให้ป้ายกำกับด้านนอกเปลี่ยนวันที่ตาม
    } catch (err) {
        alert('เกิดข้อผิดพลาดในการอัปเดต: ' + err.message);
    }
}

async function restoreCandidate(id) {
    if (!confirm('ยืนยันดึงผู้สมัครคนนี้กลับมาพิจารณาใหม่อีกครั้ง? (ข้อมูลการนัดสัมภาษณ์เดิมจะถูกล้างค่าใหม่ทั้งหมด)')) return;
    try {
        await CandidateService.updateCandidateData(id, {
            status: 'applied', // บังคับส่งกลับไปแท็บผู้สมัครใหม่เสมอ
            is_reconsidered: true, // เปิดป้ายพิจารณาใหม่
            interview_date: null,  // ล้างวันที่นัดสัมภาษณ์เดิมทิ้ง
            interview_time: null,  // ล้างเวลานัดเดิมทิ้ง
            interview_type: null,  // ล้างรูปแบบเดิมทิ้ง
            available_start_date: null // ล้างวันเริ่มงานเดิมทิ้ง (เผื่อมี)
        });
        alert('ดึงข้อมูลกลับมาเพื่อพิจารณาใหม่เรียบร้อยแล้วครับ');
        closeModal();
        fetchEmployees();
    } catch (err) {
        alert('เกิดข้อผิดพลาด: ' + err.message);
    }
}