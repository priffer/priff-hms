// ไฟล์ js/config/supabase.js

const SUPABASE_URL = 'https://hcyibcqojsyldiyzperr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhjeWliY3FvanN5bGRpeXpwZXJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2NTY1MjAsImV4cCI6MjA5NDIzMjUyMH0.jTm4LkcQFHkpi64UHhCkR254KCznE4qOPyjis7lnjM0';

// สร้างตัวแปรกลางให้ทุกหน้าเรียกใช้ได้
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);