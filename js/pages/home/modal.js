function openJobModal(id) {
    const job = allJobs.find(j => j.id === id);
    if (!job) return;
    selectedJobForModal = job;

    document.getElementById('modalZone').innerText = `โซน: ${job.zone_name}`;
    document.getElementById('modalTitle').innerText = job.title;
    document.getElementById('modalCompany').innerText = job.company_name || document.getElementById('dynamicCompanyName').innerText;
    document.getElementById('modalSalary').innerText = `รายได้: ${job.salary_text}`;
    document.getElementById('modalContent').innerText = job.content || 'ไม่มีรายละเอียดเพิ่มเติม';

    const mediaContainer = document.getElementById('modalMediaContainer');
    const modalImg = document.getElementById('modalImage');
    const modalPdf = document.getElementById('modalPdf');

    mediaContainer.classList.add('hidden');
    modalImg.classList.add('hidden');
    modalPdf.classList.add('hidden');

    if (job.flyer_url) {
        modalImg.src = job.flyer_url;
        modalImg.classList.remove('hidden');
        mediaContainer.classList.remove('hidden');
    }

    const modal = document.getElementById('jobModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.classList.add('modal-open');
}

function closeModal() {
    document.getElementById('jobModal').classList.add('hidden');
    document.getElementById('jobModal').classList.remove('flex');
    document.body.classList.remove('modal-open');
    selectedJobForModal = null;
}

function applyForThisJob() {
    if (!selectedJobForModal) return;
    localStorage.setItem('selected_position_title', selectedJobForModal.title);
    localStorage.setItem('target_company_id', CURRENT_SITE_COMPANY_ID);
    window.location.href = 'apply.html';
}

function shareJob(platform) {
    if (!selectedJobForModal) return;
    const shareUrl = `${window.location.origin}${window.location.pathname}?company=${CURRENT_SITE_COMPANY_ID}&job=${selectedJobForModal.id}`;
    const shareText = `แนะนำตำแหน่งงาน: ${selectedJobForModal.title}`;

    if (platform === 'line') window.open(`https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`, '_blank');
    if (platform === 'facebook') window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`, '_blank');
    if (platform === 'copy') navigator.clipboard.writeText(shareUrl).then(() => alert('คัดลอกลิงก์เรียบร้อยแล้ว'));
}