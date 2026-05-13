// ตรวจสอบว่ามีคนกดปุ่ม Login หรือไม่
document.getElementById('loginForm').addEventListener('submit', async function(event) {
    event.preventDefault(); // ป้องกันเว็บรีเฟรช
    
    const btn = document.getElementById('loginBtn');
    const alertBox = document.getElementById('alertBox');
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
  
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> กำลังตรวจสอบ...';
    btn.disabled = true;
    alertBox.style.display = 'none';
  
    try {
      // เรียกใช้ตัวแปร supabaseClient จากไฟล์ config/supabase.js
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: email,
        password: password,
      });
  
      if (error) throw new Error('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
  
      alertBox.className = 'alert alert-success mt-3';
      alertBox.innerHTML = '✅ เข้าสู่ระบบสำเร็จ! กำลังพาท่านไปหน้าจัดการ...';
      alertBox.style.display = 'block';
  
      // ล็อกอินผ่าน เด้งไปหน้า Dashboard 
      setTimeout(() => {
        window.location.href = 'dashboard.html';
      }, 1000);
  
    } catch (error) {
      alertBox.className = 'alert alert-danger mt-3';
      alertBox.innerHTML = '❌ ' + error.message;
      alertBox.style.display = 'block';
      btn.innerHTML = 'เข้าสู่ระบบ';
      btn.disabled = false;
    }
});