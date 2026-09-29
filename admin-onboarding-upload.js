/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - ORGANIZATION ONBOARDING & SETUP CONTROLLER
 * ============================================================================
 * 
 * Handles Organization Setup matching PRD requirements and exact 21 columns
 * from the 'Organization' sheet in 'Templates.xlsx':
 * 
 * 1. In-App Template Download (Templates.xlsx served strictly in-app, never email).
 * 2. Supported Setup Methods:
 *    A. Manual Data Entry Form
 *    B. Bulk File Upload (Excel .xlsx / CSV parser)
 * 3. Exact 21 Fields for Organization Setup:
 *    Legal_Name, Display_Name, Organization_Type, Industry, Website,
 *    Official_Email, Official_Phone, Country, State, City, PIN_Code,
 *    Registered_Address, Corporate_Address, Time_Zone, Currency,
 *    Financial_Year_Start, PAN, TAN, CIN_or_LLPIN, GSTIN, Logo_URL.
 * 4. Processing & State Update:
 *    - Save/update Firestore organizations/{orgId}
 *    - Update state to { orgConfigured: true }
 *    - Trigger initial continuous sequential employee ID provisioning (EMP0001)
 *    - Redirect Super Admin to admin-dashboard.html
 * 
 * @version 2.0.0
 * @author Senior Frontend & Firebase Developer
 */

import { auth, db } from "./firebase-config.js";
import { 
    doc, 
    getDoc, 
    setDoc, 
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";

// Exact 21 Attributes Schema Definition (PRD Section 1 & 'Organization' Sheet)
export const ORGANIZATION_ATTRIBUTES = [
    { key: "Legal_Name", label: "1. Legal Name", required: true, synonyms: ["legal_name", "legalname", "company_name", "companyname", "legal entity name"] },
    { key: "Display_Name", label: "2. Display Name", required: true, synonyms: ["display_name", "displayname", "brand_name", "brandname", "name"] },
    { key: "Organization_Type", label: "3. Organization Type", required: true, defaultValue: "Private Limited", synonyms: ["organization_type", "organizationtype", "org_type", "orgtype", "type"] },
    { key: "Industry", label: "4. Industry", required: true, synonyms: ["industry", "sector", "domain"] },
    { key: "Website", label: "5. Website", required: false, synonyms: ["website", "url", "domain", "web"] },
    { key: "Official_Email", label: "6. Official Email", required: true, synonyms: ["official_email", "officialemail", "email", "corporate_email"] },
    { key: "Official_Phone", label: "7. Official Phone", required: true, synonyms: ["official_phone", "officialphone", "phone", "contact_number"] },
    { key: "Country", label: "8. Country", required: true, defaultValue: "India", synonyms: ["country", "nation"] },
    { key: "State", label: "9. State", required: true, synonyms: ["state", "province", "region"] },
    { key: "City", label: "10. City", required: true, synonyms: ["city", "town"] },
    { key: "PIN_Code", label: "11. PIN Code", required: true, synonyms: ["pin_code", "pincode", "pin", "postal_code", "postalcode", "zip", "zipcode"] },
    { key: "Registered_Address", label: "12. Registered Address", required: true, synonyms: ["registered_address", "registeredaddress", "reg_address", "regaddress"] },
    { key: "Corporate_Address", label: "13. Corporate Address", required: true, synonyms: ["corporate_address", "corporateaddress", "corp_address", "corpaddress", "hq_address"] },
    { key: "Time_Zone", label: "14. Time Zone", required: true, defaultValue: "Asia/Kolkata", synonyms: ["time_zone", "timezone", "tz"] },
    { key: "Currency", label: "15. Currency", required: true, defaultValue: "INR", synonyms: ["currency", "curr"] },
    { key: "Financial_Year_Start", label: "16. Financial Year Start", required: true, defaultValue: "04-01", synonyms: ["financial_year_start", "financialyearstart", "fy_start", "fystart"] },
    { key: "PAN", label: "17. PAN", required: true, synonyms: ["pan", "pan_number", "pannumber", "company_pan"] },
    { key: "TAN", label: "18. TAN", required: true, synonyms: ["tan", "tan_number", "tannumber"] },
    { key: "CIN_or_LLPIN", label: "19. CIN or LLPIN", required: false, synonyms: ["cin_or_llpin", "cinorllpin", "cin", "llpin", "cin_number", "cin/llpin"] },
    { key: "GSTIN", label: "20. GSTIN", required: true, synonyms: ["gstin", "gst_number", "gstnumber", "gst"] },
    { key: "Logo_URL", label: "21. Logo URL", required: false, synonyms: ["logo_url", "logourl", "logo", "brand_logo"] }
];

// Controller State
const state = {
    orgId: localStorage.getItem('orgId') || 'org_kylrx',
    isConfigured: false,
    parsedOrgData: null,
    isProcessing: false
};

// UI Element References
const statusBadge = document.getElementById('statusBadge');
const tabManual = document.getElementById('tabManual');
const tabBulk = document.getElementById('tabBulk');
const manualView = document.getElementById('manualView');
const uploadView = document.getElementById('uploadView');
const manualOrgForm = document.getElementById('manualOrgForm');
const btnFillDemoData = document.getElementById('btnFillDemoData');
const btnManualClear = document.getElementById('btnManualClear');
const btnManualSubmit = document.getElementById('btnManualSubmit');

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const btnDownloadTemplate = document.getElementById('btnDownloadTemplate');
const btnDownloadBanner = document.getElementById('btnDownloadBanner');
const parseResultsContainer = document.getElementById('parseResultsContainer');
const parseResultFileName = document.getElementById('parseResultFileName');
const parseResultMeta = document.getElementById('parseResultMeta');
const parsedAttributesTableBody = document.getElementById('parsedAttributesTableBody');
const validationStatusBadge = document.getElementById('validationStatusBadge');
const btnCancelIngest = document.getElementById('btnCancelIngest');
const btnConfirmIngest = document.getElementById('btnConfirmIngest');
const logoutBtn = document.getElementById('logoutBtn');

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', async () => {
    setupAuthWatcher();
    setupNavigationTabs();
    setupInAppDownload();
    setupManualForm();
    setupFileUpload();
    setupLogout();
    await checkExistingOrganizationStatus();
});

