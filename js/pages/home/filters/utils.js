function cleanStr(str) {
    return String(str || '').replace(/ต\.|อ\.|จ\.|เขต|\(ทั้งหมด\)/g, '').replace(/\s+/g, '').toLowerCase();
}

// p1 = จังหวัด, p2 = นิคมอุตสาหกรรม OR อำเภอ (flattened single-select), p3 = ตำบล (only applies when p2 is an อำเภอ)
function isZoneInArea(job, p1, p2, p3) {
    if (!p1) return true;

    const zone = cleanStr(job.zone_name);
    const content = cleanStr(job.content);
    const compName = cleanStr(job.company_name);

    const textIncludes = (needle) => {
        const cNeedle = cleanStr(needle);
        if (!cNeedle) return false;
        if (zone.includes(cNeedle) || content.includes(cNeedle) || compName.includes(cNeedle)) return true;
        // Guard against empty zone always matching via reverse-inclusion.
        return Boolean(zone) && cNeedle.includes(zone);
    };

    if (!p2) {
        return textIncludes(p1);
    }

    if (typeof locationData === 'undefined' || !locationData[p1]) {
        return textIncludes(p2);
    }

    const groups = locationData[p1];

    for (const groupName of Object.keys(groups)) {
        const node = groups[groupName];

        if (Array.isArray(node)) {
            // Industrial estate group: p2 is a leaf value, no further drill-down.
            if (node.includes(p2)) {
                return textIncludes(p2);
            }
            continue;
        }

        // Amphoe/Tambon group: p2 is an อำเภอ key.
        if (node[p2]) {
            if (p3) {
                return textIncludes(p3);
            }
            // No specific tambon chosen: match the amphoe name itself or any of its tambons.
            if (textIncludes(p2)) return true;
            return node[p2].some(tambon => textIncludes(tambon));
        }
    }

    return textIncludes(p2);
}