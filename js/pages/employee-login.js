document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('employeeLoginForm');
    const alertBox = document.getElementById('alertBox');
    const loginBtn = document.getElementById('loginBtn');

    function showAlert(message, type = 'error') {
        alertBox.textContent = message;
        alertBox.className = `mb-6 p-4 rounded-2xl border text-center font-bold text-sm block ${
            type === 'error' ? 'bg-red-50 border-red-200 text-red-600' : 'bg-emerald-50 border-emerald-200 text-emerald-600'
        }`;
    }

    // ตรวจสอบสิทธิ์ Portal ทันทีหลัง Login: ESS Portal อนุญาตเฉพาะ employee และ supervisor เท่านั้น
    async function enforceEssPortalRole(uid) {
        const { data: profile, error: profileErr } = await supabaseClient
            .from('user_profiles').select('role,status').eq('auth_uid', uid).single();
        if (profileErr || !profile || profile.status !== 'active') {
            await supabaseClient.auth.signOut();
            throw new Error('ไม่พบบัญชีผู้ใช้งานที่ใช้งานได้ กรุณาติดต่อผู้ดูแลระบบ');
        }
        if (!['employee', 'supervisor'].includes(profile.role)) {
            await supabaseClient.auth.signOut();
            const err = new Error('บัญชีนี้ไม่มีสิทธิ์เข้าใช้งาน ESS Portal กรุณาเข้าสู่ระบบผ่าน Admin Portal แทน');
            err.isPortalMismatch = true;
            throw err;
        }
        return profile;
    }

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const identifier = document.getElementById('empId').value.trim();
        const secret = document.getElementById('empPhone').value.trim();

        if (!identifier || !secret) {
            showAlert('กรุณากรอกข้อมูลให้ครบถ้วน');
            return;
        }

        const originalBtnText = loginBtn.innerHTML;
        loginBtn.innerHTML = 'กำลังตรวจสอบ...';
        loginBtn.disabled = true;
        loginBtn.classList.add('opacity-50', 'cursor-not-allowed');

        try {
            let session;
            if (identifier.includes('@')) {
                // โหมดเข้าสู่ระบบด้วยอีเมล (สำหรับ supervisor/employee ที่มีบัญชี Supabase Auth โดยตรง)
                const { data, error } = await supabaseClient.auth.signInWithPassword({ email: identifier, password: secret });
                if (error) throw new Error('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
                session = data;
            } else {
                const empId = identifier.toUpperCase();
                const empPhone = secret;

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

                // ใช้ Synthetic Email Login ผ่าน PriffLogin เพื่อสร้าง Supabase session
                session = await window.PriffLogin.loginWithEmpId(empId, empPhone);
            }

            // ตรวจสอบ role ให้ตรงกับ ESS Portal ก่อนพาไปหน้าหลัก
            await enforceEssPortalRole(session?.user?.id);

            try { localStorage.removeItem('priff_emp_session'); } catch (e) {}
            showAlert('เข้าสู่ระบบสำเร็จ! กำลังพาท่านไปยังหน้าหลัก...', 'success');
            setTimeout(() => {
                window.location.href = 'employee-dashboard.html';
            }, 1000);

        } catch (err) {
            console.error('Login Error:', err);
            if (err.isPortalMismatch) {
                alertBox.innerHTML = `❌ ${err.message} <a href="login.html" class="underline font-bold">ไปที่ Admin Portal</a>`;
                alertBox.className = 'mb-6 p-4 rounded-2xl border text-center font-bold text-sm block bg-red-50 border-red-200 text-red-600';
            } else {
                showAlert(err.message);
            }
        } finally {
            loginBtn.innerHTML = originalBtnText;
            loginBtn.disabled = false;
            loginBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        }
    });
});