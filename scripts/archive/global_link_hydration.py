import os
import glob
import re

manager_files = glob.glob('manager-*.html') + ['manager-calendar.html']

global_hydration_code = """
        // Global Link Hydration
        (function hydrateSidebar() {
            const centerId = new URLSearchParams(window.location.search).get('id');
            const overviewLink = document.getElementById('overviewLink');
            const leaveHolidaysLink = document.getElementById('leaveHolidaysLink');
            const navConsoleLink = document.getElementById('navConsoleLink');
            const navAnalysisLink = document.getElementById('navAnalysisLink');
            const navNotifLink = document.getElementById('navNotifLink');
            const navMsgLink = document.getElementById('navMsgLink');
            const navDocsLink = document.getElementById('navDocsLink');
            const navPolicyLink = document.getElementById('navPolicyLink');
            const navAssetsLink = document.getElementById('navAssetsLink');
            const navWorkforceLink = document.getElementById('navWorkforceLink');
            const navSecurityLink = document.getElementById('navSecurityLink');
            const navPerformanceLink = document.getElementById('navPerformanceLink');
            const navAttendanceLink = document.getElementById('navAttendanceLink');

            if (overviewLink) overviewLink.href = centerId ? `manager-dashboard.html?id=${centerId}` : `manager-dashboard.html`;
            if (leaveHolidaysLink) leaveHolidaysLink.href = centerId ? `manager-calendar.html?id=${centerId}` : `manager-calendar.html`;
            if (navConsoleLink) navConsoleLink.href = centerId ? `manager-dashboard.html?id=${centerId}` : `manager-dashboard.html`;
            if (navAnalysisLink) navAnalysisLink.href = centerId ? `manager-analysis.html?id=${centerId}` : `manager-analysis.html`;
            if (navNotifLink) navNotifLink.href = centerId ? `manager-notification.html?id=${centerId}` : `manager-notification.html`;
            if (navMsgLink) navMsgLink.href = centerId ? `manager-message.html?id=${centerId}` : `manager-message.html`;
            if (navDocsLink) navDocsLink.href = centerId ? `manager-documents.html?id=${centerId}` : `manager-documents.html`;
            if (navWorkforceLink) navWorkforceLink.href = centerId ? `manager-workforce.html?id=${centerId}` : `manager-workforce.html`;
            if (navSecurityLink) navSecurityLink.href = centerId ? `manager-security.html?id=${centerId}` : `manager-security.html`;
            if (navPerformanceLink) navPerformanceLink.href = centerId ? `manager-performance.html?id=${centerId}` : `manager-performance.html`;
            if (navAttendanceLink) navAttendanceLink.href = centerId ? `manager-attendance.html?id=${centerId}` : `manager-attendance.html`;
        })();
"""

for f in manager_files:
    if os.path.exists(f):
        with open(f, 'r', encoding='utf-8') as file:
            content = file.read()
            
        # We'll inject this right after lucide.createIcons();
        if 'lucide.createIcons();' in content and 'function hydrateSidebar' not in content:
            patched = content.replace('lucide.createIcons();', 'lucide.createIcons();\n' + global_hydration_code, 1)
            
            if patched != content:
                with open(f, 'w', encoding='utf-8') as out_file:
                    out_file.write(patched)
                print(f"Added global link hydration to {f}")
