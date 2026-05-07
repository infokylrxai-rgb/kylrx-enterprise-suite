$base = 'c:\Users\Admin\OneDrive\Desktop\product_sprint\hr-dashboard'
$src = Get-Content "$base\engineering-employee-tvc-dashboard.html" -Raw

# Finance
$f = $src
$f = $f.Replace('Engineering TVC', 'Finance TVC')
$f = $f.Replace('engineering employee', 'finance employee')
$f = $f.Replace('ENGINEERING', 'FINANCE')
$f = $f.Replace('engineering-employee.html', 'finance-employee.html')
$f = $f.Replace([char]0x2699 + [char]0xFE0F, [char]0x1F4B0)
$f = $f.Replace('--accent: #0ea5e9', '--accent: #8b5cf6')
$f = $f.Replace('--accent-glow: rgba(14,165,233,0.15)', '--accent-glow: rgba(139,92,246,0.15)')
$f = $f.Replace('--accent-dark: #0284c7', '--accent-dark: #7c3aed')
$f = $f.Replace('data-lucide="cpu"', 'data-lucide="landmark"')
[System.IO.File]::WriteAllText("$base\finance-employee-tvc-dashboard.html", $f)

# Marketing
$m = $src
$m = $m.Replace('Engineering TVC', 'Marketing TVC')
$m = $m.Replace('engineering employee', 'marketing employee')
$m = $m.Replace('ENGINEERING', 'MARKETING')
$m = $m.Replace('engineering-employee.html', 'marketing-employee.html')
$m = $m.Replace('--accent: #0ea5e9', '--accent: #f97316')
$m = $m.Replace('--accent-glow: rgba(14,165,233,0.15)', '--accent-glow: rgba(249,115,22,0.15)')
$m = $m.Replace('--accent-dark: #0284c7', '--accent-dark: #ea580c')
$m = $m.Replace('data-lucide="cpu"', 'data-lucide="megaphone"')
[System.IO.File]::WriteAllText("$base\marketing-employee-tvc-dashboard.html", $m)

# Sales
$s = $src
$s = $s.Replace('Engineering TVC', 'Sales TVC')
$s = $s.Replace('engineering employee', 'sales employee')
$s = $s.Replace('ENGINEERING', 'SALES')
$s = $s.Replace('engineering-employee.html', 'sales-employee.html')
$s = $s.Replace('--accent: #0ea5e9', '--accent: #10b981')
$s = $s.Replace('--accent-glow: rgba(14,165,233,0.15)', '--accent-glow: rgba(16,185,129,0.15)')
$s = $s.Replace('--accent-dark: #0284c7', '--accent-dark: #059669')
$s = $s.Replace('data-lucide="cpu"', 'data-lucide="trending-up"')
[System.IO.File]::WriteAllText("$base\sales-employee-tvc-dashboard.html", $s)

# Operations
$o = $src
$o = $o.Replace('Engineering TVC', 'Operations TVC')
$o = $o.Replace('engineering employee', 'operations employee')
$o = $o.Replace('ENGINEERING', 'OPERATIONS')
$o = $o.Replace('engineering-employee.html', 'operational-employee.html')
$o = $o.Replace('--accent: #0ea5e9', '--accent: #06b6d4')
$o = $o.Replace('--accent-glow: rgba(14,165,233,0.15)', '--accent-glow: rgba(6,182,212,0.15)')
$o = $o.Replace('--accent-dark: #0284c7', '--accent-dark: #0891b2')
$o = $o.Replace('data-lucide="cpu"', 'data-lucide="settings"')
[System.IO.File]::WriteAllText("$base\operations-employee-tvc-dashboard.html", $o)

# HR
$h = $src
$h = $h.Replace('Engineering TVC', 'HR TVC')
$h = $h.Replace('engineering employee', 'hr employee')
$h = $h.Replace('ENGINEERING', 'HR')
$h = $h.Replace('engineering-employee.html', 'hr-employee.html')
$h = $h.Replace('--accent: #0ea5e9', '--accent: #ec4899')
$h = $h.Replace('--accent-glow: rgba(14,165,233,0.15)', '--accent-glow: rgba(236,72,153,0.15)')
$h = $h.Replace('--accent-dark: #0284c7', '--accent-dark: #db2777')
$h = $h.Replace('data-lucide="cpu"', 'data-lucide="heart"')
[System.IO.File]::WriteAllText("$base\hr-employee-tvc-dashboard.html", $h)

Write-Host "All 5 department dashboards generated successfully."
