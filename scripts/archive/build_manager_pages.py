import os
import re

manager_files = [
    'manager-dashboard.html',
    'manager-analysis.html',
    'manager-message.html',
    'manager-notification.html',
    'manager-calendar.html'
]

def patch_sidebar(content):
    content = re.sub(
        r'onclick="showModuleInfo\(\'My Documents\',\s*\'[^\']+\'\)"',
        'href="#" id="navDocsLink"',
        content
    )
    content = re.sub(
        r'onclick="showModuleInfo\(\'Workforce\',\s*\'[^\']+\'\)"',
        'href="#" id="navWorkforceLink"',
        content
    )
    content = re.sub(
        r'onclick="showModuleInfo\(\'Security\',\s*\'[^\']+\'\)"',
        'href="#" id="navSecurityLink"',
        content
    )
    content = re.sub(
        r'onclick="showModuleInfo\(\'Performance\',\s*\'[^\']+\'\)"',
        'href="#" id="navPerformanceLink"',
        content
    )
    
    # Hydration variables
    if "const navDocsLink =" not in content:
        content = re.sub(
            r'(const navMsgLink = document.getElementById\(\'navMsgLink\'\);)',
            r"\1\n            const navDocsLink = document.getElementById('navDocsLink');\n            const navWorkforceLink = document.getElementById('navWorkforceLink');\n            const navSecurityLink = document.getElementById('navSecurityLink');\n            const navPerformanceLink = document.getElementById('navPerformanceLink');",
            content
        )
        content = re.sub(
            r'(if \(navMsgLink && centerId\) navMsgLink\.href = `manager-message\.html\?id=\$\{centerId\}`;)',
            r"\1\n            if (navDocsLink && centerId) navDocsLink.href = `manager-documents.html?id=${centerId}`;\n            if (navWorkforceLink && centerId) navWorkforceLink.href = `manager-workforce.html?id=${centerId}`;\n            if (navSecurityLink && centerId) navSecurityLink.href = `manager-security.html?id=${centerId}`;\n            if (navPerformanceLink && centerId) navPerformanceLink.href = `manager-performance.html?id=${centerId}`;",
            content
        )
    return content

for f in manager_files:
    if os.path.exists(f):
        with open(f, 'r', encoding='utf-8') as file:
            content = file.read()
        patched = patch_sidebar(content)
        with open(f, 'w', encoding='utf-8') as file:
            file.write(patched)

# Generate new pages
with open('manager-dashboard.html', 'r', encoding='utf-8') as file:
    base_template = file.read()

def create_page(filename, title, desc, icon, widgets_html):
    main_start = base_template.find('<main class="main-content">')
    main_end = base_template.find('</main>') + len('</main>')
    
    new_main = f'''<main class="main-content">
            <header class="header">
                <div>
                    <h1>{title}</h1>
                    <p class="sub-header">{desc}</p>
                </div>
                <div style="display: flex; align-items: center; gap: 1rem;">
                    <div class="ai-status">
                        <div class="ai-pulse"></div>
                        <span>AI ENGINE ACTIVE</span>
                    </div>
                </div>
            </header>
            {widgets_html}
        </main>'''
        
    page_content = base_template[:main_start] + new_main + base_template[main_end:]
    page_content = page_content.replace('id="overviewLink" class="nav-link active"', 'id="overviewLink" class="nav-link"')
    
    # Optionally mark the current link as active, but we can skip that for simplicity
    with open(filename, 'w', encoding='utf-8') as f:
        f.write(page_content)

docs_html = '''
<div class="widget-grid" style="grid-template-columns: 1fr;">
    <div class="card">
        <div class="card-header">
            <h2>Department Document Vault</h2>
            <i data-lucide="folder-lock" class="text-muted" size="16"></i>
        </div>
        <div class="insight-content" style="display: flex; flex-direction: column; gap: 1rem;">
            <div style="padding: 1.5rem; background: #f8fafc; border: 1px solid var(--border); border-radius: 12px; display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; align-items: center; gap: 1rem;">
                    <i data-lucide="file-text" style="color: var(--primary);"></i>
                    <div>
                        <div style="font-weight: 800; font-size: 0.9rem;">Q2 Performance Reviews.pdf</div>
                        <div style="font-size: 0.75rem; color: var(--text-muted);">Confidential • 2.4 MB</div>
                    </div>
                </div>
                <button class="btn-ghost"><i data-lucide="download"></i></button>
            </div>
            <div style="padding: 1.5rem; background: #f8fafc; border: 1px solid var(--border); border-radius: 12px; display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; align-items: center; gap: 1rem;">
                    <i data-lucide="file-spreadsheet" style="color: var(--success);"></i>
                    <div>
                        <div style="font-weight: 800; font-size: 0.9rem;">Budget Allocation 2026.xlsx</div>
                        <div style="font-size: 0.75rem; color: var(--text-muted);">Financials • 1.1 MB</div>
                    </div>
                </div>
                <button class="btn-ghost"><i data-lucide="download"></i></button>
            </div>
        </div>
    </div>
</div>
'''

