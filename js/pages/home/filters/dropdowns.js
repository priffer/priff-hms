function initLocationFilters() {
    const dd1 = document.getElementById('dd1');
    const dd2 = document.getElementById('dd2');
    const dd3 = document.getElementById('dd3');
    const searchInput = document.getElementById('searchKeyword');

    if (dd1) {
        dd1.removeEventListener('change', handleDd1Change);
        dd1.addEventListener('change', handleDd1Change);
    }
    if (dd2) {
        dd2.removeEventListener('change', handleDd2Change);
        dd2.addEventListener('change', handleDd2Change);
    }
    if (dd3) {
        dd3.removeEventListener('change', filterJobs);
        dd3.addEventListener('change', filterJobs);
    }
    if (searchInput) {
        searchInput.removeEventListener('input', filterJobs);
        searchInput.addEventListener('input', filterJobs);
    }

    if (!dd1 || typeof locationData === 'undefined') return;

    dd1.innerHTML = '<option value="">-- สถานที่ทั้งหมด --</option>';
    Object.keys(locationData).forEach(province => {
        dd1.innerHTML += `<option value="${province}">${province}</option>`;
    });
}

function handleDd1Change() {
    const dd1 = document.getElementById('dd1').value;
    const boxDd2 = document.getElementById('boxDd2');
    const dd2 = document.getElementById('dd2');
    const boxDd3 = document.getElementById('boxDd3');
    
    if (boxDd3) boxDd3.classList.add('hidden');

    if (!dd1 || typeof locationData === 'undefined' || !locationData[dd1]) {
        if (boxDd2) boxDd2.classList.add('hidden');
        if (dd2) dd2.innerHTML = '';
        filterJobs();
        return;
    }

    const lblDd2 = document.getElementById('lblDd2');
    if (lblDd2) lblDd2.innerText = 'เลือกเขตพื้นที่';
    
    if (dd2) {
        dd2.innerHTML = '<option value="">-- เลือกพื้นที่ทั้งหมด --</option>';
        Object.keys(locationData[dd1]).forEach(group => {
            dd2.innerHTML += `<option value="${group}">${group}</option>`;
        });
        if (boxDd2) boxDd2.classList.remove('hidden');
    }
    filterJobs();
}

function handleDd2Change() {
    const dd1 = document.getElementById('dd1').value;
    const dd2 = document.getElementById('dd2').value;
    const boxDd3 = document.getElementById('boxDd3');
    const dd3 = document.getElementById('dd3');

    if (!dd2 || typeof locationData === 'undefined' || !locationData[dd1] || !locationData[dd1][dd2]) {
        if (boxDd3) boxDd3.classList.add('hidden');
        if (dd3) dd3.innerHTML = '';
        filterJobs();
        return;
    }

    const lblDd3 = document.getElementById('lblDd3');
    if (lblDd3) lblDd3.innerText = dd2 === 'นิคมอุตสาหกรรม' ? 'ชื่อนิคมอุตสาหกรรม' : 'อำเภอ / ตำบล';
    
    if (dd3) {
        let optionsHTML = '<option value="">-- เลือกพื้นที่ย่อยทั้งหมด --</option>';
        const dataNode = locationData[dd1][dd2];
        
        if (Array.isArray(dataNode)) {
            dataNode.forEach(sub => {
                optionsHTML += `<option value="${sub}">${sub}</option>`;
            });
        } else if (typeof dataNode === 'object') {
            for (const [amphoe, tambons] of Object.entries(dataNode)) {
                optionsHTML += `<optgroup label="${amphoe}">`;
                tambons.forEach(t => {
                    let val = t.includes('(ทั้งหมด)') ? amphoe : t;
                    optionsHTML += `<option value="${val}">${t}</option>`;
                });
                optionsHTML += `</optgroup>`;
            }
        }
        
        dd3.innerHTML = optionsHTML;
        if (boxDd3) boxDd3.classList.remove('hidden');
    }
    filterJobs();
}