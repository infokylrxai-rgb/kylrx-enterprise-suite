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
    ["Business_Unit_Code", "Business_Unit_Name", "Head_Employee_ID", "Active"],
    ["BU-TECH", "Technology & Product Engineering", "EMP0001", "Yes"],
    ["BU-OPS", "Global Operations & Customer Success", "EMP0002", "Yes"],
    ["BU-CORP", "Corporate Finance & Human Resources", "EMP0003", "Yes"],
    ["BU_CORP_01", "Corporate Operations", "EMP0003", "Yes"]
];
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(buHeaders), "Business Unit");

// 3. Cost Center / Cost Centre (PRD Section 1, 10, & 13)
const ccHeaders = [
    ["Cost_Center_Code", "Cost_Center_Name", "Owner Employee ID", "Active"],
    ["CC_ENG_01", "QA & Engineering Operations", "EMP0002", "Yes"],
    ["CC_ENG_DEV", "Software Engineering & R&D", "EMP0002", "Yes"],
    ["CC-ENG-101", "Core Software Engineering", "EMP0001", "Yes"],
    ["CC-AI-102", "Artificial Intelligence R&D", "EMP0001", "Yes"],
    ["CC-HR-201", "People Operations & HRMS", "EMP0003", "Yes"],
    ["CC-FIN-301", "Treasury & Statutory Compliance", "EMP0004", "Yes"],
    ["CC-OPS-401", "Global Operations & Customer Support", "EMP0005", "Yes"]
];
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ccHeaders), "Cost Center");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ccHeaders), "Cost Centre");

// 4. Departments
const deptHeaders = [
    ["Department_Code", "Department_Name", "Cost_Center_Code"],
    ["DEPT_ENG", "QA & Engineering", "CC_ENG_01"],
    ["ENG", "Engineering & Architecture", "CC-ENG-101"],
    ["AI-LABS", "AI Research & Model Engineering", "CC-AI-102"],
    ["HR", "Human Resources & Payroll", "CC-HR-201"],
    ["FIN", "Finance & Accounts", "CC-FIN-301"]
];
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(deptHeaders), "Departments");

// 5. Sub-Departments (PRD §1, §10, & §13)
const subDeptHeaders = [
    ["Sub-Department_Code", "Sub-Department_Name", "Sub-Department_Head_Employee_ID", "Cost_Center_Code", "Active"],
    ["SUB_QA_AUTO", "QA & Automation", "Same as Department Head", "CC_ENG_01", "Yes"],
    ["ENG-FRONTEND", "Frontend Platform & UI", "EMP0006", "CC-ENG-101", "Yes"],
    ["ENG-BACKEND", "Cloud Architecture & APIs", "EMP0001", "CC-ENG-101", "Yes"],
    ["ENG-QA", "Quality Assurance & Testing", "Same as Department Head", "CC-ENG-101", "Yes"],
    ["HR-COMPLIANCE", "Statutory Compliance & ECR", "EMP0003", "CC-HR-201", "Yes"],
    ["FIN-PAYROLL", "Payroll Disbursement & Banking", "Same as Department Head", "CC-FIN-301", "Yes"],
    ["SUB_ENG_API", "Platform & API Services", "EMP0007", "CC_ENG_DEV", "Yes"]
];
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(subDeptHeaders), "Sub-Departments");

// 6. Shifts & Week-offs (Exact 13 Attributes matching PRD Sections 1, 13, & 16)
const shiftHeaders = [
    [
        "Shift_Code", "Shift_Name", "Start_Time", "End_Time", "Break_Minutes",
        "Grace_In_Minutes", "Grace_Out_Minutes", "Half_Day_Minutes", "Full_Day_Minutes",
        "Night_Shift", "Overtime_Eligible", "Weekly_Off_Pattern", "Active"
    ],
    ["SH_GEN_01", "General Corporate Shift", "09:30", "18:30", 60, 15, 15, 240, 480, "No", "Yes", "Sun", "Yes"],
    ["SHIFT-GEN", "Standard Day Shift", "09:00", "18:00", 60, 15, 15, 240, 480, "No", "Yes", "Sat,Sun", "Yes"],
    ["SH_MORN_01", "Morning Production Shift", "06:00", "14:30", 30, 10, 10, 210, 450, "No", "Yes", "Sun", "Yes"],
    ["SH_EVE_01", "Evening Technical Shift", "14:00", "22:30", 45, 15, 15, 240, 465, "No", "Yes", "Sun", "Yes"],
    ["SH_NIGHT_01", "Overnight Mission-Critical Shift", "22:00", "06:30", 45, 15, 15, 240, 465, "Yes", "Yes", "Sat,Sun", "Yes"]
];
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(shiftHeaders), "Shifts & Week-offs");

