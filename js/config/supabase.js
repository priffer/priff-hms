// ไฟล์ js/config/supabase.js

const SUPABASE_URL = 'https://hcyibcqojsyldiyzperr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_5uPLa6fHxRFTVj_3TnHjZg__VAbXMm5';

// สร้างตัวแปรกลางให้ทุกหน้าเรียกใช้ได้
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// สำคัญ: top-level `const` ไม่ผูกเข้ากับ window object โดยอัตโนมัติ
// ต้อง assign เข้า window แบบชัดเจน เพื่อให้ auth-guard.js / login.js
// (ซึ่งอ่านค่าจาก window.supabase || window.supabaseClient) หาไคลเอนต์เจอ
window.supabaseClient = supabaseClient;