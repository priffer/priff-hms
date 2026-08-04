// ไฟล์ js/config/supabase.js

const SUPABASE_URL = 'https://hcyibcqojsyldiyzperr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_5uPLa6fHxRFTVj_3TnHjZg__VAbXMm5';

// สร้างตัวแปรกลางให้ทุกหน้าเรียกใช้ได้
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);