/**
 * Listens to Firebase Auth state to associate with tenant Org ID
 */
function setupAuthWatcher() {
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            try {
                const userDoc = await getDoc(doc(db, "users", user.uid));
                if (userDoc.exists() && userDoc.data().orgId) {
                    state.orgId = userDoc.data().orgId;
                    localStorage.setItem('orgId', state.orgId);
                }
            } catch (err) {
                console.warn("Could not query user orgId, using fallback:", state.orgId);
            }
            await checkExistingOrganizationStatus();
        }
    });
}

/**
 * Checks Firestore organizations/{orgId} to see if orgConfigured: true is set
 */
async function checkExistingOrganizationStatus() {
    try {
        const orgRef = doc(db, "organizations", state.orgId);
        const orgSnap = await getDoc(orgRef);

        if (orgSnap.exists()) {
            const data = orgSnap.data();
            if (data.orgConfigured === true) {
                state.isConfigured = true;
                localStorage.setItem('orgConfigured', 'true');
                if (statusBadge) {
                    statusBadge.className = 'badge-verified';
                    statusBadge.innerHTML = '<i data-lucide="check-circle" style="width: 14px;"></i> Organization Configured (orgConfigured: true)';
                }
                populateManualFormWithExistingData(data);
                console.log(`✅ Organization ${state.orgId} is configured:`, data);
            } else {
                markPendingStatus();
            }
        } else {
            markPendingStatus();
        }
    } catch (err) {
        console.warn("Status check failed (network/rules):", err.message);
        if (localStorage.getItem('orgConfigured') === 'true') {
            if (statusBadge) {
                statusBadge.className = 'badge-verified';
                statusBadge.innerHTML = '<i data-lucide="check-circle" style="width: 14px;"></i> Organization Configured (orgConfigured: true)';
            }
        }
    }
    if (window.lucide) lucide.createIcons();
}

function markPendingStatus() {
    state.isConfigured = false;
    if (statusBadge) {
        statusBadge.className = 'badge-pending';
        statusBadge.innerHTML = '<i data-lucide="shield-alert" style="width: 14px;"></i> Setup Required (orgConfigured: false)';
    }
}

/**
 * Pre-populates manual form fields if org data already exists
 */
