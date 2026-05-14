// 1. Initial Configuration & DOM Elements
const form = document.getElementById('applyForm');
const jobGroupSelect = document.getElementById('jobGroup');
const officeSkills = document.getElementById('officeSkills');
const opsSpecific = document.getElementById('opsSpecific');
const emailInput = document.getElementById('email');
const btn = document.getElementById('submitBtn');
const alertBox = document.getElementById('alertBox');

// 2. UI Logic Functions (แสดง/ซ่อน ปุ่มลบไฟล์)
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
    input.value = ''; // เคลียร์ไฟล์ทิ้ง
    document.getElementById(`btn-clear-${inputId}`).classList.add('hidden');
};

function toggleJobFields(val) {
    officeSkills.classList.add('hidden');
    officeSkills.classList.remove('grid');
    opsSpecific.classList.add('hidden');
    opsSpecific.classList.remove('grid');
    
    if (val === 'office') {
        officeSkills.classList.remove('hidden');
        officeSkills.classList.add('grid');
        emailInput.required = true;
        emailInput.placeholder = "อีเมล (Email) *ต้องระบุ";
    } else if (val === 'operations') {
        opsSpecific.classList.remove('hidden');
        opsSpecific.classList.add('grid');
        emailInput.required = false;
        emailInput.placeholder = "อีเมล (ถ้ามี)";
    }
}

async function loadPdpaContent() {
    const { data, error } = await supabaseClient
        .from('system_settings')
        .select('setting_value')
        .eq('setting_key', 'PDPA_CONTENT')
        .single();

    const pdpaBody = document.getElementById('pdpaBody');
    if (!error && data) {
        pdpaBody.innerText = data.setting_value;
    } else {
        pdpaBody.innerText = "กรุณากดยอมรับเงื่อนไขการสมัครงานตามนโยบายของบริษัท";
    }
}

// ฟังก์ชันช่วยอัปโหลดไฟล์
async function uploadFileToStorage(fileInputId) {
    const fileInput = document.getElementById(fileInputId);
    if (!fileInput || fileInput.files.length === 0) return null;
    
    const file = fileInput.files[0];
    const fileExt = file.name.split('.').pop();
    const newFileName = `${fileInputId}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.${fileExt}`;
    
    const { error } = await supabaseClient.storage.from('recruitment_files').upload(newFileName, file);
    if (error) throw new Error(`อัปโหลดไฟล์ไม่สำเร็จ`);
    
    const { data } = supabaseClient.storage.from('recruitment_files').getPublicUrl(newFileName);
    return data.publicUrl;
}

// 3. Form Handling Functions
async function handleFormSubmit(event) {
    event.preventDefault();

    if (!document.getElementById('pdpaConsent').checked) {
        alert("กรุณากดยอมรับเงื่อนไข PDPA ก่อนส่งใบสมัคร");
        return;
    }

    const jobGroup = jobGroupSelect.value;

    // ตรวจสอบความถูกต้อง (Validation) แยกตามสายงาน
    if (jobGroup === 'office') {
        if (document.getElementById('educationFile').files.length === 0) {
            alert('กรุณาอัปโหลด "สำเนาวุฒิการศึกษา" สำหรับตำแหน่งออฟฟิศ');
            return;
        }
        if (document.getElementById('resumeFile').files.length === 0) {
            alert('กรุณาอัปโหลด "Resume / CV" สำหรับตำแหน่งออฟฟิศ');
            return;
        }
    }

    btn.innerHTML = 'กำลังอัปโหลดเอกสาร และประมวลผล...';
    btn.disabled = true;
    btn.classList.add('opacity-70', 'cursor-not-allowed');
    alertBox.classList.add('hidden');

    try {
        // อัปโหลดไฟล์ทั้งหมดพร้อมกัน
        const [
            profile_photo_url, id_card_url, house_reg_url, 
            education_cert_url, resume_url, certificate_url
        ] = await Promise.all([
            uploadFileToStorage('profilePhoto'),
            uploadFileToStorage('idCardFile'),
            uploadFileToStorage('houseRegFile'),
            uploadFileToStorage('educationFile'),
            uploadFileToStorage('resumeFile'),
            uploadFileToStorage('certificateFile')
        ]);

        // บันทึกข้อมูลลงฐานข้อมูล
        const { error: insertError } = await supabaseClient.from('employees').insert([{
            job_group: jobGroup === 'office' ? 'ออฟฟิศ/ฝ่ายขาย' : 'ปฏิบัติการ/ทำความสะอาด',
            full_name: document.getElementById('fullName').value,
            id_card_number: document.getElementById('idCard').value,
            gender: document.getElementById('gender').value,
            birth_date: document.getElementById('birthDate').value,
            marital_status: document.getElementById('maritalStatus').value,
            phone_number: document.getElementById('phone').value,
            email: emailInput.value,
            current_address: document.getElementById('currentAddress').value,
            emergency_contact: document.getElementById('emergencyContact').value,
            education_level: document.getElementById('educationLevel').value,
            driving_ability: document.getElementById('drivingAbility').value,
            work_experience: document.getElementById('workExperience').value,
            tech_ai_skills: jobGroup === 'office' ? document.getElementById('techAiSkills').value : null,
            special_skills: jobGroup === 'office' ? document.getElementById('specialSkills').value : null,
            interested_position: document.getElementById('interestedPosition').value,
            expected_salary: document.getElementById('expectedSalary').value,
            work_mode: document.getElementById('workMode').value,
            available_start_date: document.getElementById('availableStartDate').value,
            preferred_zone: jobGroup === 'operations' ? document.getElementById('preferredZone').value : null,
            shift_work: jobGroup === 'operations' ? document.getElementById('shiftWork').value : null,
            
            profile_photo_url: profile_photo_url,
            id_card_url: id_card_url,
            house_reg_url: house_reg_url,
            education_cert_url: education_cert_url,
            resume_url: resume_url,
            certificate_url: certificate_url,
            
            status: 'applied'
        }]);

        if (insertError) throw new Error('บันทึกข้อมูลไม่สำเร็จ: ' + insertError.message);

        alertBox.className = 'mb-6 p-4 border-2 font-bold text-center border-green-500 bg-green-50 text-green-700 rounded-none block';
        alertBox.innerHTML = 'ส่งใบสมัครและเอกสารสำเร็จ! ระบบกำลังพากลับไปหน้าหลัก...';
        form.reset();
        
        // ซ่อนปุ่มลบไฟล์ทั้งหมดหลังส่งสำเร็จ
        document.querySelectorAll('[id^="btn-clear-"]').forEach(btn => btn.classList.add('hidden'));

        setTimeout(() => { window.location.href = 'index.html'; }, 2000);

    } catch (error) {
        alertBox.className = 'mb-6 p-4 border-2 font-bold text-center border-red-500 bg-red-50 text-red-700 rounded-none block';
        alertBox.innerHTML = error.message;
    } finally {
        btn.innerHTML = 'ส่งใบสมัครงาน';
        btn.disabled = false;
        btn.classList.remove('opacity-70', 'cursor-not-allowed');
    }
}

// 4. Event Listeners
jobGroupSelect.addEventListener('change', (e) => toggleJobFields(e.target.value));
form.addEventListener('submit', handleFormSubmit);

document.addEventListener('DOMContentLoaded', () => {
    loadPdpaContent();
});