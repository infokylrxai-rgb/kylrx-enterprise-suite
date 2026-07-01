import os

files_to_fix = [
    'manager-analysis.html',
    'manager-attendance.html',
    'manager-message.html',
    'manager-notification.html'
]

for fn in files_to_fix:
    if os.path.exists(fn):
        with open(fn, 'r', encoding='utf-8') as f:
            lines = f.readlines()
        
        new_lines = []
        for line in lines:
            if 'computeUnitIds' not in line:
                new_lines.append(line)
        
        if len(new_lines) != len(lines):
            with open(fn, 'w', encoding='utf-8') as f:
                f.writelines(new_lines)
            print(f"Removed broken computeUnitIds calls from {fn}")
