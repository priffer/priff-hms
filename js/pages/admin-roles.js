const ROLE_OPTIONS = ['admin', 'payroll', 'supervisor', 'employee', 'hr', 'accounting', 'executive'];
const STEP_OPTIONS = ['', 'supervisor', 'hr', 'accounting', 'executive'];

function optionHtml(values, selected) {
    return values.map(v => {
        const label = v === '' ? '(ว่าง)' : v;
        const sel = (selected || '') === v ? ' selected' : '';
        return `<option value="${v}"${sel}>${label}</option>`;
    }).join('');
}

async function loadUserRoles() {
    const tbody = document.getElementById('rolesTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-slate-500">กำลังโหลด...</td></tr>';
    try {
        const { data, error } = await supabaseClient
            .from('user_profiles')
            .select('id, email, full_name, role, approval_step_role')
            .order('email', { ascending: true });
        if (error) throw error;
        if (!data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-slate-500">ไม่พบผู้ใช้</td></tr>';
            return;
        }
        tbody.innerHTML = data.map(row => `
            <tr class="border-t border-[#e6edf7]" data-id="${row.id}">
                <td class="p-3 font-bold text-kcdark">${row.email || ''}</td>
                <td class="p-3">${row.full_name || '-'}</td>
                <td class="p-3">
                    <select class="role-select rounded-xl border border-[#e6edf7] px-2 py-1.5 text-sm bg-white">
                        ${optionHtml(ROLE_OPTIONS, row.role)}
                    </select>
                </td>
                <td class="p-3">
                    <select class="step-select rounded-xl border border-[#e6edf7] px-2 py-1.5 text-sm bg-white">
                        ${optionHtml(STEP_OPTIONS, row.approval_step_role || '')}
                    </select>
                </td>
                <td class="p-3">
                    <button type="button" onclick="saveUserRole('${row.id}')" class="bg-kcblue text-white px-3 py-1.5 text-xs font-bold hover:bg-kcdark cursor-pointer rounded-lg">บันทึก</button>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-red-600">เกิดข้อผิดพลาด: ${err.message}</td></tr>`;
    }
}

async function saveUserRole(id) {
    const tr = document.querySelector(`tr[data-id="${id}"]`);
    if (!tr) return;
    const role = tr.querySelector('.role-select').value;
    const stepRaw = tr.querySelector('.step-select').value;
    const approval_step_role = stepRaw === '' ? null : stepRaw;
    try {
        const { error } = await supabaseClient
            .from('user_profiles')
            .update({ role, approval_step_role, updated_at: new Date().toISOString() })
            .eq('id', id);
        if (error) throw error;
        alert('บันทึกแล้ว');
    } catch (err) {
        alert('บันทึกไม่สำเร็จ: ' + err.message);
    }
}
