import os

def process_file(filepath):
    if not os.path.exists(filepath):
        print(f"File {filepath} not found.")
        return

    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Avoid processing twice
    if '<div class="layout">' in content:
        print(f"File {filepath} already processed.")
        return

    # Update body CSS
    body_old = """        body {
            font-family: 'Outfit', sans-serif;
            background-color: var(--bg);
            color: var(--text);
            min-height: 100vh;
            padding: 2.5rem;
        }"""
    body_new = """        body {
            font-family: 'Outfit', sans-serif;
            background-color: var(--bg);
            color: var(--text);
            height: 100vh;
            overflow: hidden;
        }"""
    
    if body_old in content:
        content = content.replace(body_old, body_new)
    else:
        # Fallback if spacing differs
        content = content.replace("min-height: 100vh;", "height: 100vh;")
        content = content.replace("padding: 2.5rem;", "overflow: hidden;")

    # Inject layout CSS
    layout_css = """
        .layout { display: grid; grid-template-columns: 280px 1fr; height: 100vh; overflow: hidden; }
        .sidebar { background: #ffffff; border-right: 1px solid var(--border); padding: 2.5rem 1.5rem; display: flex; flex-direction: column; z-index: 100; overflow-y: auto; scrollbar-width: thin; }
        .sidebar::-webkit-scrollbar { width: 5px; }
        .sidebar::-webkit-scrollbar-track { background: transparent; }
        .sidebar::-webkit-scrollbar-thumb { background: rgba(59, 130, 246, 0.1); border-radius: 10px; }
        .sidebar:hover::-webkit-scrollbar-thumb { background: rgba(59, 130, 246, 0.2); }
        .logo { display: flex; align-items: center; gap: 12px; margin-bottom: 3rem; text-decoration: none; color: var(--primary); }
        .logo-text { font-size: 1.5rem; font-weight: 800; color: var(--text); letter-spacing: -1px; }
        .nav-label { font-size: 0.65rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em; margin: 1.5rem 0 0.75rem 0.5rem; }
        .nav-link { display: flex; align-items: center; gap: 12px; padding: 12px 1rem; color: var(--text-muted); text-decoration: none; font-weight: 600; font-size: 0.9rem; border-radius: 14px; transition: 0.2s; margin-bottom: 4px; }
        .nav-link:hover, .nav-link.active { background: #eff6ff; color: var(--primary); }
        .profile-mini { margin-top: auto; background: #eff6ff; padding: 1rem; border-radius: 16px; display: flex; align-items: center; gap: 12px; }
        .avatar { width: 40px; height: 40px; border-radius: 10px; background: var(--primary); display: flex; align-items: center; justify-content: center; font-weight: 800; color: white; }
        .profile-info { flex: 1; min-width: 0; }
        .profile-name { font-size: 0.85rem; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text); }
        .profile-role { font-size: 0.7rem; color: var(--text-muted); font-weight: 600; }
    </style>"""
    content = content.replace("</style>", layout_css)

    # Determine active link
    active_policy = ' active' if 'policy' in filepath else ''
    active_assets = ' active' if 'assets' in filepath else ''

    # Inject sidebar HTML
    sidebar_html = f"""    <script>
        window.navigateToDashboard = () => {{
            const urlParams = new URLSearchParams(window.location.search);
            const id = urlParams.get('id');
            window.location.href = id ? `employee-dashboard.html?id=${{id}}` : 'employee-dashboard.html';
        }};
        window.navigateTo = (page) => {{
            const urlParams = new URLSearchParams(window.location.search);
            const id = urlParams.get('id');
            window.location.href = id ? `${{page}}?id=${{id}}` : page;
        }};
        window.handleLogout = () => {{
            localStorage.clear();
            window.location.href = 'index.html';
        }};
    </script>
    <div class="layout">
        <aside class="sidebar">
            <a href="#" class="logo" onclick="navigateToDashboard()">
                <img src="logo.jpg" alt="Logo" style="height: 40px; object-fit: contain;">
            </a>
            
            <nav class="nav-menu">
                <div class="nav-label">MY WORKSPACE</div>
                <div class="nav-item"><a href="#" class="nav-link" onclick="navigateToDashboard()"><i data-lucide="layout"></i><span>Dashboard</span></a></div>
                <div class="nav-item"><a href="#" class="nav-link" onclick="navigateTo('employee-leave.html')"><i data-lucide="calendar"></i><span>Leave & Holidays</span></a></div>
                <div class="nav-item"><a href="#" class="nav-link" onclick="window.location.href='employee-attendance-log.html?id='+(new URLSearchParams(window.location.search).get('id')||localStorage.getItem('employee_uid')||'')"><i data-lucide="clock"></i><span>Attendance Log</span></a></div>
                <div class="nav-item"><a href="#" class="nav-link" onclick="navigateTo('employee-docs.html')"><i data-lucide="file-text"></i><span>My Documents</span></a></div>
                <div class="nav-item"><a href="#" class="nav-link" onclick="navigateTo('employee-message.html')"><i data-lucide="message-square"></i><span>Messages</span></a></div>
                <div class="nav-item"><a href="#" class="nav-link" onclick="navigateTo('employee-notifications.html')"><i data-lucide="bell"></i><span>Notifications</span></a></div>
                
                <div class="nav-label">RESOURCES</div>
                <div class="nav-item"><a href="#" class="nav-link{active_policy}" onclick="navigateTo('employee-policy.html')"><i data-lucide="book-open"></i><span>Policies</span></a></div>
                <div class="nav-item"><a href="#" class="nav-link{active_assets}" onclick="window.location.href='employee-assets.html?id='+(new URLSearchParams(window.location.search).get('id')||localStorage.getItem('employee_uid')||'')"><i data-lucide="monitor"></i><span>My Assets</span></a></div>
                <div class="nav-item"><a href="#" class="nav-link" onclick="navigateTo('employee-message.html')"><i data-lucide="help-circle"></i><span>Support Hub</span></a></div>
            </nav>

            <div class="profile-mini">
                <div class="avatar" id="userInitial">JD</div>
                <div class="profile-info">
                    <div class="profile-name" id="userNameDisplay">John Doe</div>
                    <div class="profile-role" id="userRoleDisplay">Employee</div>
                </div>
                <button onclick="handleLogout()" style="background: none; border: none; cursor: pointer; color: var(--text-muted); transition: 0.2s;" onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='var(--text-muted)'">
                    <i data-lucide="log-out" size="18"></i>
                </button>
            </div>
        </aside>

        <main class="main-content" style="padding: 2.5rem; overflow-y: auto; height: 100vh;">
            <div class="container">"""

    content = content.replace('<div class="container">', sidebar_html, 1)

    # Insert closing tags before modals or at the end
    if '<!-- Status Modal -->' in content:
        content = content.replace('<!-- Status Modal -->', '        </div>\n        </main>\n    </div>\n\n    <!-- Status Modal -->')
    elif '<!-- Report Issue Modal -->' in content:
        content = content.replace('<!-- Report Issue Modal -->', '        </div>\n        </main>\n    </div>\n\n    <!-- Report Issue Modal -->')

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    
    print(f"Successfully processed {filepath}")

process_file('employee-policy.html')
process_file('employee-assets.html')
process_file('employee-leave.html')
process_file('employee-docs.html')
process_file('employee-attendance-log.html')
process_file('employee-message.html')
process_file('employee-notifications.html')
process_file('employee-calendar.html')
