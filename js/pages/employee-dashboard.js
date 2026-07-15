document.addEventListener('DOMContentLoaded', () => {
    checkEmployeeSession();
    startClock();
});

function checkEmployeeSession() {
    const sessionData = localStorage.getItem('priff_emp_session');
    
    if (!sessionData) {
        window.location.href = 'employee-login.html';
        return;
    }

    try {
        const emp = JSON.parse(sessionData);
        
        // แสดงแค่ชื่อและรหัสพนักงานพอ
        document.getElementById('empNameDisplay').textContent = emp.full_name;
        document.getElementById('empIdDisplay').textContent = emp.emp_id;
        
    } catch (err) {
        console.error("Session data is corrupted", err);
        confirmLogout(); 
    }
}

function startClock() {
    const timeDisplay = document.getElementById('currentTimeDisplay');
    const dateDisplay = document.getElementById('currentDateDisplay');

    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };

    setInterval(() => {
        const now = new Date();
        timeDisplay.textContent = now.toLocaleTimeString('th-TH', { hour12: false });
        dateDisplay.textContent = now.toLocaleDateString('th-TH', options);
    }, 1000);
}

// ฟังก์ชันเปิด Modal แจ้งเตือน
function logoutEmployee() {
    const modal = document.getElementById('logoutConfirmModal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex'); // สลับเป็น flex ตอนแสดงผลเท่านั้น
    }
}

// ฟังก์ชันปิด Modal แจ้งเตือน
function cancelLogout() {
    const modal = document.getElementById('logoutConfirmModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex'); // เอา flex ออกตอนซ่อน
    }
}

// ฟังก์ชันยืนยันการออกจากระบบ
function confirmLogout() {
    localStorage.removeItem('priff_emp_session');
    window.location.href = 'employee-login.html';
}

function openTimestampCamera() {
    alert("ระบบกล้องถ่ายรูปลงเวลาพร้อมจับพิกัด GPS จะถูกเปิดขึ้นที่นี่!");
}