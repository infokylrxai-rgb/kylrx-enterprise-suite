import glob
import os
import re

admin_files = glob.glob('admin-*.html')

sidebar_addition = """                <div class="nav-label" style="margin-top: 2rem; display: flex; justify-content: space-between; align-items: center;">
                    <span>CUSTOM APPS</span>
                    <button onclick="openAppRegistryModal()" style="background: none; border: none; color: var(--primary); cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 2px;" title="App Registry Control Panel">
                        <i data-lucide="settings" style="width: 14px; height: 14px;"></i>
                    </button>
                </div>
                <div id="customAppsList" style="display: flex; flex-direction: column; gap: 4px;"></div>
"""

modal_addition = """
    <!-- Custom App Registry Modal -->
    <div id="customAppsModal" class="modal-overlay">
        <style>
            #customAppsModal.modal-overlay {
                position: fixed;
                top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(15, 23, 42, 0.4);
                backdrop-filter: blur(8px);
                z-index: 9999;
                display: none;
                align-items: center;
                justify-content: center;
            }
            #customAppsModal .modal {
                background: #ffffff !important;
                color: #0f172a !important;
                padding: 2.5rem;
                border-radius: 24px;
                width: 90%;
                max-width: 500px;
                box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
                border: 1px solid #e2e8f0;
                position: relative;
                text-align: left;
            }
            #customAppsModal .modal h2 {
                font-weight: 800;
                font-size: 1.25rem;
                color: #0f172a !important;
                margin-bottom: 4px;
                margin-top: 0;
            }
            #customAppsModal .modal p {
                font-size: 0.75rem;
                color: #64748b !important;
                margin: 0;
            }
            #customAppsModal .modal .form-group {
                display: flex;
                flex-direction: column;
                gap: 8px;
                margin-bottom: 1rem;
            }
            #customAppsModal .modal label {
                font-size: 0.7rem;
                font-weight: 800;
                color: #64748b !important;
                text-transform: uppercase;
                display: block;
                margin-bottom: 4px;
            }
            #customAppsModal .modal input {
                width: 100%;
                padding: 12px 16px;
                border-radius: 12px;
                border: 1px solid #cbd5e1 !important;
                background: #ffffff !important;
                color: #0f172a !important;
                outline: none;
                margin-top: 4px;
                font-family: inherit;
                font-size: 0.85rem;
                transition: border-color 0.2s, box-shadow 0.2s;
            }
            #customAppsModal .modal input:focus {
                border-color: #3b82f6 !important;
                box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.12);
            }
            #customAppsModal .modal input::placeholder {
                color: #94a3b8 !important;
                opacity: 0.8;
            }
            #customAppsModal .modal button.map-btn {
                background: #3b82f6;
                color: white !important;
                border: none;
                border-radius: 12px;
                padding: 14px;
                font-weight: 800;
                cursor: pointer;
                transition: 0.2s;
                text-align: center;
                width: 100%;
                font-size: 0.9rem;
                margin-top: 0.5rem;
            }
            #customAppsModal .modal button.map-btn:hover {
                background: #2563eb;
                transform: translateY(-1px);
            }
            #customAppsModal .modal h3 {
                font-size: 0.7rem;
                font-weight: 800;
                color: #64748b !important;
                text-transform: uppercase;
                margin-bottom: 10px;
                margin-top: 0;
            }
            #customAppsModal .close-modal {
                position: absolute;
                top: 24px;
                right: 24px;
                width: 36px;
                height: 36px;
                border-radius: 10px;
                background: #f8fafc;
                color: #64748b !important;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                transition: 0.2s;
                border: none;
            }
            #customAppsModal .close-modal:hover {
                color: #ef4444 !important;
                background: #fee2e2;
            }
        </style>
        <div class="modal">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                <div>
                    <h2>Custom App Registry</h2>
                    <p>Custom-map external tools in real time to the sidebar</p>
                </div>
                <button class="close-modal" onclick="document.getElementById('customAppsModal').style.display='none'"><i data-lucide="x"></i></button>
            </div>
            
            <div style="display: flex; flex-direction: column; gap: 1rem; margin-bottom: 1.5rem;">
                <div class="form-group">
                    <label>Tool/App Name</label>
                    <input type="text" id="appNameInput" placeholder="e.g. AWS Console">
                </div>
                <div class="form-group">
                    <label>External Link (URL)</label>
                    <input type="text" id="appUrlInput" placeholder="e.g. console.aws.amazon.com">
                </div>
                <button class="map-btn" onclick="addCustomApp()">Map Tool Link</button>
            </div>

            <div style="border-top: 1px solid #e2e8f0; padding-top: 1.25rem;">
                <h3>Mapped Connections</h3>
                <div id="registryAppsList" style="display: flex; flex-direction: column; gap: 8px; max-height: 180px; overflow-y: auto;">
                    <!-- Mapped apps inside the registry panel -->
                </div>
            </div>
        </div>
    </div>
"""

