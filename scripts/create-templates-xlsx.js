/**
 * Script to create the official 27-sheet Templates.xlsx file in assets/Templates.xlsx
 */
const fs = require('fs');
const path = require('path');

// Load XLSX from local utils
const XLSX = require('../utils/xlsx.full.min.js');

const assetsDir = path.resolve(__dirname, '../assets');
if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
}

const wb = XLSX.utils.book_new();

// 1. Organization (Exact 21 columns matching PRD)
const organizationHeaders = [
    [
        "Legal_Name", "Display_Name", "Organization_Type", "Industry", "Website", 
        "Official_Email", "Official_Phone", "Country", "State", "City", 
        "PIN_Code", "Registered_Address", "Corporate_Address", "Time_Zone", "Currency", 
        "Financial_Year_Start", "PAN", "TAN", "CIN_or_LLPIN", "GSTIN", "Logo_URL"
    ],
    [
        "Kylrx Technologies Pvt. Ltd.", "Kylrx AI", "Private Limited", "Technology & HR Automation", "https://kylrx.ai",
        "info@kylrx.ai", "+91 80 4123 4567", "India", "Karnataka", "Bengaluru",
        "560103", "Outer Ring Road, Bellandur, Bengaluru, Karnataka 560103", "Outer Ring Road, Bellandur, Bengaluru, Karnataka 560103", "Asia/Kolkata", "INR",
        "04-01", "AAACK1234F", "BLRK12345D", "U72200KA2026PTC123456", "29AAACK1234F1Z5", "https://kylrx.ai/logo.jpg"
    ]
];
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(organizationHeaders), "Organization");

// 2. Business Unit
const buHeaders = [
    ["Business_Unit_Code", "Business_Unit_Name", "Head_Employee_ID"],
    ["BU-TECH", "Technology & Product Engineering", "EMP0001"],
    ["BU-OPS", "Global Operations & Customer Success", "EMP0002"],
    ["BU-CORP", "Corporate Finance & Human Resources", "EMP0003"]
];
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(buHeaders), "Business Unit");

// 3. Cost Centre
const ccHeaders = [
    ["Cost_Center_Code", "Cost_Center_Name", "Owner Employee ID"],
    ["CC-ENG-101", "Core Software Engineering", "EMP0001"],
    ["CC-AI-102", "Artificial Intelligence R&D", "EMP0001"],
    ["CC-HR-201", "People Operations & HRMS", "EMP0003"],
    ["CC-FIN-301", "Treasury & Statutory Compliance", "EMP0003"]
];
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ccHeaders), "Cost Centre");

// 4. Departments
const deptHeaders = [
    ["Department_Code", "Department_Name", "Cost_Center_Code"],
    ["ENG", "Engineering & Architecture", "CC-ENG-101"],
    ["AI-LABS", "AI Research & Model Engineering", "CC-AI-102"],
    ["HR", "Human Resources & Payroll", "CC-HR-201"],
    ["FIN", "Finance & Accounts", "CC-FIN-301"]
];
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(deptHeaders), "Departments");

// 5. Sub-Departments
const subDeptHeaders = [
    ["Sub-Department_Code", "Sub-Department_Name", "Cost_Center_Code"],
    ["ENG-FRONTEND", "Frontend Platform & UI", "CC-ENG-101"],
    ["ENG-BACKEND", "Cloud Architecture & APIs", "CC-ENG-101"],
    ["HR-COMPLIANCE", "Statutory Compliance & ECR", "CC-HR-201"],
    ["FIN-PAYROLL", "Payroll Disbursement & Banking", "CC-FIN-301"]
];
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(subDeptHeaders), "Sub-Departments");

// 6. Designations
const designations = [
    ["Designation_Code", "Designation_Name", "Department_Code"],
    ["DES-SE", "Software Engineer", "ENG"],
    ["DES-SSE", "Senior Software Engineer", "ENG"],
    ["DES-EM", "Engineering Manager", "ENG"],
    ["DES-HRO", "HR Operations Specialist", "HR"]
];
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(designations), "Designations");

// 7. Grades_Bands
const grades = [
    ["Grade_Band", "Description", "Min_CTC", "Max_CTC"],
    ["L1", "Associate Level", 400000, 800000],
    ["L2", "Professional Level", 800000, 1600000],
    ["L3", "Senior Level", 1600000, 3000000],
    ["L4", "Leadership / Executive", 3000000, 6000000]
];
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(grades), "Grades_Bands");

