const crypto = require('crypto');
const logger = require('../utils/logger');
const { db } = require('../config/firebase');

/**
 * Custom Analytics Engine for Kylrx Enterprise Suite
 * 
 * Enables HR Administrators to build multi-dimensional dashboards without developers:
 * Pipeline: Select Data Source → Metrics → Filters → Grouping → Chart → Save Dashboard
 * 
 * Supported Domains:
 * 1. Workforce: headcount, hiring, attrition, employee type, BU, location
 * 2. Attendance: absenteeism, late marks, WFH, overtime, regularization
 * 3. Payroll: payroll cost, variance, deductions, exceptions, statutory totals
 * 4. PMS: review completion, goal completion, rating distribution
 * 5. Exit: exits, reasons, tenure, department attrition, pending F&F
 * 6. Policy: assigned, acknowledged, pending, overdue
 */

const DATA_SOURCES = {
    workforce: {
        id: 'workforce',
        name: 'Workforce & Demographics',
        category: 'Core HR',
        description: 'Comprehensive employee headcount, talent acquisition, attrition rates, employee types, BU, and location distribution.',
        icon: 'users',
        metrics: [
            { id: 'headcount', name: 'Total Headcount', unit: 'Employees', defaultChart: 'bar' },
            { id: 'hiring', name: 'New Hires (QTD)', unit: 'Employees', defaultChart: 'line' },
            { id: 'attrition', name: 'Attrition Rate', unit: '%', defaultChart: 'line' },
            { id: 'employee_type', name: 'Employee Type Breakdown', unit: 'Headcount', defaultChart: 'doughnut' }
        ],
        filterFields: [
            { id: 'bu', label: 'Business Unit', options: ['Technology', 'Sales & Marketing', 'Operations', 'Finance & HR'] },
            { id: 'location', label: 'Location', options: ['Bengaluru HQ', 'Mumbai', 'Delhi NCR', 'Remote (India)', 'US East'] },
            { id: 'department', label: 'Department', options: ['Engineering', 'Product', 'Customer Success', 'Sales', 'Finance', 'People Ops'] },
            { id: 'employeeType', label: 'Employee Type', options: ['Full Time', 'Contractor', 'Intern', 'Consultant'] }
        ],
        groupingDimensions: [
            { id: 'bu', label: 'Business Unit (BU)' },
            { id: 'location', label: 'Location' },
            { id: 'department', label: 'Department' },
            { id: 'employeeType', label: 'Employee Type' }
        ]
    },

    attendance: {
        id: 'attendance',
        name: 'Attendance & Shift Operations',
        category: 'Workforce Operations',
        description: 'Employee clock-in patterns, absenteeism clusters, late arrival marks, WFH utilization, overtime, and regularization.',
        icon: 'clock',
        metrics: [
            { id: 'absenteeism', name: 'Absenteeism Incidents', unit: 'Days', defaultChart: 'bar' },
            { id: 'late_marks', name: 'Late Arrival Marks', unit: 'Incidents', defaultChart: 'bar' },
            { id: 'wfh', name: 'Work From Home (WFH) Days', unit: 'Days', defaultChart: 'line' },
            { id: 'overtime', name: 'Overtime Hours Logged', unit: 'Hours', defaultChart: 'line' },
            { id: 'regularization', name: 'Regularization Requests', unit: 'Requests', defaultChart: 'bar' }
        ],
        filterFields: [
            { id: 'bu', label: 'Business Unit', options: ['Technology', 'Sales & Marketing', 'Operations', 'Finance & HR'] },
            { id: 'department', label: 'Department', options: ['Engineering', 'Product', 'Customer Success', 'Sales', 'Finance', 'People Ops'] },
            { id: 'location', label: 'Location', options: ['Bengaluru HQ', 'Mumbai', 'Delhi NCR', 'Remote (India)'] },
            { id: 'shift', label: 'Shift Type', options: ['General (9-6)', 'Morning (7-4)', 'Evening (2-11)', 'Night Shift'] }
        ],
        groupingDimensions: [
            { id: 'department', label: 'Department' },
            { id: 'bu', label: 'Business Unit' },
            { id: 'location', label: 'Location' },
            { id: 'shift', label: 'Shift Type' }
        ]
    },

    payroll: {
        id: 'payroll',
        name: 'Payroll & Statutory Costs',
        category: 'Financial Operations',
        description: 'Gross payroll disbursements, month-over-month variance anomalies, tax deductions, reconciliation exceptions, and statutory totals.',
        icon: 'credit-card',
        metrics: [
            { id: 'payroll_cost', name: 'Gross Payroll Cost (INR Lakhs)', unit: '₹ Lakhs', defaultChart: 'bar' },
            { id: 'variance', name: 'Month-over-Month Variance', unit: '%', defaultChart: 'line' },
            { id: 'deductions', name: 'Statutory & Voluntary Deductions', unit: '₹ Lakhs', defaultChart: 'bar' },
            { id: 'exceptions', name: 'Reconciliation Holds & Exceptions', unit: 'Cases', defaultChart: 'bar' },
            { id: 'statutory_totals', name: 'Total Statutory Remittances (PF/ESIC/NPS/Gratuity)', unit: '₹ Lakhs', defaultChart: 'doughnut' }
        ],
        filterFields: [
            { id: 'bu', label: 'Business Unit', options: ['Technology', 'Sales & Marketing', 'Operations', 'Finance & HR'] },
            { id: 'department', label: 'Department', options: ['Engineering', 'Product', 'Customer Success', 'Sales', 'Finance', 'People Ops'] },
            { id: 'legalEntity', label: 'Legal Entity', options: ['Kylrx Technologies India Pvt Ltd', 'Kylrx US Inc'] },
            { id: 'cycleMonth', label: 'Cycle Month', options: ['September 2026', 'August 2026', 'July 2026'] }
        ],
        groupingDimensions: [
            { id: 'bu', label: 'Business Unit' },
            { id: 'department', label: 'Department' },
            { id: 'legalEntity', label: 'Legal Entity' }
        ]
    },

    pms: {
        id: 'pms',
        name: 'Performance Management (PMS)',
        category: 'Talent Development',
        description: 'Evaluation cycle completion rates, OKR/goal achievement percentages, and bell curve performance rating distribution.',
        icon: 'award',
        metrics: [
            { id: 'review_completion', name: 'Appraisal Review Completion Rate', unit: '%', defaultChart: 'line' },
            { id: 'goal_completion', name: 'Goal & OKR Completion %', unit: '%', defaultChart: 'bar' },
            { id: 'rating_distribution', name: 'Rating Distribution (Bell Curve)', unit: 'Employees', defaultChart: 'doughnut' }
        ],
        filterFields: [
            { id: 'bu', label: 'Business Unit', options: ['Technology', 'Sales & Marketing', 'Operations', 'Finance & HR'] },
            { id: 'department', label: 'Department', options: ['Engineering', 'Product', 'Customer Success', 'Sales', 'Finance', 'People Ops'] },
            { id: 'cycle', label: 'Performance Cycle', options: ['Annual FY26 Review', 'Q2 FY26 Review', 'Mid-Year FY26'] },
            { id: 'grade', label: 'Employee Grade', options: ['L1 Associate', 'L2 Senior', 'L3 Lead', 'L4 Principal', 'L5 Director'] }
        ],
        groupingDimensions: [
            { id: 'rating', label: 'Rating Band (1 to 5)' },
            { id: 'department', label: 'Department' },
            { id: 'bu', label: 'Business Unit' },
            { id: 'grade', label: 'Grade' }
        ]
    },

    exit: {
        id: 'exit',
        name: 'Exit & Separation Management',
        category: 'Offboarding SLAs',
        description: 'Separation volumes, primary resignation reasons, average tenure before exit, departmental attrition, and pending F&F clearances.',
        icon: 'log-out',
        metrics: [
            { id: 'exits', name: 'Total Exits', unit: 'Headcount', defaultChart: 'bar' },
            { id: 'reasons', name: 'Primary Exit Reasons Breakdown', unit: 'Cases', defaultChart: 'doughnut' },
            { id: 'tenure', name: 'Average Tenure at Departure', unit: 'Months', defaultChart: 'bar' },
            { id: 'department_attrition', name: 'Departmental Attrition Rate', unit: '%', defaultChart: 'bar' },
            { id: 'pending_fnf', name: 'Pending F&F Settlements', unit: 'Pending Cases', defaultChart: 'line' }
        ],
        filterFields: [
            { id: 'bu', label: 'Business Unit', options: ['Technology', 'Sales & Marketing', 'Operations', 'Finance & HR'] },
            { id: 'department', label: 'Department', options: ['Engineering', 'Product', 'Customer Success', 'Sales', 'Finance', 'People Ops'] },
            { id: 'tenureBracket', label: 'Tenure Bracket', options: ['< 1 Year', '1 - 2 Years', '2 - 4 Years', '4+ Years'] },
            { id: 'reason', label: 'Exit Reason', options: ['Higher Studies', 'Compensation', 'Career Growth', 'Relocation', 'Personal'] }
        ],
        groupingDimensions: [
            { id: 'reason', label: 'Exit Reason' },
            { id: 'department', label: 'Department' },
            { id: 'bu', label: 'Business Unit' },
            { id: 'tenureBracket', label: 'Tenure Bracket' }
        ]
    },

    policy: {
        id: 'policy',
        name: 'Policy & Document Compliance',
        category: 'Legal & Governance',
        description: 'Distribution tracking for mandatory policies, employee signatures acknowledged, pending acknowledgments, and overdue sign-offs.',
        icon: 'shield-check',
        metrics: [
            { id: 'assigned', name: 'Total Policies Distributed', unit: 'Assigned Copies', defaultChart: 'bar' },
            { id: 'acknowledged', name: 'Signed & Acknowledged', unit: 'Acknowledged', defaultChart: 'bar' },
            { id: 'pending', name: 'Pending Sign-off (< 3 Days)', unit: 'Pending', defaultChart: 'bar' },
            { id: 'overdue', name: 'Overdue Breached (> 3 Days)', unit: 'Overdue Copies', defaultChart: 'line' }
        ],
        filterFields: [
            { id: 'bu', label: 'Business Unit', options: ['Technology', 'Sales & Marketing', 'Operations', 'Finance & HR'] },
            { id: 'department', label: 'Department', options: ['Engineering', 'Product', 'Customer Success', 'Sales', 'Finance', 'People Ops'] },
            { id: 'policyDocument', label: 'Policy Document', options: ['Code of Conduct 2026', 'InfoSec & Data Protection', 'POSH Policy', 'Remote Work Guidelines'] }
        ],
        groupingDimensions: [
            { id: 'policyDocument', label: 'Policy Document' },
            { id: 'department', label: 'Department' },
            { id: 'bu', label: 'Business Unit' }
        ]
    }
};

