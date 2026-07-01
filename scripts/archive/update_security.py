import glob
import re

manager_files = glob.glob('manager-*.html')

target_pattern = r"""\s*// Fetch alerts relevant to this department or system-wide without composite index\s*const q = query\(\s*collection\(db, 'alertEvents'\),\s*where\('departmentId', 'in', \[deptName, 'SYS', 'GLOBAL'\]\)\s*\);\s*onSnapshot\(q, \(snapshot\) => \{"""

replacement = """
            // Client-side filtering ensures we bypass any 400 indexing errors and catch all unit match variants
            onSnapshot(collection(db, 'alertEvents'), (rawSnapshot) => {
                const validUnits = Array.from(new Set([...(window.currentUnitIds || []), deptName, 'SYS', 'GLOBAL', 'ALL']));
                
                const docs = rawSnapshot.docs.map(d => d.data()).filter(data => {
                    const targetId = data.departmentId || data.department || data.unitId || data.target || 'GLOBAL';
                    return validUnits.some(u => typeof targetId === 'string' && typeof u === 'string' && (targetId.includes(u) || u.includes(targetId)));
                });
                
                // Create a mock snapshot object for the rest of the code
                const snapshot = {
                    empty: docs.length === 0,
                    docs: docs.map(d => ({ data: () => d }))
                };
"""

for file in manager_files:
    with open(file, 'r', encoding='utf-8') as f:
        content = f.read()
    
    if "collection(db, 'alertEvents')" in content and "where('departmentId', 'in'" in content:
        # Use re to replace
        new_content = re.sub(target_pattern, replacement, content, flags=re.MULTILINE)
        if new_content != content:
            with open(file, 'w', encoding='utf-8') as f:
                f.write(new_content)
            print(f"Updated security alerts query in {file}")
