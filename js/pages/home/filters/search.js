function filterJobs() {
    if (!allJobs || allJobs.length === 0) return;

    const kwEl = document.getElementById('searchKeyword');
    const keyword = kwEl ? kwEl.value.trim().toLowerCase() : '';
    
    const p1 = document.getElementById('dd1') ? document.getElementById('dd1').value : '';
    const p2 = document.getElementById('dd2') ? document.getElementById('dd2').value : '';
    const p3 = document.getElementById('dd3') ? document.getElementById('dd3').value : '';

    filteredJobs = allJobs.filter(job => {
        const title = String(job.title || '').toLowerCase();
        const zone = String(job.zone_name || '').toLowerCase();
        
        const matchKeyword = !keyword || title.includes(keyword) || zone.includes(keyword);
        
        let matchLocation = true;
        if (typeof locationData !== 'undefined') {
            matchLocation = isZoneInArea(zone, p1, p2, p3);
        } else {
            const targetArea = p3 || p2 || p1;
            if (targetArea) {
                const cTarget = cleanStr(targetArea);
                const cZone = cleanStr(zone);
                matchLocation = cZone.includes(cTarget) || cTarget.includes(cZone);
            }
        }

        return matchKeyword && matchLocation;
    });

    currentPage = 1;
    if (typeof renderJobGrid === 'function') {
        renderJobGrid();
    }
}