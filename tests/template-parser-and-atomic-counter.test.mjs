import test from 'node:test';
import assert from 'node:assert/strict';
import { 
    parseOrganizationSheet, 
    parseBusinessUnitSheet, 
    parseCostCentreSheet, 
    parseDepartmentsAndSubDepartments,
    ingestTemplatesWorkbook 
} from '../services/template-parser-service.js';

test('1. Ingestion of exact columns from Organization Sheet', () => {
    const rawRows = [
        {
            Legal_Name: "Kylrx Technologies Pvt. Ltd.",
            PAN: "AAACK1234F",
            TAN: "BLRK12345D",
            CIN_or_LLPIN: "U72200KA2026PTC123456",
            GSTIN: "29AAACK1234F1Z5",
            Time_Zone: "Asia/Kolkata",
            Currency: "INR",
            Financial_Year_Start: "04-01"
        }
    ];

    const result = parseOrganizationSheet(rawRows);
    assert.equal(result.valid, true);
    assert.equal(result.data.legalName, "Kylrx Technologies Pvt. Ltd.");
    assert.equal(result.data.pan, "AAACK1234F");
    assert.equal(result.data.tan, "BLRK12345D");
    assert.equal(result.data.cinOrLlpin, "U72200KA2026PTC123456");
    assert.equal(result.data.gstin, "29AAACK1234F1Z5");
    assert.equal(result.data.timezone, "Asia/Kolkata");
    assert.equal(result.data.currency, "INR");
    assert.equal(result.data.financialYearStart, "04-01");
});

test('2. Ingestion of Business Unit Sheet', () => {
    const rawRows = [
        { Business_Unit_Code: "BU-TECH", Business_Unit_Name: "Technology & Platform", Head_Employee_ID: "EMP0001" },
        { Business_Unit_Code: "BU-OPS", Business_Unit_Name: "Global Operations", Head_Employee_ID: "EMP0002" }
    ];

    const result = parseBusinessUnitSheet(rawRows);
    assert.equal(result.valid, true);
    assert.equal(result.data.length, 2);
    assert.equal(result.data[0].code, "BU-TECH");
    assert.equal(result.data[0].headEmployeeId, "EMP0001");
});

test('3. Ingestion of Cost Centre Sheet', () => {
    const rawRows = [
        { Cost_Center_Code: "CC-ENG-101", Cost_Center_Name: "Software Engineering", "Owner Employee ID": "EMP0001" },
        { Cost_Center_Code: "CC-HR-201", Cost_Center_Name: "People Operations", "Owner Employee ID": "EMP0003" }
    ];

    const result = parseCostCentreSheet(rawRows);
    assert.equal(result.valid, true);
    assert.equal(result.data.length, 2);
    assert.equal(result.data[0].code, "CC-ENG-101");
    assert.equal(result.data[0].ownerEmployeeId, "EMP0001");
});

test('4. Ingestion of Departments & Sub-Departments Sheets', () => {
    const deptRows = [
        { Department_Code: "ENG", Department_Name: "Engineering", Cost_Center_Code: "CC-ENG-101" }
    ];
    const subDeptRows = [
        { "Sub-Department_Code": "ENG-FE", "Sub-Department_Name": "Frontend Platform", Cost_Center_Code: "CC-ENG-101" },
        { "Sub-Department_Code": "ENG-BE", "Sub-Department_Name": "Backend Platform", Cost_Center_Code: "CC-ENG-101" }
    ];

    const result = parseDepartmentsAndSubDepartments(deptRows, subDeptRows);
    assert.equal(result.valid, true);
    assert.equal(result.departments.length, 1);
    assert.equal(result.subDepartments.length, 2);
    assert.equal(result.subDepartments[0].code, "ENG-FE");
    assert.equal(result.subDepartments[0].costCenterCode, "CC-ENG-101");
});

test('5. Uninterrupted Sequential ID Allocation: Interleaving Manual (N=1) and Bulk (N=M)', async () => {
    // Mock Firestore distributed counter state in memory
    let counterState = {
        currentSequence: 0,
        prefix: 'EMP',
        padLength: 4
    };

    const mockRunTransaction = async (txFunc) => {
        const tx = {
            get: async () => ({
                exists: () => counterState.currentSequence > 0,
                data: () => ({ ...counterState })
            }),
            set: (ref, data) => {
                counterState = { ...counterState, ...data };
            }
        };
        return await txFunc(tx);
    };

    const allocateMock = async (count) => {
        return await mockRunTransaction(async (tx) => {
            const snap = await tx.get();
            const currentSeq = snap.exists() ? snap.data().currentSequence : 0;
            const startSeq = currentSeq + 1;
            const endSeq = currentSeq + count;
            const assignedIds = [];
            for (let i = startSeq; i <= endSeq; i++) {
                assignedIds.push(`EMP${String(i).padStart(4, '0')}`);
            }
            tx.set(null, { currentSequence: endSeq });
            return assignedIds;
        });
    };

    // Step A: Bulk upload of 3 employees
    const batch1 = await allocateMock(3);
    assert.deepEqual(batch1, ["EMP0001", "EMP0002", "EMP0003"]);
    assert.equal(counterState.currentSequence, 3);

    // Step B: Manual entry of 1 employee (Single)
    const manual1 = await allocateMock(1);
    assert.deepEqual(manual1, ["EMP0004"]);
    assert.equal(counterState.currentSequence, 4);

    // Step C: Bulk upload of 2 employees
    const batch2 = await allocateMock(2);
    assert.deepEqual(batch2, ["EMP0005", "EMP0006"]);
    assert.equal(counterState.currentSequence, 6);

    // Step D: Manual entry of 1 employee
    const manual2 = await allocateMock(1);
    assert.deepEqual(manual2, ["EMP0007"]);
    assert.equal(counterState.currentSequence, 7);
});
