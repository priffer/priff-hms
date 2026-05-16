let currentActiveJob = null;
let currentPage = 1;
const itemsPerPage = 12;
let currentFilteredJobs = [];

function cleanString(str) {
    if (!str) return "";
    return str.toLowerCase()
        .replace(/^(งาน|พนักงาน|รับสมัคร|ตำแหน่ง|นิคมอุตสาหกรรม|นิคม|สวนอุตสาหกรรม|เขต|อ\.|ต\.|จังหวัด)/g, '')
        .replace(/\s+/g, '')
        .trim();
}

async function loadSystemSettings() {
    const listContainer = document.getElementById('welfareList');
    try {
        const { data: headlineData } = await supabaseClient.from('system_settings').select('setting_value').eq('setting_key', 'MAIN_HEADLINE').single();
        if (headlineData && headlineData.setting_value) document.getElementById('mainHeadline').innerText = headlineData.setting_value;
        const { data: welfareData, error } = await supabaseClient.from('system_settings').select('setting_value').eq('setting_key', 'CORE_WELFARES').single();
        if (error) throw error; 
        if (welfareData && welfareData.setting_value) {
            listContainer.innerHTML = '';
            welfareData.setting_value.split('\n').forEach(item => {
                if(item.trim()) listContainer.innerHTML += `<li class="flex items-start gap-2">✔️ <span class="text-gray-700">${item.trim()}</span></li>`;
            });
        }
    } catch (error) {
        listContainer.innerHTML = `<li class="flex items-start gap-2">✔️ <span class="text-gray-700">ประกันสังคม / กองทุนเงินทดแทน</span></li><li class="flex items-start gap-2">✔️ <span class="text-gray-700">ชุดยูนิฟอร์มพนักงาน (ฟรี)</span></li><li class="flex items-start gap-2">✔️ <span class="text-gray-700">วันหยุดประเพณี / ลาพักร้อนประจำปี</span></li>`;
    }
}

function populateZonesFilter() {
    const dd1 = document.getElementById('dd1');
    if (!dd1 || typeof locationData === 'undefined') return;

    dd1.innerHTML = '<option value="">-- สถานที่ทั้งหมด --</option>';
    dd1.innerHTML += '<option value="นิคมอุตสาหกรรม">📌 งานในนิคมอุตสาหกรรม</option>';
    Object.keys(locationData).forEach(prov => {
        dd1.innerHTML += `<option value="${prov}">📍 จังหวัด${prov}</option>`;
    });
}

function handleDd1Change() {
    const val1 = document.getElementById('dd1').value;
    const box2 = document.getElementById('boxDd2');
    const lbl2 = document.getElementById('lblDd2');
    const dd2 = document.getElementById('dd2');
    const box3 = document.getElementById('boxDd3');
    
    box3.classList.add('hidden'); 
    document.getElementById('dd3').innerHTML = '';

    if (val1 === 'นิคมอุตสาหกรรม') {
        box2.classList.remove('hidden');
        lbl2.innerText = 'จังหวัด';
        dd2.innerHTML = '<option value="">-- ทุกจังหวัด --</option>';
        Object.keys(locationData).forEach(prov => {
            dd2.innerHTML += `<option value="${prov}">${prov}</option>`;
        });
    } else if (val1 !== '') { 
        box2.classList.remove('hidden');
        lbl2.innerText = 'อำเภอ / เขต';
        dd2.innerHTML = '<option value="">-- ทุกอำเภอ --</option>';
        Object.keys(locationData[val1]["เขตอำเภอ/ตำบล"] || {}).forEach(dist => {
            dd2.innerHTML += `<option value="${dist}">${dist}</option>`;
        });
    } else {
        box2.classList.add('hidden'); 
    }
}

function handleDd2Change() {
    const val1 = document.getElementById('dd1').value;
    const val2 = document.getElementById('dd2').value;
    const box3 = document.getElementById('boxDd3');
    const lbl3 = document.getElementById('lblDd3');
    const dd3 = document.getElementById('dd3');

    if (val2 === '') {
        box3.classList.add('hidden');
        return;
    }

    if (val1 === 'นิคมอุตสาหกรรม') {
        box3.classList.remove('hidden');
        lbl3.innerText = 'รายชื่อนิคมอุตสาหกรรม';
        dd3.innerHTML = '<option value="">-- ทุกนิคมอุตสาหกรรม --</option>';
        (locationData[val2]["นิคมอุตสาหกรรม"] || []).forEach(est => {
            dd3.innerHTML += `<option value="${est}">${est}</option>`;
        });
    } else { 
        box3.classList.remove('hidden');
        lbl3.innerText = 'ตำบล / แขวง';
        dd3.innerHTML = '<option value="">-- ทุกตำบล --</option>';
        (locationData[val1]["เขตอำเภอ/ตำบล"][val2] || []).forEach(tam => {
            dd3.innerHTML += `<option value="${tam}">${tam}</option>`;
        });
    }
}