function populateManualFormWithExistingData(data) {
    const fieldMapping = {
        manualLegalName: data.Legal_Name || data.legalName,
        manualDisplayName: data.Display_Name || data.displayName,
        manualOrgType: data.Organization_Type || data.organizationType,
        manualIndustry: data.Industry || data.industry,
        manualWebsite: data.Website || data.website,
        manualOfficialEmail: data.Official_Email || data.officialEmail,
        manualOfficialPhone: data.Official_Phone || data.officialPhone,
        manualCountry: data.Country || data.country,
        manualState: data.State || data.state,
        manualCity: data.City || data.city,
        manualPinCode: data.PIN_Code || data.pinCode,
        manualRegisteredAddress: data.Registered_Address || data.registeredAddress,
        manualCorporateAddress: data.Corporate_Address || data.corporateAddress,
        manualTimeZone: data.Time_Zone || data.timezone,
        manualCurrency: data.Currency || data.currency,
        manualFyStart: data.Financial_Year_Start || data.financialYearStart,
        manualPan: data.PAN || data.pan,
        manualTan: data.TAN || data.tan,
        manualCin: data.CIN_or_LLPIN || data.cinOrLlpin,
        manualGstin: data.GSTIN || data.gstin,
        manualLogoUrl: data.Logo_URL || data.logoUrl
    };

    for (const [elemId, val] of Object.entries(fieldMapping)) {
        const el = document.getElementById(elemId);
        if (el && val !== undefined && val !== null) {
            el.value = val;
        }
    }
}

/**
 * Switcher between Tab A (Manual Form) and Tab B (Bulk File Upload)
 */
function setupNavigationTabs() {
    if (tabManual && tabBulk) {
        tabManual.onclick = () => {
            tabManual.classList.add('active');
            tabBulk.classList.remove('active');
            manualView.style.display = 'block';
            uploadView.style.display = 'none';
        };

        tabBulk.onclick = () => {
            tabBulk.classList.add('active');
            tabManual.classList.remove('active');
            uploadView.style.display = 'block';
            manualView.style.display = 'none';
        };
    }
}

/**
 * PRD Section 1: In-App Template Download (Strictly Served In-App, Never Distributed via Email)
 */
function setupInAppDownload() {
    const triggerInAppDownload = (e) => {
        e.preventDefault();
        const link = document.createElement('a');
        link.href = 'assets/Templates.xlsx';
        link.download = 'Templates.xlsx';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        console.log("📥 Direct in-app download initiated for official 27-sheet Templates.xlsx (Never distributed via email per PRD Section 1).");
    };

    if (btnDownloadTemplate) btnDownloadTemplate.onclick = triggerInAppDownload;
    if (btnDownloadBanner) btnDownloadBanner.onclick = triggerInAppDownload;
}

/**
 * Sets up Tab A: Manual Data Entry Form logic
 */
function setupManualForm() {
    // Fill sample demo data for rapid testing
    if (btnFillDemoData) {
        btnFillDemoData.onclick = () => {
            const demoData = {
                manualLegalName: "Kylrx Technologies Private Limited",
                manualDisplayName: "Kylrx AI",
                manualOrgType: "Private Limited",
                manualIndustry: "Technology & HR Automation SaaS",
                manualWebsite: "https://kylrx.ai",
                manualOfficialEmail: "admin@kylrx.ai",
                manualOfficialPhone: "+91 80 4123 4567",
                manualCountry: "India",
                manualState: "Karnataka",
                manualCity: "Bengaluru",
                manualPinCode: "560103",
                manualRegisteredAddress: "Outer Ring Road, Bellandur, Bengaluru, Karnataka 560103",
                manualCorporateAddress: "Floor 9, Tower C, Global Tech Park, Bellandur, Bengaluru, Karnataka 560103",
                manualTimeZone: "Asia/Kolkata",
                manualCurrency: "INR",
                manualFyStart: "04-01",
                manualPan: "AAACK1234F",
                manualTan: "BLRK12345D",
                manualCin: "U72200KA2026PTC123456",
                manualGstin: "29AAACK1234F1Z5",
                manualLogoUrl: "https://kylrx.ai/logo.jpg"
            };

            for (const [id, value] of Object.entries(demoData)) {
                const el = document.getElementById(id);
                if (el) el.value = value;
            }
            window.showCustomAlert("Demo Data Populated", "The exact 21 organization attributes have been auto-populated with Kylrx Enterprise defaults.", "success");
        };
    }

    if (btnManualClear) {
        btnManualClear.onclick = () => {
            if (manualOrgForm) manualOrgForm.reset();
        };
    }

    if (manualOrgForm) {
        manualOrgForm.onsubmit = async (e) => {
            e.preventDefault();
            await processManualSubmission();
        };
    }
}

