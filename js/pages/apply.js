const jobGroupSelect = document.getElementById('jobGroup');
const officeFields = document.getElementById('officeFields');
const opsFields = document.getElementById('opsFields');
const emailInput = document.getElementById('email');
const fileLabel = document.getElementById('fileLabel');

const fileInput = document.getElementById('uploadFile');
const clearFileBtn = document.getElementById('clearFileBtn');

// Logic สลับฟอร์มตามกลุ่มงาน
jobGroupSelect.addEventListener('change', function() {
    const val = this.value;
    
    if (val === 'office') {
        officeFields.classList.remove('hidden');
        opsFields.classList.add('hidden');
        emailInput.required = true; // บังคับกรอกอีเมล
        fileLabel.innerHTML = 'แนบเอกสาร (Resume หรือ CV) *';
    } else if (val === 'operations') {
        opsFields.classList.remove('hidden');
        officeFields.classList.add('hidden');
        emailInput.required = false; // ไม่บังคับอีเมล
        emailInput.value = ''; 
        fileLabel.innerHTML = 'แนบรูปถ่ายบัตรประชาชน หรือ รูปถ่ายตัวเอง *';
    } else {
        officeFields.classList.add('hidden');
        opsFields.classList.add('hidden');
        emailInput.required = false;
    }
});

// Logic ปุ่มลบไฟล์
fileInput.addEventListener('change', function() {
    if (this.files.length > 0) {
        clearFileBtn.classList.remove('hidden');
    } else {
        clearFileBtn.classList.add('hidden');
    }
});

clearFileBtn.addEventListener('click', function() {
    fileInput.value = ''; 
    this.classList.add('hidden');
});

// จัดการ Submit
document.getElementById('applyForm').addEventListener('submit', async function(event) {
    event.preventDefault();
    
    const btn = document.getElementById('submitBtn');
    const alertBox = document.getElementById('alertBox');
    
    if (fileInput.files.length === 0) return;

    btn.innerHTML = 'กำลังประมวลผล...';
    btn.disabled = true;
    btn.classList.add('opacity-70', 'cursor-not-allowed');
    alertBox.classList.add('hidden');

    try {
      const file = fileInput.files[0];
      const jobGroup = jobGroupSelect.value;
      
      // ดึงค่าตาม Logic
      const finalEmail = jobGroup === 'office' ? document.getElementById('email').value : document.getElementById('opsEmail').value;
      const educationLevel = jobGroup === 'office' ? document.getElementById('educationLevel').value : null;
      const preferredZone = jobGroup === 'operations' ? document.getElementById('preferredZone').value : null;

      const fileExt = file.name.split('.').pop();
      const newFileName = `doc_${Date.now()}_${Math.random().toString(36).substring(2, 10)}.${fileExt}`;
      
      const { error: uploadError } = await supabaseClient.storage
        .from('recruitment_files')
        .upload(newFileName, file);

      if (uploadError) throw new Error('อัปโหลดไฟล์ไม่สำเร็จ');

      const { data: publicUrlData } = supabaseClient.storage
        .from('recruitment_files')
        .getPublicUrl(newFileName);

      const { error: insertError } = await supabaseClient
        .from('employees')
        .insert([{
            full_name: document.getElementById('fullName').value,
            gender: document.getElementById('gender').value,
            id_card_number: document.getElementById('idCard').value,
            phone_number: document.getElementById('phone').value,
            job_group: jobGroup === 'office' ? 'ออฟฟิศ/ฝ่ายขาย' : 'ปฏิบัติการ/ทำความสะอาด',
            email: finalEmail,
            education_level: educationLevel,
            preferred_zone: preferredZone,
            interested_position: document.getElementById('interestedPosition').value,
            expected_salary: document.getElementById('expectedSalary').value,
            resume_url: publicUrlData.publicUrl,
            status: 'applied'
        }]);

      if (insertError) throw new Error('บันทึกข้อมูลไม่สำเร็จ');

      alertBox.className = 'mb-6 p-4 border-2 font-bold text-center border-green-500 bg-green-50 text-green-700 rounded-none block';
      alertBox.innerHTML = 'ส่งใบสมัครสำเร็จ! ระบบกำลังพากลับไปหน้าหลัก...';
      document.getElementById('applyForm').reset();
      clearFileBtn.classList.add('hidden');

      setTimeout(() => { window.location.href = 'index.html'; }, 2000);

    } catch (error) {
      alertBox.className = 'mb-6 p-4 border-2 font-bold text-center border-red-500 bg-red-50 text-red-700 rounded-none block';
      alertBox.innerHTML = error.message;
    } finally {
      btn.innerHTML = 'ส่งใบสมัคร';
      btn.disabled = false;
      btn.classList.remove('opacity-70', 'cursor-not-allowed');
    }
});