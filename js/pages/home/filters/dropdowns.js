function initLocationFilters() {
    const dd1 = document.getElementById('dd1');
    const searchInput = document.getElementById('searchKeyword');

    if (dd1) {
        dd1.removeEventListener('change', handleDd1Change);
        dd1.addEventListener('change', handleDd1Change);
    }
    if (searchInput) {
        searchInput.removeEventListener('input', filterJobs);
        searchInput.addEventListener('input', filterJobs);
    }

    if (!dd1 || typeof locationData === 'undefined') return;

    dd1.innerHTML = '<option value="">ทุกจังหวัด</option>';
    Object.keys(locationData).forEach(province => {
        dd1.innerHTML += `<option value="${province}">${province}</option>`;
    });
}

function handleDd1Change() {
    filterJobs();
}