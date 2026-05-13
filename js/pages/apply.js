// 1. Initial Configuration & DOM Elements
const form = document.getElementById('applyForm');
const jobGroupSelect = document.getElementById('jobGroup');
const officeSkills = document.getElementById('officeSkills');
const opsSpecific = document.getElementById('opsSpecific');
const emailInput = document.getElementById('email');
const fileLabel = document.getElementById('fileLabel');
const fileInput = document.getElementById('uploadResume');
const btn = document.getElementById('submitBtn');
const alertBox = document.getElementById('alertBox');

// 2. UI Logic Functions
function toggleJobFields(val) {
    // Reset classes
    officeSkills.classList.add('hidden');
    officeSkills.classList.remove('grid');
    opsSpecific.classList.add('hidden');
    opsSpecific.classList.remove('grid');
    
    if (val === 'office') {
        officeSkills.classList.remove('hidden');
        officeSkills.classList.add('grid');
        emailInput.required = true;
        emailInput.placeholder = "อีเมล (Email) *ต้องระบุ";
        fileLabel.innerHTML = 'อัปโหลด Resume / CV (PDF หรือ รูปภาพ) *';
    } else if (val === 'operations') {
        opsSpecific.classList.remove('hidden');
        opsSpecific.classList.add('grid');
        emailInput.required = false;
        emailInput.placeholder = "อีเมล (ถ้ามี)";
        fileLabel.innerHTML = 'อัปโหลดรูปถ่ายหน้าตรง หรือ รูปถ่ายบัตรประชาชน *';
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
        console.error('Error loading PDPA:', error);
        pdpaBody.innerText = "กรุณากดยอมรับเงื่อนไขการสมัครงานตามนโยบายของบริษัท";
    }
}

// 3. Form Handling Functions
async function handleFormSubmit(event) {
    event.preventDefault();

    if (!document.getElementById('pdpaConsent').checked) {
        alert("กรุณากดยอมรับเงื่อนไข PDPA ก่อนส่งใบสมัคร");
        return;
    }

    if (fileInput.files.length === 0) return;

    // UI Loading State
    btn.innerHTML = 'กำลังประมวลผลข้อมูล...';
    btn.disabled = true;
    btn.classList.add('opacity-70', 'cursor-not-allowed');
    alertBox.classList.add('hidden');

    try {
        const file = fileInput.files[0];
        const jobGroup = jobGroupSelect.value;
        const fileExt = file.name.split('.').pop();
        const newFileName = `doc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${fileExt}`;

        // Step 1: Upload File
        const { error: uploadError } = await supabaseClient.storage
            .from('recruitment_files')
            .upload(newFileName, file);

        if (uploadError) throw new Error('อัปโหลดไฟล์ไม่สำเร็จ');

        const { data: publicUrlData } = supabaseClient.storage
            .from('recruitment_files')
            .getPublicUrl(newFileName);

        // Step 2: Save Data to Database
        const { error: insertError } = await supabaseClient
            .from('employees')
            .insert([{
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
                resume_url: publicUrlData.publicUrl,
                status: 'applied'
            }]);

        if (insertError) throw new Error('บันทึกข้อมูลไม่สำเร็จ: ' + insertError.message);

        // Step 3: Success State
        alertBox.className = 'mb-6 p-4 border-2 font-bold text-center border-green-500 bg-green-50 text-green-700 rounded-none block';
        alertBox.innerHTML = 'ส่งใบสมัครสำเร็จ! ระบบกำลังพากลับไปหน้าหลัก...';
        form.reset();
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