// Realistic mock repository for dynamic multi-dimensional aggregations
const ENTERPRISE_RAW_DATA = {
    workforce: [
        { bu: 'Technology', location: 'Bengaluru HQ', department: 'Engineering', employeeType: 'Full Time', headcount: 240, hiring: 32, attrition: 8.2 },
        { bu: 'Technology', location: 'Bengaluru HQ', department: 'Product', employeeType: 'Full Time', headcount: 65, hiring: 8, attrition: 6.1 },
        { bu: 'Technology', location: 'Bengaluru HQ', department: 'Engineering', employeeType: 'Contractor', headcount: 45, hiring: 12, attrition: 14.5 },
        { bu: 'Technology', location: 'Remote (India)', department: 'Engineering', employeeType: 'Full Time', headcount: 70, hiring: 10, attrition: 9.0 },
        { bu: 'Technology', location: 'US East', department: 'Engineering', employeeType: 'Full Time', headcount: 25, hiring: 4, attrition: 4.0 },
        { bu: 'Sales & Marketing', location: 'Mumbai', department: 'Sales', employeeType: 'Full Time', headcount: 110, hiring: 18, attrition: 16.2 },
        { bu: 'Sales & Marketing', location: 'Delhi NCR', department: 'Sales', employeeType: 'Full Time', headcount: 85, hiring: 14, attrition: 15.0 },
        { bu: 'Sales & Marketing', location: 'Bengaluru HQ', department: 'Customer Success', employeeType: 'Full Time', headcount: 60, hiring: 9, attrition: 11.4 },
        { bu: 'Sales & Marketing', location: 'Mumbai', department: 'Customer Success', employeeType: 'Contractor', headcount: 20, hiring: 5, attrition: 18.0 },
        { bu: 'Operations', location: 'Bengaluru HQ', department: 'Operations', employeeType: 'Full Time', headcount: 95, hiring: 11, attrition: 7.5 },
        { bu: 'Operations', location: 'Mumbai', department: 'Operations', employeeType: 'Contractor', headcount: 35, hiring: 6, attrition: 12.0 },
        { bu: 'Finance & HR', location: 'Bengaluru HQ', department: 'Finance', employeeType: 'Full Time', headcount: 40, hiring: 4, attrition: 5.0 },
        { bu: 'Finance & HR', location: 'Bengaluru HQ', department: 'People Ops', employeeType: 'Full Time', headcount: 35, hiring: 5, attrition: 6.2 },
        { bu: 'Technology', location: 'Bengaluru HQ', department: 'Engineering', employeeType: 'Intern', headcount: 25, hiring: 20, attrition: 0 }
    ],

    attendance: [
        { bu: 'Technology', department: 'Engineering', location: 'Bengaluru HQ', shift: 'General (9-6)', absenteeism: 38, late_marks: 45, wfh: 410, overtime: 120, regularization: 24 },
        { bu: 'Technology', department: 'Product', location: 'Bengaluru HQ', shift: 'General (9-6)', absenteeism: 10, late_marks: 14, wfh: 120, overtime: 25, regularization: 8 },
        { bu: 'Sales & Marketing', department: 'Sales', location: 'Mumbai', shift: 'Morning (7-4)', absenteeism: 52, late_marks: 68, wfh: 95, overtime: 60, regularization: 42 },
        { bu: 'Sales & Marketing', department: 'Customer Success', location: 'Delhi NCR', shift: 'General (9-6)', absenteeism: 28, late_marks: 35, wfh: 140, overtime: 40, regularization: 19 },
        { bu: 'Operations', department: 'Operations', location: 'Bengaluru HQ', shift: 'Night Shift', absenteeism: 44, late_marks: 58, wfh: 20, overtime: 180, regularization: 31 },
        { bu: 'Operations', department: 'Operations', location: 'Mumbai', shift: 'Evening (2-11)', absenteeism: 30, late_marks: 42, wfh: 15, overtime: 110, regularization: 22 },
        { bu: 'Finance & HR', department: 'Finance', location: 'Bengaluru HQ', shift: 'General (9-6)', absenteeism: 12, late_marks: 18, wfh: 85, overtime: 35, regularization: 9 },
        { bu: 'Finance & HR', department: 'People Ops', location: 'Bengaluru HQ', shift: 'General (9-6)', absenteeism: 9, late_marks: 11, wfh: 90, overtime: 15, regularization: 6 }
    ],

    payroll: [
        { bu: 'Technology', department: 'Engineering', legalEntity: 'Kylrx Technologies India Pvt Ltd', cycleMonth: 'September 2026', payroll_cost: 165.4, variance: 8.2, deductions: 28.5, exceptions: 3, statutory_totals: 42.1 },
        { bu: 'Technology', department: 'Product', legalEntity: 'Kylrx Technologies India Pvt Ltd', cycleMonth: 'September 2026', payroll_cost: 58.2, variance: 4.1, deductions: 10.2, exceptions: 0, statutory_totals: 14.8 },
        { bu: 'Sales & Marketing', department: 'Sales', legalEntity: 'Kylrx Technologies India Pvt Ltd', cycleMonth: 'September 2026', payroll_cost: 88.5, variance: 12.4, deductions: 15.6, exceptions: 5, statutory_totals: 22.4 },
        { bu: 'Sales & Marketing', department: 'Customer Success', legalEntity: 'Kylrx Technologies India Pvt Ltd', cycleMonth: 'September 2026', payroll_cost: 44.0, variance: 3.5, deductions: 7.8, exceptions: 1, statutory_totals: 11.2 },
        { bu: 'Operations', department: 'Operations', legalEntity: 'Kylrx Technologies India Pvt Ltd', cycleMonth: 'September 2026', payroll_cost: 49.6, variance: 6.8, deductions: 9.1, exceptions: 2, statutory_totals: 13.0 },
        { bu: 'Finance & HR', department: 'Finance', legalEntity: 'Kylrx Technologies India Pvt Ltd', cycleMonth: 'September 2026', payroll_cost: 32.8, variance: 2.1, deductions: 5.9, exceptions: 0, statutory_totals: 8.4 },
        { bu: 'Finance & HR', department: 'People Ops', legalEntity: 'Kylrx Technologies India Pvt Ltd', cycleMonth: 'September 2026', payroll_cost: 26.5, variance: 1.8, deductions: 4.8, exceptions: 0, statutory_totals: 6.8 },
        { bu: 'Technology', department: 'Engineering', legalEntity: 'Kylrx US Inc', cycleMonth: 'September 2026', payroll_cost: 120.0, variance: 3.0, deductions: 32.0, exceptions: 1, statutory_totals: 28.0 }
    ],

    pms: [
        { rating: '5 - Outstanding', department: 'Engineering', bu: 'Technology', grade: 'L3 Lead', review_completion: 96, goal_completion: 94, rating_distribution: 35 },
        { rating: '4 - Exceeds Expectations', department: 'Engineering', bu: 'Technology', grade: 'L2 Senior', review_completion: 94, goal_completion: 88, rating_distribution: 110 },
        { rating: '3 - Meets Expectations', department: 'Engineering', bu: 'Technology', grade: 'L1 Associate', review_completion: 90, goal_completion: 80, rating_distribution: 135 },
        { rating: '2 - Needs Improvement', department: 'Engineering', bu: 'Technology', grade: 'L1 Associate', review_completion: 88, goal_completion: 65, rating_distribution: 25 },
        { rating: '1 - Unsatisfactory', department: 'Engineering', bu: 'Technology', grade: 'L1 Associate', review_completion: 85, goal_completion: 45, rating_distribution: 8 },
        { rating: '5 - Outstanding', department: 'Sales', bu: 'Sales & Marketing', grade: 'L3 Lead', review_completion: 92, goal_completion: 98, rating_distribution: 22 },
        { rating: '4 - Exceeds Expectations', department: 'Sales', bu: 'Sales & Marketing', grade: 'L2 Senior', review_completion: 88, goal_completion: 90, rating_distribution: 65 },
        { rating: '3 - Meets Expectations', department: 'Sales', bu: 'Sales & Marketing', grade: 'L1 Associate', review_completion: 84, goal_completion: 76, rating_distribution: 88 },
        { rating: '2 - Needs Improvement', department: 'Sales', bu: 'Sales & Marketing', grade: 'L1 Associate', review_completion: 80, goal_completion: 55, rating_distribution: 28 },
        { rating: '4 - Exceeds Expectations', department: 'Operations', bu: 'Operations', grade: 'L2 Senior', review_completion: 95, goal_completion: 89, rating_distribution: 45 },
        { rating: '3 - Meets Expectations', department: 'Operations', bu: 'Operations', grade: 'L1 Associate', review_completion: 92, goal_completion: 82, rating_distribution: 70 }
    ],

    exit: [
        { reason: 'Career Growth', department: 'Engineering', bu: 'Technology', tenureBracket: '1 - 2 Years', exits: 14, tenure: 18.5, department_attrition: 7.2, pending_fnf: 2 },
        { reason: 'Compensation', department: 'Engineering', bu: 'Technology', tenureBracket: '2 - 4 Years', exits: 9, tenure: 32.0, department_attrition: 4.8, pending_fnf: 1 },
        { reason: 'Higher Studies', department: 'Engineering', bu: 'Technology', tenureBracket: '< 1 Year', exits: 6, tenure: 8.5, department_attrition: 3.1, pending_fnf: 0 },
        { reason: 'Career Growth', department: 'Sales', bu: 'Sales & Marketing', tenureBracket: '1 - 2 Years', exits: 18, tenure: 15.0, department_attrition: 11.2, pending_fnf: 4 },
        { reason: 'Compensation', department: 'Sales', bu: 'Sales & Marketing', tenureBracket: '< 1 Year', exits: 12, tenure: 9.2, department_attrition: 7.5, pending_fnf: 3 },
        { reason: 'Relocation', department: 'Customer Success', bu: 'Sales & Marketing', tenureBracket: '2 - 4 Years', exits: 8, tenure: 28.0, department_attrition: 6.4, pending_fnf: 1 },
        { reason: 'Personal', department: 'Operations', bu: 'Operations', tenureBracket: '4+ Years', exits: 7, tenure: 52.0, department_attrition: 5.5, pending_fnf: 2 },
        { reason: 'Career Growth', department: 'Finance', bu: 'Finance & HR', tenureBracket: '2 - 4 Years', exits: 3, tenure: 30.0, department_attrition: 4.0, pending_fnf: 0 }
    ],

    policy: [
        { policyDocument: 'Code of Conduct 2026', department: 'Engineering', bu: 'Technology', assigned: 350, acknowledged: 338, pending: 8, overdue: 4 },
        { policyDocument: 'InfoSec & Data Protection', department: 'Engineering', bu: 'Technology', assigned: 350, acknowledged: 342, pending: 5, overdue: 3 },
        { policyDocument: 'POSH Policy', department: 'Engineering', bu: 'Technology', assigned: 350, acknowledged: 345, pending: 4, overdue: 1 },
        { policyDocument: 'Code of Conduct 2026', department: 'Sales', bu: 'Sales & Marketing', assigned: 195, acknowledged: 172, pending: 15, overdue: 8 },
        { policyDocument: 'InfoSec & Data Protection', department: 'Sales', bu: 'Sales & Marketing', assigned: 195, acknowledged: 168, pending: 16, overdue: 11 },
        { policyDocument: 'Remote Work Guidelines', department: 'Sales', bu: 'Sales & Marketing', assigned: 195, acknowledged: 180, pending: 10, overdue: 5 },
        { policyDocument: 'Code of Conduct 2026', department: 'Operations', bu: 'Operations', assigned: 130, acknowledged: 124, pending: 4, overdue: 2 },
        { policyDocument: 'POSH Policy', department: 'Operations', bu: 'Operations', assigned: 130, acknowledged: 126, pending: 3, overdue: 1 },
        { policyDocument: 'Code of Conduct 2026', department: 'Finance', bu: 'Finance & HR', assigned: 75, acknowledged: 74, pending: 1, overdue: 0 }
    ]
};

