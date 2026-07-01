import glob
import re

admin_files = glob.glob('admin-*.html')

js_module = """
<!-- Custom Apps Injection Script -->
<script type="module">
    import { db } from "./firebase-config.js";
    import { doc, setDoc, onSnapshot, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

    const DEFAULT_APPS = [
        { name: "AWS CONSOLE", url: "https://console.aws.amazon.com" },
        { name: "DATADOG", url: "https://app.datadoghq.com" }
    ];

    async function initAdminApps() {
        const appsRef = doc(db, "system_configs", "admin_custom_apps");
        onSnapshot(appsRef, async (snapshot) => {
            let apps = [];
            if (snapshot.exists()) {
                apps = snapshot.data().customApps || [];
            } else {
                try {
                    await setDoc(appsRef, { customApps: DEFAULT_APPS, customAppsInitialized: true }, { merge: true });
                    apps = DEFAULT_APPS;
                } catch(e) {}
            }
            renderAppsUI(apps);
        });
    }

    function renderAppsUI(apps) {
        const list = document.getElementById('customAppsList');
        if (list) {
            list.innerHTML = apps.map((app) => `
                <div class="nav-item" style="position: relative;">
                    <a href="${app.url}" target="_blank" class="nav-link" style="padding-right: 32px;">
                        <i data-lucide="external-link"></i>
                        <span>${app.name}</span>
                    </a>
                    <button onclick="removeAppFromServer('${app.url}', '${app.name}')" style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%); background: none; border: none; color: var(--danger); opacity: 0.5; cursor: pointer; padding: 4px; display: flex; align-items: center; justify-content: center;" title="Remove App Mapping">
                        <i data-lucide="x" style="width: 12px; height: 12px;"></i>
                    </button>
                </div>
            `).join('');
        }

        const registryList = document.getElementById('registryAppsList');
        if (registryList) {
            registryList.innerHTML = apps.map((app) => `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 12px; font-size: 0.85rem; margin-bottom: 8px;">
                    <div style="display: flex; align-items: center; gap: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 80%;">
                        <i data-lucide="external-link" style="width: 16px; height: 16px; color: var(--primary); flex-shrink: 0;"></i>
                        <span style="font-weight: 700; font-size: 0.8rem;">${app.name}</span>
                    </div>
                    <button onclick="removeAppFromServer('${app.url}', '${app.name}')" style="background: none; border: none; color: var(--danger); cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 4px; flex-shrink: 0;" title="Delete Mapping">
                        <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
                    </button>
                </div>
            `).join('');
        }
        if(window.lucide) lucide.createIcons();
    }

    window.openAppRegistryModal = () => {
        const modal = document.getElementById('customAppsModal');
        if (modal) modal.style.display = 'flex';
        if(window.lucide) lucide.createIcons();
    };

    window.addCustomApp = async () => {
        const urlInput = document.getElementById('appUrlInput');
        const nameInput = document.getElementById('appNameInput');
        if (!urlInput) return;
        
        const url = urlInput.value.trim();
        const customName = nameInput ? nameInput.value.trim() : '';
        if (!url) return;

        try {
            let cleanUrl = url;
            if (!url.startsWith('http')) cleanUrl = 'https://' + url;
            const urlObj = new URL(cleanUrl);
            const domain = urlObj.hostname.replace('www.', '');
            const appName = customName || domain.split('.')[0].toUpperCase();

            const appsRef = doc(db, "system_configs", "admin_custom_apps");
            await setDoc(appsRef, {
                customApps: arrayUnion({ name: appName, url: cleanUrl })
            }, { merge: true });

            urlInput.value = '';
            if (nameInput) nameInput.value = '';
        } catch (e) {
            alert("Invalid URL structure.");
        }
    };

    window.removeAppFromServer = async (url, name) => {
        const appsRef = doc(db, "system_configs", "admin_custom_apps");
        await setDoc(appsRef, {
            customApps: arrayRemove({ name: name, url: url })
        }, { merge: true });
    };

    initAdminApps();
</script>
</body>
"""

for f_name in admin_files:
    with open(f_name, 'r', encoding='utf-8') as f:
        content = f.read()

    # Clean up my previous JS injection if it exists
    if '// --- Admin Apps Logic (Firebase Connected) ---' in content:
        # Regex to remove the block up to window.removeAppFromServer... };
        content = re.sub(r'// --- Admin Apps Logic \(Firebase Connected\) ---.*?window\.removeAppFromServer = async.*?};\s+', '', content, flags=re.DOTALL)
        content = content.replace('initAdminApps();', '')

    if '<!-- Custom Apps Injection Script -->' not in content:
        content = content.replace('</body>', js_module)

    with open(f_name, 'w', encoding='utf-8') as f:
        f.write(content)

print("Injected fully self-contained Custom Apps JS into all admin files.")