// 7. Designations
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

// 9. Employment_Types & Employee Type (PRD §§ 1, 10, & 13)
const empTypes = [
    ["Type_Code", "Type_Name", "Probation_Days", "Notice_Days"],
    ["FT", "Full-Time Permanent", 90, 60],
    ["CT", "Fixed-Term Contract", 30, 30],
    ["IN", "Internship", 0, 15]
];
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(empTypes), "Employment_Types");

// Employee Type (Exact 7 Attributes matching PRD Sections 1, 10, & 13)
const employeeTypeHeaders = [
    [
        "Category_Code", "Category_Name", "Employment_Type", "Worker_Type",
        "Probation_Days", "Notice_Period_Days", "Active"
    ],
    ["CAT_FT_REG", "Full-Time Regular", "Permanent", "White Collar", 180, 60, "Yes"],
    ["CAT_FT_EXEC", "Executive Leadership", "Permanent", "White Collar", 90, 90, "Yes"],
    ["CAT_CON_TVC", "Contractor / TVC", "Contract", "Off-Roll", 30, 30, "Yes"],
    ["CAT_INT_GRAD", "Graduate Intern / Apprentice", "Intern", "On-Roll", 0, 15, "Yes"],
    ["CAT_TEMP_OPS", "Temporary & Seasonal Staff", "Temporary", "Blue Collar", 15, 15, "Yes"],
    ["CAT_PLANT_WKR", "Plant & Manufacturing Operative", "Permanent", "Blue Collar", 180, 30, "Yes"]
];
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(employeeTypeHeaders), "Employee Type");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(employeeTypeHeaders), "Employee_Type");

// 10. Employees_Master
const empMaster = [
    ["Official Email", "Employee Name", "Department", "Designation", "Reporting Manager", "Joining Date", "Role", "Business Unit", "Sub-Department"],
    ["superadmin@kylrx.ai", "Super Admin", "Executive", "Executive Director", "Self", "2026-01-01", "super_admin", "Corporate", "Executive"],
    ["john.doe@example.com", "John Doe", "Engineering", "Engineering Manager", "Super Admin", "2026-01-15", "manager", "Technology", "Cloud Architecture & APIs"],
    ["marry@gmail.com", "Marry Doe", "Engineering", "Software Engineer", "John Doe", "2026-02-01", "employee", "Technology", "Frontend Platform & UI"]
];
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(empMaster), "Employees_Master");

// Attendance Rules (Exact 13 Attributes matching PRD Sections 1, 15, & 16)
const attendancePolicyHeaders = [
    [
        "Attendance_Policy_Code", "Policy_Name", "Late_After_Minutes", "Early_Leaving_Grace_Minute",
        "Absent_After_Hours", "Regularization_Allowed", "Regularization_Window_Days", "WFH_Allowed",
        "OT_Minimum_Minutes", "OT_Approval_Required", "GeoFence_Required", "IP_Restricted", "Active"
    ],
    ["POL_STD_CORP", "Standard Corporate Policy", 15, 10, 4, "Yes", 7, "Yes", 60, "Yes", "No", "No", "Yes"],
    ["POL_FACTORY_OPS", "Manufacturing & Plant Operations", 5, 5, 2, "Yes", 3, "No", 30, "Yes", "Yes", "Yes", "Yes"],
    ["POL_TECH_FLEX", "Engineering & R&D Flex Policy", 30, 15, 5, "Yes", 14, "Yes", 60, "No", "No", "No", "Yes"],
    ["POL_SECURE_HQ", "Corporate Security & Finance Strict", 10, 5, 3, "Yes", 5, "No", 60, "Yes", "Yes", "Yes", "Yes"]
];
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(attendancePolicyHeaders), "Attendance Rules");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(attendancePolicyHeaders), "Attendance_Rules");

