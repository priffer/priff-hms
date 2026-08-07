const ADMIN_NAV_LINKS = [
    { href: 'dashboard.html', match: 'dashboard.html', label: 'ผู้สมัครงาน', icon: '📋', roles: ['admin', 'payroll'] },
    { href: 'admin-employees.html', match: 'admin-employees.html', label: 'พนักงาน', icon: '👥', roles: ['admin', 'payroll'] },
    { href: 'admin-jobs.html', match: 'admin-jobs.html', label: 'เว็บ/ประกาศงาน', icon: '📢', roles: ['admin', 'payroll'] },
    { href: 'admin-attendance.html', match: 'admin-attendance.html', label: 'เวลาทำงาน', icon: '⏱️', roles: ['admin', 'payroll'] },
    { href: 'admin-ot-benefits.html', match: 'admin-ot-benefits.html', label: 'โอที/สวัสดิการ', icon: '🛡️', roles: ['admin', 'payroll'] },
    { href: 'admin-announcements.html', match: 'admin-announcements.html', label: 'ประกาศ/วันหยุด', icon: '🗓️', roles: ['admin', 'payroll'] },
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
        <a href="${link.href}" data-roles="${link.roles.join(',')}" class="${isActive(link.match) ? 'bg-white/15 text-white' : 'text-white/65 hover:text-white hover:bg-white/10'} flex items-center gap-1.5 font-bold text-sm tracking-wide transition-colors whitespace-nowrap px-3 py-2 rounded-xl"><span>${link.icon}</span><span>${link.label}</span></a>
    `).join('');

    const mobileLinks = ADMIN_NAV_LINKS.map(link => `
        <a href="${link.href}" data-roles="${link.roles.join(',')}" class="${isActive(link.match) ? 'bg-white/15 text-white' : 'text-white/80 hover:bg-white/10'} flex items-center gap-2 font-bold text-base px-4 py-3 rounded-xl transition-colors"><span>${link.icon}</span><span>${link.label}</span></a>
    `).join('');

    const navbarHtml = `
        <nav class="bg-kcdark text-white shadow-[0_4px_20px_rgba(15,43,115,0.15)] shrink-0 relative z-30">
            <div class="max-w-7xl mx-auto flex justify-between items-center px-4 pt-3 pb-2 gap-4">
                <div class="flex items-center gap-2 shrink-0">
                    <div class="w-9 h-9 rounded-xl bg-kcblue text-white font-black flex items-center justify-center text-sm shadow-md">KC</div>
                    <h1 class="text-base sm:text-lg font-extrabold tracking-tight shrink-0 hidden sm:block">PRIFF HMS <span class="text-white/50 font-bold">| Admin</span></h1>
                </div>

                <div class="hidden lg:flex items-center gap-3 shrink-0">
                    <button id="adminNotifBellBtn" onclick="openAdminNotificationsModal()" class="relative w-10 h-10 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center cursor-pointer transition-colors" aria-label="การแจ้งเตือน">
                        <span class="text-base">🔔</span>
                        <span id="adminNotifUnreadBadge" class="hidden absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-bold min-w-[18px] h-[18px] rounded-full flex items-center justify-center px-1 border-2 border-kcdark">0</span>
                    </button>
                    <div id="navProfileArea" class="text-right leading-tight">
                        <p id="navProfileName" class="font-bold text-sm">กำลังโหลด...</p>
                        <p id="navProfileMeta" class="text-xs text-white/50 font-bold"></p>
                    </div>
                    <button onclick="handleGlobalLogout()" class="rounded-xl bg-white/10 border border-white/20 px-4 py-2 text-sm font-bold hover:bg-white hover:text-kcdark transition-colors cursor-pointer shrink-0">ออกจากระบบ</button>
                </div>

                <div class="lg:hidden flex items-center gap-2 shrink-0">
                    <button id="adminNotifBellBtnMobile" onclick="openAdminNotificationsModal()" class="relative w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center cursor-pointer" aria-label="การแจ้งเตือน">
                        <span class="text-base">🔔</span>
                        <span id="adminNotifUnreadBadgeMobile" class="hidden absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-bold min-w-[18px] h-[18px] rounded-full flex items-center justify-center px-1 border-2 border-kcdark">0</span>
                    </button>
                    <button id="navHamburgerBtn" onclick="toggleMobileNav()" aria-label="เปิดเมนู" class="shrink-0 rounded-xl bg-white/10 w-10 h-10 flex items-center justify-center text-2xl leading-none cursor-pointer">
                        <span id="navHamburgerIcon">☰</span>
                    </button>
                </div>
            </div>

            <div class="hidden lg:block border-t border-white/10">
                <div class="max-w-7xl mx-auto px-4 py-1.5 flex flex-wrap items-center gap-1">
                    ${desktopLinks}
                </div>
            </div>

            <div id="navMobilePanel" class="hidden lg:hidden bg-kcdark border-t border-white/10">
                <div class="px-3 pt-3 pb-1 space-y-1">
                    ${mobileLinks}
                </div>
                <div class="px-4 py-4 border-t border-white/10 flex items-center justify-between gap-3">
                    <div class="leading-tight min-w-0">
                        <p id="navProfileNameMobile" class="font-bold text-sm truncate">กำลังโหลด...</p>
                        <p id="navProfileMetaMobile" class="text-xs text-white/50 font-bold truncate"></p>
                    </div>
                    <button onclick="handleGlobalLogout()" class="rounded-xl bg-white/10 border border-white/20 px-4 py-2 text-sm font-bold hover:bg-white hover:text-kcdark transition-colors cursor-pointer shrink-0">ออกจากระบบ</button>
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

        ensureAdminNotificationsModal();
        refreshAdminNotifBadge();
        setInterval(refreshAdminNotifBadge, 60000); // เช็คแจ้งเตือนใหม่ทุก 1 นาที (polling - ยังไม่มี realtime push)
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

// ============================================================
// 🔔 การแจ้งเตือน (Admin Portal) - ใช้ตาราง notifications เดียวกับ ESS
// (database/21_notifications.sql) - สร้าง modal แบบ inject เข้า body เพราะหน้า admin
// ทุกหน้าโหลด navbar.js เหมือนกัน แต่ไม่มี HTML modal ของตัวเองอยู่แล้ว
// ============================================================
const adminNotificationCategoryIcon = {
    ot_request_pending: '⏱️', ot_request_escalated: '⚠️', ot_request_approved: '✅', ot_request_rejected: '❌',
    correction_request_pending: '✏️', correction_request_approved: '✅', correction_request_rejected: '❌',
    leave_request_pending: '🏖️', leave_request_approved: '✅', leave_request_rejected: '❌'
};

function ensureAdminNotificationsModal() {
    if (document.getElementById('adminNotificationsModal')) return;
    const div = document.createElement('div');
    div.id = 'adminNotificationsModal';
    div.className = 'hidden fixed inset-0 z-[60] bg-black/70 items-center justify-center p-4';
    div.innerHTML = `
        <div class="bg-white w-full max-w-lg rounded-[2rem] border border-[#e6edf7] shadow-[0_16px_40px_rgba(15,43,115,0.15)] flex flex-col max-h-[85vh] overflow-hidden">
            <div class="p-6 border-b border-[#e6edf7] flex justify-between items-center bg-kcsoft shrink-0">
                <h3 class="text-lg font-extrabold text-kcdark tracking-wide">🔔 การแจ้งเตือน</h3>
                <div class="flex items-center gap-3">
                    <button onclick="markAllAdminNotificationsReadUI()" class="text-xs font-bold text-kcblue hover:underline cursor-pointer">อ่านทั้งหมด</button>
                    <button onclick="closeAdminNotificationsModal()" class="text-slate-400 hover:text-red-600 font-bold text-2xl transition-colors cursor-pointer leading-none">✕</button>
                </div>
            </div>
            <div class="p-6 overflow-y-auto grow">
                <div id="adminNotificationsList" class="space-y-3">
                    <p class="text-center text-slate-400 text-sm py-6 font-bold">กำลังโหลดข้อมูล...</p>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(div);
}

function openAdminNotificationsModal() {
    ensureAdminNotificationsModal();
    const modal = document.getElementById('adminNotificationsModal');
    if (modal) { modal.classList.remove('hidden'); modal.classList.add('flex'); }
    loadAdminNotificationsList();
}
function closeAdminNotificationsModal() {
    const modal = document.getElementById('adminNotificationsModal');
    if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
}

function adminTimeAgoTh(dateStr) {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'เมื่อสักครู่';
    if (diffMin < 60) return `${diffMin} นาทีที่แล้ว`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr} ชม.ที่แล้ว`;
    return `${Math.floor(diffHr / 24)} วันที่แล้ว`;
}

async function refreshAdminNotifBadge() {
    const profile = window.currentUserProfile;
    if (!profile || !window.supabaseClient) return;
    try {
        const { count, error } = await window.supabaseClient
            .from('notifications')
            .select('id', { count: 'exact', head: true })
            .eq('recipient_user_profile_id', profile.id)
            .eq('is_read', false);
        if (error) throw error;
        const n = count || 0;
        ['adminNotifUnreadBadge', 'adminNotifUnreadBadgeMobile'].forEach(elId => {
            const el = document.getElementById(elId);
            if (!el) return;
            if (n > 0) { el.textContent = n > 99 ? '99+' : String(n); el.classList.remove('hidden'); }
            else { el.classList.add('hidden'); }
        });
    } catch (err) {
        console.error('refreshAdminNotifBadge error', err);
    }
}

async function loadAdminNotificationsList() {
    const listEl = document.getElementById('adminNotificationsList');
    const profile = window.currentUserProfile;
    if (!listEl || !profile) return;
    listEl.innerHTML = '<p class="text-center text-gray-400 text-sm py-6">กำลังโหลดข้อมูล...</p>';
    try {
        const { data, error } = await window.supabaseClient
            .from('notifications')
            .select('*')
            .eq('recipient_user_profile_id', profile.id)
            .order('created_at', { ascending: false })
            .limit(30);
        if (error) throw error;
        if (!data || data.length === 0) {
            listEl.innerHTML = '<p class="text-center text-gray-400 text-sm py-6">ยังไม่มีการแจ้งเตือน</p>';
            return;
        }
        listEl.innerHTML = data.map(item => `
            <div onclick="markAdminNotificationReadUI('${item.id}')" class="rounded-2xl border ${item.is_read ? 'border-[#e6edf7] bg-white' : 'border-kcblue bg-kclight'} p-4 cursor-pointer transition-colors">
                <div class="flex items-start gap-3">
                    <span class="text-xl shrink-0">${adminNotificationCategoryIcon[item.category] || '🔔'}</span>
                    <div class="min-w-0 flex-1">
                        <p class="text-sm font-bold ${item.is_read ? 'text-slate-500' : 'text-kcdark'}">${item.title}</p>
                        <p class="text-xs text-slate-500 mt-0.5">${item.body || ''}</p>
                        <p class="text-[11px] text-slate-400 mt-1 font-bold">${adminTimeAgoTh(item.created_at)}</p>
                    </div>
                    ${!item.is_read ? '<span class="w-2.5 h-2.5 rounded-full bg-kcblue shrink-0 mt-1"></span>' : ''}
                </div>
            </div>
        `).join('');
    } catch (err) {
        console.error('loadAdminNotificationsList error', err);
        listEl.innerHTML = `<p class="text-center text-red-500 text-sm py-6">โหลดข้อมูลไม่สำเร็จ: ${err.message}</p>`;
    }
}

async function markAdminNotificationReadUI(id) {
    try {
        const { error } = await window.supabaseClient
            .from('notifications')
            .update({ is_read: true, read_at: new Date().toISOString() })
            .eq('id', id);
        if (error) throw error;
        await loadAdminNotificationsList();
        await refreshAdminNotifBadge();
    } catch (err) {
        console.error('markAdminNotificationReadUI error', err);
    }
}

async function markAllAdminNotificationsReadUI() {
    const profile = window.currentUserProfile;
    if (!profile) return;
    try {
        const { error } = await window.supabaseClient
            .from('notifications')
            .update({ is_read: true, read_at: new Date().toISOString() })
            .eq('recipient_user_profile_id', profile.id)
            .eq('is_read', false);
        if (error) throw error;
        await loadAdminNotificationsList();
        await refreshAdminNotifBadge();
    } catch (err) {
        console.error('markAllAdminNotificationsReadUI error', err);
        alert('❌ ดำเนินการไม่สำเร็จ: ' + err.message);
    }
}