js_addition = """
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
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; font-size: 0.85rem; margin-bottom: 8px;">
                    <div style="display: flex; align-items: center; gap: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 80%;">
                        <i data-lucide="external-link" style="width: 16px; height: 16px; color: #3b82f6; flex-shrink: 0;"></i>
                        <span style="font-weight: 700; font-size: 0.8rem; color: #0f172a;">${app.name}</span>
                    </div>
                    <button onclick="removeAppFromServer('${app.url}', '${app.name}')" style="background: none; border: none; color: #ef4444; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 4px; flex-shrink: 0;" title="Delete Mapping">
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
    print(f"Processing {f_name}...")
    with open(f_name, 'r', encoding='utf-8') as f:
        content = f.read()

    # Step A: CLEANUPS
    # 1. Clean up existing sidebar addition if present
    if 'id="customAppsList"' in content:
        content = re.sub(
            r'\s*<div class="nav-label" style="margin-top: 2rem; display: flex; justify-content: space-between; align-items: center;">\s*<span>CUSTOM APPS</span>.*?</div>\s*<div id="customAppsList".*?</div>',
            '',
            content,
            flags=re.DOTALL
        )

    # 2. Clean up existing customAppsModal if present
    if 'id="customAppsModal"' in content:
        content = re.sub(
            r'<!-- (?:Custom App Registry Modal|Modal: Custom App Registry) -->.*?<!-- Mapped apps inside the registry panel -->\s*</div>\s*</div>\s*</div>\s*</div>',
            '',
            content,
            flags=re.DOTALL
        )
        content = re.sub(
            r'<div id="customAppsModal".*?<!-- Mapped apps inside the registry panel -->\s*</div>\s*</div>\s*</div>\s*</div>',
            '',
            content,
            flags=re.DOTALL
        )

    # 3. Clean up previous JS injection if it exists
    if '<!-- Custom Apps Injection Script -->' in content:
        content = re.sub(
            r'<!-- Custom Apps Injection Script -->.*?</body>',
            '</body>',
            content,
            flags=re.DOTALL
        )
    if '// --- Admin Apps Logic (Firebase Connected) ---' in content:
        content = re.sub(
            r'// --- Admin Apps Logic \(Firebase Connected\) ---.*?window\.removeAppFromServer = async.*?};\s+',
            '',
            content,
            flags=re.DOTALL
        )
        content = content.replace('initAdminApps();', '')

    # Step B: INJECTIONS
    # 4. Inject sidebar addition
    if 'id="customAppsList"' not in content and '</nav>' in content:
        content = content.replace('</nav>', f'{sidebar_addition}            </nav>')

    # 5. Inject styled customAppsModal
    if 'id="customAppsModal"' not in content and '</body>' in content:
        content = content.replace('</body>', f'{modal_addition}\n</body>')

    # 6. Inject JS Script
    if '<!-- Custom Apps Injection Script -->' not in content and '</body>' in content:
        content = content.replace('</body>', js_addition)

    with open(f_name, 'w', encoding='utf-8') as f:
        f.write(content)

print("Global custom app registry style and functional correction completed.")
