import glob
import os

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
        <div class="modal" style="text-align: left;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                <div>
                    <h2 style="font-weight: 800; font-size: 1.25rem;">Custom App Registry</h2>
                    <p style="font-size: 0.75rem; color: var(--text-muted);">Custom-map external tools in real time to the sidebar</p>
                </div>
                <button class="close-modal" onclick="document.getElementById('customAppsModal').style.display='none'" style="background: none; border: none; cursor: pointer; color: var(--text-muted);"><i data-lucide="x"></i></button>
            </div>
            
            <div style="display: flex; flex-direction: column; gap: 1rem; margin-bottom: 1.5rem;">
                <div>
                    <label style="font-size: 0.7rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase;">Tool/App Name</label>
                    <input type="text" id="appNameInput" placeholder="e.g. AWS Console" style="width: 100%; padding: 12px; border-radius: 12px; border: 1px solid var(--border); outline: none; margin-top: 4px; font-family: inherit; font-size: 0.85rem;">
                </div>
                <div>
                    <label style="font-size: 0.7rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase;">External Link (URL)</label>
                    <input type="text" id="appUrlInput" placeholder="e.g. console.aws.amazon.com" style="width: 100%; padding: 12px; border-radius: 12px; border: 1px solid var(--border); outline: none; margin-top: 4px; font-family: inherit; font-size: 0.85rem;">
                </div>
                <button onclick="addCustomApp()" style="background: var(--primary); color: white; border: none; border-radius: 12px; padding: 14px; font-weight: 800; cursor: pointer; transition: 0.2s; text-align: center; width: 100%;">Map Tool Link</button>
            </div>

            <div style="border-top: 1px solid var(--border); padding-top: 1.25rem;">
                <h3 style="font-size: 0.7rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase; margin-bottom: 10px;">Mapped Connections</h3>
                <div id="registryAppsList" style="display: flex; flex-direction: column; gap: 8px; max-height: 180px; overflow-y: auto;">
                    <!-- Mapped apps inside the registry panel -->
                </div>
            </div>
        </div>
    </div>
"""

js_addition = """
        // --- Admin Apps Logic (Firebase Connected) ---
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
"""

for f_name in admin_files:
    if f_name == 'admin-dashboard.html':
        continue # Already processed
    
    with open(f_name, 'r', encoding='utf-8') as f:
        content = f.read()

    if 'id="customAppsList"' not in content and '</nav>' in content:
        content = content.replace('</nav>', f'{sidebar_addition}            </nav>')

    if 'id="customAppsModal"' not in content and '</body>' in content:
        content = content.replace('</body>', f'{modal_addition}\n</body>')

    if 'initAdminApps' not in content and 'setupAuthObserver();' in content:
        content = content.replace('// Function to setup auth observer', f'{js_addition}\n        // Function to setup auth observer')
        content = content.replace('setupAuthObserver();', 'setupAuthObserver();\n        initAdminApps();')

    with open(f_name, 'w', encoding='utf-8') as f:
        f.write(content)

print("Applied Custom Apps to all admin pages.")
