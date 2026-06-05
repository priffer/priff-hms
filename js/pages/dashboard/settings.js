async function loadSettings() {
    try {
        const { data } = await supabaseClient.from('system_settings').select('*');
        if (!data) return;
        data.forEach(s => {
            if (s.setting_key === 'PDPA_CONTENT') document.getElementById('pdpaInput').value = s.setting_value;
            if (s.setting_key === 'LAST_EMP_RUN_NO') document.getElementById('lastEmpNo').value = s.setting_value;
            if (s.setting_key === 'TAX_PERCENT') document.getElementById('taxRate').value = s.setting_value;
            if (s.setting_key === 'SOCIAL_SECURITY_PERCENT') document.getElementById('ssoRate').value = s.setting_value;
        });
    } catch (err) {
        console.error(err);
    }
}

async function saveSettings() {
    const updates = [
        { key: 'PDPA_CONTENT', val: document.getElementById('pdpaInput').value },
        { key: 'LAST_EMP_RUN_NO', val: document.getElementById('lastEmpNo').value },
        { key: 'TAX_PERCENT', val: document.getElementById('taxRate').value },
        { key: 'SOCIAL_SECURITY_PERCENT', val: document.getElementById('ssoRate').value }
    ];

    try {
        for (let item of updates) {
            await supabaseClient.from('system_settings').update({ setting_value: item.val }).eq('setting_key', item.key);
        }
        alert('บันทึกการตั้งค่าสำเร็จ!');
    } catch (err) {
        alert('บันทึกการตั้งค่าล้มเหลว: ' + err.message);
    }
}