/**
 * Handles Tab A manual form submission and validation of 21 attributes
 */
async function processManualSubmission() {
    if (state.isProcessing) return;

    // Extract exact 21 attributes from DOM inputs
    const rawData = {
        Legal_Name: document.getElementById('manualLegalName')?.value.trim() || '',
        Display_Name: document.getElementById('manualDisplayName')?.value.trim() || '',
        Organization_Type: document.getElementById('manualOrgType')?.value.trim() || 'Private Limited',
        Industry: document.getElementById('manualIndustry')?.value.trim() || '',
        Website: document.getElementById('manualWebsite')?.value.trim() || '',
        Official_Email: document.getElementById('manualOfficialEmail')?.value.trim().toLowerCase() || '',
        Official_Phone: document.getElementById('manualOfficialPhone')?.value.trim() || '',
        Country: document.getElementById('manualCountry')?.value.trim() || 'India',
        State: document.getElementById('manualState')?.value.trim() || '',
        City: document.getElementById('manualCity')?.value.trim() || '',
        PIN_Code: document.getElementById('manualPinCode')?.value.trim() || '',
        Registered_Address: document.getElementById('manualRegisteredAddress')?.value.trim() || '',
        Corporate_Address: document.getElementById('manualCorporateAddress')?.value.trim() || '',
        Time_Zone: document.getElementById('manualTimeZone')?.value.trim() || 'Asia/Kolkata',
        Currency: document.getElementById('manualCurrency')?.value.trim().toUpperCase() || 'INR',
        Financial_Year_Start: document.getElementById('manualFyStart')?.value.trim() || '04-01',
        PAN: document.getElementById('manualPan')?.value.trim().toUpperCase() || '',
        TAN: document.getElementById('manualTan')?.value.trim().toUpperCase() || '',
        CIN_or_LLPIN: document.getElementById('manualCin')?.value.trim().toUpperCase() || '',
        GSTIN: document.getElementById('manualGstin')?.value.trim().toUpperCase() || '',
        Logo_URL: document.getElementById('manualLogoUrl')?.value.trim() || ''
    };

    // Client-side Validation
    const errors = validateOrganizationAttributes(rawData);
    if (errors.length > 0) {
        window.showCustomAlert("Validation Error", errors.join("\n"), "error");
        return;
    }

    if (btnManualSubmit) {
        btnManualSubmit.disabled = true;
        btnManualSubmit.innerHTML = '<i data-lucide="loader" class="animate-spin"></i> Saving Organization...';
        if (window.lucide) lucide.createIcons();
    }

    state.isProcessing = true;

    try {
        await executeOrganizationSetup(rawData, "Manual Form");
    } catch (err) {
        console.error("Manual setup execution failed:", err);
        window.showCustomAlert("Setup Error", "Failed to save organization: " + err.message, "error");
        if (btnManualSubmit) {
            btnManualSubmit.disabled = false;
            btnManualSubmit.innerHTML = '<i data-lucide="check-circle-2"></i> Save Organization & Set orgConfigured: true';
            if (window.lucide) lucide.createIcons();
        }
    } finally {
        state.isProcessing = false;
    }
}

/**
 * Validates the 21 organization attributes according to statutory rules
 */
