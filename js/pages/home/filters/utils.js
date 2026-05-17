function cleanStr(str) {
    return String(str || '').replace(/ต\.|อ\.|จ\.|เขต|\(ทั้งหมด\)/g, '').replace(/\s+/g, '').toLowerCase();
}

function isZoneInArea(job, p1, p2, p3) {
    if (!p1) return true; 

    const zone = cleanStr(job.zone_name);
    const content = cleanStr(job.content);
    const compName = cleanStr(job.company_name);
    
    if (p3) {
        const cleanP3 = cleanStr(p3);
        if (zone.includes(cleanP3) || content.includes(cleanP3) || compName.includes(cleanP3)) return true;
        
        if (p2 && typeof locationData !== 'undefined' && locationData[p1] && locationData[p1][p2]) {
            const node = locationData[p1][p2];
            if (!Array.isArray(node) && node[p3]) {
                return node[p3].some(tambon => {
                    const cTambon = cleanStr(tambon);
                    return zone.includes(cTambon) || content.includes(cTambon) || compName.includes(cTambon);
                });
            }
        }
        return false;
    }
    
    if (p2 && typeof locationData !== 'undefined' && locationData[p1] && locationData[p1][p2]) {
        const node = locationData[p1][p2];
        const cleanP2 = cleanStr(p2);
        
        if (zone.includes(cleanP2) || content.includes(cleanP2) || compName.includes(cleanP2)) return true;

        if (Array.isArray(node)) {
            return node.some(sub => {
                const cSub = cleanStr(sub);
                return zone.includes(cSub) || content.includes(cSub) || compName.includes(cSub);
            });
        } else {
            return Object.keys(node).some(amphoe => {
                const cAmphoe = cleanStr(amphoe);
                if (zone.includes(cAmphoe) || content.includes(cAmphoe) || compName.includes(cAmphoe)) return true;
                
                return node[amphoe].some(tambon => {
                    const cTambon = cleanStr(tambon);
                    return zone.includes(cTambon) || content.includes(cTambon) || compName.includes(cTambon);
                });
            });
        }
    }
    
    if (p1) { 
        const cleanP1 = cleanStr(p1);
        return zone.includes(cleanP1) || content.includes(cleanP1) || compName.includes(cleanP1);
    }
    
    return true;
}