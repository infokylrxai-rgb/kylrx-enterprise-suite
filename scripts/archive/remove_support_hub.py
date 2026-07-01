import os
import glob
import re

manager_files = glob.glob('manager-*.html')

# 1. Remove Support Hub link from all sidebars
for f in manager_files:
    if f == 'manager-support.html':
        continue
    
    with open(f, 'r', encoding='utf-8') as file:
        content = file.read()
    
    # Remove the normal and active versions of the link
    pattern = r'<div class="nav-item">\s*<a href="manager-support\.html"[^>]*id="navSupportLink"[^>]*>.*?<span>Support Hub</span>.*?</a>\s*</div>\n*'
    new_content = re.sub(pattern, '', content)
    
    # Also remove any old hardcoded links if they still exist somehow
    pattern_old = r'<div class="nav-item">\s*<a href="#" class="nav-link" onclick="const cid=[^>]*>.*?<span>Support Hub</span>.*?</a>\s*</div>\n*'
    new_content = re.sub(pattern_old, '', new_content)
    
    if new_content != content:
        with open(f, 'w', encoding='utf-8') as file:
            file.write(new_content)
        print(f"Removed Support Hub from {f}")

# 2. Update hydration scripts
for hyd_file in ['global_link_hydration.py', 'patch_hydration.py']:
    if os.path.exists(hyd_file):
        with open(hyd_file, 'r', encoding='utf-8') as f:
            h_content = f.read()
        
        # Remove navSupportLink declarations
        h_content = re.sub(r'^\s*const navSupportLink = document.getElementById\(\'navSupportLink\'\);\n', '', h_content, flags=re.MULTILINE)
        h_content = re.sub(r'^\s*if \(navSupportLink\) navSupportLink.href =.*?\n', '', h_content, flags=re.MULTILINE)
        
        with open(hyd_file, 'w', encoding='utf-8') as f:
            f.write(h_content)
        print(f"Updated {hyd_file}")

# 3. Update the global hydration code inside the manager files
for f in manager_files:
    if f == 'manager-support.html':
        continue
        
    with open(f, 'r', encoding='utf-8') as file:
        content = file.read()
    
    # Remove navSupportLink declarations
    new_content = re.sub(r'^\s*const navSupportLink = document.getElementById\(\'navSupportLink\'\);\n', '', content, flags=re.MULTILINE)
    new_content = re.sub(r'^\s*if \(navSupportLink\) navSupportLink.href =.*?\n', '', new_content, flags=re.MULTILINE)
    
    if new_content != content:
        with open(f, 'w', encoding='utf-8') as file:
            file.write(new_content)
        print(f"Removed Support Hub hydration from {f}")

# 4. Delete manager-support.html
if os.path.exists('manager-support.html'):
    os.remove('manager-support.html')
    print("Deleted manager-support.html")
