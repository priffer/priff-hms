const form = document.getElementById('applyForm');
const jobGroupSelect = document.getElementById('jobGroup');
const specificFieldsContainer = document.getElementById('specificFieldsContainer');
const officeFields = document.getElementById('officeFields');
const opsFields = document.getElementById('opsFields');

// 1. โหลดข้อมูล PDPA
async function loadPdpaContent() {
    const { data } = await supabaseClient.from('system_settings').select('setting_value').eq('setting_key', 'PDPA_CONTENT').single();
    if (data) document.getElementById('pdpaBody').innerText = data.setting_value;
}
document.addEventListener('DOMContentLoaded', loadPdpaContent);

// 2. ระบบสลับฟอร์ม (Progressive Disclosure)
jobGroupSelect.addEventListener('change', function() {
    const val = this.value;
    if(val) specificFieldsContainer.classList.remove('hidden');
    else specificFieldsContainer.classList.add('hidden');

    const officeReq = ['workExperience', 'techAiSkills', 'selfLearning', 'problemSolving', 'reasonForJoining'];
    const opsReq = ['workMode', 'preferredZone', 'shiftWork', 'commuteMethod', 'healthAndShape'];

    if (val === 'office') {
        officeFields.classList.remove('hidden');
        opsFields.classList.add('hidden');
        
        // บังคับกรอกช่อง Text ของออฟฟิศ
        officeReq.forEach(id => document.getElementById(id).required = true);
        opsReq.forEach(id => document.getElementById(id).required = false);
        
        document.getElementById('email').required = true;
        
        // เปลี่ยนข้อความแนะนำ (แต่ไม่บังคับระบบ)
        document.getElementById('eduLabel').innerHTML = '4. สำเนาวุฒิการศึกษา <span class="text-xs font-normal text-red-500">(ควรแนบสำหรับตำแหน่งออฟฟิศ)</span>';
    } else if (val === 'operations') {
        opsFields.classList.remove('hidden');
        officeFields.classList.add('hidden');
        
        // บังคับกรอกช่อง Text ของปฏิบัติการ
        opsReq.forEach(id => document.getElementById(id).required = true);
        officeReq.forEach(id => document.getElementById(id).required = false);
        
        document.getElementById('email').required = false;
        
        // เปลี่ยนข้อความแนะนำ
        document.getElementById('eduLabel').innerHTML = '4. สำเนาวุฒิการศึกษา <span class="text-xs font-normal text-gray-500">(ถ้ามี)</span>';
    }
});

// 3. ระบบโชว์/ซ่อน ปุ่มลบไฟล์ และฟังก์ชันลบไฟล์
document.querySelectorAll('.file-input-trigger').forEach(input => {
    input.addEventListener('change', function() {
        const clearBtn = document.getElementById(`btn-clear-${this.id}`);
        if (this.files.length > 0) {
            clearBtn.classList.remove('hidden');
        } else {
            clearBtn.classList.add('hidden');
        }
    });
});

window.clearFile = function(inputId) {
    const input = document.getElementById(inputId);
    input.value = ''; // เคลียร์ไฟล์ที่เลือกไว้ทิ้ง
    document.getElementById(`btn-clear-${inputId}`).classList.add('hidden'); // ซ่อนปุ่มลบ
};

// จำกัดจำนวนไฟล์ใบเซอร์ไม่เกิน 5
document.getElementById('otherCertsFiles').addEventListener('change', function() {
    if (this.files.length > 5) {
        alert("คุณสามารถอัปโหลดใบเซอร์เพิ่มเติมได้สูงสุดเพียง 5 ไฟล์เท่านั้นครับ");
        this.value = ''; 
        document.getElementById('btn-clear-otherCertsFiles').classList.add('hidden');
    }
});

// 4. ฟังก์ชันอัปโหลดไฟล์ไปยัง Supabase Storage
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
        if (!error) {
            urls.push(supabaseClient.storage.from('recruitment_files').getPublicUrl(newFileName).data.publicUrl);
        }
    }
    return urls.length > 0 ? urls.join(',') : null;
}

