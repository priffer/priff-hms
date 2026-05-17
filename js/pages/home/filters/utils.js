function cleanStr(str) {
    return String(str || '').replace(/ต\.|อ\.|จ\.|เขต|\(ทั้งหมด\)/g, '').replace(/\s+/g, '').toLowerCase();
}

function isZoneInArea(zoneText, p1, p2, p3) {
    if (!p1) return true; 
    
    const z = cleanStr(zoneText);
    
    if (p3) {
        const cleanP3 = cleanStr(p3);
        if (z.includes(cleanP3) || cleanP3.includes(z)) return true;
        
        // หาก p3 เป็นชื่ออำเภอ (เกิดจากการเลือก "ทั้งหมด" ใน Dropdown 3)
        // ให้ทะลวงเข้าไปเช็กตำบลทั้งหมดที่อยู่ใต้อำเภอนั้นๆ ด้วย
        if (p2 && typeof locationData !== 'undefined' && locationData[p1] && locationData[p1][p2]) {
            const node = locationData[p1][p2];
            if (!Array.isArray(node) && node[p3]) {
                return node[p3].some(tambon => {
                    const cTambon = cleanStr(tambon);
                    return z.includes(cTambon) || cTambon.includes(z);
                });
            }
        }
        return false;
    }
    
    if (p2 && typeof locationData !== 'undefined' && locationData[p1] && locationData[p1][p2]) {
        const node = locationData[p1][p2];
        const cleanP2 = cleanStr(p2);
        
        if (z.includes(cleanP2) || cleanP2.includes(z)) return true;

        if (Array.isArray(node)) {
            return node.some(sub => {
                const cSub = cleanStr(sub);
                return z.includes(cSub) || cSub.includes(z);
            });
        } else {
            return Object.keys(node).some(amphoe => {
                const cAmphoe = cleanStr(amphoe);
                if (z.includes(cAmphoe) || cAmphoe.includes(z)) return true;
                
                return node[amphoe].some(tambon => {
                    const cTambon = cleanStr(tambon);
                    return z.includes(cTambon) || cTambon.includes(z);
                });
            });
        }
    }
    
    if (p1) { 
        const cleanP1 = cleanStr(p1);
        if (z.includes(cleanP1) || cleanP1.includes(z)) return true;

        if (typeof locationData !== 'undefined' && locationData[p1]) {
            for (const k2 of Object.keys(locationData[p1])) {
                const node = locationData[p1][k2];
                if (Array.isArray(node)) {
                    if (node.some(sub => {
                        const cSub = cleanStr(sub);
                        return z.includes(cSub) || cSub.includes(z);
                    })) return true;
                } else {
                    for (const amphoe of Object.keys(node)) {
                        const cAmphoe = cleanStr(amphoe);
                        if (z.includes(cAmphoe) || cAmphoe.includes(z)) return true;
                        
                        if (node[amphoe].some(tambon => {
                            const cTambon = cleanStr(tambon);
                            return z.includes(cTambon) || cTambon.includes(z);
                        })) return true;
                    }
                }
            }
        }
        return false;
    }
    
    return true;
}