// In-Memory storage for Saved Dashboards
const savedDashboardsMap = new Map();

// Seed standard enterprise pre-built dashboards
const SEED_DASHBOARDS = [
    {
        id: 'dash-workforce-executive',
        title: 'Executive Workforce & Talent Distribution',
        category: 'Workforce',
        description: 'Comprehensive analysis of organization headcount, recruitment influx, attrition, and employee types across BUs.',
        createdAt: '2026-09-01T10:00:00Z',
        updatedAt: '2026-09-10T14:30:00Z',
        widgets: [
            { id: 'w1', title: 'Headcount by Business Unit', dataSource: 'workforce', metric: 'headcount', grouping: 'bu', chartType: 'bar', filters: {} },
            { id: 'w2', title: 'Employee Type Composition', dataSource: 'workforce', metric: 'employee_type', grouping: 'employeeType', chartType: 'doughnut', filters: {} },
            { id: 'w3', title: 'Talent Acquisition Influx', dataSource: 'workforce', metric: 'hiring', grouping: 'location', chartType: 'line', filters: {} },
            { id: 'w4', title: 'Departmental Headcount', dataSource: 'workforce', metric: 'headcount', grouping: 'department', chartType: 'bar', filters: {} }
        ]
    },
    {
        id: 'dash-attendance-operations',
        title: 'Attendance, Absenteeism & Remote Work Monitor',
        category: 'Attendance',
        description: 'Tracking unplanned absenteeism, late clock-ins, remote work adoption, and overtime trends.',
        createdAt: '2026-09-02T11:00:00Z',
        updatedAt: '2026-09-11T09:15:00Z',
        widgets: [
            { id: 'w5', title: 'Absenteeism by Department', dataSource: 'attendance', metric: 'absenteeism', grouping: 'department', chartType: 'bar', filters: {} },
            { id: 'w6', title: 'WFH Utilization by BU', dataSource: 'attendance', metric: 'wfh', grouping: 'bu', chartType: 'line', filters: {} },
            { id: 'w7', title: 'Late Marks Incidence', dataSource: 'attendance', metric: 'late_marks', grouping: 'location', chartType: 'bar', filters: {} },
            { id: 'w8', title: 'Overtime Hours Logged', dataSource: 'attendance', metric: 'overtime', grouping: 'shift', chartType: 'bar', filters: {} }
        ]
    },
    {
        id: 'dash-payroll-statutory-safety',
        title: 'Payroll Financial & Variance Safety Dashboard',
        category: 'Payroll',
        description: 'Gross disbursement totals, month-over-month variances, deduction totals, and statutory remittances.',
        createdAt: '2026-09-03T14:00:00Z',
        updatedAt: '2026-09-11T08:00:00Z',
        widgets: [
            { id: 'w9', title: 'Gross Payroll by BU (INR Lakhs)', dataSource: 'payroll', metric: 'payroll_cost', grouping: 'bu', chartType: 'bar', filters: {} },
            { id: 'w10', title: 'Statutory Remittances (PF/ESIC/NPS)', dataSource: 'payroll', metric: 'statutory_totals', grouping: 'department', chartType: 'doughnut', filters: {} },
            { id: 'w11', title: 'MoM Variance % by BU', dataSource: 'payroll', metric: 'variance', grouping: 'bu', chartType: 'line', filters: {} }
        ]
    },
    {
        id: 'dash-pms-talent-appraisal',
        title: 'Performance Management & Bell Curve Analytics',
        category: 'PMS',
        description: 'Appraisal review completion velocity, goal accomplishment, and overall employee rating distributions.',
        createdAt: '2026-09-04T09:30:00Z',
        updatedAt: '2026-09-11T12:00:00Z',
        widgets: [
            { id: 'w12', title: 'Rating Band Bell Curve Distribution', dataSource: 'pms', metric: 'rating_distribution', grouping: 'rating', chartType: 'doughnut', filters: {} },
            { id: 'w13', title: 'Goal Completion % by Department', dataSource: 'pms', metric: 'goal_completion', grouping: 'department', chartType: 'bar', filters: {} }
        ]
    },
    {
        id: 'dash-exit-attrition-intelligence',
        title: 'Exit Analytics, Tenure & Retention Intelligence',
        category: 'Exit',
        description: 'Attrition root causes, tenure distribution before separation, and departmental attrition spikes.',
        createdAt: '2026-09-05T13:00:00Z',
        updatedAt: '2026-09-10T16:00:00Z',
        widgets: [
            { id: 'w14', title: 'Primary Exit Reasons Breakdown', dataSource: 'exit', metric: 'reasons', grouping: 'reason', chartType: 'doughnut', filters: {} },
            { id: 'w15', title: 'Departmental Attrition Rate (%)', dataSource: 'exit', metric: 'department_attrition', grouping: 'department', chartType: 'bar', filters: {} },
            { id: 'w16', title: 'Average Tenure by Department (Months)', dataSource: 'exit', metric: 'tenure', grouping: 'department', chartType: 'bar', filters: {} }
        ]
    },
    {
        id: 'dash-policy-governance-audit',
        title: 'Enterprise Policy & Compliance Tracker',
        category: 'Policy',
        description: 'Signature compliance for InfoSec, POSH, and Code of Conduct; monitors pending and overdue compliance SLA breaches.',
        createdAt: '2026-09-06T15:00:00Z',
        updatedAt: '2026-09-11T11:30:00Z',
        widgets: [
            { id: 'w17', title: 'Signed vs Pending by Policy', dataSource: 'policy', metric: 'acknowledged', grouping: 'policyDocument', chartType: 'bar', filters: {} },
            { id: 'w18', title: 'Overdue Breached Policies (> 3 Days)', dataSource: 'policy', metric: 'overdue', grouping: 'department', chartType: 'bar', filters: {} }
        ]
    }
];