// 5. จัดการตอนกด Submit (บันทึกข้อมูล)
form.addEventListener('submit', async function(event) {
    event.preventDefault();
    const btn = document.getElementById('submitBtn');
    const alertBox = document.getElementById('alertBox');
    const jobGroup = jobGroupSelect.value;
    const eduLevel = document.getElementById('educationLevel').value;

    // Validation ป้องกันด่านสุดท้าย
    if (!document.getElementById('pdpaConsent').checked) return alert("กรุณากดยอมรับเงื่อนไข PDPA");
    
    if (jobGroup === 'office') {
        if (eduLevel === 'ไม่มีวุฒิการศึกษา') return alert('ตำแหน่งออฟฟิศ จำเป็นต้องระบุวุฒิการศึกษาสูงสุดครับ');
        
        // หมายเหตุ: ลบการบังคับไฟล์ educationFile ออกแล้ว (ส่งฟอร์มผ่านได้เลยแม้ไม่แนบไฟล์)
        // บังคับแค่ Resume อย่างเดียวสำหรับออฟฟิศ
        if (document.getElementById('resumeFile').files.length === 0) return alert('กรุณาอัปโหลด "Resume/CV" สำหรับตำแหน่งออฟฟิศ');
    }

    btn.innerHTML = 'กำลังประมวลผลข้อมูลและอัปโหลดเอกสารทั้งหมด...';
    btn.disabled = true;
    btn.classList.add('opacity-70', 'cursor-not-allowed');
    alertBox.classList.add('hidden');

    try {
        // อัปโหลดไฟล์ทุกช่องที่เลือกมาแบบขนาน (Parallel) เพื่อความรวดเร็ว
        const [ profile, idcard, house, edu, resume, driving, workcert, multipleCerts ] = await Promise.all([
            uploadFile('profilePhoto'), uploadFile('idCardFile'), uploadFile('houseRegFile'),
            uploadFile('educationFile'), uploadFile('resumeFile'),
            uploadFile('drivingLicenseFile'), uploadFile('workCertFile'), uploadMultipleCerts()
        ]);

        // นำข้อมูลทั้งหมดส่งเข้า Database
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

            // เฉพาะออฟฟิศ
            work_experience: jobGroup === 'office' ? document.getElementById('workExperience').value : null,
            tech_ai_skills: jobGroup === 'office' ? document.getElementById('techAiSkills').value : null,
            self_learning: jobGroup === 'office' ? document.getElementById('selfLearning').value : null,
            problem_solving: jobGroup === 'office' ? document.getElementById('problemSolving').value : null,
            reason_for_joining: jobGroup === 'office' ? document.getElementById('reasonForJoining').value : null,
            reference_person: jobGroup === 'office' ? document.getElementById('referencePerson').value : null,
            
            // เฉพาะปฏิบัติการ
            work_mode: jobGroup === 'operations' ? document.getElementById('workMode').value : null,
            preferred_zone: jobGroup === 'operations' ? document.getElementById('preferredZone').value : null,
            shift_work: jobGroup === 'operations' ? document.getElementById('shiftWork').value : null,
            commute_method: jobGroup === 'operations' ? document.getElementById('commuteMethod').value : null,
            health_and_shape: jobGroup === 'operations' ? document.getElementById('healthAndShape').value : null,
            
            // ลิงก์ไฟล์เอกสารทั้งหมด
            profile_photo_url: profile, id_card_url: idcard, house_reg_url: house,
            education_cert_url: edu, resume_url: resume, 
            driving_license_url: driving, work_certificate_url: workcert, other_certificates: multipleCerts,
            
            status: 'applied'
        }]);

        if (insertError) throw new Error(insertError.message);

        alertBox.className = 'mb-6 p-4 border-2 font-bold text-center border-green-500 bg-green-50 text-green-700 block';
        alertBox.innerHTML = 'ส่งใบสมัครสำเร็จ! ระบบกำลังพากลับไปหน้าหลัก...';
        form.reset();
        
        // ซ่อนปุ่มลบไฟล์ทั้งหมดหลังส่งฟอร์มสำเร็จ
        document.querySelectorAll('[id^="btn-clear-"]').forEach(btn => btn.classList.add('hidden'));

        setTimeout(() => { window.location.href = 'index.html'; }, 2000);

    } catch (error) {
        alertBox.className = 'mb-6 p-4 border-2 font-bold text-center border-red-500 bg-red-50 text-red-700 block';
        alertBox.innerHTML = 'เกิดข้อผิดพลาด: ' + error.message;
        btn.innerHTML = 'ยืนยันและส่งใบสมัครงาน';
        btn.disabled = false;
        btn.classList.remove('opacity-70', 'cursor-not-allowed');
    }
});