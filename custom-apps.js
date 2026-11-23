/**
 * Custom apps in the admin sidebar and the App Registry modal: one implementation for every admin page.
 *
 * Stored per organization at organizations/{orgId}/config/admin_custom_apps as { customApps: [{ name, url }] }
 * (the organization comes from the verified token via firebase-config.js tenantReady). The Firestore
 * rules let a super admin or HR user of the same organization write it; everyone in it can read it.
 *
 * Links are https:// only, and everything is drawn with textContent / setAttribute, never innerHTML,
 * so a stored name or url can never run script. The checks run when RENDERING too, so a document
 * written by anything else cannot inject a javascript: or data: link.
 */
import { db, doc, onSnapshot, setDoc, arrayUnion, arrayRemove, tenantReady, getActiveOrgId } from './firebase-config.js';

/** The normalized https URL, or null. "example.com" becomes https://example.com; any other scheme is refused. */
export function safeAppUrl(raw) {
    const text = String(raw || '').trim();
    if (!text) return null;
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
    try {
        const url = new URL(withScheme);
        if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
        return url.href;
    } catch (_) {
        return null;
    }
}

/** A short single-line label with no control characters */
export function cleanAppName(raw) {
    return String(raw || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

/** Only entries with a name and a safe https url, as stored */
export function validApps(apps) {
    if (!Array.isArray(apps)) return [];
    return apps
        .filter(app => app && typeof app.name === 'string' && typeof app.url === 'string')
        .filter(app => cleanAppName(app.name) && safeAppUrl(app.url) === app.url);
}

async function appsRef() {
    await tenantReady;
    const orgId = getActiveOrgId();
    if (!orgId) throw new Error('No organization found for the signed-in user.');
    return doc(db, 'organizations', orgId, 'config', 'admin_custom_apps');
}

function el(tag, { text, attrs = {}, style, children = [] } = {}) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    if (style) node.setAttribute('style', style);
    children.forEach(child => node.appendChild(child));
    return node;
}

const icon = (name, style) => el('i', { attrs: { 'data-lucide': name }, style });

function removeButton(app, style, title, iconName, iconStyle) {
    const button = el('button', { attrs: { type: 'button', title }, style, children: [icon(iconName, iconStyle)] });
    button.addEventListener('click', () => window.removeAppFromServer(app.url, app.name));
    return button;
}

export function renderApps(rawApps) {
    const apps = validApps(rawApps);

    const list = document.getElementById('customAppsList');
    if (list) {
        list.replaceChildren(...apps.map(app => el('div', {
            attrs: { class: 'nav-item' }, style: 'position: relative;',
            children: [
                el('a', {
                    attrs: { href: app.url, target: '_blank', rel: 'noopener noreferrer', class: 'nav-link' }, style: 'padding-right: 32px;',
                    children: [icon('external-link'), el('span', { text: app.name })]
                }),
                removeButton(app,
                    'position: absolute; right: 8px; top: 50%; transform: translateY(-50%); background: none; border: none; color: var(--danger); opacity: 0.5; cursor: pointer; padding: 4px; display: flex; align-items: center; justify-content: center;',
                    'Remove', 'x', 'width: 12px; height: 12px;')
            ]
        })));
    }

    const registry = document.getElementById('registryAppsList');
    if (registry) {
        registry.replaceChildren(...apps.map(app => el('div', {
            style: 'display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; font-size: 0.85rem; margin-bottom: 8px;',
            children: [
                el('div', {
                    style: 'display: flex; align-items: center; gap: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 80%;',
                    children: [
                        icon('external-link', 'width: 16px; height: 16px; color: #3b82f6; flex-shrink: 0;'),
                        el('span', { text: app.name, style: 'font-weight: 700; font-size: 0.8rem; color: #0f172a;' })
                    ]
                }),
                removeButton(app,
                    'background: none; border: none; color: #ef4444; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 4px; flex-shrink: 0;',
                    'Delete Mapping', 'trash-2', 'width: 16px; height: 16px;')
            ]
        })));
    }

    if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
}

function notify(message) {
    if (typeof window.alert === 'function') window.alert(message);
}

export async function addCustomApp(rawUrl, rawName) {
    const url = safeAppUrl(rawUrl);
    if (!url) throw new Error('Only https:// links are allowed.');
    const name = cleanAppName(rawName) || new URL(url).hostname.replace(/^www\./, '').split('.')[0].toUpperCase();
    await setDoc(await appsRef(), { customApps: arrayUnion({ name, url }) }, { merge: true });
}

export async function removeCustomApp(url, name) {
    await setDoc(await appsRef(), { customApps: arrayRemove({ name, url }) }, { merge: true });
}

/** Wires the sidebar list, the App Registry modal and its add / remove actions on the current page */
export function initCustomApps() {
    if (window.__customAppsReady) return;
    window.__customAppsReady = true;

    window.openAppRegistryModal = () => {
        const modal = document.getElementById('customAppsModal');
        if (modal) modal.style.display = 'flex';
        if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
    };
    window.closeAppRegistryModal = () => {
        const modal = document.getElementById('customAppsModal');
        if (modal) modal.style.display = 'none';
    };

    window.addCustomApp = async () => {
        const urlInput = document.getElementById('appUrlInput');
        const nameInput = document.getElementById('appNameInput');
        if (!urlInput || !urlInput.value.trim()) return;
        try {
            await addCustomApp(urlInput.value, nameInput ? nameInput.value : '');
            urlInput.value = '';
            if (nameInput) nameInput.value = '';
        } catch (error) {
            notify(error.message || 'Could not add the app.');
        }
    };

    window.removeAppFromServer = async (url, name) => {
        try {
            await removeCustomApp(url, name);
        } catch (error) {
            notify(`Could not remove the app: ${error.message}`);
        }
    };

    if (!document.getElementById('customAppsList') && !document.getElementById('registryAppsList')) return;
    appsRef()
        .then(ref => onSnapshot(ref, snapshot => renderApps(snapshot.exists() ? snapshot.data().customApps : []), () => renderApps([])))
        .catch(() => renderApps([]));
}
