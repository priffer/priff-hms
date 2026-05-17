// ดึงรหัสบริษัทจาก URL หรือใช้ค่าเริ่มต้น
const urlParams = new URLSearchParams(window.location.search);
const CURRENT_SITE_COMPANY_ID = urlParams.get('company') || 'comp_kc_clean';

// ตัวแปรกลางที่ต้องใช้ร่วมกันในหลายๆ ไฟล์
let allJobs = [];
let filteredJobs = [];
let currentPage = 1;
const itemsPerPage = 8;
let selectedJobForModal = null;