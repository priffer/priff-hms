// ตัวกรองพื้นที่
const ZonePicker = {
    selectedZonesList: [],

    init() {
        this.zProv = document.getElementById('zoneProvince');
        this.zType = document.getElementById('zoneType');
        this.zLoc = document.getElementById('zoneLocation');
        this.btnAdd = document.getElementById('btnAddZone');
        this.tagsContainer = document.getElementById('selectedZonesTags');
        this.emptyText = document.getElementById('emptyZoneText');
        this.checkOther = document.getElementById('checkOtherZone');
        this.inputOther = document.getElementById('inputOtherZone');

        if(!this.zProv) return;

        this.bindEvents();
    },

    bindEvents() {
        this.zProv.addEventListener('change', () => this.onProvChange());
        this.zType.addEventListener('change', () => this.onTypeChange());
        this.zLoc.addEventListener('change', () => this.onLocChange());
        this.btnAdd.addEventListener('click', () => this.addZone());

        if(this.checkOther) {
            this.checkOther.addEventListener('change', (e) => {
                this.inputOther.disabled = !e.target.checked;
                if(e.target.checked) this.inputOther.focus();
                else this.inputOther.value = '';
            });
        }
        
        window.removeZone = (index) => this.removeZone(index);
    },

    onProvChange() {
        this.zType.value = "";
        this.resetLoc();
        this.zType.disabled = !this.zProv.value;
    },

    onTypeChange() {
        this.resetLoc();
        const prov = this.zProv.value;
        const type = this.zType.value;

        if(typeof locationData === 'undefined') {
            console.error("ไม่พบฐานข้อมูล locationData");
            return;
        }

        if(prov && type) {
            this.zLoc.disabled = false;
            const data = locationData[prov][type];
            
            if (type === 'นิคมอุตสาหกรรม') {
                data.forEach(item => {
                    this.zLoc.innerHTML += `<option value="${item}">${item}</option>`;
                });
            } else {
                for (const [amphoe, tambons] of Object.entries(data)) {
                    let optgroup = document.createElement('optgroup');
                    optgroup.label = amphoe;
                    tambons.forEach(t => {
                        let option = document.createElement('option');
                        option.value = `${prov} > ${amphoe} > ${t}`;
                        option.innerText = t;
                        optgroup.appendChild(option);
                    });
                    this.zLoc.appendChild(optgroup);
                }
            }
        }
    },

    onLocChange() {
        this.btnAdd.disabled = !this.zLoc.value;
    },

    resetLoc() {
        this.zLoc.innerHTML = '<option value="">- เลือกพื้นที่ -</option>';
        this.zLoc.disabled = true;
        this.btnAdd.disabled = true;
    },

    addZone() {
        const val = this.zLoc.value;
        if(!val) return;
        
        if(!this.selectedZonesList.includes(val)) {
            this.selectedZonesList.push(val);
            this.renderTags();
        }
        this.zLoc.value = "";
        this.btnAdd.disabled = true;
    },

    removeZone(index) {
        this.selectedZonesList.splice(index, 1);
        this.renderTags();
    },

    renderTags() {
        if(this.selectedZonesList.length > 0) this.emptyText.classList.add('hidden');
        else this.emptyText.classList.remove('hidden');
        
        const existingTags = this.tagsContainer.querySelectorAll('.zone-tag');
        existingTags.forEach(tag => tag.remove());
        
        this.selectedZonesList.forEach((zone, index) => {
            const span = document.createElement('span');
            span.className = "zone-tag bg-blue-100 text-kcblue px-3 py-1 text-xs font-bold border border-blue-300 flex items-center gap-2";
            span.innerHTML = `${zone} <button type="button" class="text-red-500 hover:text-red-700 font-bold border-0 bg-transparent cursor-pointer text-sm" onclick="removeZone(${index})">✕</button>`;
            this.tagsContainer.appendChild(span);
        });
    },

    getFinalZonesArray() {
        let finalArray = [...this.selectedZonesList];
        if (this.checkOther && this.checkOther.checked) {
            const otherVal = this.inputOther.value.trim();
            if(otherVal) finalArray.push(`พื้นที่อื่นๆ: ${otherVal}`);
        }
        return finalArray;
    },
    
    clearData() {
        this.selectedZonesList = [];
        this.renderTags();
        if(this.zProv) this.zProv.value = "";
        if(this.zType) this.zType.value = "";
        this.resetLoc();
        if(this.zType) this.zType.disabled = true;
        if(this.checkOther) {
            this.checkOther.checked = false;
            this.inputOther.value = '';
            this.inputOther.disabled = true;
        }
    }
};

document.addEventListener('DOMContentLoaded', () => ZonePicker.init());