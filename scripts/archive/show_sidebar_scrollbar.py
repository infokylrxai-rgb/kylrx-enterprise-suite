import glob
import os
import re

files = glob.glob('*.html') + glob.glob('*.css')
updated_count = 0

for file in files:
    if not os.path.isfile(file):
        continue
        
    with open(file, 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()

    original = content

    # Replace display: none; inside .sidebar::-webkit-scrollbar
    # We want to be specific to avoid breaking other elements
    content = re.sub(
        r'\.sidebar::-webkit-scrollbar\s*\{\s*display:\s*none;?\s*\}',
        '.sidebar::-webkit-scrollbar {\n            width: 6px;\n        }',
        content,
        flags=re.IGNORECASE
    )
    
    # Handle single line spacing or other formatted displays
    content = re.sub(
        r'\.sidebar::-webkit-scrollbar\s*\{\s*width:\s*[^;]+;\s*display:\s*none;?\s*\}',
        '.sidebar::-webkit-scrollbar {\n            width: 6px;\n        }',
        content,
        flags=re.IGNORECASE
    )
    
    # Replace scrollbar-width: none; inside .sidebar
    # Only replace if scrollbar-width: none; is in the file
    if 'scrollbar-width: none' in content:
        content = content.replace('scrollbar-width: none', 'scrollbar-width: thin')
    if 'scrollbar-width:none' in content:
        content = content.replace('scrollbar-width:none', 'scrollbar-width:thin')
        
    # Replace -ms-overflow-style: none; inside .sidebar
    if '-ms-overflow-style: none' in content:
        content = content.replace('-ms-overflow-style: none', '-ms-overflow-style: auto')
    if '-ms-overflow-style:none' in content:
        content = content.replace('-ms-overflow-style:none', '-ms-overflow-style:auto')

    if content != original:
        with open(file, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Updated scrollbar styles in {file}")
        updated_count += 1

print(f"Scrollbar styling update complete. Total files updated: {updated_count}")