// 8. Locations_Branches
const locations = [
    ["Location_Code", "Location_Name", "State", "Country", "Is_Headquarters"],
    ["LOC-BLR", "Bangalore Tech Park", "Karnataka", "India", "YES"],
    ["LOC-MUM", "Mumbai Commercial Hub", "Maharashtra", "India", "NO"]
];
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(locations), "Locations_Branches");

// 9. Employment_Types
const empTypes = [
    ["Type_Code", "Type_Name", "Probation_Days", "Notice_Days"],
    ["FT", "Full-Time Permanent", 90, 60],
    ["CT", "Fixed-Term Contract", 30, 30],
    ["IN", "Internship", 0, 15]
];
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(empTypes), "Employment_Types");

// 10. Employees_Master
const empMaster = [
    ["Official Email", "Employee Name", "Department", "Designation", "Reporting Manager", "Joining Date", "Role", "Business Unit", "Sub-Department"],
    ["superadmin@kylrx.ai", "Super Admin", "Executive", "Executive Director", "Self", "2026-01-01", "super_admin", "Corporate", "Executive"],
    ["john.doe@example.com", "John Doe", "Engineering", "Engineering Manager", "Super Admin", "2026-01-15", "manager", "Technology", "Cloud Architecture & APIs"],
    ["marry@gmail.com", "Marry Doe", "Engineering", "Software Engineer", "John Doe", "2026-02-01", "employee", "Technology", "Frontend Platform & UI"]
];
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(empMaster), "Employees_Master");

// 11-27 Standard Enterprise Setup Sheets
const remainingSheets = [
    { name: "Salary_Structures", headers: ["Structure_Name", "Basic_Pct", "HRA_Pct", "Special_Allowance_Pct", "PF_Applicable", "ESIC_Applicable"] },
    { name: "Bank_Accounts", headers: ["Bank_Name", "Account_Number", "IFSC_Code", "Account_Type", "Branch_Name"] },
    { name: "PF_Configuration", headers: ["Establishment_Code", "Employee_Share_Pct", "Employer_Share_Pct", "Wage_Ceiling", "Admin_Charges_Pct"] },
    { name: "ESIC_Configuration", headers: ["Employer_Code", "Employee_Contribution_Pct", "Employer_Contribution_Pct", "Wage_Ceiling_Monthly"] },
    { name: "PT_Configuration", headers: ["State", "Salary_Slab_Min", "Salary_Slab_Max", "Monthly_PT_Amount"] },
    { name: "Gratuity_Configuration", headers: ["Eligibility_Years", "Calculation_Days_Per_Month", "Max_Exemption_Limit"] },
    { name: "Leave_Types", headers: ["Leave_Code", "Leave_Name", "Annual_Quota", "Carry_Forward_Limit", "Is_Paid"] },
    { name: "Holiday_Calendar", headers: ["Holiday_Name", "Date", "Location_Code", "Is_Mandatory"] },
    { name: "Shift_Roster", headers: ["Shift_Code", "Shift_Name", "Start_Time", "End_Time", "Grace_Period_Minutes"] },
    { name: "Attendance_Rules", headers: ["Weekly_Off_Policy", "Late_Deduction_Threshold", "Half_Day_Hours", "Full_Day_Hours"] },
    { name: "Overtime_Rules", headers: ["Multiplier", "Daily_Max_Hours", "Approval_Required"] },
    { name: "Appraisal_Cycles", headers: ["Cycle_Name", "Start_Date", "End_Date", "Frequency"] },
    { name: "Assets_Inventory", headers: ["Asset_Tag", "Asset_Type", "Model", "Serial_Number", "Assigned_To"] },
    { name: "Exit_Policies", headers: ["Policy_Name", "Notice_Period_Days", "Clearance_Departments", "Buyout_Allowed"] },
    { name: "Document_Categories", headers: ["Category_Code", "Category_Name", "Is_Mandatory_Onboarding"] },
    { name: "Notification_Matrix", headers: ["Event_Type", "Notify_Employee", "Notify_Manager", "Notify_Admin", "Channel"] },
    { name: "Statutory_Deductions", headers: ["Deduction_Type", "Exemption_Section", "Calculation_Type", "Frequency"] }
];

remainingSheets.forEach(s => {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([s.headers]), s.name);
});

const outputPath = path.join(assetsDir, 'Templates.xlsx');
const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
fs.writeFileSync(outputPath, buffer);
const rootOutputPath = path.resolve(__dirname, '../Templates.xlsx');
fs.writeFileSync(rootOutputPath, buffer);
console.log(`✅ Successfully generated official 27-sheet Templates.xlsx at: ${outputPath} and ${rootOutputPath}`);
console.log(`Total sheets in template: ${wb.SheetNames.length}`);
