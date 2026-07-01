import os
import re

manager_files = [
    'manager-dashboard.html',
    'manager-analysis.html',
    'manager-message.html',
    'manager-notification.html',
    'manager-calendar.html',
    'manager-documents.html',
    'manager-workforce.html',
    'manager-security.html',
    'manager-performance.html',
    'manager-attendance.html'
]

def undo_custom_apps(content):
    content = re.sub(
        r'onclick="window\.location\.href=\'admin-Dashboard-bulider\.html\'"\s*style="background: none; border: none; color: var\(--primary\); cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 2px;" title="App Registry Control Panel"',
        'onclick="openAppRegistryModal()" style="background: none; border: none; color: var(--primary); cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 2px;" title="App Registry Control Panel"',
        content
    )
    return content

count = 0
for f in manager_files:
    if os.path.exists(f):
        with open(f, 'r', encoding='utf-8') as file:
            content = file.read()
        patched = undo_custom_apps(content)
        if patched != content:
            with open(f, 'w', encoding='utf-8') as file:
                file.write(patched)
            count += 1

print(f"Reverted CUSTOM APPS settings icon in {count} manager files.")