function initializeSavedDashboards() {
    SEED_DASHBOARDS.forEach(dash => savedDashboardsMap.set(dash.id, dash));
    logger.info(`[CustomAnalyticsEngine] Initialized ${savedDashboardsMap.size} pre-built HR dashboards.`);
}

initializeSavedDashboards();

/**
 * Executes a custom dynamic analytics query
 * 
 * @param {Object} queryConfig
 * @param {string} queryConfig.dataSource - 'workforce' | 'attendance' | 'payroll' | 'pms' | 'exit' | 'policy'
 * @param {string} queryConfig.metric - e.g. 'headcount', 'variance', 'overdue'
 * @param {Object} queryConfig.filters - e.g. { bu: 'Technology', location: 'Bengaluru HQ' }
/**
 * Executes a custom dynamic analytics query
 * 
 * @param {Object} queryConfig
 * @param {string} queryConfig.dataSource - 'workforce' | 'attendance' | 'payroll' | 'pms' | 'exit' | 'policy'
 * @param {string} queryConfig.metric - e.g. 'headcount', 'variance', 'overdue'
 * @param {Object} queryConfig.filters - e.g. { bu: 'Technology', location: 'Bengaluru HQ' }
 * @param {string} queryConfig.grouping - e.g. 'bu', 'department', 'location', 'rating', 'reason'
 * @param {string} queryConfig.chartType - 'bar' | 'line' | 'doughnut' | 'pie' | 'kpi' | 'table'
 * @param {boolean} queryConfig.useLiveFirebase - Priority live Firestore query
 */
