// js/pages/apply.js

document.getElementById('applyForm').addEventListener('submit', async function(event) {
    event.preventDefault();
    
    const btn = document.getElementById('submitBtn');
    const alertBox = document.getElementById('alertBox');
    const fileInput = document.getElementById('uploadFile');
    
    if (fileInput.files.length === 0) return;

    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> กำลังประมวลผล...';
    btn.disabled = true;
    alertBox.style.display = 'none';

    try {
      const file = fileInput.files[0];
      const firstName = document.getElementById('firstName').value;
      const lastName = document.getElementById('lastName').value;
      const idCard = document.getElementById('idCard').value;
      const phone = document.getElementById('phone').value;

      // สุ่มชื่อไฟล์
      const fileExt = file.name.split('.').pop();
      const randomString = Math.random().toString(36).substring(2, 10);
      const newFileName = `cv_${Date.now()}_${randomString}.${fileExt}`;
      
      const { data: uploadData, error: uploadError } = await supabaseClient.storage
        .from('recruitment_files')
        .upload(newFileName, file);

      if (uploadError) throw new Error('อัปโหลดไฟล์ไม่สำเร็จ: ' + uploadError.message);

      const { data: publicUrlData } = supabaseClient.storage
        .from('recruitment_files')
        .getPublicUrl(newFileName);
      const fileUrl = publicUrlData.publicUrl;

      // บันทึกข้อมูล
      const { data: insertData, error: insertError } = await supabaseClient
        .from('employees')
        .insert([{
            first_name: firstName,
            last_name: lastName,
            id_card: idCard,
            phone: phone,
            resume_url: fileUrl
        }]);

      if (insertError) throw new Error('บันทึกข้อมูลไม่สำเร็จ: ' + insertError.message);

      alertBox.className = 'alert alert-success mt-3';
      alertBox.innerHTML = '✅ ส่งใบสมัครสำเร็จ! ข้อมูลของคุณถูกบันทึกเรียบร้อยแล้ว';
      alertBox.style.display = 'block';
      document.getElementById('applyForm').reset();

    } catch (error) {
      alertBox.className = 'alert alert-danger mt-3';
      alertBox.innerHTML = '❌ ' + error.message;
      alertBox.style.display = 'block';
    } finally {
      btn.innerHTML = 'ส่งใบสมัคร';
      btn.disabled = false;
    }
});