// Employee Finance Details (Exact 17 Attributes matching PRD Sections 1, 4, & 13)
const employeeFinanceHeaders = [
    [
        "Employee_ID",
        "Account_Holder_Name",
        "Bank_Name",
        "Branch_Name",
        "Account_Number",
        "IFSC",
        "Account_Type",
        "Is_Primary",
        "Effective_From",
        "UAN",
        "UAN No (If Applicable)",
        "ESIC",
        "ESIC No (If Applicable)",
        "NPS",
        "NPS No (If Applicable)",
        "Gratuity",
        "Gratuity No (If Applicable)"
    ],
    [
        "EMP0001",
        "Super Admin",
        "HDFC Bank",
        "Koramangala, Bengaluru",
        "50100234567890",
        "HDFC0000053",
        "Salary",
        "Yes",
        "2026-01-01",
        "Yes",
        "100904829102",
        "Yes",
        "3100482910",
        "No",
        "",
        "Yes",
        "GRAT-2026-001"
    ],
    [
        "EMP0002",
        "John Doe",
        "ICICI Bank",
        "Indiranagar, Bengaluru",
        "001101234567",
        "ICIC0000011",
        "Salary",
        "Yes",
        "2026-01-15",
        "Yes",
        "100904829103",
        "No",
        "",
        "Yes",
        "110012345678",
        "Yes",
        "GRAT-2026-002"
    ],
    [
        "EMP0003",
        "Marry Doe",
        "State Bank of India",
        "MG Road, Bengaluru",
        "20123456789",
        "SBIN0000813",
        "Savings",
        "Yes",
        "2026-02-01",
        "Yes",
        "100904829104",
        "Yes",
        "3100482911",
        "No",
        "",
        "Yes",
        "GRAT-2026-003"
    ]
];
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(employeeFinanceHeaders), "Employee Finance Deatils");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(employeeFinanceHeaders), "Employee Finance Details");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(employeeFinanceHeaders), "Employee_Finance_Details");

// 9. Exact 9 Columns for 'Salary Stcruture' (PRD Sections 1 & 4)
const salaryStructureHeaders = [
    [
        "Employee_ID",
        "Effective_From",
        "Pay_Frequency",
        "Salary_Structure_Code",
        "Component_Code",
        "Amount",
        "Percentage",
        "Calculation_Basis",
        "Active"
    ],
    // EMP0001 (Monthly Gross = 100,000, Annual CTC = 1,200,000)
    [
        "EMP0001",
        "2026-01-01",
        "Monthly",
        "STRUC_ENG_L2",
        "BASIC",
        50000,
        "",
        "FLAT",
        "Yes"
    ],
    [
        "EMP0001",
        "2026-01-01",
        "Monthly",
        "STRUC_ENG_L2",
        "HRA",
        "",
        50,
        "BASIC",
        "Yes"
    ],
    [
        "EMP0001",
        "2026-01-01",
        "Monthly",
        "STRUC_ENG_L2",
        "SPECIAL_ALLOW",
        25000,
        "",
        "FLAT",
        "Yes"
    ],
    // EMP0002 (Monthly Gross = 75,000, Annual CTC = 900,000)
    [
        "EMP0002",
        "2026-01-15",
        "Monthly",
        "STRUC_ENG_L1",
        "BASIC",
        40000,
        "",
        "FLAT",
        "Yes"
    ],
    [
        "EMP0002",
        "2026-01-15",
        "Monthly",
        "STRUC_ENG_L1",
        "HRA",
        "",
        50,
        "BASIC",
        "Yes"
    ],
    [
        "EMP0002",
        "2026-01-15",
        "Monthly",
        "STRUC_ENG_L1",
        "SPECIAL_ALLOW",
        15000,
        "",
        "FLAT",
        "Yes"
    ],
    // EMP0003 (Monthly Gross = 60,000, Annual CTC = 720,000)
    [
        "EMP0003",
        "2026-02-01",
        "Monthly",
        "STRUC_OPERATIONS",
        "BASIC",
        35000,
        "",
        "FLAT",
        "Yes"
    ],
    [
        "EMP0003",
        "2026-02-01",
        "Monthly",
        "STRUC_OPERATIONS",
        "HRA",
        "",
        40,
        "BASIC",
        "Yes"
    ],
    [
        "EMP0003",
        "2026-02-01",
        "Monthly",
        "STRUC_OPERATIONS",
        "SPECIAL_ALLOW",
        11000,
        "",
        "FLAT",
        "Yes"
    ]
];

XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(salaryStructureHeaders), "Salary Stcruture");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(salaryStructureHeaders), "Salary Structure");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(salaryStructureHeaders), "Salary_Structure");

