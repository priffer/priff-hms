function renderGlobalNavbar() {
    const container = document.getElementById('global-navbar');
    if (!container) return;

    const currentPath = window.location.pathname;
    const isDashboard = currentPath.includes('dashboard.html') || currentPath.endsWith('/');
    const isEmployees = currentPath.includes('admin-employees.html');
    const isJobs = currentPath.includes('admin-jobs.html');

    const navbarHtml = `
        <nav class="bg-kcblue text-white p-4 shadow-none border-b-4 border-kcyellow shrink-0">
            <div class="max-w-7xl mx-auto flex justify-between items-center">
                <div class="flex items-center gap-4">
                    <h1 class="text-xl font-bold uppercase tracking-tight">PRIFF HMS | Admin</h1>
                    <div class="hidden sm:flex gap-8 ml-6 border-l border-white/30 pl-6">
                        <a href="dashboard.html" class="${isDashboard ? 'text-kcyellow' : 'text-white/80 hover:text-white'} font-bold text-base tracking-wide transition-colors">จัดการผู้สมัครงาน</a>
                        <a href="admin-employees.html" class="${isEmployees ? 'text-kcyellow' : 'text-white/80 hover:text-white'} font-bold text-base tracking-wide transition-colors">จัดการพนักงาน</a>
                        <a href="admin-jobs.html" class="${isJobs ? 'text-kcyellow' : 'text-white/80 hover:text-white'} font-bold text-base tracking-wide transition-colors">จัดการเว็บและประกาศงาน</a>
                    </div>
                </div>
                <button onclick="handleGlobalLogout()" class="border-2 border-white px-4 py-1 text-sm font-bold hover:bg-white hover:text-kcblue transition-colors cursor-pointer">ออกจากระบบ</button>
            </div>
        </nav>
    `;

    container.innerHTML = navbarHtml;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderGlobalNavbar);
} else {
    renderGlobalNavbar();
}

async function handleGlobalLogout() {
    if (typeof supabaseClient !== 'undefined' && supabaseClient.auth) {
        await supabaseClient.auth.signOut();
    }
    window.location.href = 'login.html';
}