function initLocationFilters() {
    const dd1 = document.getElementById('dd1');
    if (!dd1 || typeof locationsData === 'undefined') return;

    dd1.innerHTML = '<option value="">-- สถานที่ทั้งหมด --</option>';
    Object.keys(locationsData).forEach(province => {
        dd1.innerHTML += `<option value="${province}">${province}</option>`;
    });
}

function handleDd1Change() {
    const dd1 = document.getElementById('dd1').value;
    const boxDd2 = document.getElementById('boxDd2');
    const dd2 = document.getElementById('dd2');
    document.getElementById('boxDd3').classList.add('hidden');

    if (!dd1 || !locationsData[dd1]) {
        boxDd2.classList.add('hidden');
        dd2.innerHTML = '';
        return;
    }

    document.getElementById('lblDd2').innerText = dd1 === 'ชลบุรี' ? 'อำเภอ / นิคมอุตสาหกรรม' : 'อำเภอ';
    dd2.innerHTML = '<option value="">-- เลือกพื้นที่ทั้งหมด --</option>';
    Object.keys(locationsData[dd1]).forEach(district => {
        dd2.innerHTML += `<option value="${district}">${district}</option>`;
    });
    boxDd2.classList.remove('hidden');
}

function handleDd2Change() {
    const dd1 = document.getElementById('dd1').value;
    const dd2 = document.getElementById('dd2').value;
    const boxDd3 = document.getElementById('boxDd3');
    const dd3 = document.getElementById('dd3');

    if (!dd2 || !locationsData[dd1][dd2]) {
        boxDd3.classList.add('hidden');
        dd3.innerHTML = '';
        return;
    }

    document.getElementById('lblDd3').innerText = 'ตำบล / โซนย่อย';
    dd3.innerHTML = '<option value="">-- เลือกพื้นที่ย่อยทั้งหมด --</option>';
    locationsData[dd1][dd2].forEach(sub => {
        dd3.innerHTML += `<option value="${sub}">${sub}</option>`;
    });
    boxDd3.classList.remove('hidden');
}

function filterJobs() {
    const keyword = document.getElementById('searchKeyword').value.toLowerCase().trim();
    const p1 = document.getElementById('dd1').value;
    const p2 = document.getElementById('dd2') ? document.getElementById('dd2').value : '';
    const p3 = document.getElementById('dd3') ? document.getElementById('dd3').value : '';

    filteredJobs = allJobs.filter(job => {
        // ป้องกัน Error กรณีที่แอดมินไม่ได้ใส่ชื่อตำแหน่งหรือโซน 
        const title = job.title ? job.title.toLowerCase() : '';
        const zone = job.zone_name ? job.zone_name.toLowerCase() : '';
        
        const matchKeyword = !keyword || title.includes(keyword) || zone.includes(keyword);
        
        let matchLocation = true;
        if (p1) {
            matchLocation = zone.includes(p1.toLowerCase()) && 
                            (p2 ? zone.includes(p2.toLowerCase()) : true) && 
                            (p3 ? zone.includes(p3.toLowerCase()) : true);
        }
        return matchKeyword && matchLocation;
    });

    currentPage = 1;
    renderJobGrid();
}