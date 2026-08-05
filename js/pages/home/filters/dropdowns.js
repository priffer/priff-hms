function initLocationFilters() {
    const dd1 = document.getElementById('dd1');
    const dd2 = document.getElementById('dd2');
    const searchInput = document.getElementById('searchKeyword');

    if (dd1) {
        dd1.removeEventListener('change', handleDd1Change);
        dd1.addEventListener('change', handleDd1Change);
    }
    if (dd2) {
        dd2.removeEventListener('change', handleDd2Change);
        dd2.addEventListener('change', handleDd2Change);
    }

    if (!dd1 || typeof locationData === 'undefined') return;

    dd1.innerHTML = '<option value="">-- ทุกจังหวัด --</option>';
    Object.keys(locationData).forEach(province => {
        dd1.innerHTML += `<option value="${province}">${province}</option>`;
    });
}

function handleDd1Change() {
    const dd1 = document.getElementById('dd1').value;
    const boxDd2 = document.getElementById('boxDd2');
    const dd2 = document.getElementById('dd2');
    const placeholder = document.getElementById('boxDd2Placeholder');

    if (!dd1 || typeof locationData === 'undefined' || !locationData[dd1]) {
        if (boxDd2) boxDd2.classList.add('hidden');
        if (placeholder) placeholder.classList.remove('hidden');
        if (dd2) {
            dd2.innerHTML = '';
            dd2.value = '';
        }
        return;
    }
    
    if (dd2) {
        dd2.innerHTML = '<option value="">-- เลือกพื้นที่ทั้งหมด --</option>';
        Object.keys(locationData[dd1]).forEach(group => {
            dd2.innerHTML += `<option value="${group}">${group}</option>`;
        });
        dd2.value = '';
        if (boxDd2) boxDd2.classList.remove('hidden');
        if (placeholder) placeholder.classList.add('hidden');
    }
}

function handleDd2Change() {
    // No auto filter on dropdown change, user must click "Apply"
}