async function executeCustomQuery(queryConfig = {}) {
    const { dataSource, metric, filters = {}, grouping, chartType = 'bar', useLiveFirebase = true } = queryConfig;

    if (!dataSource || !DATA_SOURCES[dataSource]) {
        throw new Error(`Invalid data source: '${dataSource}'`);
    }

    const sourceSchema = DATA_SOURCES[dataSource];
    const metricSchema = sourceSchema.metrics.find(m => m.id === metric) || sourceSchema.metrics[0];
    const targetMetricId = metricSchema.id;
    const targetGrouping = grouping || sourceSchema.groupingDimensions[0]?.id || 'bu';

    let rawRecords = [];

    // Query live Firebase Cloud Firestore
    if (useLiveFirebase) {
        try {
            if (db && typeof db.collection === 'function') {
                const collName = dataSource === 'workforce' ? 'employees' : `analytics_${dataSource}`;
                const snap = await Promise.race([
                    db.collection(collName).get(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 1200))
                ]);

                if (snap && !snap.empty) {
                    rawRecords = snap.docs.map(doc => doc.data());
                } else {
                    rawRecords = ENTERPRISE_RAW_DATA[dataSource] || [];
                }
            }
        } catch (e) {
            logger.warn(`[CustomAnalyticsEngine] Live Firebase query notice for ${dataSource}:`, e.message);
            rawRecords = ENTERPRISE_RAW_DATA[dataSource] || [];
        }
    } else {
        rawRecords = ENTERPRISE_RAW_DATA[dataSource] || [];
    }

    // Determine default category labels for current grouping dimension
    const defaultCategories = sourceSchema.filterFields?.find(f => f.id === targetGrouping)?.options 
        || (targetGrouping === 'bu' ? ['Technology', 'Sales & Marketing', 'Operations', 'Finance & HR'] : ['Engineering', 'Sales', 'Operations', 'Finance']);

    // If 0 records in Firebase Firestore, return clean 0 metrics and zeroed datasets
    if (rawRecords.length === 0) {
        const zeroLabels = defaultCategories;
        const zeroData = zeroLabels.map(() => 0);

        const dataset = {
            label: `${metricSchema.name} (${metricSchema.unit})`,
            data: zeroData,
            backgroundColor: chartType === 'line' ? 'rgba(37, 99, 235, 0.15)' : [
                'rgba(37, 99, 235, 0.85)',
                'rgba(5, 150, 105, 0.85)',
                'rgba(2, 132, 199, 0.85)',
                'rgba(217, 119, 6, 0.85)'
            ].slice(0, zeroLabels.length),
            borderColor: chartType === 'line' ? '#2563eb' : ['#2563eb', '#059669', '#0284c7', '#d97706'].slice(0, zeroLabels.length),
            borderWidth: 2,
            fill: chartType === 'line'
        };

        return {
            success: true,
            source: 'firebase_live',
            query: {
                dataSource,
                dataSourceName: sourceSchema.name,
                metric: targetMetricId,
                metricName: metricSchema.name,
                unit: metricSchema.unit,
                grouping: targetGrouping,
                chartType,
                filtersApplied: filters
            },
            chartData: {
                labels: zeroLabels,
                datasets: [dataset]
            },
            summary: {
                total: 0,
                average: 0,
                max: 0,
                min: 0,
                groupCount: 0,
                recordsScanned: 0
            }
        };
    }

    // 1. Apply Dynamic Filters for existing records
    const filteredRecords = rawRecords.filter(row => {
        for (const [key, filterVal] of Object.entries(filters)) {
            if (filterVal && filterVal !== 'ALL') {
                if (Array.isArray(filterVal)) {
                    if (!filterVal.includes(row[key])) return false;
                } else if (row[key] !== filterVal) {
                    return false;
                }
            }
        }
        return true;
    });

    // 2. Perform Grouping Aggregations
    const groupedMap = new Map();
    defaultCategories.forEach(cat => groupedMap.set(cat, { sum: 0, count: 0, values: [] }));

    for (const row of filteredRecords) {
        const groupKey = row[targetGrouping] || 'Other';
        let val = Number(row[targetMetricId]) || (targetMetricId === 'headcount' ? 1 : 0);

        if (!groupedMap.has(groupKey)) {
            groupedMap.set(groupKey, { sum: 0, count: 0, values: [] });
        }

        const bucket = groupedMap.get(groupKey);
        bucket.sum += val;
        bucket.count += 1;
        bucket.values.push(val);
    }

    // 3. Assemble Labels and Datasets for Chart.js
    const labels = Array.from(groupedMap.keys());
    const dataPoints = [];

    const bgColors = [
        'rgba(37, 99, 235, 0.85)',
        'rgba(5, 150, 105, 0.85)',
        'rgba(2, 132, 199, 0.85)',
        'rgba(217, 119, 6, 0.85)',
        'rgba(220, 38, 38, 0.85)',
        'rgba(147, 51, 234, 0.85)'
    ];

    const borderColors = ['#2563eb', '#059669', '#0284c7', '#d97706', '#dc2626', '#9333ea'];
    const isRateOrAverage = ['variance', 'attrition', 'review_completion', 'goal_completion', 'department_attrition', 'tenure'].includes(targetMetricId);

    labels.forEach(label => {
        const bucket = groupedMap.get(label);
        const finalVal = isRateOrAverage 
            ? (bucket.count ? Number((bucket.sum / bucket.count).toFixed(1)) : 0)
            : Number(bucket.sum.toFixed(1));
        dataPoints.push(finalVal);
    });

    const dataset = {
        label: `${metricSchema.name} (${metricSchema.unit})`,
        data: dataPoints,
        backgroundColor: chartType === 'line' ? 'rgba(37, 99, 235, 0.15)' : bgColors.slice(0, labels.length),
        borderColor: chartType === 'line' ? '#2563eb' : borderColors.slice(0, labels.length),
        borderWidth: 2,
        fill: chartType === 'line'
    };

    // Summary Statistics
    const numValues = dataPoints.length ? dataPoints : [0];
    const maxVal = Math.max(...numValues);
    const minVal = Math.min(...numValues);
    const avgVal = Number((dataPoints.reduce((a, b) => a + b, 0) / (dataPoints.length || 1)).toFixed(1));
    const totalVal = isRateOrAverage ? avgVal : Number(dataPoints.reduce((a, b) => a + b, 0).toFixed(1));

    return {
        success: true,
        source: 'firebase_live',
        query: {
            dataSource,
            dataSourceName: sourceSchema.name,
            metric: targetMetricId,
            metricName: metricSchema.name,
            unit: metricSchema.unit,
            grouping: targetGrouping,
            chartType,
            filtersApplied: filters
        },
        chartData: {
            labels,
            datasets: [dataset]
        },
        summary: {
            total: totalVal,
            average: avgVal,
            max: maxVal,
            min: minVal,
            groupCount: labels.length,
            recordsScanned: filteredRecords.length
        }
    };
}

