async function uploadFile(fileInputId) {
    const fileInput = document.getElementById(fileInputId);
    if (!fileInput || fileInput.files.length === 0) return null;
    const file = fileInput.files[0];
    const fileName = `companies/${targetCompanyId}/${fileInputId}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.${file.name.split('.').pop()}`;
    await CandidateService.uploadCandidateFile(file, fileName);
    return CandidateService.getFilePublicUrl(fileName);
}

async function uploadMultipleCerts() {
    const fileInput = document.getElementById('otherCertsFiles');
    if (!fileInput || fileInput.files.length === 0) return null;
    const urls = [];
    for (let i = 0; i < fileInput.files.length; i++) {
        const file = fileInput.files[i];
        const fileName = `companies/${targetCompanyId}/cert_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}.${file.name.split('.').pop()}`;
        await CandidateService.uploadCandidateFile(file, fileName);
        urls.push(CandidateService.getFilePublicUrl(fileName));
    }
    return urls.length > 0 ? urls.join(', ') : null;
}

DOM.form.addEventListener('submit', async function(event) {
    event.preventDefault();
    const btn = DOM.btnSubmit;
    const alertBox = DOM.alertBox;
    const jobGroup = DOM.jobGroupSelect.value;
    const eduLevel = document.getElementById('educationLevel').value;

    if (!document.getElementById('pdpaConsent').checked) return alert("กรุณากดยอมรับเงื่อนไข PDPA ก่อนส่งใบสมัคร");
    if (jobGroup === 'office' && eduLevel === 'ไม่มีวุฒิการศึกษา') return alert('ตำแหน่งออฟฟิศ จำเป็นต้องระบุวุฒิการศึกษาสูงสุดครับ');
    if (jobGroup === 'office' && document.getElementById('resumeFile').files.length === 0) return alert('กรุณาอัปโหลด "Resume/CV" สำหรับออฟฟิศ');

    let finalZonesStr = null;
    let combinedHealthData = null;

    if (jobGroup === 'operations') {
        const selectedZones = ZonePicker.getFinalZonesArray();
        const checkOther = document.getElementById('checkOtherZone');
        const inputOther = document.getElementById('inputOtherZone');
        
        if (checkOther && checkOther.checked && !inputOther.value.trim()) return alert('คุณติ๊กเลือก "พื้นที่อื่นๆ" กรุณาพิมพ์ระบุพื้นที่ด้วยครับ');
        if (selectedZones.length === 0) return alert('กรุณาเลือกโซนพื้นที่ทำงานที่ท่านสะดวกอย่างน้อย 1 ที่ครับ');
        
        finalZonesStr = selectedZones.join(', ');
        combinedHealthData = `ส่วนสูง: ${document.getElementById('height').value} ซม. | น้ำหนัก: ${document.getElementById('weight').value} กก. | โรคประจำตัว: ${document.getElementById('medicalCondition').value}`;
    }

    btn.innerHTML = 'กำลังประมวลผลข้อมูลและอัปโหลดเอกสารทั้งหมด...';
    btn.disabled = true;
    btn.classList.add('opacity-70', 'cursor-not-allowed');
    alertBox.classList.add('hidden');

    try {
        const [ profile, idcard, house, edu, resume, driving, workcert, multipleCerts ] = await Promise.all([
            uploadFile('profilePhoto'), uploadFile('idCardFile'), uploadFile('houseRegFile'),
            uploadFile('educationFile'), uploadFile('resumeFile'),
            uploadFile('drivingLicenseFile'), uploadFile('workCertFile'), uploadMultipleCerts()
        ]);

        const latestJobEl = document.getElementById('latestJob');
        const latestMistakeEl = document.getElementById('latestMistake');

        const payload = {
            company_id: targetCompanyId,
            job_group: jobGroup === 'office' ? 'ออฟฟิศ/ฝ่ายขาย' : 'ปฏิบัติการ/ทำความสะอาด',
            full_name: document.getElementById('fullName').value,
            id_card_number: document.getElementById('idCard').value,
            gender: document.getElementById('gender').value,
            birth_date: document.getElementById('birthDate').value,
            marital_status: document.getElementById('maritalStatus').value,
            phone_number: document.getElementById('phone').value,
            email: document.getElementById('email').value,
            current_address: document.getElementById('currentAddress').value,
            emergency_contact: document.getElementById('emergencyContact').value,
            education_level: eduLevel,
            interested_position: document.getElementById('interestedPosition').value,
            expected_salary: document.getElementById('expectedSalary').value,
            available_start_date: document.getElementById('availableStartDate').value,

            work_experience: jobGroup === 'office' ? document.getElementById('workExperience').value : null,
            latest_job: (jobGroup === 'office' && latestJobEl) ? latestJobEl.value : null,
            driving_and_travel: jobGroup === 'office' ? document.getElementById('drivingAndTravel').value : null,
            tech_ai_skills: jobGroup === 'office' ? document.getElementById('techAiSkills').value : null,
            self_learning: jobGroup === 'office' ? document.getElementById('selfLearning').value : null,
            latest_mistake: (jobGroup === 'office' && latestMistakeEl) ? latestMistakeEl.value : null,
            problem_solving: jobGroup === 'office' ? document.getElementById('problemSolving').value : null,
            teamwork_attitude: jobGroup === 'office' ? document.getElementById('teamworkAttitude').value : null,
            reason_for_joining: jobGroup === 'office' ? document.getElementById('reasonForJoining').value : null,
            career_goal: jobGroup === 'office' ? document.getElementById('careerGoal').value : null,
            reference_person: jobGroup === 'office' ? document.getElementById('referencePerson').value : null,
            
            work_mode: jobGroup === 'operations' ? document.getElementById('workMode').value : null,
            shift_work: jobGroup === 'operations' ? document.getElementById('shiftWork').value : null,
            commute_method: jobGroup === 'operations' ? document.getElementById('commuteMethod').value : null,
            health_and_shape: combinedHealthData,
            criminal_record: jobGroup === 'operations' ? document.getElementById('criminalRecord').value : null,
            
            preferred_zone: finalZonesStr,
            ops_skills: jobGroup === 'operations' ? Array.from(document.querySelectorAll('input[name="opsSkills"]:checked')).map(cb => cb.value).join(', ') : null,
            
            profile_photo_url: profile, id_card_url: idcard, house_reg_url: house,
            education_cert_url: edu, resume_url: resume, 
            driving_license_url: driving, work_certificate_url: workcert, other_certificates: multipleCerts,
            
            status: 'applied'
        };

        await CandidateService.submitApplication(payload);

        alertBox.className = 'mb-6 p-4 border-2 font-bold text-center border-green-500 bg-green-50 text-green-700 block';
        alertBox.innerHTML = 'ส่งใบสมัครงานและเอกสารสำเร็จเรียบร้อยแล้ว! ระบบกำลังพากลับหน้าหลัก...';
        
        localStorage.removeItem('selected_position_title');
        localStorage.removeItem('target_company_id');

        DOM.form.reset();
        document.querySelectorAll('[id^="btn-clear-"]').forEach(btn => btn.classList.add('hidden'));
        if (jobGroup === 'operations') ZonePicker.clearData();

        setTimeout(() => { window.location.href = 'index.html'; }, 2000);

    } catch (error) {
        alertBox.className = 'mb-6 p-4 border-2 font-bold text-center border-red-500 bg-red-50 text-red-700 block';
        alertBox.innerHTML = 'เกิดข้อผิดพลาดในการบันทึก: ' + error.message;
        btn.innerHTML = 'ยืนยันและส่งใบสมัครงาน';
        btn.disabled = false;
        btn.classList.remove('opacity-70', 'cursor-not-allowed');
    }
});