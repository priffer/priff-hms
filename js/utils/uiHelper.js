// js/utils/uiHelper.js

const UIHelper = {
    cachedDepartments: [],

    // 1. โหลดข้อมูลแผนกมาเก็บไว้ในความจำส่วนกลาง (โหลดแค่ครั้งเดียวใช้ได้ทั้งหน้า)
    async initDepartments() {
        if (this.cachedDepartments.length === 0) {
            try {
                this.cachedDepartments = await CandidateService.getDepartmentsWithHeadcount();
            } catch (err) {
                console.error("UIHelper: ไม่สามารถโหลดข้อมูลแผนกได้", err);
            }
        }
        return this.cachedDepartments;
    },

    // 2. ฟังก์ชันแปลง ID แผนก เป็นโค้ด HTML สีน้ำเงินสวยๆ (ใช้ในตาราง)
    getDepartmentDisplayHtml(departmentId, fallbackText = '-') {
        if (!departmentId) return fallbackText;
        
        const dept = this.cachedDepartments.find(d => d.id === departmentId);
        if (dept) {
            return `<span class="text-kcblue font-bold">${dept.department_name}</span>`;
        }
        return fallbackText;
    },

    // 3. ฟังก์ชันสร้างแท็ก <option> สำหรับกล่อง Dropdown เลือกแผนก (ใช้ในป๊อปอัป Modal)
    getDepartmentOptionsHtml(selectedId = null) {
        let html = '<option value="">-- กรุณาเลือกแผนก/ฝ่าย --</option>';
        const activeDepts = this.cachedDepartments.filter(d => d.is_active);
        
        activeDepts.forEach(d => {
            const isSelected = selectedId === d.id ? 'selected' : '';
            html += `<option value="${d.id}" ${isSelected}>${d.department_name} (${d.department_code})</option>`;
        });
        
        return html;
    }
};