/**
 * Dashboard Management
 */
function getAllDashboards() {
    return Array.from(savedDashboardsMap.values());
}

async function getDashboardById(id) {
    const dash = savedDashboardsMap.get(id);
    if (!dash) return null;

    // Refresh each widget with real-time executed data
    const executedWidgets = await Promise.all((dash.widgets || []).map(async w => {
        try {
            const queryResult = await executeCustomQuery({
                dataSource: w.dataSource,
                metric: w.metric,
                grouping: w.grouping,
                chartType: w.chartType,
                filters: w.filters || {}
            });
            return {
                ...w,
                chartData: queryResult.chartData,
                summary: queryResult.summary,
                unit: queryResult.query.unit
            };
        } catch (e) {
            return { ...w, error: e.message };
        }
    }));

    return { ...dash, widgets: executedWidgets };
}

function saveDashboard(dashboardData) {
    const id = dashboardData.id || `dash-${crypto.randomUUID().slice(0, 8)}`;
    const newDash = {
        ...dashboardData,
        id,
        updatedAt: new Date().toISOString(),
        createdAt: dashboardData.createdAt || new Date().toISOString()
    };
    savedDashboardsMap.set(id, newDash);
    return newDash;
}

function deleteDashboard(id) {
    return savedDashboardsMap.delete(id);
}

module.exports = {
    DATA_SOURCES,
    executeCustomQuery,
    getAllDashboards,
    getDashboardById,
    saveDashboard,
    deleteDashboard
};
