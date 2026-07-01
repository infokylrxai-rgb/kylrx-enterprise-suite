import glob
import os

# 1. Update global_link_hydration.py
with open('global_link_hydration.py', 'r', encoding='utf-8') as f:
    content = f.read()

if 'navPolicyLink' not in content:
    content = content.replace(
        "const navDocsLink = document.getElementById('navDocsLink');",
        "const navDocsLink = document.getElementById('navDocsLink');\n            const navPolicyLink = document.getElementById('navPolicyLink');\n            const navAssetsLink = document.getElementById('navAssetsLink');"
    )
    content = content.replace(
        "if (navDocsLink && centerId) navDocsLink.href = `manager-documents.html?id=${centerId}`;",
        "if (navDocsLink && centerId) navDocsLink.href = `manager-documents.html?id=${centerId}`;\n            if (navPolicyLink && centerId) navPolicyLink.href = `manager-policy.html?id=${centerId}`;\n            if (navAssetsLink && centerId) navAssetsLink.href = `manager-assets.html?id=${centerId}`;"
    )
    with open('global_link_hydration.py', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Updated global_link_hydration.py")

# 2. Update RESOURCES in all manager-*.html
manager_files = glob.glob('manager-*.html')

old_res = """                <div class="nav-label" style="margin-top: 2rem;">RESOURCES</div>
                <div class="nav-item"><a href="employee-policy.html" class="nav-link"><i data-lucide="book-open"></i><span>Policies</span></a></div>
                <div class="nav-item"><a href="employee-assets.html" class="nav-link"><i data-lucide="monitor"></i><span>My Assets</span></a></div>
                <div class="nav-item"><a href="#" class="nav-link" onclick="const cid=new URLSearchParams(window.location.search).get('id'); window.location.href=cid ? 'manager-message.html?id='+cid : 'manager-message.html'"><i data-lucide="help-circle"></i><span>Support Hub</span></a></div>"""

new_res = """                <div class="nav-label" style="margin-top: 2rem;">RESOURCES</div>
                <div class="nav-item"><a href="manager-policy.html" class="nav-link" id="navPolicyLink"><i data-lucide="book-open"></i><span>Policies</span></a></div>
                <div class="nav-item"><a href="manager-assets.html" class="nav-link" id="navAssetsLink"><i data-lucide="monitor"></i><span>My Assets</span></a></div>
                <div class="nav-item"><a href="#" class="nav-link" onclick="const cid=new URLSearchParams(window.location.search).get('id'); window.location.href=cid ? 'manager-message.html?id='+cid : 'manager-message.html'"><i data-lucide="help-circle"></i><span>Support Hub</span></a></div>"""

# Ensure manager-dashboard.html has the updated resources before extracting its sidebar
for f_name in manager_files:
    if f_name in ['manager-policy.html', 'manager-assets.html']: continue
    with open(f_name, 'r', encoding='utf-8') as f:
        html = f.read()
    if old_res in html:
        html = html.replace(old_res, new_res)
        with open(f_name, 'w', encoding='utf-8') as f:
            f.write(html)
        print(f"Updated RESOURCES in {f_name}")
    elif '<div class="nav-label" style="margin-top: 2rem;">RESOURCES</div>' in html and 'navPolicyLink' not in html:
        # Fallback replacement if whitespace differs
        pass

# 3. Extract the updated sidebar from manager-dashboard.html
with open('manager-dashboard.html', 'r', encoding='utf-8') as f:
    db_html = f.read()

sidebar_start = db_html.find('<aside class="sidebar">')
sidebar_end = db_html.find('</aside>') + 8
manager_sidebar = db_html[sidebar_start:sidebar_end]

# 4. Create manager-policy.html
with open('employee-policy.html', 'r', encoding='utf-8') as f:
    pol_html = f.read()

pol_sidebar_start = pol_html.find('<aside class="sidebar">')
pol_sidebar_end = pol_html.find('</aside>') + 8

pol_html = pol_html[:pol_sidebar_start] + manager_sidebar + pol_html[pol_sidebar_end:]

# Set active class for policy
pol_html = pol_html.replace('id="navPolicyLink"', 'id="navPolicyLink" class="nav-link active"')
# Remove active from overviewLink
pol_html = pol_html.replace('id="overviewLink" class="nav-link active"', 'id="overviewLink" class="nav-link"')
# Update "Back to Dashboard" href
pol_html = pol_html.replace("'employee-dashboard.html?id='+id : 'employee-dashboard.html'", "'manager-dashboard.html?id='+id : 'manager-dashboard.html'")
# Update navigateToDashboard js function
pol_html = pol_html.replace("window.location.href = id ? `employee-dashboard.html?id=${id}` : 'employee-dashboard.html';", "window.location.href = id ? `manager-dashboard.html?id=${id}` : 'manager-dashboard.html';")

with open('manager-policy.html', 'w', encoding='utf-8') as f:
    f.write(pol_html)
print("Created manager-policy.html")

# 5. Create manager-assets.html
with open('employee-assets.html', 'r', encoding='utf-8') as f:
    ass_html = f.read()

ass_sidebar_start = ass_html.find('<aside class="sidebar">')
ass_sidebar_end = ass_html.find('</aside>') + 8

ass_html = ass_html[:ass_sidebar_start] + manager_sidebar + ass_html[ass_sidebar_end:]

# Set active class for assets
ass_html = ass_html.replace('id="navAssetsLink"', 'id="navAssetsLink" class="nav-link active"')
# Remove active from overviewLink
ass_html = ass_html.replace('id="overviewLink" class="nav-link active"', 'id="overviewLink" class="nav-link"')
# Update "Back to Dashboard" href
ass_html = ass_html.replace("'employee-dashboard.html?id='+id : 'employee-dashboard.html'", "'manager-dashboard.html?id='+id : 'manager-dashboard.html'")
ass_html = ass_html.replace("`employee-dashboard.html?id=${id}` : 'employee-dashboard.html'", "`manager-dashboard.html?id=${id}` : 'manager-dashboard.html'")

with open('manager-assets.html', 'w', encoding='utf-8') as f:
    f.write(ass_html)
print("Created manager-assets.html")

