function filterJobs() {
    if (!allJobs || allJobs.length === 0) return;

    const kwEl = document.getElementById('searchKeyword');
    const keyword = kwEl ? kwEl.value.trim().toLowerCase() : '';
    const cleanKeyword = keyword.replace(/ต\.|อ\.|จ\.|เขต/g, '').replace(/\s+/g, '');
    
    const p1 = document.getElementById('dd1') ? document.getElementById('dd1').value : '';
    const p2 = document.getElementById('dd2') ? document.getElementById('dd2').value : '';
    const p3 = document.getElementById('dd3') ? document.getElementById('dd3').value : '';

    filteredJobs = allJobs.filter(job => {
        const title = String(job.title || '').toLowerCase();
        const zone = String(job.zone_name || '').toLowerCase();
        const companyName = String(job.company_name || '').toLowerCase();
        const content = String(job.content || '').toLowerCase(); 
        
        // 1. ตรวจสอบการค้นหาด้วยคีย์เวิร์ดแบบพิมพ์คำอิสระ (เพิ่มความฉลาดทางภูมิศาสตร์)
        let matchKeyword = !keyword;
        if (keyword) {
            // เช็กเบื้องต้นแบบตรงตัวจากฟิลด์ต่างๆ
            if (title.includes(keyword) || zone.includes(keyword) || companyName.includes(keyword) || content.includes(keyword)) {
                matchKeyword = true;
            } 
            // หากไม่เจอตรงๆ ให้เช็กว่าคีย์เวิร์ดที่พิมพ์เข้ามา เป็นชื่อ "อำเภอ" ในระบบหรือไม่
            else if (typeof locationData !== 'undefined' && cleanKeyword) {
                const cZone = cleanStr(zone);
                const cContent = cleanStr(content);
                const cCompany = cleanStr(companyName);

                // ลูปหาความสัมพันธ์ว่าตำบลในโพสต์งาน อยู่ใต้อำเภอที่พิมพ์มาหรือไม่
                for (const province of Object.keys(locationData)) {
                    for (const group of Object.keys(locationData[province])) {
                        const node = locationData[province][group];
                        // ตรวจสอบเฉพาะกลุ่มที่เป็น อ./ต. (ไม่ใช่อาร์เรย์ของนิคม)
                        if (!Array.isArray(node)) {
                            for (const amphoe of Object.keys(node)) {
                                const cAmphoe = cleanStr(amphoe);
                                // ถ้าชื่ออำเภอตรงกับคำที่ผู้ใช้พิมพ์ค้นหา (เช่น ศรีราชา)
                                if (cAmphoe.includes(cleanKeyword) || cleanKeyword.includes(cAmphoe)) {
                                    // เช็กว่าตำบลลูกๆ ใต้อำเภอนี้ มีคำไหนไปโผล่ในโพสต์งานบ้างไหม
                                    const hasMatchedTambon = node[amphoe].some(tambon => {
                                        const cTambon = cleanStr(tambon);
                                        return cZone.includes(cTambon) || cContent.includes(cTambon) || cCompany.includes(cTambon);
                                    });
                                    if (hasMatchedTambon) {
                                        matchKeyword = true;
                                        break;
                                    }
                                }
                            }
                        }
                    }
                    if (matchKeyword) break;
                }
            }
        }
        
        // 2. ตรวจสอบการเลือกพื้นที่จากกลุ่ม Dropdown
        let matchLocation = true;
        if (typeof locationData !== 'undefined') {
            matchLocation = isZoneInArea(job, p1, p2, p3);
        } else {
            const targetArea = p3 || p2 || p1;
            if (targetArea) {
                const cTarget = cleanStr(targetArea);
                const cZone = cleanStr(zone);
                const cContent = cleanStr(content);
                const cCompany = cleanStr(companyName);
                matchLocation = cZone.includes(cTarget) || cTarget.includes(cZone) || cContent.includes(cTarget) || cCompany.includes(cTarget);
            }
        }

        return matchKeyword && matchLocation;
    });

    currentPage = 1;
    if (typeof renderJobGrid === 'function') {
        renderJobGrid();
    }
}