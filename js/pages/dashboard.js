// js/pages/dashboard.js

async function fetchEmployees() {
    const { data, error } = await supabaseClient
        .from('employees')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching data:', error);
        return;
    }

    const tableBody = document.getElementById('employeeTableBody');
    tableBody.innerHTML = '';

    data.forEach(emp => {
        const date = new Date(emp.created_at).toLocaleDateString('th-TH');
        tableBody.innerHTML += `
            <tr>
                <td>${date}</td>
                <td>${emp.first_name} ${emp.last_name}</td>
                <td>${emp.id_card}</td>
                <td>${emp.phone}</td>
                <td>
                    <a href="${emp.resume_url}" target="_blank" class="btn btn-sm btn-dark">ดูรูปภาพ</a>
                </td>
                <td>
                    <span class="badge bg-warning text-dark">${emp.status}</span>
                </td>
            </tr>
        `;
    });
}

async function handleLogout() {
    await supabaseClient.auth.signOut();
    window.location.href = 'login.html';
}

// โหลดข้อมูลทันทีที่เปิดหน้า
fetchEmployees();