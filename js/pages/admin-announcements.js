// js/pages/admin-announcements.js
// หน้าแอดมิน: จัดการประกาศบริษัท + ปฏิทินวันหยุดบริษัท/ไซต์ลูกค้า

function showToast(message, duration = 3000) {
    const toast = document.getElementById('globalToast');
    const msgSpan = document.getElementById('toastMessage');
    if (!toast || !msgSpan) return;
    msgSpan.textContent = message;
    toast.classList.remove('hidden');
    toast.classList.add('flex');
    setTimeout(() => {
        toast.classList.add('hidden');
        toast.classList.remove('flex');
    }, duration);
}

function initAdminAnnouncementsPage() {
    loadAnnouncementAdminList();
    loadCompanyHolidayAdminList();
    loadClientHolidayAdminList();
    loadClientOptionsForHolidayForm();
    bindAnnouncementForms();
}

function switchAnnAdminTab(tab) {
    const tabs = ['feed', 'company', 'client'];
    tabs.forEach(t => {
        const btn = document.getElementById(`annAdminTab-${t}`);
        const view = document.getElementById(`annAdminView-${t}`);
        if (!btn || !view) return;
        if (t === tab) {
            btn.classList.add('bg-kcblue', 'text-white');
            btn.classList.remove('bg-[#f7faff]', 'border', 'border-[#e6edf7]', 'text-slate-600');
            view.classList.remove('hidden');
        } else {
            btn.classList.remove('bg-kcblue', 'text-white');
            btn.classList.add('bg-[#f7faff]', 'border', 'border-[#e6edf7]', 'text-slate-600');
            view.classList.add('hidden');
        }
    });
}

const annCategoryLabel = {
    general: '📰 ทั่วไป',
    policy: '📋 ระเบียบ',
    benefit: '🎁 สวัสดิการ',
    safety: '🦺 ความปลอดภัย'
};

