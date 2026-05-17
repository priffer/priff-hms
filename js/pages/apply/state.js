// ดึงข้อมูลบริษัทเป้าหมายและตำแหน่ง
const targetCompanyId = localStorage.getItem('target_company_id') || 'comp_kc_clean';
const selectedPositionTitle = localStorage.getItem('selected_position_title');

// ตัวแปร DOM กลางที่ใช้ร่วมกัน
const DOM = {
    form: document.getElementById('applyForm'),
    jobGroupSelect: document.getElementById('jobGroup'),
    specificFieldsContainer: document.getElementById('specificFieldsContainer'),
    officeFields: document.getElementById('officeFields'),
    opsFields: document.getElementById('opsFields'),
    btnSubmit: document.getElementById('submitBtn'),
    alertBox: document.getElementById('alertBox')
};