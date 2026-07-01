import glob
import re
import os

manager_files = glob.glob('manager-*.html') + ['manager-calendar.html']

new_hydration = """// Global Link Hydration
        (function hydrateSidebar() {
            const centerId = new URLSearchParams(window.location.search).get('id');
            const overviewLink = document.getElementById('overviewLink');
            const leaveHolidaysLink = document.getElementById('leaveHolidaysLink');
            const navConsoleLink = document.getElementById('navConsoleLink');
            const navAnalysisLink = document.getElementById('navAnalysisLink');
            const navNotifLink = document.getElementById('navNotifLink');
            const navMsgLink = document.getElementById('navMsgLink');
            const navDocsLink = document.getElementById('navDocsLink');
            const navWorkforceLink = document.getElementById('navWorkforceLink');
            const navSecurityLink = document.getElementById('navSecurityLink');
            const navPerformanceLink = document.getElementById('navPerformanceLink');
            const navAttendanceLink = document.getElementById('navAttendanceLink');
            const navPolicyLink = document.getElementById('navPolicyLink');
            const navAssetsLink = document.getElementById('navAssetsLink');

            if (overviewLink) overviewLink.href = centerId ? `manager-dashboard.html?id=${centerId}` : `manager-dashboard.html`;
            if (leaveHolidaysLink) leaveHolidaysLink.href = centerId ? `manager-calendar.html?id=${centerId}` : `manager-calendar.html`;
            if (navConsoleLink) navConsoleLink.href = centerId ? `manager-console.html?id=${centerId}` : `manager-console.html`;
            if (navAnalysisLink) navAnalysisLink.href = centerId ? `manager-analysis.html?id=${centerId}` : `manager-analysis.html`;
            if (navNotifLink) navNotifLink.href = centerId ? `manager-notification.html?id=${centerId}` : `manager-notification.html`;
            if (navMsgLink) navMsgLink.href = centerId ? `manager-message.html?id=${centerId}` : `manager-message.html`;
            if (navDocsLink) navDocsLink.href = centerId ? `manager-documents.html?id=${centerId}` : `manager-documents.html`;
            if (navWorkforceLink) navWorkforceLink.href = centerId ? `manager-workforce.html?id=${centerId}` : `manager-workforce.html`;
            if (navSecurityLink) navSecurityLink.href = centerId ? `manager-security.html?id=${centerId}` : `manager-security.html`;
            if (navPerformanceLink) navPerformanceLink.href = centerId ? `manager-performance.html?id=${centerId}` : `manager-performance.html`;
            if (navAttendanceLink) navAttendanceLink.href = centerId ? `manager-attendance.html?id=${centerId}` : `manager-attendance.html`;
            if (navPolicyLink) navPolicyLink.href = centerId ? `manager-policy.html?id=${centerId}` : `manager-policy.html`;
            if (navAssetsLink) navAssetsLink.href = centerId ? `manager-assets.html?id=${centerId}` : `manager-assets.html`;
                {
                    const _navTeamLink = document.getElementById('navTeamLink');
                    if (_navTeamLink) {
                        if (typeof openTeamManager === 'undefined') {
                            _navTeamLink.removeAttribute('onclick');
                            _navTeamLink.href = centerId ? `manager-workforce.html?id=${centerId}` : `manager-workforce.html`;
                        }
                    }
                }
        })();"""

for f in manager_files:
    if not os.path.exists(f): continue
    with open(f, 'r', encoding='utf-8') as file:
        content = file.read()
    
    # regex to find the hydrateSidebar function
    pattern = re.compile(r'// Global Link Hydration\s*\(\s*function hydrateSidebar\(\).*?\)\(\);', re.DOTALL)
    
    if pattern.search(content):
        new_content = pattern.sub(new_hydration, content)
        with open(f, 'w', encoding='utf-8') as file:
            file.write(new_content)
        print(f"Updated {f}")
    else:
        # If it doesn't exist, we could inject it right after lucide.createIcons();
        if 'lucide.createIcons();' in content:
            new_content = content.replace('lucide.createIcons();', 'lucide.createIcons();\n        ' + new_hydration, 1)
            with open(f, 'w', encoding='utf-8') as file:
                file.write(new_content)
            print(f"Injected into {f}")
