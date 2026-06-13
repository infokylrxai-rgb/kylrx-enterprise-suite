import os
import glob
import re

files = glob.glob('**/*.html', recursive=True) + glob.glob('**/*.css', recursive=True)

for f in files:
    if 'node_modules' in f or '.git' in f:
        continue
    
    try:
        with open(f, 'r', encoding='utf-8') as file:
            content = file.read()
            
        new_content = re.sub(r'\.sidebar::-webkit-scrollbar\s*\{\s*display:\s*none;\s*\}\s*\n', '.sidebar {\n', content)
        
        # also handle case where there is no newline, just a space or nothing
        new_content = re.sub(r'\.sidebar::-webkit-scrollbar\s*\{\s*display:\s*none;\s*\}\s*(?![\n])', '.sidebar { ', new_content)

        if new_content != content:
            with open(f, 'w', encoding='utf-8') as file:
                file.write(new_content)
            print(f"Fixed {f}")
    except Exception as e:
        print(f"Error processing {f}: {e}")
