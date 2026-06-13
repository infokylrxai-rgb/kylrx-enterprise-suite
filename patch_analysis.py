with open('manager-analysis.html', 'r', encoding='utf-8') as f:
    content = f.read()

logic = """
                const deptName = ccData.name || '';
                const deptFilters = Array.from(new Set([
                    centerId, 
                    deptName, 
                    deptName.toLowerCase(), 
                    deptName.toLowerCase().replace(/\\s+/g, '-'),
                    (ccData.unitId || '').toLowerCase()
                ])).filter(Boolean);
                
                // Strict isolation: only query users belonging to this command center departmentId
                const q = query(collection(db, 'users'), where('departmentId', 'in', deptFilters));
"""

old_logic = """// Strict isolation: only query users belonging to this command center departmentId
                const q = query(collection(db, 'users'), where('departmentId', '==', centerId));"""

content = content.replace(old_logic, logic)

with open('manager-analysis.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("manager-analysis.html patched successfully")
