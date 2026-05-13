const fileInput = document.getElementById('uploadFile');
const clearFileBtn = document.getElementById('clearFileBtn');

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
      const fullName = document.getElementById('fullName').value;
      const gender = document.getElementById('gender').value;
      const idCard = document.getElementById('idCard').value;
      const phone = document.getElementById('phone').value;
      const jobGroup = document.getElementById('jobGroup').value;
      const interestedPosition = document.getElementById('interestedPosition').value;
      const expectedSalary = document.getElementById('expectedSalary').value;
      const availableStartDate = document.getElementById('availableStartDate').value;

      const fileExt = file.name.split('.').pop();
      const randomString = Math.random().toString(36).substring(2, 10);
      const newFileName = `cv_${Date.now()}_${randomString}.${fileExt}`;
      
      const { data: uploadData, error: uploadError } = await supabaseClient.storage
        .from('recruitment_files')
        .upload(newFileName, file);

      if (uploadError) throw new Error('อัปโหลดไฟล์ไม่สำเร็จ');

      const { data: publicUrlData } = supabaseClient.storage
        .from('recruitment_files')
        .getPublicUrl(newFileName);
      const fileUrl = publicUrlData.publicUrl;

      const { error: insertError } = await supabaseClient
        .from('employees')
        .insert([{
            full_name: fullName,
            gender: gender,
            id_card_number: idCard,
            phone_number: phone,
            job_group: jobGroup,
            interested_position: interestedPosition,
            expected_salary: expectedSalary,
            available_start_date: availableStartDate,
            resume_url: fileUrl,
            status: 'applied'
        }]);

      if (insertError) throw new Error('บันทึกข้อมูลไม่สำเร็จ');

      alertBox.className = 'mb-6 p-4 border-2 font-bold text-center border-green-500 bg-green-50 text-green-700 rounded-none block';
      alertBox.innerHTML = 'ส่งใบสมัครสำเร็จ! ข้อมูลของคุณถูกบันทึกเรียบร้อยแล้ว';
      document.getElementById('applyForm').reset();
      clearFileBtn.classList.add('hidden');

    } catch (error) {
      alertBox.className = 'mb-6 p-4 border-2 font-bold text-center border-red-500 bg-red-50 text-red-700 rounded-none block';
      alertBox.innerHTML = error.message;
    } finally {
      btn.innerHTML = 'ส่งใบสมัคร';
      btn.disabled = false;
      btn.classList.remove('opacity-70', 'cursor-not-allowed');
    }
});