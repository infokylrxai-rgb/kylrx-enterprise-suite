import re

with open('admin-dashboard.css', 'r', encoding='utf-8') as f:
    css_content = f.read()

with open('admin-onboarding-ai.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add imports
content = content.replace(
    'import { collection, query, getDocs, where, addDoc, serverTimestamp, orderBy, limit, onSnapshot, writeBatch }',
    'import { collection, query, getDocs, where, addDoc, serverTimestamp, orderBy, limit, onSnapshot, writeBatch, doc, deleteDoc, updateDoc }'
)

# 2. Remove manual appendMessage calls in sendChat
content = re.sub(r"appendMessage\(text, 'user'\);\s*input\.value = '';", "input.value = '';", content)
content = re.sub(r"appendMessage\(response, 'ai'\);\s*await addDoc", "await addDoc", content)

# 3. Update onSnapshot to pass doc.id
content = content.replace(
    'appendMessage(data.message, data.role);',
    'appendMessage(data.message, data.role, doc.id);'
)

# 4. Replace appendMessage function and add edit/delete functions
new_append_message = '''        function appendMessage(text, role, docId = null) {
            const display = document.getElementById('chatDisplay');
            if (!display) return;
            
            const bubbleWrap = document.createElement('div');
            bubbleWrap.style.display = 'flex';
            bubbleWrap.style.flexDirection = 'column';
            bubbleWrap.style.gap = '4px';
            bubbleWrap.style.alignSelf = role === 'ai' ? 'flex-start' : 'flex-end';
            bubbleWrap.style.maxWidth = '85%';

            const bubble = document.createElement('div');
            bubble.className = `chat-bubble bubble-${role}`;
            bubble.style.maxWidth = '100%';
            bubble.innerHTML = text;
            bubbleWrap.appendChild(bubble);

            if (role === 'user' && docId) {
                const actions = document.createElement('div');
                actions.style.display = 'flex';
                actions.style.gap = '12px';
                actions.style.justifyContent = 'flex-end';
                actions.style.fontSize = '0.75rem';
                actions.style.marginTop = '2px';

                const editBtn = document.createElement('span');
                editBtn.innerHTML = '<i data-lucide="edit-2" style="width:12px;height:12px;margin-bottom:-2px;"></i> Edit';
                editBtn.style.cursor = 'pointer';
                editBtn.style.color = 'var(--text-muted)';
                editBtn.onclick = async () => {
                    const newText = prompt("Edit your message:", text);
                    if (newText !== null && newText.trim() !== "") {
                        try {
                            await updateDoc(doc(db, 'ai_chat_logs', docId), { message: newText.trim() });
                        } catch(e) { console.error(e); }
                    }
                };

                const delBtn = document.createElement('span');
                delBtn.innerHTML = '<i data-lucide="trash-2" style="width:12px;height:12px;margin-bottom:-2px;"></i> Delete';
                delBtn.style.cursor = 'pointer';
                delBtn.style.color = 'var(--danger)';
                delBtn.onclick = async () => {
                    if (confirm("Delete this message?")) {
                        try {
                            await deleteDoc(doc(db, 'ai_chat_logs', docId));
                        } catch(e) { console.error(e); }
                    }
                };

                actions.appendChild(editBtn);
                actions.appendChild(delBtn);
                bubbleWrap.appendChild(actions);
            }

            display.appendChild(bubbleWrap);
            display.scrollTop = display.scrollHeight;
            if (window.lucide) lucide.createIcons();
        }'''

# Replace the old function definition
content = re.sub(
    r"function appendMessage\(text, role\) \{.*?(?=async function loadAIIntelligence\(\))",
    new_append_message + "\n\n        ",
    content,
    flags=re.DOTALL
)

with open('admin-onboarding-ai.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("Updated admin-onboarding-ai.html successfully")
