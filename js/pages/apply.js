// ฟอร์มหลักและการบันทึกข้อมูล
const form = document.getElementById('applyForm');
const jobGroupSelect = document.getElementById('jobGroup');
const specificFieldsContainer = document.getElementById('specificFieldsContainer');
const officeFields = document.getElementById('officeFields');
const opsFields = document.getElementById('opsFields');

// แก้บั๊ก PDPA: สั่งให้ทำงานทันที ไม่ต้องรอ DOMContentLoaded แล้ว
async function loadPdpaContent() {
    try {
        const { data, error } = await supabaseClient.from('system_settings').select('setting_value').eq('setting_key', 'PDPA_CONTENT').single();
        if (data && data.setting_value) {
            document.getElementById('pdpaBody').innerText = data.setting_value;
        } else {
            throw new Error('No Data');
        }
    } catch (error) {
        document.getElementById('pdpaBody').innerText = "ข้าพเจ้ายินยอมให้บริษัทฯ เก็บรวบรวม ใช้ และเปิดเผยข้อมูลส่วนบุคคลของข้าพเจ้า เพื่อพิจารณาการรับสมัครงาน ตาม พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล (PDPA)";
    }
}
// เรียกใช้ฟังก์ชันทันที
loadPdpaContent();

// สลับฟอร์มตามตำแหน่ง
jobGroupSelect.addEventListener('change', function() {
    const val = this.value;
    if(val) specificFieldsContainer.classList.remove('hidden');
    else specificFieldsContainer.classList.add('hidden');

    const officeReq = ['latestJob', 'drivingAndTravel', 'techAiSkills', 'selfLearning', 'latestMistake', 'problemSolving', 'teamworkAttitude', 'reasonForJoining', 'careerGoal'];
    const opsReq = ['workMode', 'shiftWork', 'commuteMethod', 'height', 'weight', 'medicalCondition', 'criminalRecord'];

    if (val === 'office') {
        officeFields.classList.remove('hidden');
        opsFields.classList.add('hidden');
        officeReq.forEach(id => { const el = document.getElementById(id); if(el) el.required = true; });
        opsReq.forEach(id => { const el = document.getElementById(id); if(el) el.required = false; });
        document.getElementById('email').required = true;
        document.getElementById('eduLabel').innerHTML = '4. สำเนาวุฒิการศึกษา <span class="text-xs font-normal text-red-500">(ควรแนบสำหรับออฟฟิศ)</span>';
    } else if (val === 'operations') {
        opsFields.classList.remove('hidden');
        officeFields.classList.add('hidden');
        opsReq.forEach(id => { const el = document.getElementById(id); if(el) el.required = true; });
        officeReq.forEach(id => { const el = document.getElementById(id); if(el) el.required = false; });
        document.getElementById('email').required = false;
        document.getElementById('eduLabel').innerHTML = '4. สำเนาวุฒิการศึกษา <span class="text-xs font-normal text-gray-500">(ถ้ามี)</span>';
    }
});

document.querySelectorAll('.file-input-trigger').forEach(input => {
    input.addEventListener('change', function() {
        const clearBtn = document.getElementById(`btn-clear-${this.id}`);
        if (clearBtn) {
            if (this.files.length > 0) clearBtn.classList.remove('hidden');
            else clearBtn.classList.add('hidden');
        }
    });
});

window.clearFile = function(inputId) {
    const input = document.getElementById(inputId);
    if (input) input.value = ''; 
    const clearBtn = document.getElementById(`btn-clear-${inputId}`);
    if (clearBtn) clearBtn.classList.add('hidden');
};

document.getElementById('otherCertsFiles').addEventListener('change', function() {
    if (this.files.length > 5) {
        alert("อัปโหลดใบเซอร์เพิ่มเติมได้สูงสุด 5 ไฟล์เท่านั้นครับ");
        this.value = ''; 
        document.getElementById('btn-clear-otherCertsFiles').classList.add('hidden');
    }
});

async function uploadFile(fileInputId) {
    const fileInput = document.getElementById(fileInputId);
    if (!fileInput || fileInput.files.length === 0) return null;
    const file = fileInput.files[0];
    const newFileName = `${fileInputId}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.${file.name.split('.').pop()}`;
    const { error } = await supabaseClient.storage.from('recruitment_files').upload(newFileName, file);
    if (error) throw new Error(`อัปโหลดไฟล์ ${fileInputId} ไม่สำเร็จ`);
    return supabaseClient.storage.from('recruitment_files').getPublicUrl(newFileName).data.publicUrl;
}

async function uploadMultipleCerts() {
    const fileInput = document.getElementById('otherCertsFiles');
    if (!fileInput || fileInput.files.length === 0) return null;
    const urls = [];
    for (let i = 0; i < fileInput.files.length; i++) {
        const file = fileInput.files[i];
        const newFileName = `cert_${Date.now()}_${i}.${file.name.split('.').pop()}`;
        const { error } = await supabaseClient.storage.from('recruitment_files').upload(newFileName, file);
        if (!error) urls.push(supabaseClient.storage.from('recruitment_files').getPublicUrl(newFileName).data.publicUrl);
    }
    return urls.length > 0 ? urls.join(', ') : null;
}

// บันทึกข้อมูลใบสมัคร
form.addEventListener('submit', async function(event) {
    event.preventDefault();
    const btn = document.getElementById('submitBtn');
    const alertBox = document.getElementById('alertBox');
    const jobGroup = jobGroupSelect.value;
    const eduLevel = document.getElementById('educationLevel').value;

    if (!document.getElementById('pdpaConsent').checked) return alert("กรุณากดยอมรับเงื่อนไข PDPA ก่อนส่งใบสมัคร");
    
    if (jobGroup === 'office') {
        if (eduLevel === 'ไม่มีวุฒิการศึกษา') return alert('ตำแหน่งออฟฟิศ จำเป็นต้องระบุวุฒิการศึกษาสูงสุดครับ');
        if (document.getElementById('resumeFile').files.length === 0) return alert('กรุณาอัปโหลด "Resume/CV" สำหรับออฟฟิศ');
    }

    let finalZonesStr = null;
    let combinedHealthData = null;

    if (jobGroup === 'operations') {
        const selectedZones = ZonePicker.getFinalZonesArray();
        
        const checkOther = document.getElementById('checkOtherZone');
        const inputOther = document.getElementById('inputOtherZone');
        if (checkOther && checkOther.checked && !inputOther.value.trim()) {
            return alert('คุณติ๊กเลือก "พื้นที่อื่นๆ" กรุณาพิมพ์ระบุพื้นที่ด้วยครับ');
        }

        if (selectedZones.length === 0) return alert('กรุณาเลือกโซนพื้นที่ทำงานที่ท่านสะดวกอย่างน้อย 1 ที่ครับ');
        finalZonesStr = selectedZones.join(', ');

        const h = document.getElementById('height').value;
        const w = document.getElementById('weight').value;
        const m = document.getElementById('medicalCondition').value;
        combinedHealthData = `ส่วนสูง: ${h} ซม. | น้ำหนัก: ${w} กก. | โรคประจำตัว: ${m}`;
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

        const { error: insertError } = await supabaseClient.from('employees').insert([{
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
        }]);

        if (insertError) throw new Error(insertError.message);

        alertBox.className = 'mb-6 p-4 border-2 font-bold text-center border-green-500 bg-green-50 text-green-700 block';
        alertBox.innerHTML = 'ส่งใบสมัครงานและเอกสารสำเร็จเรียบร้อยแล้ว! ระบบกำลังพากลับหน้าหลัก...';
        
        form.reset();
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