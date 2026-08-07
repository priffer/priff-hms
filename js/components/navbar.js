const ADMIN_NAV_LINKS = [
    { href: 'dashboard.html', match: 'dashboard.html', label: 'จัดการผู้สมัครงาน', roles: ['admin', 'payroll'] },
    { href: 'admin-employees.html', match: 'admin-employees.html', label: 'จัดการพนักงาน', roles: ['admin', 'payroll'] },
    { href: 'admin-jobs.html', match: 'admin-jobs.html', label: 'จัดการเว็บและประกาศงาน', roles: ['admin', 'payroll'] },
    { href: 'admin-attendance.html', match: 'admin-attendance.html', label: 'จัดการเวลาทำงาน (ESS)', roles: ['admin', 'payroll'] },
    { href: 'admin-ot-benefits.html', match: 'admin-ot-benefits.html', label: 'โอที & สวัสดิการ', roles: ['admin', 'payroll'] },
    { href: 'admin-announcements.html', match: 'admin-announcements.html', label: 'ประกาศ & วันหยุด', roles: ['admin', 'payroll'] },
];

const ROLE_LABELS = {
    admin: 'ผู้ดูแลระบบ (Admin)',
    payroll: 'ฝ่ายบุคคล/เงินเดือน (Payroll)',
    supervisor: 'หัวหน้างาน (Supervisor)',
    employee: 'พนักงาน (Employee)',
};

function renderGlobalNavbar() {
    const container = document.getElementById('global-navbar');
    if (!container) return;

    const currentPath = window.location.pathname;
    const isActive = (match) => currentPath.includes(match) || (match === 'dashboard.html' && currentPath.endsWith('/'));

    const desktopLinks = ADMIN_NAV_LINKS.map(link => `
        <a href="${link.href}" data-roles="${link.roles.join(',')}" class="${isActive(link.match) ? 'text-kcyellow' : 'text-white/80 hover:text-white'} font-bold text-base tracking-wide transition-colors whitespace-nowrap">${link.label}</a>
    `).join('');

    const mobileLinks = ADMIN_NAV_LINKS.map(link => `
        <a href="${link.href}" data-roles="${link.roles.join(',')}" class="${isActive(link.match) ? 'bg-kcyellow text-kcblue' : 'text-white hover:bg-white/10'} block font-bold text-base px-4 py-3 border-b border-white/10 transition-colors">${link.label}</a>
    `).join('');

    const navbarHtml = `
        <nav class="bg-kcblue text-white shadow-none border-b-4 border-kcyellow shrink-0 relative z-30">
            <div class="max-w-7xl mx-auto flex justify-between items-center p-4 gap-4">
                <div class="flex items-center gap-4 min-w-0">
                    <h1 class="text-lg sm:text-xl font-bold uppercase tracking-tight shrink-0">PRIFF HMS | Admin</h1>
                    <div class="hidden lg:flex gap-6 xl:gap-8 ml-2 border-l border-white/30 pl-6 overflow-x-auto">
                        ${desktopLinks}
                    </div>
                </div>

                <div class="hidden lg:flex items-center gap-4 shrink-0">
                    <div id="navProfileArea" class="text-right leading-tight">
                        <p id="navProfileName" class="font-bold text-sm">กำลังโหลด...</p>
                        <p id="navProfileMeta" class="text-xs text-blue-200"></p>
                    </div>
                    <button onclick="handleGlobalLogout()" class="border-2 border-white px-4 py-1 text-sm font-bold hover:bg-white hover:text-kcblue transition-colors cursor-pointer shrink-0">ออกจากระบบ</button>
                </div>

                <button id="navHamburgerBtn" onclick="toggleMobileNav()" aria-label="เปิดเมนู" class="lg:hidden shrink-0 border-2 border-white/60 w-10 h-10 flex items-center justify-center text-2xl leading-none cursor-pointer">
                    <span id="navHamburgerIcon">☰</span>
                </button>
            </div>

            <div id="navMobilePanel" class="hidden lg:hidden bg-kcblue border-t border-white/20">
                <div class="px-2 pt-2 pb-1">
                    ${mobileLinks}
                </div>
                <div class="px-4 py-4 border-t border-white/20 flex items-center justify-between gap-3">
                    <div class="leading-tight min-w-0">
                        <p id="navProfileNameMobile" class="font-bold text-sm truncate">กำลังโหลด...</p>
                        <p id="navProfileMetaMobile" class="text-xs text-blue-200 truncate"></p>
                    </div>
                    <button onclick="handleGlobalLogout()" class="border-2 border-white px-4 py-2 text-sm font-bold hover:bg-white hover:text-kcblue transition-colors cursor-pointer shrink-0">ออกจากระบบ</button>
                </div>
            </div>
        </nav>
    `;

    container.innerHTML = navbarHtml;
    loadNavbarProfile();
}

let mobileNavOpen = false;
function toggleMobileNav() {
    mobileNavOpen = !mobileNavOpen;
    const panel = document.getElementById('navMobilePanel');
    const icon = document.getElementById('navHamburgerIcon');
    if (!panel) return;
    panel.classList.toggle('hidden', !mobileNavOpen);
    if (icon) icon.textContent = mobileNavOpen ? '✕' : '☰';
}

async function loadNavbarProfile() {
    try {
        if (!window.PriffAuthGuard || typeof window.PriffAuthGuard.getCurrentUserProfile !== 'function') return;
        const profile = window.currentUserProfile || await window.PriffAuthGuard.getCurrentUserProfile();
        if (!profile) return;
        window.currentUserProfile = profile;

        const name = profile.display_name || profile.full_name || profile.email || 'ผู้ใช้งาน';
        const roleLabel = ROLE_LABELS[profile.role] || profile.role || '';
        const meta = [profile.email, roleLabel].filter(Boolean).join(' · ');

        const nameEl = document.getElementById('navProfileName');
        const metaEl = document.getElementById('navProfileMeta');
        const nameMobileEl = document.getElementById('navProfileNameMobile');
        const metaMobileEl = document.getElementById('navProfileMetaMobile');
        if (nameEl) nameEl.textContent = name;
        if (metaEl) metaEl.textContent = meta;
        if (nameMobileEl) nameMobileEl.textContent = name;
        if (metaMobileEl) metaMobileEl.textContent = meta;

        // ซ่อนเมนูที่ role ปัจจุบันไม่มีสิทธิ์เข้าถึง (Role-aware menu)
        document.querySelectorAll('[data-roles]').forEach(el => {
            const roles = (el.getAttribute('data-roles') || '').split(',').filter(Boolean);
            if (roles.length && !roles.includes(profile.role)) {
                el.style.display = 'none';
            }
        });
    } catch (e) {
        console.error('loadNavbarProfile error', e);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderGlobalNavbar);
} else {
    renderGlobalNavbar();
}

async function handleGlobalLogout() {
    const sb = window.supabaseClient || window.supabase;
    if (sb && sb.auth) {
        await sb.auth.signOut();
    }
    window.location.href = 'login.html';
}