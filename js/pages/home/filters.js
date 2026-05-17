const filterScripts = [
    'js/pages/home/filters/utils.js',
    'js/pages/home/filters/dropdowns.js',
    'js/pages/home/filters/search.js'
];

function loadFilterScripts(index) {
    if (index >= filterScripts.length) {
        // โหลดครบ 3 ไฟล์แล้วค่อยสั่งรันฟังก์ชันเริ่มต้น
        if (typeof initLocationFilters === 'function') {
            initLocationFilters();
        }
        return;
    }
    
    const script = document.createElement('script');
    script.src = filterScripts[index];
    script.onload = () => loadFilterScripts(index + 1);
    document.body.appendChild(script);
}

document.addEventListener('DOMContentLoaded', () => {
    loadFilterScripts(0);
});