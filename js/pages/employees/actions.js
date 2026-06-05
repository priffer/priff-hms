async function handleLogout() {
    if (typeof supabaseClient !== 'undefined' && supabaseClient.auth) {
        await supabaseClient.auth.signOut();
    }
    window.location.href = 'login.html';
}

// อัปเดตสถานะการเป็นพนักงาน (Active, Suspended, Resigned)
async function updateEmployeeStatus(id) {
    const newStatus = document.getElementById('empStatusSelect').value;
    
    // แจ้งเตือนแอดมินให้ชัวร์ก่อนเซฟ
    const statusText = newStatus === 'hired' ? 'ทำงานอยู่ปกติ' : newStatus === 'suspended' ? 'พักงาน' : 'ลาออก/พ้นสภาพ';
    if (!confirm(`ยืนยันการเปลี่ยนสถานะพนักงานคนนี้เป็น: "${statusText}" ใช่หรือไม่?`)) return;
    
    try {
        await CandidateService.updateCandidateData(id, { status: newStatus });
        alert('อัปเดตสถานะพนักงานเรียบร้อยแล้ว');
        closeEmployeeModal();
        
        // ถ้าสถานะไม่ใช่ hired แล้ว ให้โหลดตารางใหม่ชื่อเขาจะหายไป
        loadEmployees(); 
    } catch (err) {
        alert('เกิดข้อผิดพลาดในการบันทึก: ' + err.message);
    }
}

// ฟังก์ชันจำลองพนักงานกดขอเบิกเงิน (สำหรับทดสอบ)
async function simulateAdvanceRequest(dbId, empId) {
    if (!empId || empId === '-') {
        alert('พนักงานคนนี้ยังไม่มีรหัสพนักงาน (emp_id)');
        return;
    }
    
    const amount = prompt('จำลองคำขอ (เสมือนพนักงานกดมาจากแอป):\nกรุณากรอกจำนวนเงินที่ต้องการเบิก (เช่น 1000)');
    if (!amount || isNaN(amount)) return;
    
    try {
        await CandidateService.createAdvancePayment({
            emp_id: empId,
            amount: parseFloat(amount),
            status: 'pending' // ค่าเริ่มต้นคือรอแอดมินโอน
        });
        alert('ส่งคำขอเบิกเงินจำลองสำเร็จ!');
        viewEmployeeDetails(dbId); // รีเฟรชหน้าต่างอัตโนมัติ ไม่ต้องกดปิดเปิดใหม่
    } catch (err) {
        alert('เกิดข้อผิดพลาด: ' + err.message);
    }
}

// แอดมินยืนยันการโอนเงิน (บังคับอัปโหลดสลิป)
async function approveAdvance(dbId, advId) {
    const fileInput = document.getElementById(`slip_${advId}`);
    const file = fileInput?.files[0];
    
    if (!file) {
        alert('❌ กรุณาอัปโหลดรูป "สลิปโอนเงิน" ก่อนกดยืนยันครับ (ระบบบังคับเพื่อป้องกันการทุจริต)');
        return;
    }

    if (!confirm('ยืนยันว่าสลิปถูกต้อง และโอนเงินเรียบร้อยแล้ว?')) return;

    try {
        // อัปโหลดสลิป และขอ URL
        const fileExt = file.name.split('.').pop();
        const fileName = `slips/slip_${advId}_${Date.now()}.${fileExt}`;
        const slipUrl = await CandidateService.uploadSlipAndGetUrl(file, fileName);

        // อัปเดตสถานะเป็น Approved
        await CandidateService.updateAdvancePayment(advId, {
            status: 'approved',
            transfer_slip_url: slipUrl
        });
        
        alert('✅ บันทึกสลิปและอนุมัติการเบิกเงินเรียบร้อยครับ');
        viewEmployeeDetails(dbId); // รีเฟรชหน้าต่าง
    } catch (err) {
        alert('เกิดข้อผิดพลาด: ' + err.message);
    }
}

// แอดมินกดไม่อนุมัติ
async function rejectAdvance(dbId, advId) {
    if (!confirm('ยืนยัน "ไม่อนุมัติ" คำขอเบิกเงินนี้?')) return;
    try {
        await CandidateService.updateAdvancePayment(advId, { status: 'rejected' });
        alert('บันทึกสถานะไม่อนุมัติเรียบร้อย');
        viewEmployeeDetails(dbId); // รีเฟรชหน้าต่าง
    } catch (err) {
        alert('เกิดข้อผิดพลาด: ' + err.message);
    }
}