workforce_html = '''
<div class="widget-grid" style="grid-template-columns: 2fr 1fr;">
    <div class="card">
        <div class="card-header">
            <h2>Active Personnel Monitoring</h2>
            <i data-lucide="users" class="text-muted" size="16"></i>
        </div>
        <table>
            <thead>
                <tr><th>Employee</th><th>Role</th><th>Status</th><th>Productivity</th></tr>
            </thead>
            <tbody>
                <tr><td>Arvind Kumar</td><td>Senior Developer</td><td><span style="color:var(--success)">● Active</span></td><td>98%</td></tr>
                <tr><td>Sneha Joshi</td><td>Product Manager</td><td><span style="color:var(--warning)">● In Call</span></td><td>85%</td></tr>
                <tr><td>Deepak Shetty</td><td>QA Engineer</td><td><span style="color:var(--success)">● Active</span></td><td>92%</td></tr>
                <tr><td>Riya Patel</td><td>UI/UX Designer</td><td><span style="color:var(--danger)">● Offline</span></td><td>--</td></tr>
            </tbody>
        </table>
    </div>
    <div class="card">
        <div class="card-header">
            <h2>Workforce Distribution</h2>
            <i data-lucide="pie-chart" class="text-muted" size="16"></i>
        </div>
        <div style="height: 200px; display: flex; align-items: center; justify-content: center; color: var(--text-muted); font-size: 0.8rem; flex-direction: column; gap: 10px;">
            <i data-lucide="users-2" size="32" style="opacity: 0.5;"></i>
            Total Active Unit: 24 Members
        </div>
    </div>
</div>
'''

security_html = '''
<div class="widget-grid" style="grid-template-columns: 1fr;">
    <div class="card" style="border-left: 4px solid var(--danger);">
        <div class="card-header">
            <h2>Live Threat Telemetry (TVC)</h2>
            <div id="tvcConnectionStatus" style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 0.7rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase;">Connecting...</span>
                <i data-lucide="wifi-off" class="text-muted" style="width: 16px; height: 16px;"></i>
            </div>
        </div>
        <div id="manager-security-list" class="insight-content" style="display: flex; flex-direction: column; gap: 1rem;">
            <div style="padding: 2rem; text-align: center; color: var(--text-muted);">
                <i data-lucide="loader" class="animate-spin" size="24" style="margin-bottom: 1rem; opacity: 0.5;"></i>
                <p>Establishing secure link to Kylrx AI threat monitoring system...</p>
            </div>
        </div>
    </div>
</div>
'''

performance_html = '''
<div class="widget-grid" style="grid-template-columns: 1fr 1fr 1fr;">
    <div class="card">
        <div class="card-header"><h2>Unit Efficiency</h2></div>
        <div style="font-size: 2.5rem; font-weight: 800; color: var(--primary);">94%</div>
        <div style="font-size: 0.8rem; color: var(--success); font-weight: 700; margin-top: 5px;">↑ 2.4% from last week</div>
    </div>
    <div class="card">
        <div class="card-header"><h2>Task Completion</h2></div>
        <div style="font-size: 2.5rem; font-weight: 800; color: var(--text-main);">142</div>
        <div style="font-size: 0.8rem; color: var(--text-muted); font-weight: 700; margin-top: 5px;">Tasks resolved this sprint</div>
    </div>
    <div class="card">
        <div class="card-header"><h2>AI Focus Score</h2></div>
        <div style="font-size: 2.5rem; font-weight: 800; color: #8b5cf6;">A+</div>
        <div style="font-size: 0.8rem; color: #8b5cf6; font-weight: 700; margin-top: 5px;">Exceptional team focus</div>
    </div>
</div>
<div class="widget-grid" style="grid-template-columns: 1fr;">
    <div class="card">
        <div class="card-header">
            <h2>Predictive Analytics Engine</h2>
            <i data-lucide="trending-up" class="text-muted" size="16"></i>
        </div>
        <div style="padding: 2rem; text-align: center; color: var(--text-muted);">
            <i data-lucide="activity" class="animate-pulse" size="48" style="opacity: 0.2; margin-bottom: 1rem;"></i>
            <p>Based on current velocity, your team is projected to complete all quarterly goals 4 days ahead of schedule.</p>
        </div>
    </div>
</div>
'''

create_page('manager-documents.html', 'Document Vault', 'Secure file access and management', 'file-text', docs_html)
create_page('manager-workforce.html', 'Workforce Tracking', 'Real-time personnel and resource monitoring', 'users', workforce_html)
create_page('manager-security.html', 'Security Console', 'Live threat telemetry and access control', 'shield-check', security_html)
create_page('manager-performance.html', 'Performance Analytics', 'AI-driven predictive team metrics', 'trending-up', performance_html)

print("Created 4 new pages and patched 5 sidebars.")
