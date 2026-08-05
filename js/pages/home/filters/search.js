function filterJobs(scrollToResults = true) {
    if (!allJobs || allJobs.length === 0) return;

    const kwEl = document.getElementById('searchKeyword');
    const keyword = kwEl ? kwEl.value.trim().toLowerCase() : '';
    const locationEl = document.getElementById('locationKeyword');
    const locationKeyword = locationEl ? locationEl.value.trim().toLowerCase() : '';
    const cleanKeyword = keyword.replace(/ต\.|อ\.|จ\.|เขต/g, '').replace(/\s+/g, '');
    const cleanLocationKeyword = locationKeyword.replace(/ต\.|อ\.|จ\.|เขต/g, '').replace(/\s+/g, '');
    
    const p1 = document.getElementById('dd1') ? document.getElementById('dd1').value : '';
    const p2 = document.getElementById('dd2') ? document.getElementById('dd2').value : '';
    const p3 = document.getElementById('dd3') ? document.getElementById('dd3').value : '';

    filteredJobs = allJobs.filter(job => {
        const zone = String(job.zone_name || '').toLowerCase();
        const companyName = String(job.company_name || '').toLowerCase();
        const content = String(job.content || '').toLowerCase(); 
        
        const matchKeyword = matchesJobSearchTerm(job, keyword, cleanKeyword);
        const matchLocationKeyword = matchesJobLocationTerm(job, locationKeyword, cleanLocationKeyword);
        
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

        return matchKeyword && matchLocationKeyword && matchLocation;
    });

    currentPage = 1;
    if (typeof renderJobGrid === 'function') {
        renderJobGrid();
    }

    // เลื่อนไปดูผลลัพธ์เฉพาะตอนกดปุ่มค้นหา/Enter อย่างชัดเจน
    // ไม่เลื่อนตอนพิมพ์แบบ live หรือใช้ตัวกรอง Dropdown เพราะผู้ใช้อาจยังพิมพ์/ปรับตัวเลือกต่อ
    if (scrollToResults) {
        document.getElementById('jobs-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

// ใช้เป็น event handler อ้างอิงคงที่ (สำหรับ addEventListener/removeEventListener)
// เพื่อกรองแบบ live โดยไม่เลื่อนจอทุกครั้งที่พิมพ์หรือเปลี่ยนตัวกรอง
function filterJobsNoScroll() {
    filterJobs(false);
}

function matchesJobSearchTerm(job, keyword, cleanKeyword) {
    if (!keyword) return true;

    const title = String(job.title || '').toLowerCase();
    const zone = String(job.zone_name || '').toLowerCase();
    const companyName = String(job.company_name || '').toLowerCase();
    const content = String(job.content || '').toLowerCase();

    if (title.includes(keyword) || zone.includes(keyword) || companyName.includes(keyword) || content.includes(keyword)) {
        return true;
    }

    return matchesLocationKeyword(job, cleanKeyword);
}

function matchesJobLocationTerm(job, locationKeyword, cleanLocationKeyword) {
    if (!locationKeyword) return true;
    return matchesLocationKeyword(job, cleanLocationKeyword);
}

function matchesLocationKeyword(job, cleanKeyword) {
    if (!cleanKeyword || typeof locationData === 'undefined') return false;

    const zone = cleanStr(job.zone_name);
    const content = cleanStr(job.content);
    const companyName = cleanStr(job.company_name);

    if (zone.includes(cleanKeyword) || content.includes(cleanKeyword) || companyName.includes(cleanKeyword)) {
        return true;
    }

    for (const province of Object.keys(locationData)) {
        for (const group of Object.keys(locationData[province])) {
            const node = locationData[province][group];
            if (!Array.isArray(node)) {
                for (const amphoe of Object.keys(node)) {
                    const cAmphoe = cleanStr(amphoe);
                    if (cAmphoe.includes(cleanKeyword) || cleanKeyword.includes(cAmphoe)) {
                        const hasMatchedTambon = node[amphoe].some(tambon => {
                            const cTambon = cleanStr(tambon);
                            return zone.includes(cTambon) || content.includes(cTambon) || companyName.includes(cTambon);
                        });
                        if (hasMatchedTambon) {
                            return true;
                        }
                    }
                }
            }
        }
    }

    return false;
}