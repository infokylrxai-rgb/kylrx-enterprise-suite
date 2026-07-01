import os
import glob

manager_files = glob.glob('manager-*.html') + ['manager-calendar.html']

for f in manager_files:
    if os.path.exists(f):
        with open(f, 'r', encoding='utf-8') as file:
            content = file.read()
            
        patched = content.replace(
            '<div class="dept-icon-box" id="deptIcon"><i data-lucide="shield"></i></div>',
            ''
        )
        # Also handle cases where it might have been modified by JS already (unlikely in raw HTML)
        # Or if it has different spacing
        
        if patched != content:
            with open(f, 'w', encoding='utf-8') as file:
                file.write(patched)
            print(f"Removed dept-icon-box from {f}")
