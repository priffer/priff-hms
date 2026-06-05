const dashboardScripts = [
    'js/pages/dashboard/tabs.js',
    'js/pages/dashboard/modal.js',
    'js/pages/dashboard/actions.js',
    'js/pages/dashboard/settings.js'
];

function loadDashboardScripts(index) {
    if (index >= dashboardScripts.length) {
        // เมื่อโหลดสคริปต์ย่อยครบบริบูรณ์ ให้สั่งดึงข้อมูลตารางชุดแรกขึ้นมาแสดงผลทันที
        if (typeof fetchEmployees === 'function') {
            fetchEmployees();
        }
        return;
    }
    
    const script = document.createElement('script');
    script.src = dashboardScripts[index];
    script.onload = () => loadDashboardScripts(index + 1);
    document.body.appendChild(script);
}

document.addEventListener('DOMContentLoaded', () => {
    loadDashboardScripts(0);
});