function validateOrganizationAttributes(data) {
    const errors = [];

    // Required fields check
    ORGANIZATION_ATTRIBUTES.forEach(attr => {
        if (attr.required && (!data[attr.key] || data[attr.key].toString().trim() === '')) {
            errors.push(`Missing required field: ${attr.label}`);
        }
    });

    // Email format
    if (data.Official_Email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.Official_Email)) {
        errors.push("Invalid Official Email format.");
    }

    // PAN format: 10 chars (5 letters, 4 digits, 1 letter)
    if (data.PAN && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(data.PAN)) {
        errors.push(`Invalid PAN format: "${data.PAN}". Must be 10 characters (e.g. AAACK1234F).`);
    }

    // TAN format: 10 chars (4 letters, 5 digits, 1 letter)
    if (data.TAN && !/^[A-Z]{4}[0-9]{5}[A-Z]{1}$/.test(data.TAN)) {
        errors.push(`Invalid TAN format: "${data.TAN}". Must be 10 characters (e.g. BLRK12345D).`);
    }

    // GSTIN format: 15 chars (2 state code + 10 PAN + 1 entity code + Z + 1 check digit)
    if (data.GSTIN && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(data.GSTIN)) {
        errors.push(`Invalid GSTIN format: "${data.GSTIN}". Must be 15 characters (e.g. 29AAACK1234F1Z5).`);
    }

    return errors;
}

/**
 * Sets up Tab B: Bulk File Upload (.xlsx / .csv parser)
 */
function setupFileUpload() {
    if (dropZone && fileInput) {
        dropZone.onclick = () => fileInput.click();
        fileInput.onchange = (e) => {
            if (e.target.files && e.target.files[0]) {
                handleUploadedFile(e.target.files[0]);
            }
        };

        dropZone.ondragover = (e) => {
            e.preventDefault();
            dropZone.style.borderColor = 'var(--primary)';
            dropZone.style.backgroundColor = 'var(--primary-light)';
        };

        dropZone.ondragleave = (e) => {
            e.preventDefault();
            dropZone.style.borderColor = 'var(--border)';
            dropZone.style.backgroundColor = '#ffffff';
        };

        dropZone.ondrop = (e) => {
            e.preventDefault();
            dropZone.style.borderColor = 'var(--border)';
            dropZone.style.backgroundColor = '#ffffff';
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                handleUploadedFile(e.dataTransfer.files[0]);
            }
        };
    }

    if (btnCancelIngest) {
        btnCancelIngest.onclick = () => {
            state.parsedOrgData = null;
            if (fileInput) fileInput.value = '';
            if (parseResultsContainer) parseResultsContainer.style.display = 'none';
            if (dropZone) dropZone.style.display = 'block';
        };
    }

    if (btnConfirmIngest) {
        btnConfirmIngest.onclick = async () => {
            if (!state.parsedOrgData || state.isProcessing) return;

            btnConfirmIngest.disabled = true;
            btnConfirmIngest.innerHTML = '<i data-lucide="loader" class="animate-spin"></i> Ingesting Organization...';
            if (window.lucide) lucide.createIcons();
            state.isProcessing = true;

            try {
                await executeOrganizationSetup(state.parsedOrgData, "Bulk Spreadsheet Upload");
            } catch (err) {
                console.error("Bulk spreadsheet ingest failed:", err);
                window.showCustomAlert("Ingest Error", "Failed to ingest organization: " + err.message, "error");
                btnConfirmIngest.disabled = false;
                btnConfirmIngest.innerHTML = '<i data-lucide="lock"></i> Ingest 21 Attributes & Set orgConfigured: true';
                if (window.lucide) lucide.createIcons();
            } finally {
                state.isProcessing = false;
            }
        };
    }
}

/**
 * Handles parsing of dropped / browsed Excel or CSV file using SheetJS
 */
function handleUploadedFile(file) {
    if (!file) return;

    const validExtensions = ['.xlsx', '.xls', '.csv'];
    const fileName = file.name.toLowerCase();
    const isValidExt = validExtensions.some(ext => fileName.endsWith(ext));

    if (!isValidExt) {
        window.showCustomAlert("Invalid File", "Please upload a valid Excel workbook (.xlsx, .xls) or CSV file.", "error");
        return;
    }

    if (typeof XLSX === 'undefined') {
        window.showCustomAlert("Parser Error", "SheetJS parser is not loaded. Please reload the page.", "error");
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });

            // 1. Target the 'Organization' sheet
            let targetSheetName = workbook.SheetNames.find(s => s.trim().toLowerCase() === 'organization');
            if (!targetSheetName) {
                // If single-sheet workbook or CSV, fallback to first sheet
                targetSheetName = workbook.SheetNames[0];
            }

            const sheet = workbook.Sheets[targetSheetName];
            if (!sheet) {
                throw new Error("Could not find sheet to parse in the uploaded file.");
            }

            const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
            if (!rawRows || rawRows.length === 0) {
                throw new Error(`Sheet '${targetSheetName}' contains no data rows.`);
            }

            // 2. Extract exactly the 21 attributes
            const extractedData = extract21AttributesFromSheetRows(rawRows);
            state.parsedOrgData = extractedData;

            // 3. Render live preview
            renderParsedAttributesPreview(file.name, targetSheetName, extractedData);
        } catch (err) {
            console.error("File parsing error:", err);
            window.showCustomAlert("Parsing Error", "Failed to parse spreadsheet: " + err.message, "error");
        }
    };
    reader.readAsArrayBuffer(file);
}

