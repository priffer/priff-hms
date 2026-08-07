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
    const deptId = document.getElementById('assignDepartmentInput').value;

    if (!startDate || !deptId) {
        alert('กรุณาระบุวันที่เริ่มงาน และเลือกแผนกให้ครบถ้วนด้วยครับ');
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
            available_start_date: startDate,
            department_id: deptId 
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

async function processTransfer(id) {
    const newDeptId = document.getElementById('transferDeptInput').value;
    const transferDate = document.getElementById('transferDateInput').value;

    if (!newDeptId || !transferDate) {
        alert('กรุณาเลือกแผนกใหม่และระบุวันที่มีผลให้ครบถ้วนครับ');
        return;
    }

    if (!confirm('ยืนยันการทำเรื่องย้ายแผนก/ปรับตำแหน่งใช่หรือไม่?')) return;

    try {
        await CandidateService.updateCandidateData(id, {
            department_id: newDeptId
        });

        alert('บันทึกการโยกย้ายแผนกให้พนักงานเรียบร้อยแล้วครับ!');
        closeModal();
        fetchEmployees();
    } catch (error) {
        alert('เกิดข้อผิดพลาดในการย้ายแผนก: ' + error.message);
    }
}

async function saveSiteAssignment(userProfileId) {
    const select = document.getElementById('siteAssignSelect');
    if (!select) return;
    const clientId = select.value || null;
    try {
        await CandidateService.updatePrimaryClientSite(userProfileId, clientId);
        alert(clientId ? 'ผูกไซต์ลูกค้าให้พนักงานเรียบร้อยแล้วครับ' : 'ตั้งค่าเป็นพนักงานออฟฟิศ (ไม่ประจำไซต์ลูกค้า) เรียบร้อยแล้ว');
    } catch (err) {
        alert('บันทึกไซต์ลูกค้าไม่สำเร็จ: ' + err.message);
    }
}

async function saveSupervisorSites(userProfileId) {
    const checkboxes = document.querySelectorAll('.supervisorSiteCheckbox:checked');
    const clientIds = Array.from(checkboxes).map(cb => cb.value);
    try {
        await CandidateService.setSupervisorClientAssignments(userProfileId, clientIds);
        alert('บันทึกไซต์ที่ดูแลเรียบร้อยแล้วครับ');
    } catch (err) {
        alert('บันทึกไซต์ที่ดูแลไม่สำเร็จ: ' + err.message);
    }
}

async function saveEmployeeShift(employeeId) {
    const shiftName = document.getElementById('shiftNameInput').value.trim();
    const shiftStart = document.getElementById('shiftStartInput').value;
    const shiftEnd = document.getElementById('shiftEndInput').value;
    const standardHours = Number(document.getElementById('shiftStandardHoursInput').value);

    if (!shiftStart || !shiftEnd) { alert('กรุณาระบุเวลาเข้า-ออกงานให้ครบถ้วน'); return; }
    if (!standardHours || standardHours <= 0) { alert('กรุณาระบุจำนวนชั่วโมงทำงานปกติ/วันให้ถูกต้อง'); return; }

    try {
        await CandidateService.setEmployeeShift(employeeId, { shiftName, shiftStart, shiftEnd, standardHours });
        alert('บันทึกกะการทำงานเรียบร้อยแล้วครับ');
        await viewEmployeeDetails(employeeId); // รีโหลดแฟ้มประวัติเพื่อแสดงกะล่าสุด
        switchEmpTab('settings'); // กลับไปแท็บเดิมที่ผู้ใช้กำลังทำงานอยู่
    } catch (err) {
        alert('บันทึกกะการทำงานไม่สำเร็จ: ' + err.message);
    }
}

// อัปเดตสถานะการทำงานของพนักงาน (บันทึกสถานะ ปุ่มในแท็บ "ตั้งค่าสถานะ")
// หมายเหตุ: ฟังก์ชันนี้ถูกอ้างอิงใน modal.js มานานแล้วแต่ไม่เคยถูกสร้างจริง (พบระหว่างทำ
// ฟีเจอร์เบิกเงินล่วงหน้ารอบนี้) - เพิ่มให้ใช้งานได้จริงในคราวเดียวกัน
async function updateEmployeeStatus(id) {
    const select = document.getElementById('empStatusSelect');
    if (!select) return;
    const newStatus = select.value;
    if (!confirm(`ยืนยันเปลี่ยนสถานะพนักงานเป็น: ${newStatus}?`)) return;
    try {
        await CandidateService.updateCandidateData(id, { status: newStatus });
        alert('บันทึกสถานะพนักงานเรียบร้อยแล้ว');
        await viewEmployeeDetails(id);
        switchEmpTab('settings');
        if (typeof fetchEmployees === 'function') fetchEmployees();
    } catch (err) {
        alert('บันทึกสถานะไม่สำเร็จ: ' + err.message);
    }
}

// บันทึกค่าจ้าง/เงินเดือนของพนักงาน (salary_type/monthly_salary/daily_rate/hourly_rate/
// standard_monthly_hours/standard_working_hours/employment_type) - ใช้เป็นฐานคำนวณยอดประมาณการ
// เบิกล่วงหน้า (database/22_advance_payment_estimate_summary.sql, 23_advance_payment_admin_tools.sql)
// และเป็นฐานคำนวณ Payroll Engine จริง (employment_type กระทบประกันสังคม/ภาษี - database/31)
async function saveSalaryConfig(id) {
    const salaryType = document.getElementById('salaryTypeSelect').value;
    if (!salaryType) { alert('กรุณาเลือกประเภทค่าจ้างก่อนบันทึก'); return; }

    const employmentType = document.getElementById('employmentTypeSelect').value;
    const payFrequency = document.getElementById('payFrequencySelect').value;
    const monthlySalary = document.getElementById('monthlySalaryInput').value;
    const dailyRate = document.getElementById('dailyRateInput').value;
    const hourlyRate = document.getElementById('hourlyRateInput').value;
    const stdMonthlyHours = document.getElementById('stdMonthlyHoursInput').value;
    const stdWorkingHours = document.getElementById('stdWorkingHoursInput').value;

    try {
        await CandidateService.updateCandidateData(id, {
            salary_type: salaryType,
            employment_type: employmentType || 'regular',
            pay_frequency: payFrequency || null,
            monthly_salary: monthlySalary ? Number(monthlySalary) : null,
            daily_rate: dailyRate ? Number(dailyRate) : null,
            hourly_rate: hourlyRate ? Number(hourlyRate) : null,
            standard_monthly_hours: stdMonthlyHours ? Number(stdMonthlyHours) : null,
            standard_working_hours: stdWorkingHours ? Number(stdWorkingHours) : null
        });
        alert('บันทึกค่าจ้าง/เงินเดือนเรียบร้อยแล้ว');
        await viewEmployeeDetails(id);
        switchEmpTab('settings');
    } catch (err) {
        alert('บันทึกค่าจ้างไม่สำเร็จ: ' + err.message);
    }
}

// ยืนยันการโอนเงินเบิกล่วงหน้า (บังคับแนบสลิปโอนเงินก่อนกดยืนยันเสมอ)
// หมายเหตุ: ฟังก์ชันนี้ถูกอ้างอิงใน modal.js มานานแล้วแต่ไม่เคยถูกสร้างจริง - เพิ่มให้ใช้งาน
// ได้จริงพร้อมกับฟีเจอร์แสดงยอดประมาณการตอนอนุมัติ (item เสนอเพิ่มรอบนี้)
async function approveAdvance(employeeId, advanceId) {
    const fileInput = document.getElementById(`slip_${advanceId}`);
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        alert('กรุณาแนบสลิปโอนเงินก่อนยืนยัน (บังคับแนบ)');
        return;
    }
    if (!confirm('ยืนยันว่าได้โอนเงินให้พนักงานเรียบร้อยแล้ว?')) return;

    try {
        const file = fileInput.files[0];
        const fileName = `advance-slips/${advanceId}-${Date.now()}-${file.name}`;
        const slipUrl = await CandidateService.uploadSlipAndGetUrl(file, fileName);
        const { data: userData } = await supabaseClient.auth.getUser();

        await CandidateService.updateAdvancePayment(advanceId, {
            status: 'approved',
            transfer_slip_url: slipUrl,
            approved_at: new Date().toISOString(),
            approved_by: userData?.user?.id || null
        });
        alert('ยืนยันการโอนเงินเรียบร้อยแล้ว');
        await viewEmployeeDetails(employeeId);
        switchEmpTab('advance');
    } catch (err) {
        alert('ยืนยันการโอนเงินไม่สำเร็จ: ' + err.message);
    }
}

