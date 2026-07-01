import os

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
    page_content = page_content.replace('id="navConsoleLink"', 'id="navConsoleLink" class="nav-link active"')
    
    with open(filename, 'w', encoding='utf-8') as f:
        f.write(page_content)

hr_html = '''
<div class="widget-grid" style="grid-template-columns: 1fr 1fr 1fr;">
    <div class="card">
        <div class="card-header"><h2>Turnover Rate</h2></div>
        <div style="font-size: 2.5rem; font-weight: 800; color: var(--success);">1.2%</div>
        <div style="font-size: 0.8rem; color: var(--success); font-weight: 700; margin-top: 5px;">Below industry average</div>
    </div>
    <div class="card">
        <div class="card-header"><h2>Open Positions</h2></div>
        <div style="font-size: 2.5rem; font-weight: 800; color: var(--text-main);">4</div>
        <div style="font-size: 0.8rem; color: var(--text-muted); font-weight: 700; margin-top: 5px;">2 Engineering, 2 Design</div>
    </div>
    <div class="card">
        <div class="card-header"><h2>Talent AI Score</h2></div>
        <div style="font-size: 2.5rem; font-weight: 800; color: #8b5cf6;">High</div>
        <div style="font-size: 0.8rem; color: #8b5cf6; font-weight: 700; margin-top: 5px;">Excellent retention indicators</div>
    </div>
</div>
<div class="widget-grid" style="grid-template-columns: 1fr;">
    <div class="card">
        <div class="card-header">
            <h2>Kylrx AI - Recruitment Copilot</h2>
            <div id="recruitmentConnectionStatus" style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 0.7rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase;">Connecting...</span>
                <i data-lucide="wifi-off" class="text-muted" style="width: 16px; height: 16px;"></i>
            </div>
        </div>
        <div id="recruitmentCopilotBody" style="padding: 2rem; text-align: center; color: var(--text-muted);">
            <i data-lucide="user-plus" class="animate-pulse" size="48" style="opacity: 0.2; margin-bottom: 1rem;"></i>
            <p>AI is currently scanning LinkedIn and internal databases for matching profiles for your open positions.</p>
        </div>
    </div>
</div>
'''

create_page('manager-console.html', 'Strategic HR Console', 'Departmental HR analytics and recruitment intelligence', 'bar-chart-3', hr_html)
print("Created manager-console.html")