/**
 * Extracts and maps rows to the exact 21 attributes
 */
function extract21AttributesFromSheetRows(rows) {
    const extracted = {};

    // Helper to find a key in an object case-insensitively
    function findValueInObject(obj, synonymsList) {
        const objKeys = Object.keys(obj);
        for (const syn of synonymsList) {
            const cleanSyn = syn.toLowerCase().replace(/[\s_-]+/g, '');
            const foundKey = objKeys.find(k => k.trim().toLowerCase().replace(/[\s_-]+/g, '') === cleanSyn);
            if (foundKey && obj[foundKey] !== undefined && obj[foundKey] !== null && String(obj[foundKey]).trim() !== '') {
                return String(obj[foundKey]).trim();
            }
        }
        return null;
    }

    // Format A: Standard tabular format (Row 0 has headers, Row 1 has data)
    const firstRow = rows[0] || {};
    ORGANIZATION_ATTRIBUTES.forEach(attr => {
        const val = findValueInObject(firstRow, [attr.key, ...attr.synonyms]);
        extracted[attr.key] = val !== null ? val : (attr.defaultValue || "");
    });

    // Format B: Two-column key-value format (Column A: Attribute Name, Column B: Value)
    // If fewer than 5 attributes were found from first row and multiple rows exist, scan down rows
    const extractedCount = Object.values(extracted).filter(v => v !== "").length;
    if (extractedCount < 5 && rows.length > 5) {
        rows.forEach(row => {
            const values = Object.values(row);
            if (values.length >= 2) {
                const rowKey = String(values[0]).trim().toLowerCase().replace(/[\s_-]+/g, '');
                const rowVal = String(values[1]).trim();

                ORGANIZATION_ATTRIBUTES.forEach(attr => {
                    const matchedSyn = [attr.key, ...attr.synonyms].some(s => s.toLowerCase().replace(/[\s_-]+/g, '') === rowKey);
                    if (matchedSyn && rowVal) {
                        extracted[attr.key] = rowVal;
                    }
                });
            }
        });
    }

    // Enforce statutory casing
    if (extracted.Currency) extracted.Currency = extracted.Currency.toUpperCase();
    if (extracted.PAN) extracted.PAN = extracted.PAN.toUpperCase();
    if (extracted.TAN) extracted.TAN = extracted.TAN.toUpperCase();
    if (extracted.CIN_or_LLPIN) extracted.CIN_or_LLPIN = extracted.CIN_or_LLPIN.toUpperCase();
    if (extracted.GSTIN) extracted.GSTIN = extracted.GSTIN.toUpperCase();
    if (extracted.Official_Email) extracted.Official_Email = extracted.Official_Email.toLowerCase();

    return extracted;
}

/**
 * Renders the parsed 21 attributes into the live preview table
 */