// 10. Standard Payroll Components Sheet (Exact 13 Attributes matching PRD Sections 1 & 4)
const payrollComponentsHeaders = [
    [
        "Component_Code",
        "Component_Name",
        "Component_Type",
        "Calculation_Method",
        "Value_or_Percentage",
        "Percentage_Basis",
        "Taxable",
        "PF_Applicable",
        "ESI_Applicable",
        "PT_Applicable",
        "TDS_Applicable",
        "Prorate_On_LOP",
        "Active"
    ],
    ["BASIC", "Basic Salary", "Earning", "Flat_Amount", 50000, "", "Yes", "Yes", "Yes", "Yes", "Yes", "Yes", "Yes"],
    ["HRA", "House Rent Allowance", "Earning", "Percentage", 50, "BASIC", "Yes", "No", "Yes", "Yes", "Yes", "Yes", "Yes"],
    ["SPECIAL_ALLOW", "Special Allowance", "Earning", "Flat_Amount", 25000, "", "Yes", "No", "Yes", "Yes", "Yes", "Yes", "Yes"],
    ["CONVEYANCE", "Conveyance Allowance", "Earning", "Flat_Amount", 1600, "", "No", "No", "No", "No", "No", "Yes", "Yes"],
    ["MEDICAL_ALLOW", "Medical Allowance", "Earning", "Flat_Amount", 1250, "", "No", "No", "No", "No", "No", "Yes", "Yes"],
    ["VARIABLE_PAY", "Performance Variable Pay", "Earning", "Flat_Amount", 15000, "", "Yes", "No", "Yes", "Yes", "Yes", "No", "Yes"],
    ["PF_EE", "Provident Fund (Employee)", "Deduction", "Percentage", 12, "BASIC", "No", "Yes", "No", "No", "No", "Yes", "Yes"],
    ["ESI_EE", "ESIC (Employee)", "Deduction", "Percentage", 0.75, "GROSS", "No", "No", "Yes", "No", "No", "Yes", "Yes"],
    ["PT", "Professional Tax", "Deduction", "Flat_Amount", 200, "", "No", "No", "No", "Yes", "No", "No", "Yes"],
    ["TDS", "Tax Deducted at Source", "Deduction", "Formula", 0, "TAXABLE", "No", "No", "No", "No", "Yes", "No", "Yes"],
    ["GRATUITY_ER", "Gratuity Provision (Employer)", "Employer_Contribution", "Formula", 4.81, "BASIC", "No", "No", "No", "No", "No", "No", "Yes"],
    ["PF_ER", "Provident Fund (Employer)", "Employer_Contribution", "Percentage", 12, "BASIC", "No", "Yes", "No", "No", "No", "No", "Yes"],
    ["MED_REIMB", "Medical Reimbursement", "Reimbursement", "Flat_Amount", 5000, "", "No", "No", "No", "No", "No", "No", "Yes"]
];
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(payrollComponentsHeaders), "Payroll Components");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(payrollComponentsHeaders), "Payroll_Components");

