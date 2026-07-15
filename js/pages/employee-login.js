document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('employeeLoginForm');
    const alertBox = document.getElementById('alertBox');
    const loginBtn = document.getElementById('loginBtn');

    function showAlert(message, type = 'error') {
        alertBox.textContent = message;
        alertBox.className = `mb-6 p-4 border text-center font-bold text-sm block ${
            type === 'error' ? 'bg-red-50 border-red-300 text-red-700' : 'bg-green-50 border-green-300 text-green-700'
        }`;
    }

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const empId = document.getElementById('empId').value.trim().toUpperCase();
        const empPhone = document.getElementById('empPhone').value.trim();

        if (!empId || !empPhone) {
            showAlert('กรุณากรอกรหัสพนักงานและเบอร์โทรศัพท์ให้ครบถ้วน');
            return;
        }

        const originalBtnText = loginBtn.innerHTML;
        loginBtn.innerHTML = 'กำลังตรวจสอบ...';
        loginBtn.disabled = true;
        loginBtn.classList.add('opacity-50', 'cursor-not-allowed');

        try {
            console.log("🔍 กำลังค้นหา: ", empId);

            // 1. ค้นหาโดยบังคับว่า "รหัสพนักงาน" และ "เบอร์โทร" ต้องตรงกันเป๊ะ
            const { data, error } = await supabaseClient
                .from('employees')
                .select('*')
                .eq('emp_id', empId)
                .eq('phone_number', empPhone) // เปิดการเช็คเบอร์โทรกลับมาแล้ว
                .single(); // บังคับว่าต้องเจอแค่ 1 คนเท่านั้น

            if (error || !data) {
                throw new Error('รหัสพนักงาน หรือ เบอร์โทรศัพท์ ไม่ถูกต้อง');
            }

            // 2. เช็คว่าพนักงานคนนี้ยังทำงานอยู่ใช่ไหม? (ป้องกันคนลาออกแอบเข้าระบบ)
            if (data.status !== 'hired') {
                throw new Error('พนักงานคนนี้ไม่ได้อยู่ในสถานะทำงานปกติ (อาจลาออกหรือถูกพักงาน)');
            }

            showAlert('เข้าสู่ระบบสำเร็จ! กำลังพาท่านไปยังหน้าหลัก...', 'success');
            localStorage.setItem('priff_emp_session', JSON.stringify(data));

            setTimeout(() => {
                window.location.href = 'employee-dashboard.html';
            }, 1000);

        } catch (err) {
            console.error('Login Error:', err);
            showAlert(err.message);
        } finally {
            loginBtn.innerHTML = originalBtnText;
            loginBtn.disabled = false;
            loginBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        }
    });
});