function filterJobs() {
    let rawKeyword = document.getElementById('searchKeyword').value.trim();
    let keyword = cleanString(rawKeyword);

    const dd1 = document.getElementById('dd1').value;
    const dd2 = document.getElementById('dd2').value;
    const dd3 = document.getElementById('dd3').value;

    const filtered = mockJobPostings.filter(job => {
        const jobTitleClean = cleanString(job.title);
        const jobCompanyClean = cleanString(job.companyName);
        const jobZoneClean = cleanString(job.zone);
        const jobContentClean = cleanString(job.contentData);

        const matchKeyword = keyword === '' || jobTitleClean.includes(keyword) || jobContentClean.includes(keyword) || jobZoneClean.includes(keyword) || jobCompanyClean.includes(keyword);

        let matchLocation = true;

        if (dd1 === 'นิคมอุตสาหกรรม') {
            const province = dd2;
            const estate = dd3;
            if (estate !== '') {
                matchLocation = jobZoneClean.includes(cleanString(estate));
            } else if (province !== '') {
                const estatesInProv = locationData[province]["นิคมอุตสาหกรรม"] || [];
                matchLocation = estatesInProv.some(e => jobZoneClean.includes(cleanString(e)));
            } else {
                let allEstates = [];
                Object.values(locationData).forEach(p => allEstates = allEstates.concat(p["นิคมอุตสาหกรรม"] || []));
                matchLocation = allEstates.some(e => jobZoneClean.includes(cleanString(e)));
            }
        } 
        else if (dd1 !== '') { 
            const province = dd1;
            const district = dd2;
            const tambon = dd3;

            if (tambon !== '') {
                matchLocation = jobZoneClean.includes(cleanString(tambon));
            } else if (district !== '') {
                let cleanDist = cleanString(district);
                let tambonsInDist = locationData[province]["เขตอำเภอ/ตำบล"][district] || [];
                let matchDist = jobZoneClean.includes(cleanDist);
                let mtchTam = tambonsInDist.some(t => jobZoneClean.includes(cleanString(t)));
                matchLocation = matchDist || mtchTam;
            } else {
                matchLocation = jobZoneClean.includes(cleanString(province));
            }
        }

        return matchKeyword && matchLocation;
    });

    currentPage = 1; 
    renderJobs(filtered);
}

function renderJobs(jobsToRender) {
    currentFilteredJobs = jobsToRender;
    const grid = document.getElementById('jobGrid');
    const countLabel = document.getElementById('jobCount');
    
    grid.innerHTML = '';
    countLabel.innerText = jobsToRender.length;

    if (jobsToRender.length === 0) {
        grid.innerHTML = `<div class="col-span-full p-8 text-center text-gray-500 bg-white border-2 border-gray-300 font-bold text-lg">ไม่พบตำแหน่งงานที่ค้นหา ลองเปลี่ยนพื้นที่หรือคำค้นหาดูนะครับ</div>`;
        renderPagination(0);
        return;
    }

    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const jobsOnPage = jobsToRender.slice(startIndex, endIndex);

    jobsOnPage.forEach(job => {
        const card = document.createElement('div');
        card.className = "bg-white border-2 border-gray-300 hover:border-kcblue transition-colors shadow-sm cursor-pointer flex flex-col h-full group border-t-8 border-t-gray-300 hover:border-t-kcblue";
        card.onclick = () => openModal(job.id);

        card.innerHTML = `
            <div class="p-5 flex-1 flex flex-col">
                <span class="inline-block bg-blue-50 text-kcblue font-bold px-2 py-1 text-[11px] mb-2 self-start border border-blue-200 truncate max-w-full">📍 ${job.zone}</span>
                <p class="text-[12px] font-bold text-gray-500 mb-1 line-clamp-1">🏢 ${job.companyName || 'ไม่ระบุสถานที่'}</p>
                <h3 class="text-[16px] font-bold text-gray-800 mb-2 leading-snug line-clamp-2 group-hover:text-kcblue transition-colors">${job.title}</h3>
                <p class="text-green-600 font-bold text-sm mb-4">${job.salaryHighlight}</p>
                <div class="mt-auto pt-4 border-t-2 border-gray-100 flex justify-between items-center">
                    <span class="text-kcblue font-bold text-xs group-hover:underline">ดูรายละเอียด &rarr;</span>
                </div>
            </div>
        `;
        grid.appendChild(card);
    });

    renderPagination(jobsToRender.length);
}

