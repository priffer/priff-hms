const employeeScripts = [
    'js/pages/employees/list.js',
    'js/pages/employees/modal.js',
    'js/pages/employees/actions.js'
];

function loadEmployeeScripts(index) {
    if (index >= employeeScripts.length) {
        // เมื่อโหลดสคริปต์ครบแล้ว สั่งให้ดึงข้อมูลพนักงานมาแสดง
        if (typeof loadEmployees === 'function') {
            loadEmployees();
        }
        return;
    }
    
    const script = document.createElement('script');
    script.src = employeeScripts[index];
    script.onload = () => loadEmployeeScripts(index + 1);
    document.body.appendChild(script);
}

document.addEventListener('DOMContentLoaded', () => {
    loadEmployeeScripts(0);
});