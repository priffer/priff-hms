const mockJobPostings = [
    { id: 'JOB-001', companyName: 'บมจ. อมตะ คอร์ปอเรชัน', title: 'แม่บ้านประจำออฟฟิศ (VIP)', zone: 'อมตะซิตี้ ชลบุรี', salaryHighlight: 'รายได้ 450 - 500 บาท/วัน', contentType: 'text', contentData: 'ดูแลความสะอาดออฟฟิศผู้บริหาร', fileUrl: '' },
    { id: 'JOB-002', companyName: 'บจก. ออโตพาร์ท แมนูแฟคเจอริ่ง', title: 'พนักงานทำความสะอาดโรงงาน', zone: 'WHA ระยอง 36', salaryHighlight: 'รายได้เฉลี่ย 15,000+ บาท/เดือน', contentType: 'text', contentData: 'ทำความสะอาดไลน์ผลิต', fileUrl: '' },
    { id: 'JOB-003', companyName: 'ศูนย์บริการทำความสะอาด KC', title: 'พนักงานเช็ดกระจกที่สูง', zone: 'ต.บางปลาสร้อย', salaryHighlight: 'รายได้ 600 - 800 บาท/วัน', contentType: 'image', contentData: 'ต้องมีใบเซอร์ที่สูง', fileUrl: 'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?auto=format&fit=crop&w=400&q=80' },
    
    // ตัวอย่างประกาศงานที่เป็นไฟล์ PDF (สมมติ URL ของ PDF เอาไว้)
    { id: 'JOB-004', companyName: 'คลังสินค้า ปิ่นทอง', title: 'พนักงานขับรถโฟล์คลิฟท์ (มีไฟล์ PDF แนบ)', zone: 'นิคมอุตสาหกรรมปิ่นทอง 1', salaryHighlight: 'รายได้ 500 บาท/วัน', contentType: 'pdf', contentData: 'ตรวจสอบรายละเอียดเพิ่มเติมในเอกสารแนบ', fileUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf' },
    
    { id: 'JOB-005', companyName: 'โรงงานประกอบชิ้นส่วนอิเล็กทรอนิกส์', title: 'แม่บ้านทำความสะอาดโรงงาน', zone: 'โรจนะ บ่อวิน', salaryHighlight: 'รายได้ 380 บาท/วัน', contentType: 'text', contentData: 'ทำความสะอาดทั่วไป', fileUrl: '' },
    { id: 'JOB-006', companyName: 'ท่าเรือแหลมฉบัง (โซน B)', title: 'พนักงานทำความสะอาดทั่วไป', zone: 'นิคมอุตสาหกรรมแหลมฉบัง', salaryHighlight: 'รายได้ตามตกลง', contentType: 'text', contentData: 'ด่วนมาก', fileUrl: '' },
    { id: 'JOB-007', companyName: 'โครงการก่อสร้างคอนโดหรู', title: 'พนักงานเก็บงานหลังก่อสร้าง', zone: 'ต.มาบตาพุด', salaryHighlight: 'รายได้ 450 บาท/วัน', contentType: 'text', contentData: 'เคลียร์พื้นที่', fileUrl: '' },
    { id: 'JOB-008', companyName: 'บจก. อีสเทิร์น โพลีเมอร์', title: 'หัวหน้าแม่บ้าน (Supervisor)', zone: 'เหมราช อีสเทิร์นซีบอร์ด', salaryHighlight: 'รายได้ 18,000 บาท/เดือน', contentType: 'text', contentData: 'มีประสบการณ์ 3 ปีขึ้นไป', fileUrl: '' },
    { id: 'JOB-009', companyName: 'บ้านพักตากอากาศผู้บริหาร', title: 'แม่บ้าน VIP ทำอาหารได้', zone: 'ต.แสนสุข', salaryHighlight: 'รายได้ 500 บาท/วัน', contentType: 'text', contentData: 'ทำอาหารไทยได้', fileUrl: '' },
    { id: 'JOB-010', companyName: 'คลังสินค้า สมาร์ทพาร์ค', title: 'พนักงานขับรถขัดพื้น (Ride-on)', zone: 'สมาร์ทพาร์ค ระยอง', salaryHighlight: 'รายได้ 450 บาท/วัน', contentType: 'text', contentData: 'ขับรถขัดพื้นอัตโนมัติ', fileUrl: '' },
    { id: 'JOB-011', companyName: 'โรงอาหารกลาง อมตะ', title: 'แม่บ้านโรงอาหาร', zone: 'อมตะซิตี้ ชลบุรี', salaryHighlight: 'รายได้ 350 บาท/วัน', contentType: 'text', contentData: 'เก็บจาน ทำความสะอาด', fileUrl: '' },
    { id: 'JOB-012', title: 'พนักงานจัดสวน ตัดหญ้า', companyName: 'บจก. กรีนสเปซ อินดัสทรี', zone: 'WHA ระยอง 36', salaryHighlight: 'รายได้ 400 บาท/วัน', contentType: 'text', contentData: 'ใช้เครื่องตัดหญ้าสะพายบ่าเป็น', fileUrl: '' },
    { id: 'JOB-013', title: 'พนักงานทำความสะอาดกะดึก', companyName: 'โรงงานผลิตอาหารกระป๋อง', zone: 'นิคมอุตสาหกรรมปิ่นทอง 1', salaryHighlight: 'รายได้ 400 บาท/วัน + ค่ากะ', contentType: 'text', contentData: 'ทำกะกลางคืน', fileUrl: '' },
    { id: 'JOB-014', title: 'แม่บ้านสำนักงานทั่วไป', companyName: 'ออฟฟิศใจกลางเมืองระยอง', zone: 'ต.เชิงเนิน', salaryHighlight: 'รายได้ 350 บาท/วัน', contentType: 'text', contentData: 'ทำความสะอาดออฟฟิศ', fileUrl: '' },
    { id: 'JOB-015', title: 'ช่างเทคนิคซ่อมบำรุง', companyName: 'อาคารสำนักงาน อมตะ', zone: 'อมตะซิตี้ ชลบุรี', salaryHighlight: 'รายได้ 15,000 - 20,000 บาท', contentType: 'text', contentData: 'ซ่อมบำรุงอาคาร', fileUrl: '' }
];