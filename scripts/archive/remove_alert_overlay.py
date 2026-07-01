import glob
import re

files = glob.glob('manager-*.html')

pattern = re.compile(r'<div id="moduleAlertOverlay" class="custom-alert-overlay">.*?</div>\s*</div>', re.DOTALL)

for file in files:
    with open(file, 'r', encoding='utf-8') as f:
        content = f.read()
    
    new_content = pattern.sub('', content)
    
    if new_content != content:
        with open(file, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"Removed moduleAlertOverlay from {file}")
