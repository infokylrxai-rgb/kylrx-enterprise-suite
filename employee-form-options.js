/**
 * The employee form's organisation-specific dropdowns, filled from the organisation's
 * own records.
 *
 * Designation, location, shift and cost centre were hard-coded in the page - DES-SE
 * "Software Engineer", LOC-BLR, SHIFT-GEN, CC-ENG-101 and their neighbours - so every
 * customer chose from the same seven invented designations and four invented offices,
 * and the employee record then pointed at things that existed nowhere.
 *
 * An organisation that has not set something up yet sees that it has none, and the
 * field is optional until it does.
 */

const SOURCES = {
  designationSelect:   { col: 'designations', code: ['designationCode'], name: ['designationName'], what: 'designations' },
  locationCodeSelect:  { col: 'locations',    code: ['locationCode'],    name: ['locationName'],    what: 'locations' },
  shiftCodeSelect:     { col: 'shifts',       code: ['shiftCode'],       name: ['shiftName'],       what: 'shifts' }
};

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const first = (o, keys, fallback) => { for (const k of keys) if (o && o[k]) return o[k]; return fallback; };

/** Options markup for a list, or the empty state. Keeps `selected` even if not listed. */
export function optionsHtml(items, what, selected = '') {
  if (!items.length && !selected) {
    return { html: `<option value="">No ${what} set up yet - add them in Organization Setup</option>`, empty: true };
  }
  let html = `<option value="">-- Select --</option>`;
  let found = false;
  for (const it of items) {
    const isSel = selected && String(it.code).toUpperCase() === String(selected).toUpperCase();
    if (isSel) found = true;
    html += `<option value="${esc(it.code)}"${isSel ? ' selected' : ''}>${esc(it.code)} - ${esc(it.name)}</option>`;
  }
  // A saved value that is no longer in the list is kept, and shown as such, so opening
  // and re-saving an employee never silently clears it.
  if (selected && !found) html += `<option value="${esc(selected)}" selected>${esc(selected)} (not in your list)</option>`;
  return { html, empty: false };
}

/**
 * Fill the form's dropdowns. deps: { db, collection, getDocs, orgId }.
 * selected: { designation, locationCode, shiftCode, costCenterCode } for an edit.
 */
export async function fillEmployeeFormOptions(form, deps, selected = {}) {
  if (!form || !deps || !deps.orgId) return;
  const { db, collection, getDocs, orgId } = deps;
  const wanted = { designationSelect: selected.designation, locationCodeSelect: selected.locationCode, shiftCodeSelect: selected.shiftCode };

  await Promise.all(Object.entries(SOURCES).map(async ([id, src]) => {
    const select = (typeof document !== 'undefined' && document.getElementById(id)) || null;
    if (!select) return;
    let items = [];
    try {
      const snap = await getDocs(collection(db, 'organizations', orgId, src.col));
      snap.forEach(d => {
        const data = d.data() || {};
        if (data.isActive === false) return;
        items.push({ code: first(data, src.code, d.id), name: first(data, src.name, d.id) });
      });
    } catch (err) {
      console.error('[EmployeeForm] ' + src.what + ' could not be loaded:', err);
      select.innerHTML = `<option value="">${esc(src.what)} could not be loaded</option>`;
      select.required = false;
      return;
    }
    items.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const { html, empty } = optionsHtml(items, src.what, wanted[id] || '');
    select.innerHTML = html;
    select.required = !empty && select.dataset.wasRequired === 'true';
  }));

  // Cost centres: through the cost-centre service, so its later re-renders (when the
  // department changes) show the same real list instead of an empty one.
  const cc = (typeof document !== 'undefined' && document.getElementById('costCenterCodeSelect')) || null;
  const svc = typeof window !== 'undefined' ? window.KylrxCostCenterService : null;
  if (cc && svc && typeof svc.loadCostCentersFromFirestore === 'function') {
    try {
      await svc.loadCostCentersFromFirestore(orgId);
      if (svc.getActiveCostCenters().length) {
        svc.populateCostCenterDropdown(cc, { selectedCode: selected.costCenterCode || '', includePlaceholder: true });
      } else {
        cc.innerHTML = optionsHtml([], 'cost centres', selected.costCenterCode || '').html;
        cc.required = false;
      }
    } catch (err) {
      console.error('[EmployeeForm] cost centres could not be loaded:', err);
      cc.innerHTML = '<option value="">Cost centres could not be loaded</option>';
      cc.required = false;
    }
  }
}