function renderPagination(totalItems) {
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    const paginationContainer = document.getElementById('paginationControls');
    paginationContainer.innerHTML = '';

    if (totalPages <= 1) return; 

    const prevBtn = document.createElement('button');
    prevBtn.className = `w-10 h-10 flex items-center justify-center border-2 font-bold transition-colors ${currentPage === 1 ? 'bg-gray-100 border-gray-300 text-gray-400 cursor-not-allowed' : 'bg-white border-gray-300 text-kcblue hover:bg-gray-100 cursor-pointer'}`;
    prevBtn.innerText = '<';
    prevBtn.onclick = () => { if(currentPage > 1) { currentPage--; renderJobs(currentFilteredJobs); window.scrollTo({top: 0, behavior: 'smooth'}); } };
    paginationContainer.appendChild(prevBtn);

    for (let i = 1; i <= totalPages; i++) {
        const pageBtn = document.createElement('button');
        pageBtn.className = `w-10 h-10 flex items-center justify-center border-2 font-bold transition-colors ${currentPage === i ? 'bg-kcblue text-white border-kcblue' : 'bg-white border-gray-300 text-kcblue hover:bg-gray-100'}`;
        pageBtn.innerText = i;
        pageBtn.onclick = () => { currentPage = i; renderJobs(currentFilteredJobs); window.scrollTo({top: 0, behavior: 'smooth'}); };
        paginationContainer.appendChild(pageBtn);
    }

    const nextBtn = document.createElement('button');
    nextBtn.className = `w-10 h-10 flex items-center justify-center border-2 font-bold transition-colors ${currentPage === totalPages ? 'bg-gray-100 border-gray-300 text-gray-400 cursor-not-allowed' : 'bg-white border-gray-300 text-kcblue hover:bg-gray-100 cursor-pointer'}`;
    nextBtn.innerText = '>';
    nextBtn.onclick = () => { if(currentPage < totalPages) { currentPage++; renderJobs(currentFilteredJobs); window.scrollTo({top: 0, behavior: 'smooth'}); } };
    paginationContainer.appendChild(nextBtn);
}

function openModal(jobId) {
    const job = mockJobPostings.find(j => j.id === jobId);
    if (!job) return;
    currentActiveJob = job;
    
    document.getElementById('modalTitle').innerText = job.title;
    document.getElementById('modalCompany').innerText = "🏢 " + (job.companyName || 'ไม่ระบุชื่อสถานประกอบการ');
    document.getElementById('modalZone').innerText = "📍 " + job.zone;
    document.getElementById('modalSalary').innerText = "💰 " + job.salaryHighlight;
    document.getElementById('modalContent').innerText = job.contentData;

    const mediaContainer = document.getElementById('modalMediaContainer');
    const imgEl = document.getElementById('modalImage');
    const pdfEl = document.getElementById('modalPdf');
    
    imgEl.classList.add('hidden');
    pdfEl.classList.add('hidden');
    mediaContainer.classList.add('hidden');

    if (job.fileUrl) {
        mediaContainer.classList.remove('hidden');
        if (job.contentType === 'image') {
            imgEl.src = job.fileUrl;
            imgEl.classList.remove('hidden');
        } else if (job.contentType === 'pdf') {
            pdfEl.src = job.fileUrl;
            pdfEl.classList.remove('hidden');
        }
    }

    const modal = document.getElementById('jobModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.classList.add('modal-open');
    window.history.pushState({jobId: job.id}, '', `?job=${job.id}`);
}

function closeModal() {
    const modal = document.getElementById('jobModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    document.body.classList.remove('modal-open');
    currentActiveJob = null;
    window.history.pushState({}, '', window.location.pathname);
    
    document.getElementById('modalImage').src = '';
    document.getElementById('modalPdf').src = '';
}

function checkDeepLink() {
    const urlParams = new URLSearchParams(window.location.search);
    const jobIdFromUrl = urlParams.get('job');
    if (jobIdFromUrl) openModal(jobIdFromUrl);
}

function shareJob(platform) {
    if (!currentActiveJob) return;
    const shareUrl = `${window.location.origin}${window.location.pathname}?job=${currentActiveJob.id}`;
    const shareText = `ด่วน! รับสมัคร ${currentActiveJob.title} ที่ ${currentActiveJob.companyName || currentActiveJob.zone} (${currentActiveJob.salaryHighlight}) สนใจคลิกดูรายละเอียดและสมัครเลย: `;

    if (platform === 'line') window.open(`https://line.me/R/msg/text/?${encodeURIComponent(shareText + shareUrl)}`, '_blank');
    else if (platform === 'facebook') window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`, '_blank');
    else if (platform === 'copy') {
        navigator.clipboard.writeText(shareText + shareUrl).then(() => alert('คัดลอกลิงก์เรียบร้อย นำไปวางส่งให้เพื่อนได้เลยครับ!'));
    }
}

function applyForThisJob() {
    if (!currentActiveJob) return;
    const positionText = encodeURIComponent(`${currentActiveJob.title} - ${currentActiveJob.companyName || currentActiveJob.zone}`);
    window.location.href = `apply.html?auto_position=${positionText}`;
}

document.addEventListener('DOMContentLoaded', () => {
    loadSystemSettings();
    populateZonesFilter(); 
    if (typeof mockJobPostings !== 'undefined') renderJobs(mockJobPostings);
    checkDeepLink();
    
    document.getElementById('searchKeyword').addEventListener('keypress', function (e) {
        if (e.key === 'Enter') filterJobs();
    });
});