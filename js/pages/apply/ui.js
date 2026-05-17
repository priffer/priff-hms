function initUI() {
    // ล็อกชื่อตำแหน่งอัตโนมัติ
    if (selectedPositionTitle) {
        const positionInput = document.getElementById('interestedPosition');
        if (positionInput) {
            positionInput.value = selectedPositionTitle;
            positionInput.readOnly = true;
            positionInput.classList.add('bg-gray-100', 'text-gray-600');
        }
    }
    
    // โหลดข้อความ PDPA ทันที
    loadPdpaContent();
}

async function loadPdpaContent() {
    try {
        const data = await CandidateService.getPdpaContent();
        if (data && data.setting_value) {
            document.getElementById('pdpaBody').innerText = data.setting_value;
        }
    } catch (error) {
        document.getElementById('pdpaBody').innerText = "ข้าพเจ้ายินยอมให้บริษัทฯ เก็บรวบรวม ใช้ และเปิดเผยข้อมูลส่วนบุคคลของข้าพเจ้า เพื่อพิจารณาการรับสมัครงาน ตาม พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล (PDPA)";
    }
}

// สลับฟอร์ม Office / Ops
DOM.jobGroupSelect.addEventListener('change', function() {
    const val = this.value;
    if(val) DOM.specificFieldsContainer.classList.remove('hidden');
    else DOM.specificFieldsContainer.classList.add('hidden');

    const officeReq = ['latestJob', 'drivingAndTravel', 'techAiSkills', 'selfLearning', 'latestMistake', 'problemSolving', 'teamworkAttitude', 'reasonForJoining', 'careerGoal'];
    const opsReq = ['workMode', 'shiftWork', 'commuteMethod', 'height', 'weight', 'medicalCondition', 'criminalRecord'];

    if (val === 'office') {
        DOM.officeFields.classList.remove('hidden');
        DOM.opsFields.classList.add('hidden');
        officeReq.forEach(id => { const el = document.getElementById(id); if(el) el.required = true; });
        opsReq.forEach(id => { const el = document.getElementById(id); if(el) el.required = false; });
        document.getElementById('email').required = true;
        document.getElementById('eduLabel').innerHTML = '4. สำเนาวุฒิการศึกษา <span class="text-xs font-normal text-red-500">(ควรแนบสำหรับออฟฟิศ)</span>';
    } else if (val === 'operations') {
        DOM.opsFields.classList.remove('hidden');
        DOM.officeFields.classList.add('hidden');
        opsReq.forEach(id => { const el = document.getElementById(id); if(el) el.required = true; });
        officeReq.forEach(id => { const el = document.getElementById(id); if(el) el.required = false; });
        document.getElementById('email').required = false;
        document.getElementById('eduLabel').innerHTML = '4. สำเนาวุฒิการศึกษา <span class="text-xs font-normal text-gray-500">(ถ้ามี)</span>';
    }
});

// จัดการปุ่มเคลียร์ไฟล์
document.querySelectorAll('.file-input-trigger').forEach(input => {
    input.addEventListener('change', function() {
        const clearBtn = document.getElementById(`btn-clear-${this.id}`);
        if (clearBtn) clearBtn.classList.toggle('hidden', this.files.length === 0);
    });
});

window.clearFile = function(inputId) {
    const input = document.getElementById(inputId);
    if (input) input.value = ''; 
    const clearBtn = document.getElementById(`btn-clear-${inputId}`);
    if (clearBtn) clearBtn.classList.add('hidden');
};

document.getElementById('otherCertsFiles').addEventListener('change', function() {
    if (this.files.length > 5) {
        alert("อัปโหลดใบเซอร์เพิ่มเติมได้สูงสุด 5 ไฟล์เท่านั้นครับ");
        this.value = ''; 
        document.getElementById('btn-clear-otherCertsFiles').classList.add('hidden');
    }
});

initUI();