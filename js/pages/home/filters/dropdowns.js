// Cascading location filters: dd1 = จังหวัด, dd2 = อำเภอ/นิคมอุตสาหกรรม (flattened), dd3 = ตำบล (only for อำเภอ items)

function initLocationFilters() {
    const dd1 = document.getElementById('dd1');
    const dd2 = document.getElementById('dd2');
    const dd3 = document.getElementById('dd3');

    if (dd1) {
        dd1.removeEventListener('change', handleDd1Change);
        dd1.addEventListener('change', handleDd1Change);
    }
    if (dd2) {
        dd2.removeEventListener('change', handleDd2Change);
        dd2.addEventListener('change', handleDd2Change);
    }
    if (dd3) {
        dd3.removeEventListener('change', handleDd3Change);
        dd3.addEventListener('change', handleDd3Change);
    }

    if (!dd1 || typeof locationData === 'undefined') return;

    dd1.innerHTML = '<option value="">-- ทุกจังหวัด --</option>';
    Object.keys(locationData).forEach(province => {
        dd1.innerHTML += `<option value="${province}">${province}</option>`;
    });
}

// Builds the flat "area" list for a province: industrial estates (leaf values, no further drill-down)
// plus amphoe entries (each unlocks dd3 so a specific ตำบล can be picked).
function handleDd1Change() {
    const p1 = document.getElementById('dd1').value;
    const dd2 = document.getElementById('dd2');
    const dd3 = document.getElementById('dd3');

    resetDropdown(dd3, 'โปรดเลือกอำเภอก่อน');

    if (!p1 || typeof locationData === 'undefined' || !locationData[p1]) {
        resetDropdown(dd2, 'โปรดเลือกจังหวัดก่อน');
        return;
    }

    const groups = locationData[p1];
    let optionsHtml = '<option value="">-- ทุกพื้นที่ใน' + p1 + ' --</option>';

    // Render each raw group as its own <optgroup> so นิคมอุตสาหกรรม and อำเภอ/ตำบล
    // never visually mix together in the dropdown list.
    Object.keys(groups).forEach(groupName => {
        const node = groups[groupName];
        optionsHtml += `<optgroup label="${groupName}">`;
        if (Array.isArray(node)) {
            // Industrial estate group: each entry is a selectable leaf value
            node.forEach(estate => {
                optionsHtml += `<option value="${estate}" data-type="estate">${estate}</option>`;
            });
        } else {
            // Amphoe/Tambon group: each amphoe is selectable and unlocks dd3 (tambon)
            Object.keys(node).forEach(amphoe => {
                optionsHtml += `<option value="${amphoe}" data-type="amphoe">${amphoe}</option>`;
            });
        }
        optionsHtml += '</optgroup>';
    });

    if (dd2) {
        dd2.innerHTML = optionsHtml;
        dd2.value = '';
        dd2.disabled = false;
        dd2.classList.remove('bg-slate-50', 'text-slate-400');
        dd2.classList.add('bg-white', 'text-slate-900');
    }
}

function handleDd2Change() {
    const p1 = document.getElementById('dd1').value;
    const dd2 = document.getElementById('dd2');
    const dd3 = document.getElementById('dd3');
    const selectedOption = dd2 ? dd2.options[dd2.selectedIndex] : null;
    const areaType = selectedOption ? selectedOption.getAttribute('data-type') : null;
    const p2 = dd2 ? dd2.value : '';

    if (!p2 || areaType !== 'amphoe' || !locationData[p1]) {
        resetDropdown(dd3, p2 ? 'ไม่มีตำบลย่อยสำหรับพื้นที่นี้' : 'โปรดเลือกอำเภอก่อน');
        return;
    }

    // Find the group object that contains this amphoe to list its tambons
    const groups = locationData[p1];
    let tambons = null;
    Object.keys(groups).forEach(groupName => {
        const node = groups[groupName];
        if (!Array.isArray(node) && node[p2]) {
            tambons = node[p2];
        }
    });

    if (!tambons || !dd3) return;

    let optionsHtml = '<option value="">-- ทุกตำบลใน' + p2 + ' --</option>';
    tambons.forEach(tambon => {
        optionsHtml += `<option value="${tambon}">${tambon}</option>`;
    });

    dd3.innerHTML = optionsHtml;
    dd3.value = '';
    dd3.disabled = false;
    dd3.classList.remove('bg-slate-50', 'text-slate-400');
    dd3.classList.add('bg-white', 'text-slate-900');
}

function handleDd3Change() {
    // Selection is read directly by filterJobs() on submit; nothing to cascade further.
}

function resetDropdown(select, placeholderText) {
    if (!select) return;
    select.innerHTML = `<option value="">${placeholderText}</option>`;
    select.value = '';
    select.disabled = true;
    select.classList.add('bg-slate-50', 'text-slate-400');
    select.classList.remove('bg-white', 'text-slate-900');
}
