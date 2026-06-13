import re

with open('admin-onboarding-ai.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add Edit and Delete modals HTML before </body>
modals_html = """
    <!-- Edit Message Modal -->
    <div class="confirm-modal-overlay" id="editMessageModal">
        <div class="confirm-modal">
            <div class="confirm-modal-icon" style="background: #e0f2fe; color: #0ea5e9;">
                <i data-lucide="edit-2" style="width: 28px; height: 28px;"></i>
            </div>
            <h4 class="confirm-modal-title">Edit Message</h4>
            <div style="margin-bottom: 1.5rem; text-align: left;">
                <input type="text" id="editMessageInput" class="input-box" style="width: 100%; border: 1px solid var(--border); padding: 10px; border-radius: 8px;">
            </div>
            <div class="confirm-modal-actions">
                <button class="confirm-modal-btn confirm-modal-btn-cancel" id="cancelEditBtn">Cancel</button>
                <button class="confirm-modal-btn confirm-modal-btn-confirm" id="saveEditBtn" style="background: var(--primary);">Save</button>
            </div>
        </div>
    </div>

    <!-- Delete Message Modal -->
    <div class="confirm-modal-overlay" id="deleteMessageModal">
        <div class="confirm-modal">
            <div class="confirm-modal-icon">
                <i data-lucide="trash-2" style="width: 28px; height: 28px;"></i>
            </div>
            <h4 class="confirm-modal-title">Delete Message</h4>
            <p class="confirm-modal-desc">Are you sure you want to delete this message? This action cannot be undone.</p>
            <div class="confirm-modal-actions">
                <button class="confirm-modal-btn confirm-modal-btn-cancel" id="cancelDeleteMsgBtn">Cancel</button>
                <button class="confirm-modal-btn confirm-modal-btn-confirm" id="confirmDeleteMsgBtn">Delete</button>
            </div>
        </div>
    </div>
"""

content = content.replace('</body>', modals_html + '\n</body>')

# 2. Add global state and modal event listeners to setupChat()
setup_chat_additions = """
            // Global state for modals
            window.currentEditDocId = null;
            window.currentDeleteDocId = null;

            // Edit Modal Listeners
            document.getElementById('cancelEditBtn')?.addEventListener('click', () => {
                document.getElementById('editMessageModal')?.classList.remove('active');
            });
            document.getElementById('saveEditBtn')?.addEventListener('click', async () => {
                const input = document.getElementById('editMessageInput');
                if (window.currentEditDocId && input.value.trim() !== '') {
                    try {
                        await updateDoc(doc(db, 'ai_chat_logs', window.currentEditDocId), { message: input.value.trim() });
                    } catch(e) { console.error(e); }
                }
                document.getElementById('editMessageModal')?.classList.remove('active');
            });

            // Delete Modal Listeners
            document.getElementById('cancelDeleteMsgBtn')?.addEventListener('click', () => {
                document.getElementById('deleteMessageModal')?.classList.remove('active');
            });
            document.getElementById('confirmDeleteMsgBtn')?.addEventListener('click', async () => {
                if (window.currentDeleteDocId) {
                    try {
                        await deleteDoc(doc(db, 'ai_chat_logs', window.currentDeleteDocId));
                    } catch(e) { console.error(e); }
                }
                document.getElementById('deleteMessageModal')?.classList.remove('active');
            });
"""

# Insert the additions at the beginning of setupChat
content = re.sub(
    r'(function setupChat\(\) \{)',
    r'\1\n' + setup_chat_additions,
    content
)

# 3. Replace the inline prompt and confirm with modal logic
edit_logic_old = """                editBtn.onclick = async () => {
                    const newText = prompt("Edit your message:", text);
                    if (newText !== null && newText.trim() !== "") {
                        try {
                            await updateDoc(doc(db, 'ai_chat_logs', docId), { message: newText.trim() });
                        } catch(e) { console.error(e); }
                    }
                };"""

edit_logic_new = """                editBtn.onclick = () => {
                    window.currentEditDocId = docId;
                    document.getElementById('editMessageInput').value = text;
                    document.getElementById('editMessageModal').classList.add('active');
                    if (window.lucide) lucide.createIcons();
                };"""

del_logic_old = """                delBtn.onclick = async () => {
                    if (confirm("Delete this message?")) {
                        try {
                            await deleteDoc(doc(db, 'ai_chat_logs', docId));
                        } catch(e) { console.error(e); }
                    }
                };"""

del_logic_new = """                delBtn.onclick = () => {
                    window.currentDeleteDocId = docId;
                    document.getElementById('deleteMessageModal').classList.add('active');
                    if (window.lucide) lucide.createIcons();
                };"""

content = content.replace(edit_logic_old, edit_logic_new)
content = content.replace(del_logic_old, del_logic_new)

with open('admin-onboarding-ai.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("Modal integration complete")
