import re

with open('admin-dashboard.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix logo
old_logo = '''            <a href="admin-dashboard.html" class="logo">
                <img src="logo.jpg" alt="Logo" style="height: 40px; object-fit: contain;">
            </a>'''
new_logo = '''            <a href="admin-dashboard.html" class="logo">
                <img src="logo.jpg" alt="Logo" style="height: 36px; object-fit: contain; border-radius: 8px;">
                <span class="logo-text">Kylrx <span style="color: var(--primary);">AI</span></span>
            </a>'''
content = content.replace(old_logo, new_logo)

# Remove @media (max-width: 1024px) block that starts at line 267
content = re.sub(r'@media \(max-width: 1024px\) \{[\s\S]*?\}\s*(?=/\* Main Content)', '', content)

# Remove @media (max-width: 1024px) block that starts at line 1210 and @media (max-width: 480px)
content = re.sub(r'@media \(max-width: 1024px\) \{[\s\S]*?\}\s*(?=@media|\</style\>)', '', content)
content = re.sub(r'@media \(max-width: 480px\) \{[\s\S]*?\}\s*(?=\</style\>)', '', content)

with open('admin-dashboard.html', 'w', encoding='utf-8') as f:
    f.write(content)
print('Fixed admin-dashboard.html')
