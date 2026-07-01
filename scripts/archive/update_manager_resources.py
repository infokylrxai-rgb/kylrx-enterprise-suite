import glob

manager_files = glob.glob('manager-*.html')

old_resources_block1 = """                <div class="nav-label" style="margin-top: 2rem;">RESOURCES</div>
                <div class="nav-item"><a href="#" class="nav-link" onclick="showModuleInfo('Policy Hub', 'Policy Hub is updated.')"><i data-lucide="book-open"></i><span>Policies</span></a></div>
                <div class="nav-item"><a href="#" class="nav-link" onclick="showModuleInfo('My Assets', 'Asset Management module is restricted to Admin portal.')"><i data-lucide="monitor"></i><span>My Assets</span></a></div>
                <div class="nav-item"><a href="#" class="nav-link" onclick="showModuleInfo('Support Hub', 'Support Hub is currently offline.')"><i data-lucide="help-circle"></i><span>Support Hub</span></a></div>"""

new_resources_block = """                <div class="nav-label" style="margin-top: 2rem;">RESOURCES</div>
                <div class="nav-item"><a href="employee-policy.html" class="nav-link"><i data-lucide="book-open"></i><span>Policies</span></a></div>
                <div class="nav-item"><a href="employee-assets.html" class="nav-link"><i data-lucide="monitor"></i><span>My Assets</span></a></div>
                <div class="nav-item"><a href="#" class="nav-link" onclick="const cid=new URLSearchParams(window.location.search).get('id'); window.location.href=cid ? 'manager-message.html?id='+cid : 'manager-message.html'"><i data-lucide="help-circle"></i><span>Support Hub</span></a></div>"""

for f_name in manager_files:
    with open(f_name, 'r', encoding='utf-8') as f:
        content = f.read()
    
    if old_resources_block1 in content:
        content = content.replace(old_resources_block1, new_resources_block)
        with open(f_name, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Updated {f_name}")
    else:
        # Maybe slightly different whitespace
        pass
