import glob
import re

manager_files = glob.glob('manager-*.html')

for file in manager_files:
    with open(file, 'r', encoding='utf-8') as f:
        content = f.read()
    
    if "const docs = rawSnapshot.docs.map(d => d.data()).filter(data => {" in content:
        content = content.replace(
            "const docs = rawSnapshot.docs.map(d => d.data()).filter(data => {",
            "const matchedDocs = rawSnapshot.docs.map(d => d.data()).filter(data => {"
        )
        content = content.replace(
            "empty: docs.length === 0,",
            "empty: matchedDocs.length === 0,"
        )
        content = content.replace(
            "docs: docs.map(d => ({ data: () => d }))",
            "docs: matchedDocs.map(d => ({ data: () => d }))"
        )
        with open(file, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Fixed SyntaxError in {file}")
