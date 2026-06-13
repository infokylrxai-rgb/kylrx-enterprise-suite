with open('manager-dashboard.html', 'r', encoding='utf-8') as f:
    content = f.read()

setup_ids = """
            // Ensure global compatibility for DBAC
            window.currentUnitIds = Array.from(new Set([
                currentUnitId, 
                config.name, 
                config.name.toLowerCase(), 
                config.name.toLowerCase().replace(/\\s+/g, '-'),
                (config.unitId || '').toLowerCase()
            ])).filter(Boolean);
"""

content = content.replace("if (sideDeptName) sideDeptName.textContent = config.name;", setup_ids + "\n            if (sideDeptName) sideDeptName.textContent = config.name;")

content = content.replace("where('departmentId', '==', currentUnitId)", "where('departmentId', 'in', window.currentUnitIds)")
content = content.replace("departmentId !== currentUnitId", "!window.currentUnitIds.includes(teamDoc.data().departmentId)")
content = content.replace("departmentId === currentUnitId", "window.currentUnitIds.includes(teamSnap.data().departmentId)")
content = content.replace("t.departmentId !== currentUnitId", "!window.currentUnitIds.includes(t.departmentId)")
content = content.replace("teamSnap.data().departmentId !== currentUnitId", "!window.currentUnitIds.includes(teamSnap.data().departmentId)")

with open('manager-dashboard.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("manager-dashboard.html patched successfully")