async function rejectAdvance(employeeId, advanceId) {
    const reasonInput = document.getElementById(`rejectReason_${advanceId}`);
    const reason = reasonInput ? reasonInput.value.trim() : '';
    if (!confirm('ยืนยันไม่อนุมัติคำขอเบิกเงินนี้?')) return;

    try {
        await CandidateService.updateAdvancePayment(advanceId, {
            status: 'rejected',
            admin_remarks: reason || null
        });
        alert('บันทึกการไม่อนุมัติเรียบร้อยแล้ว');
        await viewEmployeeDetails(employeeId);
        switchEmpTab('advance');
    } catch (err) {
        alert('บันทึกไม่สำเร็จ: ' + err.message);
    }
}

// สร้างคำขอเบิกเงินจำลองสำหรับทดสอบ QA เท่านั้น (ปุ่ม "+ ทดสอบจำลองคำขอเบิกเงิน" ใน
// แท็บเบิกเงินล่วงหน้า) - เดิมเป็นปุ่มที่ไม่เคยมีฟังก์ชันจริงมาก่อน เพิ่มให้ใช้งานได้จริง
// หมายเหตุ: ใช้จำนวนเงินคงที่ (500 บาท) แทน prompt() เพราะ prompt() ใช้ไม่ได้ในบาง
// webview/เบราว์เซอร์มือถือ - ถ้าต้องการยอดอื่น ให้ใช้ปุ่มขอเบิกจริงจากฝั่งพนักงานแทน
async function simulateAdvanceRequest(employeeId, empId) {
    if (!empId || empId === 'null' || empId === 'undefined') {
        alert('พนักงานคนนี้ยังไม่มีรหัสพนักงาน (emp_id) จึงจำลองคำขอไม่ได้');
        return;
    }
    if (!confirm('สร้างคำขอเบิกเงินจำลองจำนวน 500 บาท สำหรับทดสอบ QA?')) return;

    try {
        await CandidateService.createAdvancePayment({
            emp_id: empId,
            amount: 500,
            status: 'pending',
            employee_remark: '(คำขอจำลองสำหรับทดสอบ QA โดยแอดมิน)'
        });
        alert('สร้างคำขอเบิกเงินจำลองเรียบร้อยแล้ว');
        await viewEmployeeDetails(employeeId);
        switchEmpTab('advance');
    } catch (err) {
        alert('สร้างคำขอจำลองไม่สำเร็จ: ' + err.message);
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
        fetchEmployees(); 
    } catch (err) {
        alert('เกิดข้อผิดพลาดในการอัปเดต: ' + err.message);
    }
}

async function restoreCandidate(id) {
    if (!confirm('ยืนยันดึงผู้สมัครคนนี้กลับมาพิจารณาใหม่อีกครั้ง? (ข้อมูลการนัดสัมภาษณ์เดิมจะถูกล้างค่าใหม่ทั้งหมด)')) return;
    try {
        await CandidateService.updateCandidateData(id, {
            status: 'applied', 
            is_reconsidered: true, 
            interview_date: null,  
            interview_time: null,  
            interview_type: null,  
            available_start_date: null 
        });
        alert('ดึงข้อมูลกลับมาเพื่อพิจารณาใหม่เรียบร้อยแล้วครับ');
        closeModal();
        fetchEmployees();
    } catch (err) {
        alert('เกิดข้อผิดพลาด: ' + err.message);
    }
}