// ไฟล์: js/pages/apply/main.js
// หน้าที่: ไฟล์กลาง (Entry Point) สำหรับโหลด Dependencies และระบบทั้งหมดของหน้าสมัครงาน

document.addEventListener('ComponentsLoaded', () => {
    
    // 1. โหลดระบบเลือกพื้นที่ทำงาน (ZonePicker)
    const scriptZone = document.createElement('script');
    scriptZone.src = 'js/components/zonePicker.js';
    document.body.appendChild(scriptZone);
    
    scriptZone.onload = () => {
        if(typeof ZonePicker !== 'undefined') ZonePicker.init();
    };

    // 2. ทะเบียนไฟล์ย่อย (Modular) ที่ต้องใช้งานในหน้านี้
    const appScripts = [
        'js/services/candidateService.js', // ตัวคุยหลังบ้าน
        'js/pages/apply/state.js',         // ตัวแปรกลาง
        'js/pages/apply/ui.js',            // ลอจิกหน้าจอ
        'js/pages/apply/submit.js'         // ลอจิกส่งข้อมูล
    ];

    // ฟังก์ชันโหลดสคริปต์เรียงลำดับแบบอัตโนมัติ
    function bootApp(index) {
        if (index >= appScripts.length) return; // โหลดครบแล้วหยุด
        
        const script = document.createElement('script');
        script.src = appScripts[index];
        script.onload = () => bootApp(index + 1);
        document.body.appendChild(script);
    }

    // สั่งเริ่ม Boot ระบบ
    bootApp(0);
});