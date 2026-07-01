import os
import glob
import re

# 1. Update the sidebar links in all manager-*.html
files = glob.glob('manager-*.html')

old_link = """<div class="nav-item"><a href="#" class="nav-link" onclick="const cid=new URLSearchParams(window.location.search).get('id'); window.location.href=cid ? 'manager-message.html?id='+cid : 'manager-message.html'"><i data-lucide="help-circle"></i><span>Support Hub</span></a></div>"""
new_link = """<div class="nav-item"><a href="manager-support.html" class="nav-link" id="navSupportLink"><i data-lucide="help-circle"></i><span>Support Hub</span></a></div>"""

for f in files:
    with open(f, 'r', encoding='utf-8') as file:
        content = file.read()
    
    if old_link in content:
        content = content.replace(old_link, new_link)
        with open(f, 'w', encoding='utf-8') as file:
            file.write(content)
        print(f"Updated link in {f}")

# 2. Update global_link_hydration.py
hydration_script = 'global_link_hydration.py'
with open(hydration_script, 'r', encoding='utf-8') as f:
    hyd_content = f.read()

if "const navSupportLink = document.getElementById('navSupportLink');" not in hyd_content:
    hyd_content = hyd_content.replace(
        "const navAssetsLink = document.getElementById('navAssetsLink');",
        "const navAssetsLink = document.getElementById('navAssetsLink');\n            const navSupportLink = document.getElementById('navSupportLink');"
    )
    hyd_content = hyd_content.replace(
        "if (navAssetsLink) navAssetsLink.href = centerId ? `manager-assets.html?id=${centerId}` : `manager-assets.html`;",
        "if (navAssetsLink) navAssetsLink.href = centerId ? `manager-assets.html?id=${centerId}` : `manager-assets.html`;\n            if (navSupportLink) navSupportLink.href = centerId ? `manager-support.html?id=${centerId}` : `manager-support.html`;"
    )
    with open(hydration_script, 'w', encoding='utf-8') as f:
        f.write(hyd_content)
    print("Updated global_link_hydration.py")

# 3. Create manager-support.html
import shutil
shutil.copy('manager-message.html', 'manager-support.html')

with open('manager-support.html', 'r', encoding='utf-8') as f:
    supp_content = f.read()

# Update the header title and description
supp_content = supp_content.replace('Manager Communications', 'Manager Support Hub')
supp_content = supp_content.replace('Secure messaging with departments, managers, and personnel', 'Connect with HR administrators and IT support')

# Remove the action icons (Messages and Notifications) from the header
header_icons_pattern = r'<div style="display: flex; align-items: center; gap: 0.75rem; background: white; padding: 6px; border-radius: 14px; border: 1px solid var\(--border\); box-shadow: var\(--shadow-sm\);">.*?</div>'
supp_content = re.sub(header_icons_pattern, '', supp_content, flags=re.DOTALL)

# Make "Support Hub" active instead of "Messages"
supp_content = supp_content.replace('<a href="#" class="nav-link active" id="navMsgLink">', '<a href="#" class="nav-link" id="navMsgLink">')
# The old_link was replaced with new_link, so we just add active to the new link
supp_content = supp_content.replace('<a href="manager-support.html" class="nav-link" id="navSupportLink">', '<a href="manager-support.html" class="nav-link active" id="navSupportLink">')

# Modify contacts directory to ONLY show HR Support Hub
# Instead of replacing complex JS, we can just hardcode the contacts list container, or let the JS run but filter out everyone except 'admin'.
# Actually, the simplest is to modify the JS filtering logic.
js_filter_old = "u.role !== 'team' && u.role !== 'admin' && u.role !== 'hrms' && u.name !== 'HR Support Hub'"
js_filter_new = "u.role === 'admin' || u.role === 'hrms' || u.name === 'HR Support Hub'"
supp_content = supp_content.replace(js_filter_old, js_filter_new)

# For teams, filter out all teams
js_team_filter_old = "const duplicate = seen.has(t.name);"
js_team_filter_new = "return false; // No teams in support hub\n                const duplicate = seen.has(t.name);"
supp_content = supp_content.replace(js_team_filter_old, js_team_filter_new)

with open('manager-support.html', 'w', encoding='utf-8') as f:
    f.write(supp_content)
print("Created manager-support.html")
