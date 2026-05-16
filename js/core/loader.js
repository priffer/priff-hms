// ฟังก์ชันดูดไฟล์ HTML ย่อยมาแสดงผล
async function loadComponent(elementId, filePath) {
    try {
        const response = await fetch(filePath);
        if (!response.ok) throw new Error(`ไม่สามารถโหลด ${filePath} ได้`);
        const html = await response.text();
        document.getElementById(elementId).innerHTML = html;
    } catch (error) {
        console.error("Component Load Error:", error);
    }
}

// โหลดทุกส่วนพร้อมกันเพื่อให้เว็บไม่กระตุก
async function initApp() {
    await Promise.all([
        loadComponent('comp-personal-info', 'components/1-personal-info.html'),
        loadComponent('comp-documents', 'components/2-documents.html'),
        loadComponent('comp-job-selection', 'components/3-job-selection.html'),
        loadComponent('comp-office-fields', 'components/4-office-fields.html'),
        loadComponent('comp-ops-fields', 'components/5-ops-fields.html'),
        loadComponent('comp-submit-section', 'components/6-submit-section.html')
    ]);

    // ส่งสัญญาณบอกเบราว์เซอร์ว่า "ประกอบร่างเสร็จแล้ว รัน JS ได้เลย!"
    document.dispatchEvent(new Event('ComponentsLoaded'));
}

initApp();