function renderParsedAttributesPreview(fileName, sheetName, data) {
    if (parseResultFileName) parseResultFileName.innerText = fileName;
    if (parseResultMeta) parseResultMeta.innerText = `Extracted 21 attributes from '${sheetName}' sheet`;

    const errors = validateOrganizationAttributes(data);
    const isValid = errors.length === 0;

    if (validationStatusBadge) {
        if (isValid) {
            validationStatusBadge.className = 'badge-verified';
            validationStatusBadge.innerHTML = '<i data-lucide="check-circle" style="width: 14px;"></i> All 21 Attributes Validated';
        } else {
            validationStatusBadge.className = 'badge-pending';
            validationStatusBadge.innerHTML = `<i data-lucide="alert-triangle" style="width: 14px;"></i> ${errors.length} Field Issue(s) Detected`;
        }
    }

    if (parsedAttributesTableBody) {
        parsedAttributesTableBody.innerHTML = ORGANIZATION_ATTRIBUTES.map((attr, index) => {
            const val = data[attr.key] || '';
            const isMissingRequired = attr.required && !val;
            
            let statusPill = '';
            if (isMissingRequired) {
                statusPill = '<span style="color: #991b1b; background: #fee2e2; font-weight: 700; padding: 2px 8px; border-radius: 6px; font-size: 0.72rem; border: 1px solid #fecaca;">Missing *</span>';
            } else if (val) {
                statusPill = '<span style="color: #166534; background: #dcfce7; font-weight: 700; padding: 2px 8px; border-radius: 6px; font-size: 0.72rem; border: 1px solid #bbf7d0;">Extracted</span>';
            } else {
                statusPill = '<span style="color: #64748b; background: #f1f5f9; font-weight: 600; padding: 2px 8px; border-radius: 6px; font-size: 0.72rem;">Optional</span>';
            }

            const displayVal = val 
                ? `<span style="font-weight: 600; color: #0f172a;">${escapeHtml(val)}</span>` 
                : `<span style="color: #94a3b8; font-style: italic;">(Empty)</span>`;

            return `
                <tr>
                    <td style="font-weight: 700; color: var(--text-muted);">${index + 1}</td>
                    <td>
                        <strong style="color: #1e293b;">${attr.key}</strong>
                        ${attr.required ? '<span style="color: var(--danger); font-weight: 800;">*</span>' : ''}
                    </td>
                    <td>${displayVal}</td>
                    <td>${statusPill}</td>
                </tr>
            `;
        }).join('');
    }

    if (parseResultsContainer) parseResultsContainer.style.display = 'block';
    if (dropZone) dropZone.style.display = 'none';
    if (window.lucide) lucide.createIcons();
}

/**
 * PRD Section 2: Core Processing & State Update
 * 
 * 1. Save/update record in Firestore under organizations/{orgId}.
 * 2. Update organization state to { orgConfigured: true }.
 * 3. Trigger initial continuous sequential employee ID provisioning (EMP0001) for subsequent onboarding.
 * 4. Redirect Super Admin to main administrative dashboard (admin-dashboard.html).
 */
