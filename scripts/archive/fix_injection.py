import glob

manager_files = glob.glob('manager-*.html')

broken_injection = """                if (navTeamLink) {
                    if (typeof openTeamManager === 'undefined') {
                        navTeamLink.removeAttribute('onclick');
                        navTeamLink.href = centerId ? `manager-workforce.html?id=${centerId}` : `manager-workforce.html`;
                    }
                }"""

fixed_injection = """                {
                    const _navTeamLink = document.getElementById('navTeamLink');
                    if (_navTeamLink) {
                        if (typeof openTeamManager === 'undefined') {
                            _navTeamLink.removeAttribute('onclick');
                            _navTeamLink.href = centerId ? `manager-workforce.html?id=${centerId}` : `manager-workforce.html`;
                        }
                    }
                }"""

for file in manager_files:
    with open(file, 'r', encoding='utf-8') as f:
        content = f.read()

    if broken_injection in content:
        content = content.replace(broken_injection, fixed_injection)
        with open(file, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Fixed navTeamLink injection in {file}")