// 11-27 Standard Enterprise Setup Sheets
const remainingSheets = [
    { name: "Salary_Structures", headers: ["Structure_Name", "Basic_Pct", "HRA_Pct", "Special_Allowance_Pct", "PF_Applicable", "ESIC_Applicable"] },
    { name: "Bank_Accounts", headers: ["Bank_Name", "Account_Number", "IFSC_Code", "Account_Type", "Branch_Name"] },
    { name: "PF_Configuration", headers: ["Establishment_Code", "Employee_Share_Pct", "Employer_Share_Pct", "Wage_Ceiling", "Admin_Charges_Pct"] },
    { name: "ESIC_Configuration", headers: ["Employer_Code", "Employee_Contribution_Pct", "Employer_Contribution_Pct", "Wage_Ceiling_Monthly"] },
    { name: "PT_Configuration", headers: ["State", "Salary_Slab_Min", "Salary_Slab_Max", "Monthly_PT_Amount"] },
    { name: "Gratuity_Configuration", headers: ["Eligibility_Years", "Calculation_Days_Per_Month", "Max_Exemption_Limit"] },
    { name: "Leave_Types", headers: ["Leave_Code", "Leave_Name", "Annual_Quota", "Carry_Forward_Limit", "Is_Paid"] },
    { name: "Shift_Roster", headers: ["Shift_Code", "Shift_Name", "Start_Time", "End_Time", "Grace_Period_Minutes"] },
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

// Holiday Calendar (Exact 9 Attributes matching PRD Sections 1, 4, 15, & 16)
const holidayCalendarHeaders = [
    [
        "Holiday_Calendar_Code",
        "Holiday_Calendar_Name",
        "Location_Code",
        "Holiday_Date",
        "Holiday_Name",
        "Holiday_Type",
        "Optional_Holiday",
        "Paid_Holiday",
        "Active"
    ],
    ["HOL_BLR_2026", "Bengaluru General Calendar 2026", "LOC-BLR", "2026-01-26", "Republic Day", "National", "No", "Yes", "Yes"],
    ["HOL_BLR_2026", "Bengaluru General Calendar 2026", "LOC-BLR", "2026-03-04", "Maha Shivratri", "Restricted", "Yes", "Yes", "Yes"],
    ["HOL_BLR_2026", "Bengaluru General Calendar 2026", "LOC-BLR", "2026-03-25", "Holi", "National", "No", "Yes", "Yes"],
    ["HOL_BLR_2026", "Bengaluru General Calendar 2026", "LOC-BLR", "2026-04-10", "Good Friday", "National", "No", "Yes", "Yes"],
    ["HOL_BLR_2026", "Bengaluru General Calendar 2026", "LOC-BLR", "2026-05-01", "May Day", "Regional", "No", "Yes", "Yes"],
    ["HOL_BLR_2026", "Bengaluru General Calendar 2026", "LOC-BLR", "2026-08-15", "Independence Day", "National", "No", "Yes", "Yes"],
    ["HOL_BLR_2026", "Bengaluru General Calendar 2026", "LOC-BLR", "2026-08-27", "Raksha Bandhan", "Restricted", "Yes", "Yes", "Yes"],
    ["HOL_BLR_2026", "Bengaluru General Calendar 2026", "LOC-BLR", "2026-10-02", "Gandhi Jayanti", "National", "No", "Yes", "Yes"],
    ["HOL_BLR_2026", "Bengaluru General Calendar 2026", "LOC-BLR", "2026-10-20", "Dussehra", "National", "No", "Yes", "Yes"],
    ["HOL_BLR_2026", "Bengaluru General Calendar 2026", "LOC-BLR", "2026-11-01", "Kannada Rajyotsava", "Regional", "No", "Yes", "Yes"],
    ["HOL_BLR_2026", "Bengaluru General Calendar 2026", "LOC-BLR", "2026-11-08", "Diwali", "National", "No", "Yes", "Yes"],
    ["HOL_BLR_2026", "Bengaluru General Calendar 2026", "LOC-BLR", "2026-12-25", "Christmas", "National", "No", "Yes", "Yes"],
    // Mumbai Office Calendar
    ["HOL_MUM_2026", "Mumbai Commercial Hub Calendar 2026", "LOC-MUM", "2026-01-26", "Republic Day", "National", "No", "Yes", "Yes"],
    ["HOL_MUM_2026", "Mumbai Commercial Hub Calendar 2026", "LOC-MUM", "2026-03-25", "Holi", "National", "No", "Yes", "Yes"],
    ["HOL_MUM_2026", "Mumbai Commercial Hub Calendar 2026", "LOC-MUM", "2026-05-01", "Maharashtra Day", "Regional", "No", "Yes", "Yes"],
    ["HOL_MUM_2026", "Mumbai Commercial Hub Calendar 2026", "LOC-MUM", "2026-08-15", "Independence Day", "National", "No", "Yes", "Yes"],
    ["HOL_MUM_2026", "Mumbai Commercial Hub Calendar 2026", "LOC-MUM", "2026-09-17", "Ganesh Chaturthi", "Regional", "No", "Yes", "Yes"],
    ["HOL_MUM_2026", "Mumbai Commercial Hub Calendar 2026", "LOC-MUM", "2026-10-02", "Gandhi Jayanti", "National", "No", "Yes", "Yes"],
    ["HOL_MUM_2026", "Mumbai Commercial Hub Calendar 2026", "LOC-MUM", "2026-11-08", "Diwali", "National", "No", "Yes", "Yes"],
    ["HOL_MUM_2026", "Mumbai Commercial Hub Calendar 2026", "LOC-MUM", "2026-12-25", "Christmas", "National", "No", "Yes", "Yes"]
];

XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(holidayCalendarHeaders), "Holiday Calendar");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(holidayCalendarHeaders), "Holiday_Calendar");