// ---------- ประกาศบริษัท ----------
async function loadAnnouncementAdminList() {
    const listEl = document.getElementById('announcementAdminList');
    if (!listEl) return;
    try {
        const list = await window.AnnouncementService.getAllAnnouncements();
        if (!list || list.length === 0) {
            listEl.innerHTML = '<p class="text-center text-slate-400 text-sm py-6">ยังไม่มีประกาศ</p>';
            return;
        }
        listEl.innerHTML = list.map(item => {
            const isDraft = !item.published_at;
            const statusBadge = isDraft
                ? '<span class="bg-slate-100 text-slate-500 border border-slate-200 rounded-full px-2 py-0.5 text-[10px] font-bold">แบบร่าง</span>'
                : '<span class="bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2 py-0.5 text-[10px] font-bold">เผยแพร่แล้ว</span>';
            return `
                <div class="rounded-2xl border ${item.is_pinned ? 'border-kcyellow bg-[#fff9ec]' : 'border-[#e6edf7] bg-[#f7faff]'} p-4">
                    <div class="flex justify-between items-start gap-2 mb-1">
                        <p class="text-sm font-bold text-kcdark">${item.is_pinned ? '📌 ' : ''}${item.title}</p>
                        <div class="flex gap-1 shrink-0">${statusBadge}</div>
                    </div>
                    <p class="text-xs text-slate-600 whitespace-pre-line mb-2">${item.body}</p>
                    <div class="flex justify-between items-center">
                        <span class="text-[11px] text-slate-400">${annCategoryLabel[item.category] || item.category}</span>
                        <button onclick="deleteAnnouncementItem('${item.id}')" class="text-xs font-bold text-red-500 hover:underline cursor-pointer">ลบ</button>
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error('loadAnnouncementAdminList error', err);
        listEl.innerHTML = '<p class="text-center text-red-500 text-sm py-6">โหลดข้อมูลไม่สำเร็จ: ' + err.message + '</p>';
    }
}

async function deleteAnnouncementItem(id) {
    if (!confirm('ยืนยันการลบประกาศนี้?')) return;
    try {
        await window.AnnouncementService.deleteAnnouncement(id);
        showToast('✅ ลบประกาศสำเร็จ');
        loadAnnouncementAdminList();
    } catch (err) {
        showToast('❌ ลบไม่สำเร็จ: ' + err.message);
    }
}

// ---------- วันหยุดบริษัท ----------
async function loadCompanyHolidayAdminList() {
    const listEl = document.getElementById('companyHolidayAdminList');
    if (!listEl) return;
    try {
        const list = await window.AnnouncementService.getAllCompanyHolidays();
        if (!list || list.length === 0) {
            listEl.innerHTML = '<p class="text-center text-slate-400 text-sm py-6">ยังไม่มีวันหยุดบริษัท</p>';
            return;
        }
        listEl.innerHTML = list.map(h => `
            <div class="flex justify-between items-center rounded-xl border border-[#e6edf7] bg-[#f7faff] px-3 py-2">
                <div>
                    <span class="text-xs font-bold text-slate-700">${h.name_th}</span>
                    <span class="block text-[11px] text-slate-400">${new Date(h.holiday_date).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                </div>
                <button onclick="deleteCompanyHolidayItem('${h.id}')" class="text-xs font-bold text-red-500 hover:underline cursor-pointer">ลบ</button>
            </div>
        `).join('');
    } catch (err) {
        console.error('loadCompanyHolidayAdminList error', err);
        listEl.innerHTML = '<p class="text-center text-red-500 text-sm py-6">โหลดข้อมูลไม่สำเร็จ: ' + err.message + '</p>';
    }
}

async function deleteCompanyHolidayItem(id) {
    if (!confirm('ยืนยันการลบวันหยุดนี้?')) return;
    try {
        await window.AnnouncementService.deleteCompanyHoliday(id);
        showToast('✅ ลบวันหยุดสำเร็จ');
        loadCompanyHolidayAdminList();
    } catch (err) {
        showToast('❌ ลบไม่สำเร็จ: ' + err.message);
    }
}

// ---------- วันหยุดไซต์ลูกค้า ----------
async function loadClientOptionsForHolidayForm() {
    const select = document.getElementById('chClientSelect');
    if (!select) return;
    try {
        const { data, error } = await supabaseClient.from('clients').select('id, client_name').order('client_name');
        if (error) throw error;
        select.innerHTML = '<option value="">-- เลือกไซต์ลูกค้า --</option>';
        (data || []).forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = c.client_name;
            select.appendChild(opt);
        });
    } catch (err) {
        console.error('loadClientOptionsForHolidayForm error', err);
        select.innerHTML = '<option value="">❌ โหลดไซต์งานไม่สำเร็จ</option>';
    }
}

async function loadClientHolidayAdminList() {
    const listEl = document.getElementById('clientHolidayAdminList');
    if (!listEl) return;
    try {
        const list = await window.AnnouncementService.getAllClientHolidays();
        if (!list || list.length === 0) {
            listEl.innerHTML = '<p class="text-center text-slate-400 text-sm py-6">ยังไม่มีวันหยุดไซต์ลูกค้า</p>';
            return;
        }
        listEl.innerHTML = list.map(h => `
            <div class="flex justify-between items-center rounded-xl border border-[#cdeedd] bg-[#f0fbf5] px-3 py-2">
                <div>
                    <span class="text-xs font-bold text-slate-700">${h.name_th}</span>
                    <span class="block text-[11px] text-emerald-600 font-bold">${h.clients?.client_name || 'ไม่ระบุไซต์งาน'} · ${new Date(h.holiday_date).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                </div>
                <button onclick="deleteClientHolidayItem('${h.id}')" class="text-xs font-bold text-red-500 hover:underline cursor-pointer">ลบ</button>
            </div>
        `).join('');
    } catch (err) {
        console.error('loadClientHolidayAdminList error', err);
        listEl.innerHTML = '<p class="text-center text-red-500 text-sm py-6">โหลดข้อมูลไม่สำเร็จ: ' + err.message + '</p>';
    }
}

async function deleteClientHolidayItem(id) {
    if (!confirm('ยืนยันการลบวันหยุดนี้?')) return;
    try {
        await window.AnnouncementService.deleteClientHoliday(id);
        showToast('✅ ลบวันหยุดสำเร็จ');
        loadClientHolidayAdminList();
    } catch (err) {
        showToast('❌ ลบไม่สำเร็จ: ' + err.message);
    }
}

async function copyCompanyHolidaysToSelectedClient() {
    const clientId = document.getElementById('chClientSelect').value;
    if (!clientId) { showToast('⚠️ กรุณาเลือกไซต์ลูกค้าก่อน'); return; }
    if (!confirm('คัดลอกวันหยุดบริษัททั้งหมดมาเป็นฐานตั้งต้นของไซต์นี้?\n(วันที่ไซต์นี้มีอยู่แล้วจะถูกข้าม ไม่ทับข้อมูลเดิม)')) return;
    try {
        const result = await window.AnnouncementService.copyCompanyHolidaysToClient(clientId);
        if (result.total === 0) {
            showToast('⚠️ ยังไม่มีวันหยุดบริษัทให้คัดลอก');
        } else {
            const skipped = result.total - result.copied;
            showToast(`✅ คัดลอกสำเร็จ ${result.copied} วัน${skipped > 0 ? ` (ข้าม ${skipped} วันที่มีอยู่แล้ว)` : ''}`);
        }
        loadClientHolidayAdminList();
    } catch (err) {
        console.error('copyCompanyHolidaysToClient error', err);
        showToast('❌ คัดลอกไม่สำเร็จ: ' + err.message);
    }
}

// ---------- Form bindings ----------
function bindAnnouncementForms() {
    const annForm = document.getElementById('announcementForm');
    if (annForm) {
        annForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('annSubmitBtn');
            const title = document.getElementById('annTitle').value.trim();
            const body = document.getElementById('annBody').value.trim();
            const category = document.getElementById('annCategory').value;
            const isPinned = document.getElementById('annPinned').checked;
            const publishNow = document.getElementById('annPublishNow').checked;
            const targetSelect = document.getElementById('annTargetRoles');
            const targetRoles = Array.from(targetSelect.selectedOptions).map(o => o.value);
            const attachmentFile = document.getElementById('annAttachmentFile').files[0];

            btn.disabled = true; btn.classList.add('opacity-50');
            try {
                let attachment_url = null;
                if (attachmentFile) {
                    const fileName = `announcements/${Date.now()}_${attachmentFile.name}`;
                    await window.AnnouncementService.uploadAttachment(attachmentFile, fileName);
                    attachment_url = window.AnnouncementService.getAttachmentPublicUrl(fileName);
                }
                await window.AnnouncementService.createAnnouncement({
                    title,
                    body,
                    category,
                    is_pinned: isPinned,
                    target_roles: targetRoles.length > 0 ? targetRoles : null,
                    attachment_url,
                    published_at: publishNow ? new Date().toISOString() : null
                });
                showToast('✅ บันทึกประกาศสำเร็จ');
                annForm.reset();
                loadAnnouncementAdminList();
            } catch (err) {
                console.error('createAnnouncement error', err);
                showToast('❌ บันทึกไม่สำเร็จ: ' + err.message);
            } finally {
                btn.disabled = false; btn.classList.remove('opacity-50');
            }
        });
    }

    const chForm = document.getElementById('companyHolidayForm');
    if (chForm) {
        chForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const holiday_date = document.getElementById('chDate').value;
            const name_th = document.getElementById('chName').value.trim();
            const holiday_type = document.getElementById('chType').value;
            if (!holiday_date || !name_th) { showToast('⚠️ กรุณากรอกข้อมูลให้ครบถ้วน'); return; }
            try {
                await window.AnnouncementService.createCompanyHoliday({ holiday_date, name_th, holiday_type });
                showToast('✅ เพิ่มวันหยุดสำเร็จ');
                chForm.reset();
                loadCompanyHolidayAdminList();
            } catch (err) {
                console.error('createCompanyHoliday error', err);
                showToast('❌ เพิ่มไม่สำเร็จ: ' + err.message);
            }
        });
    }

    const clhForm = document.getElementById('clientHolidayForm');
    if (clhForm) {
        clhForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const client_id = document.getElementById('chClientSelect').value;
            const holiday_date = document.getElementById('clhDate').value;
            const name_th = document.getElementById('clhName').value.trim();
            if (!client_id || !holiday_date || !name_th) { showToast('⚠️ กรุณากรอกข้อมูลให้ครบถ้วน'); return; }
            try {
                await window.AnnouncementService.createClientHoliday({ client_id, holiday_date, name_th });
                showToast('✅ เพิ่มวันหยุดสำเร็จ');
                clhForm.reset();
                loadClientHolidayAdminList();
            } catch (err) {
                console.error('createClientHoliday error', err);
                showToast('❌ เพิ่มไม่สำเร็จ: ' + err.message);
            }
        });
    }
}
