/**
 * Production gap verification — run: npm test
 * Covers unit checks + config presence. Firebase deploy is manual.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

let passed = 0;
let failed = 0;

function assert(cond, msg) {
    if (!cond) throw new Error(msg);
}

function ok(label) {
    passed++;
    console.log(`  ✓ ${label}`);
}

function fail(label, err) {
    failed++;
    console.error(`  ✗ ${label}: ${err}`);
}

function readFile(rel) {
    return fs.readFileSync(path.join(root, rel), "utf8");
}

function fileExists(rel) {
    return fs.existsSync(path.join(root, rel));
}

console.log("\n=== Production Gap Verification ===\n");

// ── 1. Firebase config files ───────────────────────────────────────
console.log("1. Firebase rules & indexes");
try {
    assert(fileExists("firestore.rules"), "firestore.rules missing");
    assert(fileExists("storage.rules"), "storage.rules missing");
    assert(fileExists("firestore.indexes.json"), "firestore.indexes.json missing");
    const rules = readFile("firestore.rules");
    assert(rules.includes("payroll_documents"), "firestore.rules missing payroll_documents");
    assert(rules.includes("candidates"), "firestore.rules missing candidates");
    assert(rules.includes("recruitment_events"), "firestore.rules missing recruitment_events");
    const storage = readFile("storage.rules");
    assert(storage.includes("payroll/payslips"), "storage.rules missing payslip path");
    const indexes = JSON.parse(readFile("firestore.indexes.json"));
    const payrollIdx = indexes.indexes?.find((i) =>
        i.collectionGroup === "payroll_documents" &&
        i.fields?.some((f) => f.fieldPath === "employeeId") &&
        i.fields?.some((f) => f.fieldPath === "createdAt")
    );
    assert(payrollIdx, "composite index employeeId+createdAt missing");
    const firebaseJson = JSON.parse(readFile("firebase.json"));
    assert(firebaseJson.storage?.rules === "storage.rules", "firebase.json missing storage rules");
    ok("Firebase rules, storage rules, and composite index files present");
} catch (e) {
    fail("Firebase config", e.message);
}

// ── 2. Bank CSV export ─────────────────────────────────────────────
console.log("\n2. Bank CSV export");
try {
    const { enrichEmployeeBankDetails, buildBankTransferRows } = await import("../bank-export-service.js");
    const emp = enrichEmployeeBankDetails(
        { id: "emp1", name: "Test User", net: 50000 },
        { accountNumber: "1234567890", routingCode: "HDFC0001234", bankName: "HDFC" }
    );
    assert(emp.bankAccount === "1234567890", "bank account not mapped");
    assert(emp.ifscCode === "HDFC0001234", "IFSC not mapped");
    assert(emp.bankComplete === true, "bankComplete should be true");
    const rows = buildBankTransferRows([emp], "June 2026");
    assert(rows[0].paymentMode === "NEFT", "NEFT column missing");
    assert(rows[0].bankName === "HDFC", "bank name missing");
    ok("Bank export maps payroll profile fields and NEFT columns");
} catch (e) {
    fail("Bank CSV export", e.message);
}

// ── 3. Payslip PDF module (browser-only imports — verify file exports) ──
console.log("\n3. Payslip PDF generation");
try {
    const payslip = readFile("payslip-pdf-service.js");
    assert(payslip.includes("generatePayslipPdfBlob"), "generatePayslipPdfBlob missing");
    assert(payslip.includes("uploadPayslipPdf"), "uploadPayslipPdf missing");
    assert(payslip.includes("fetchSignedPayslipUrl"), "fetchSignedPayslipUrl missing");
    assert(payslip.includes("payroll/payslips"), "storage path missing");
    const payrollDoc = readFile("payroll-doc-service.js");
    assert(payrollDoc.includes("storageUrl"), "payroll-doc-service not storing storageUrl");
    ok("Payslip PDF service exports and payroll-doc integration");
} catch (e) {
    fail("Payslip PDF generation", e.message);
}

// ── 4. Recruitment / onboarding ──────────────────────────────────
console.log("\n4. Recruitment & onboarding service");
try {
    const recruitment = readFile("recruitment-service.js");
    assert(recruitment.includes("subscribeCandidates"), "subscribeCandidates missing");
    assert(recruitment.includes("startOnboarding"), "startOnboarding missing");
    assert(recruitment.includes("recruitment_events"), "recruitment_events missing");
    assert(recruitment.includes("interviews"), "interviews subcollection missing");
    const dashboard = readFile("hrms-dashboard.html");
    assert(dashboard.includes("triggerOnboarding"), "Start Onboarding UI missing");
    assert(dashboard.includes("openInterviewModal"), "interview modal missing");
    ok("Recruitment service and HRMS workflow UI wired");
} catch (e) {
    fail("Recruitment & onboarding", e.message);
}

// ── 5. Payroll API route ───────────────────────────────────────────
console.log("\n5. Payroll signed-download API");
try {
    assert(fileExists("routes/payroll.js"), "routes/payroll.js missing");
    const payrollRoute = readFile("routes/payroll.js");
    assert(payrollRoute.includes("download-url"), "signed download route missing");
    assert(payrollRoute.includes("employeeId"), "employeeId validation missing");
    const server = readFile("server.js");
    assert(server.includes("/api/payroll"), "payroll route not mounted in server.js");
    ok("Signed payslip download API route exists");
} catch (e) {
    fail("Payroll API", e.message);
}

// ── 6. Deploy reminder ─────────────────────────────────────────────
console.log("\n6. Manual steps (not auto-tested)");
console.log("  → firebase deploy --only firestore:rules,firestore:indexes,storage");
console.log("  → Ensure FIREBASE_SERVICE_ACCOUNT is set for signed URL API");
console.log("  → HR users must sign in with Firebase Auth for write access under new rules");
console.log("  → E2E in browser: HRMS payslip PDF → employee-docs download → bank CSV → Start Onboarding");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