async function executeOrganizationSetup(attributes21, sourceMethod) {
    const orgId = state.orgId || localStorage.getItem('orgId') || 'org_kylrx';

    console.log(`🚀 Executing Organization Setup via [${sourceMethod}] for orgId: "${orgId}"...`);

    // 1. Construct payload with exact 21 attributes + enterprise system metadata
    const orgPayload = {
        // Exact 21 attributes matching PRD
        Legal_Name: attributes21.Legal_Name,
        Display_Name: attributes21.Display_Name,
        Organization_Type: attributes21.Organization_Type,
        Industry: attributes21.Industry,
        Website: attributes21.Website || '',
        Official_Email: attributes21.Official_Email,
        Official_Phone: attributes21.Official_Phone,
        Country: attributes21.Country,
        State: attributes21.State,
        City: attributes21.City,
        PIN_Code: attributes21.PIN_Code,
        Registered_Address: attributes21.Registered_Address,
        Corporate_Address: attributes21.Corporate_Address,
        Time_Zone: attributes21.Time_Zone,
        Currency: attributes21.Currency,
        Financial_Year_Start: attributes21.Financial_Year_Start,
        PAN: attributes21.PAN,
        TAN: attributes21.TAN,
        CIN_or_LLPIN: attributes21.CIN_or_LLPIN || '',
        GSTIN: attributes21.GSTIN,
        Logo_URL: attributes21.Logo_URL || '',

        // Normalized camelCase mirrors for backwards compatibility
        legalName: attributes21.Legal_Name,
        displayName: attributes21.Display_Name,
        organizationType: attributes21.Organization_Type,
        industry: attributes21.Industry,
        website: attributes21.Website || '',
        officialEmail: attributes21.Official_Email,
        officialPhone: attributes21.Official_Phone,
        country: attributes21.Country,
        state: attributes21.State,
        city: attributes21.City,
        pinCode: attributes21.PIN_Code,
        registeredAddress: attributes21.Registered_Address,
        corporateAddress: attributes21.Corporate_Address,
        timezone: attributes21.Time_Zone,
        currency: attributes21.Currency,
        financialYearStart: attributes21.Financial_Year_Start,
        pan: attributes21.PAN,
        tan: attributes21.TAN,
        cinOrLlpin: attributes21.CIN_or_LLPIN || '',
        gstin: attributes21.GSTIN,
        logoUrl: attributes21.Logo_URL || '',

        // PRD Section 2 Gate State
        orgId: orgId,
        orgConfigured: true,
        initialEmployeeIdProvisioned: true,
        setupSource: sourceMethod,
        configuredAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    };

    // Step 1: Save/update Firestore organizations/{orgId}
    const orgDocRef = doc(db, "organizations", orgId);
    await setDoc(orgDocRef, orgPayload, { merge: true });
    console.log(`✅ Step 1: Organization record saved to Firestore under organizations/${orgId}`);

    // Step 2: Trigger continuous sequential employee ID provisioning (starting at EMP0001)
    // Writing counter document at organizations/{orgId}/counters/employees with currentSequence: 0
    // guarantees subsequent allocation begins atomically at EMP0001
    const counterDocRef = doc(db, "organizations", orgId, "counters", "employees");
    await setDoc(counterDocRef, {
        currentSequence: 0,
        prefix: 'EMP',
        padLength: 4,
        nextIdPreview: 'EMP0001',
        initialProvisioned: true,
        orgId: orgId,
        initializedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    }, { merge: true });
    console.log(`🔢 Step 2: Initialized continuous sequential Employee ID counter (EMP0001) for org ${orgId}`);

    // Step 3: Update local storage and UI status
    localStorage.setItem('orgConfigured', 'true');
    localStorage.setItem('orgId', orgId);
    localStorage.setItem('companyName', orgPayload.Display_Name || orgPayload.Legal_Name);

    if (statusBadge) {
        statusBadge.className = 'badge-verified';
        statusBadge.innerHTML = '<i data-lucide="check-circle" style="width: 14px;"></i> Organization Configured (orgConfigured: true)';
        if (window.lucide) lucide.createIcons();
    }

    // Step 4: Alert Super Admin and redirect to main administrative dashboard
    window.customAlertCallback = () => {
        window.location.href = 'admin-dashboard.html';
    };

    window.showCustomAlert(
        "Organization Configured Successfully",
        `Legal identity for "${orgPayload.Legal_Name}" is verified and active. Continuous sequential Employee ID provisioning (EMP0001) has been provisioned.\n\nRedirecting to Admin Console...`,
        "success"
    );

    setTimeout(() => {
        window.location.href = 'admin-dashboard.html';
    }, 2200);
}

/**
 * Sets up sidebar logout
 */
function setupLogout() {
    if (logoutBtn) {
        logoutBtn.onclick = (e) => {
            e.preventDefault();
            localStorage.clear();
            auth.signOut().then(() => {
                window.location.href = 'index.html';
            });
        };
    }
}

/**
 * Custom Alert Modal Controller
 */
window.customAlertCallback = null;

window.showCustomAlert = function(title, msg, type = 'success') {
    const overlay = document.getElementById('customAlertOverlay');
    const titleEl = document.getElementById('customAlertTitle');
    const msgEl = document.getElementById('customAlertMsg');
    const iconEl = document.getElementById('customAlertIcon');

    if (titleEl) titleEl.innerText = title;
    if (msgEl) msgEl.innerText = msg;
    if (iconEl) {
        if (type === 'error') {
            iconEl.setAttribute('data-lucide', 'alert-triangle');
            if (iconEl.parentElement) {
                iconEl.parentElement.style.background = '#fee2e2';
                iconEl.parentElement.style.color = '#ef4444';
            }
        } else {
            iconEl.setAttribute('data-lucide', 'check-circle');
            if (iconEl.parentElement) {
                iconEl.parentElement.style.background = '#dcfce7';
                iconEl.parentElement.style.color = '#16a34a';
            }
        }
        if (window.lucide) lucide.createIcons();
    }
    if (overlay) overlay.style.display = 'flex';
};

window.closeCustomAlert = function() {
    const overlay = document.getElementById('customAlertOverlay');
    if (overlay) overlay.style.display = 'none';
    if (typeof window.customAlertCallback === 'function') {
        const cb = window.customAlertCallback;
        window.customAlertCallback = null;
        cb();
    }
};

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
