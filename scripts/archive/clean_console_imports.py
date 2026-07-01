import os

filepath = 'manager-console.html'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace block 1: statusRef listener import
target1 = '''            import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js").then(mod => {
                const { onSnapshot } = mod;
                onSnapshot(statusRef, (docSnap) => {'''

replacement1 = '''            onSnapshot(statusRef, (docSnap) => {'''

target1_end = '''                        if (window.lucide) lucide.createIcons();
                    }
                });
            });
        }'''

replacement1_end = '''                        if (window.lucide) lucide.createIcons();
                    }
                });
        }'''

# Replace block 2: secure department sync import
target2 = '''            // SECURE DEPARTMENT SYNC: Strict isolation enforced at Firestore level
            import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js").then(mod => {
                const { collection, query, where, onSnapshot } = mod;
                const today = new Date().toISOString().split('T')[0];
                
                // DBAC Layer: Strict bind to currentUnitId (Client-side filtering to bypass 400 errors)
                onSnapshot(collection(db, 'users'), (snapshot) => {'''

replacement2 = '''            // SECURE DEPARTMENT SYNC: Strict isolation enforced at Firestore level
            const today = new Date().toISOString().split('T')[0];
            
            // DBAC Layer: Strict bind to currentUnitId (Client-side filtering to bypass 400 errors)
            onSnapshot(collection(db, 'users'), (snapshot) => {'''

target2_end = '''                        updateSecurityAlerts(config.name);
                    });
                });
            });

            lucide.createIcons();'''

replacement2_end = '''                        updateSecurityAlerts(config.name);
                    });
                });

            lucide.createIcons();'''

# Perform block replacements
if target1 in content:
    content = content.replace(target1, replacement1)
    print("Replaced target1")
else:
    print("WARNING: target1 not found!")

if target1_end in content:
    content = content.replace(target1_end, replacement1_end)
    print("Replaced target1_end")
else:
    print("WARNING: target1_end not found!")

if target2 in content:
    content = content.replace(target2, replacement2)
    print("Replaced target2")
else:
    print("WARNING: target2 not found!")

if target2_end in content:
    content = content.replace(target2_end, replacement2_end)
    print("Replaced target2_end")
else:
    print("WARNING: target2_end not found!")

# Single line await imports replacements
await_imports = [
    'const { collection, onSnapshot } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js");',
    'const { collection, getDocs, query, where } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js");',
    'const { collection, addDoc, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js");',
    'const { doc, onSnapshot } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js");',
    'const { doc, updateDoc, arrayUnion, getDoc } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js");',
    'const { doc, getDoc, updateDoc } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js");',
    'const { doc, deleteDoc, getDoc } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js");'
]

for imp in await_imports:
    if imp in content:
        content = content.replace(imp, '// Using centralized imports')
        print(f"Replaced await import: {imp[:40]}...")
    else:
        # try with single quotes
        imp_sq = imp.replace('"', "'")
        if imp_sq in content:
            content = content.replace(imp_sq, '// Using centralized imports')
            print(f"Replaced await import (single quote): {imp_sq[:40]}...")
        else:
            print(f"WARNING: await import not found: {imp[:40]}...")

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print("Finished cleaning manager-console.html")