// Statutory Compliance (Exact 11 Attributes matching PRD Sections 1, 4, 11, & 13)
const statutoryComplianceHeaders = [
    [
        "Compliance_Code",
        "Compliance_Name",
        "Applicable",
        "Registration_Number",
        "State",
        "Effective_From",
        "Wage_Ceiling_or_Rule",
        "Employee_Contribution_Rate",
        "Employer_Contribution_Rate",
        "Due_Date_Day",
        "Active"
    ],
    [
        "COMP_PF",
        "Employees Provident Fund (EPF & EPS)",
        "Yes",
        "KN/BNG/0012345/000",
        "All India",
        "2026-01-01",
        15000,
        "12%",
        "12%",
        15,
        "Yes"
    ],
    [
        "COMP_ESI",
        "Employees State Insurance (ESIC)",
        "Yes",
        "31000123450000101",
        "All India",
        "2026-01-01",
        21000,
        "0.75%",
        "3.25%",
        15,
        "Yes"
    ],
    [
        "COMP_PT_KA",
        "Professional Tax (Karnataka)",
        "Yes",
        "PT/KA/BNG/98765",
        "Karnataka",
        "2026-01-01",
        25000,
        200,
        0,
        20,
        "Yes"
    ],
    [
        "COMP_PT_MH",
        "Professional Tax (Maharashtra)",
        "Yes",
        "PT/MH/MUM/12345",
        "Maharashtra",
        "2026-01-01",
        10000,
        200,
        0,
        20,
        "Yes"
    ],
    [
        "COMP_LWF_KA",
        "Labour Welfare Fund (Karnataka)",
        "Yes",
        "LWF/KA/2026/01",
        "Karnataka",
        "2026-01-01",
        15000,
        20,
        40,
        15,
        "Yes"
    ],
    [
        "COMP_GRATUITY",
        "Payment of Gratuity Scheme",
        "Yes",
        "GRAT/EST/00918",
        "All India",
        "2026-01-01",
        "15/26 Formula",
        0,
        "4.81%",
        30,
        "Yes"
    ]
];

XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(statutoryComplianceHeaders), "Statuatory Compliance");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(statutoryComplianceHeaders), "Statutory Compliance");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(statutoryComplianceHeaders), "Statutory_Compliance");

// 21. Role-Based Access Control (RBAC) & Employee Permissions (Exact 13 Attributes - PRD §§ 1, 14, 17, & 18)
const rolePermissionHeaders = [
    [
        "Role_Code_or_Employee_Code",
        "Role_Name",
        "Description",
        "Scope_Level",
        "Employee_Module",
        "Attendance_Module",
        "Leave_Module",
        "Payroll_Module",
        "Recruitment_Module",
        "Assets_Module",
        "Reports_Module",
        "Organization_Setup",
        "Active"
    ],
    [
        "ROLE_SUPER_ADMIN",
        "Super Administrator",
        "Unrestricted organization governance, security, and enterprise configuration",
        "Global",
        "Full",
        "Full",
        "Full",
        "Full",
        "Full",
        "Full",
        "Full",
        "Full",
        "Yes"
    ],
    [
        "ROLE_ADMIN",
        "Company Administrator",
        "Enterprise-wide operational control and resource management",
        "Global",
        "Full",
        "Full",
        "Full",
        "Full",
        "Full",
        "Full",
        "Full",
        "Edit",
        "Yes"
    ],
    [
        "ROLE_HRMS",
        "Human Resources Manager",
        "People operations, employee records, onboarding, and leave approvals",
        "Global",
        "Full",
        "Approve",
        "Approve",
        "View",
        "Full",
        "View",
        "Export",
        "View",
        "Yes"
    ],
    [
        "ROLE_DEPT_MGR",
        "Department Manager",
        "Departmental oversight, timesheet validation, and leave approvals",
        "Department",
        "View",
        "Approve",
        "Approve",
        "None",
        "View",
        "Approve",
        "View",
        "None",
        "Yes"
    ],
    [
        "ROLE_EMPLOYEE",
        "Standard Employee",
        "Employee self-service, personal attendance marking, and leave applications",
        "Self",
        "Self",
        "Self",
        "Self",
        "Self",
        "None",
        "Self",
        "None",
        "None",
        "Yes"
    ],
    [
        "ROLE_FINANCE",
        "Financial Comptroller",
        "Payroll processing, salary disbursement, and statutory remittance exports",
        "Global",
        "View",
        "View",
        "View",
        "Full",
        "None",
        "View",
        "Export",
        "None",
        "Yes"
    ],
    [
        "ROLE_RECRUITER",
        "Talent Acquisition Lead",
        "Candidate pipeline, job openings, and interview lifecycle",
        "Global",
        "View",
        "None",
        "None",
        "None",
        "Full",
        "None",
        "View",
        "None",
        "Yes"
    ],
    [
        "EMP0001",
        "Head of Engineering Override",
        "Elevated business-unit oversight with asset allocation and report export rights",
        "Business_Unit",
        "View",
        "Approve",
        "Approve",
        "None",
        "Edit",
        "Allocate",
        "Export",
        "None",
        "Yes"
    ],
    [
        "EMP0012",
        "Special Asset Auditor Override",
        "Temporary elevated access to audit company assets and export reports",
        "Global",
        "View",
        "Self",
        "Self",
        "None",
        "None",
        "Full",
        "Export",
        "None",
        "Yes"
    ]
];

XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rolePermissionHeaders), "Role_Code_Employee Cod");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rolePermissionHeaders), "Role_Code_Employee_Code");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rolePermissionHeaders), "Roles_Permissions");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rolePermissionHeaders), "Role_Permissions");

// 28. Workflow Rules (Exact 10 Attributes matching PRD Sections 1, 9, 12, 14, & 18)
const workflowRulesHeaders = [
    [
        "Workflow_Code",
        "Module",
        "Transaction_Type",
        "Step_No",
        "Approver_Type",
        "Approver_Employee_ID",
        "Approver_Role_Code",
        "SLA_Hours",
        "Mandatory",
        "Active"
    ],
    // Leave Application Standard (2 Steps)
    [
        "WF_LEAVE_STD",
        "Leave",
        "Leave_Application",
        1,
        "Reporting_Manager",
        "",
        "",
        24,
        "Yes",
        "Yes"
    ],
    [
        "WF_LEAVE_STD",
        "Leave",
        "Leave_Application",
        2,
        "Role_Based",
        "",
        "ROLE_HR_EXEC",
        48,
        "Yes",
        "Yes"
    ],
    // Attendance Regularization (2 Steps)
    [
        "WF_ATT_REG",
        "Attendance",
        "Attendance_Regularization",
        1,
        "Reporting_Manager",
        "",
        "",
        12,
        "Yes",
        "Yes"
    ],
    [
        "WF_ATT_REG",
        "Attendance",
        "Attendance_Regularization",
        2,
        "Department_Head",
        "",
        "",
        24,
        "No",
        "Yes"
    ],
    // Salary Revision / Payroll (3 Steps)
    [
        "WF_PAY_REV",
        "Payroll",
        "Salary_Revision",
        1,
        "Secondary_Manager",
        "",
        "",
        48,
        "Yes",
        "Yes"
    ],
    [
        "WF_PAY_REV",
        "Payroll",
        "Salary_Revision",
        2,
        "Specific_Employee",
        "EMP0004",
        "",
        72,
        "Yes",
        "Yes"
    ],
    [
        "WF_PAY_REV",
        "Payroll",
        "Salary_Revision",
        3,
        "Role_Based",
        "",
        "ROLE_SUPER_ADMIN",
        24,
        "Yes",
        "Yes"
    ],
    // Expenses (2 Steps)
    [
        "WF_EXP_CLAIM",
        "Expenses",
        "Expense_Claim",
        1,
        "Reporting_Manager",
        "",
        "",
        24,
        "Yes",
        "Yes"
    ],
    [
        "WF_EXP_CLAIM",
        "Expenses",
        "Expense_Claim",
        2,
        "Role_Based",
        "",
        "ROLE_FINANCE",
        48,
        "Yes",
        "Yes"
    ],
    // Performance Management Review (2 Steps)
    [
        "WF_PMS_REV",
        "PMS",
        "Appraisal_Review",
        1,
        "Reporting_Manager",
        "",
        "",
        72,
        "Yes",
        "Yes"
    ],
    [
        "WF_PMS_REV",
        "PMS",
        "Appraisal_Review",
        2,
        "Department_Head",
        "",
        "",
        72,
        "Yes",
        "Yes"
    ],
    // Employee Lifecycle Exit Clearance (3 Steps)
    [
        "WF_EXIT_CLR",
        "Lifecycle",
        "Exit_Clearance",
        1,
        "Reporting_Manager",
        "",
        "",
        48,
        "Yes",
        "Yes"
    ],
    [
        "WF_EXIT_CLR",
        "Lifecycle",
        "Exit_Clearance",
        2,
        "Specific_Employee",
        "EMP0002",
        "",
        48,
        "Yes",
        "Yes"
    ],
    [
        "WF_EXIT_CLR",
        "Lifecycle",
        "Exit_Clearance",
        3,
        "Role_Based",
        "",
        "ROLE_FINANCE",
        48,
        "Yes",
        "Yes"
    ]
];

XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(workflowRulesHeaders), "Workflow Rules");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(workflowRulesHeaders), "Workflow_Rules");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(workflowRulesHeaders), "Workflow_Chain");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(workflowRulesHeaders), "Workflow");

// 28. Company Policies & Compliance (Exact 11 Attributes matching PRD Sections 1, 10, 13, 17, & 18)
const companyPoliciesHeaders = [
    [
        "Policy_Code",
        "Policy_Name",
        "Version",
        "Policy_Type",
        "Effective_From",
        "Acknowledgement_Required",
        "Acknowledgement_Due_Days",
        "Applies_To_Category_Code",
        "Applies_To_Location_Code",
        "Document_URL_or_File_Name",
        "Active"
    ],
    [
        "POL_POSH_01",
        "Prevention of Sexual Harassment (POSH) Policy",
        "1.0",
        "Statutory",
        "2026-01-01",
        "Yes",
        14,
        "ALL",
        "ALL",
        "policies/POL_POSH_01_v1.0.pdf",
        "Yes"
    ],
    [
        "POL_COC_01",
        "Code of Business Conduct & Ethics",
        "2.0",
        "Code_of_Conduct",
        "2026-01-01",
        "Yes",
        7,
        "ALL",
        "ALL",
        "policies/POL_COC_01_v2.0.pdf",
        "Yes"
    ],
    [
        "POL_IT_SEC_01",
        "Information Security & Data Protection Policy",
        "1.2",
        "IT_Security",
        "2026-02-01",
        "Yes",
        10,
        "ALL",
        "ALL",
        "policies/POL_IT_SEC_01_v1.2.pdf",
        "Yes"
    ],
    [
        "POL_HR_HB_01",
        "Enterprise Employee Handbook",
        "3.0",
        "HR_Handbook",
        "2026-01-01",
        "Yes",
        30,
        "CAT_FT_REG",
        "ALL",
        "policies/POL_HR_HB_01_v3.0.pdf",
        "Yes"
    ],
    [
        "POL_REMOTE_01",
        "Remote & Hybrid Workplace Guidelines",
        "1.1",
        "Operational",
        "2026-03-01",
        "No",
        15,
        "ALL",
        "LOC-BLR",
        "policies/POL_REMOTE_01_v1.1.pdf",
        "Yes"
    ],
    [
        "POL_WHISTLE_01",
        "Whistleblower & Anti-Bribery Policy",
        "1.0",
        "Statutory",
        "2026-01-01",
        "Yes",
        14,
        "ALL",
        "ALL",
        "policies/POL_WHISTLE_01_v1.0.pdf",
        "Yes"
    ],
    [
        "POL_LEAD_01",
        "Executive Leadership Governance Protocol",
        "1.0",
        "Operational",
        "2026-01-01",
        "Yes",
        7,
        "CAT_FT_EXEC",
        "ALL",
        "policies/POL_LEAD_01_v1.0.pdf",
        "Yes"
    ],
    [
        "POL_MUM_FAC_01",
        "Mumbai Commercial Hub Facility Safety Manual",
        "1.0",
        "Operational",
        "2026-01-01",
        "Yes",
        14,
        "ALL",
        "LOC-MUM",
        "policies/POL_MUM_FAC_01_v1.0.pdf",
        "Yes"
    ]
];

XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(companyPoliciesHeaders), "Company Policies");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(companyPoliciesHeaders), "Company_Policies");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(companyPoliciesHeaders), "Policies");



const outputPath = path.join(assetsDir, 'Templates.xlsx');
const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
fs.writeFileSync(outputPath, buffer);
const rootOutputPath = path.resolve(__dirname, '../Templates.xlsx');
fs.writeFileSync(rootOutputPath, buffer);
console.log(`✅ Successfully generated official 27-sheet Templates.xlsx at: ${outputPath} and ${rootOutputPath}`);
console.log(`Total sheets in template: ${wb.SheetNames.length}`);
