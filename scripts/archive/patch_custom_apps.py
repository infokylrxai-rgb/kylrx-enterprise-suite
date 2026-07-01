import glob
import re

manager_files = glob.glob('manager-*.html')

apps_html = """
                <div class="nav-label" style="margin-top: 2rem; display: flex; justify-content: space-between; align-items: center;">
                    <span>CUSTOM APPS</span>
                    <button onclick="window.location.href=new URLSearchParams(window.location.search).get('id') ? `manager-dashboard.html?id=${new URLSearchParams(window.location.search).get('id')}` : 'manager-dashboard.html'" style="background: none; border: none; color: var(--primary); cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 2px;" title="App Registry Control Panel">
                        <i data-lucide="settings" style="width: 14px; height: 14px;"></i>
                    </button>
                </div>
                <div id="customAppsList" style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 2rem;"></div>
"""

apps_js = """
        // Hydrate custom apps dynamically
        const customList = document.getElementById('customAppsList');
        if (customList) {
            const apps = JSON.parse(localStorage.getItem('managerCustomApps') || '[]');
            customList.innerHTML = apps.map(app => `
                <div class="nav-item">
                    <a href="${app.url.startsWith('http') ? app.url : 'https://' + app.url}" target="_blank" class="nav-link" style="color: var(--primary);">
                        <i data-lucide="external-link"></i><span>${app.name}</span>
                    </a>
                </div>
            `).join('');
            if(window.lucide) window.lucide.createIcons();
        }
"""

for file in manager_files:
    if file == 'manager-dashboard.html':
        continue
    
    with open(file, 'r', encoding='utf-8') as f:
        content = f.read()

    # Inject HTML
    if 'id="customAppsList"' not in content:
        content = re.sub(
            r'(<div class="nav-label" style="margin-top: 2rem;">RESOURCES</div>)',
            apps_html + r'\n                \1',
            content
        )
    
    # Inject JS at the end of script
    if 'managerCustomApps' not in content:
        # Find the last closing script tag
        content = re.sub(
            r'(</script>\s*</body>)',
            apps_js + r'\1',
            content
        )

    with open(file, 'w', encoding='utf-8') as f:
        f.write(content)
        print(f"Patched {file}")
