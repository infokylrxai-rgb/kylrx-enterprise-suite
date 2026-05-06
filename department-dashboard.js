/**
 * department-dashboard.js
 * Universal Configuration for Departmental Hubs
 */

const deptConfig = {
  marketing: {
    title: 'Marketing Dashboard',
    role: 'Marketing Manager',
    user: 'Sarah Jenkins',
    theme: {
      primary: '#8b5cf6',
      light: '#f5f3ff',
      soft: '#ede9fe',
      accent: '#d946ef'
    },
    kpis: [
      { id: 'stat-active-campaigns', label: 'Active Campaigns', value: '14', change: '+2 this week', icon: 'fa-rocket', color: 'purple' },
      { id: 'stat-leads', label: 'Leads Generated', value: '5,120', change: '14% increase', icon: 'fa-bullseye', color: 'green' },
      { id: 'stat-conv-rate', label: 'Conversion Rate', value: '4.1%', change: '-0.2% vs avg', icon: 'fa-percent', color: 'orange' },
      { id: 'stat-ad-spend', label: 'Monthly Ad Spend', value: '₹920k', change: 'Within budget', icon: 'fa-indian-rupee-sign', color: 'blue' }
    ],
    charts: {
      performance: {
        type: 'line',
        label: 'Conversions',
        data: [65, 82, 75, 94, 88],
        borderColor: '#8b5cf6'
      },
      distribution: {
        type: 'doughnut',
        labels: ['Instagram', 'Facebook', 'Google', 'Email', 'Other'],
        data: [45, 25, 15, 10, 5],
        colors: ['#8b5cf6', '#d946ef', '#3b82f6', '#10b981', '#f59e0b']
      }
    },
    tableHeader: ['Campaign Name', 'Platform', 'Budget Spent', 'Status', 'ROI'],
    tableData: [
      { name: 'Summer Blast 2024', meta: 'Instagram', value: '₹450k', status: 'Active', badge: 'success', extra: '4.2x' },
      { name: 'Q2 Newsletter', meta: 'Email', value: '₹12k', status: 'Paused', badge: 'warn', extra: '0.8x' },
      { name: 'Social Blitz', meta: 'Facebook', value: '₹120k', status: 'Active', badge: 'success', extra: '2.5x' },
      { name: 'Flash Sale App', meta: 'Push', value: '₹65k', status: 'Draft', badge: 'pending', extra: '--' }
    ]
  },
  engineering: {
    title: 'Engineering Hub',
    role: 'Engineering Lead',
    user: 'David Chen',
    theme: {
      primary: '#0f172a',
      light: '#f8fafc',
      soft: '#e2e8f0',
      accent: '#38bdf8'
    },
    kpis: [
      { id: 'stat-active-projects', label: 'Active Projects', value: '9', change: '2 in sprint', icon: 'fa-microchip', color: 'blue' },
      { id: 'stat-tasks', label: 'Tasks Completed', value: '156', change: '94% velocity', icon: 'fa-check-double', color: 'green' },
      { id: 'stat-bugs', label: 'Open Bugs', value: '14', change: '-4 this week', icon: 'fa-bug', color: 'orange' },
      { id: 'stat-sprint-prog', label: 'Sprint Progress', value: '84%', change: 'On track', icon: 'fa-gauge-high', color: 'purple' }
    ],
    charts: {
      performance: {
        type: 'line',
        label: 'Actual Burn',
        data: [100, 82, 60, 40, 18],
        borderColor: '#0ea5e9',
        extra: { label: 'Ideal Burn', data: [100, 75, 50, 25, 0] }
      },
      distribution: {
        type: 'radar',
        labels: ['Security', 'Speed', 'Stability', 'Coverage', 'UI/UX'],
        data: [85, 92, 78, 95, 88],
        colors: ['rgba(14,165,233,0.2)']
      }
    },
    tableHeader: ['Issue ID', 'Title', 'Assignee', 'Status', 'Priority'],
    tableData: [
      { name: '#ENG-104', meta: 'Auth Module V2', value: 'David Chen', status: 'In Progress', badge: 'success', extra: 'High' },
      { name: '#ENG-215', meta: 'Database Migration', value: 'Sarah Connor', status: 'Blocked', badge: 'warn', extra: 'Critical' },
      { name: '#ENG-098', meta: 'UI Refactoring', value: 'Mike Ross', status: 'To Do', badge: 'pending', extra: 'Medium' },
      { name: '#ENG-312', meta: 'API Gateway Fix', value: 'John Smith', status: 'QA Review', badge: 'info', extra: 'Low' }
    ]
  },
  finance: {
    title: 'Financial Dashboard',
    role: 'Finance Controller',
    user: 'Michael Ross',
    theme: {
      primary: '#065f46',
      light: '#f0fdf4',
      soft: '#d1fae5',
      accent: '#f59e0b'
    },
    kpis: [
      { id: 'stat-revenue', label: 'Total Revenue', value: '₹4.2M', change: '+8% vs LY', icon: 'fa-hand-holding-dollar', color: 'green' },
      { id: 'stat-expenses', label: 'Total Expenses', value: '₹1.8M', change: 'Within budget', icon: 'fa-wallet', color: 'red' },
      { id: 'stat-profit', label: 'Net Profit', value: '₹2.4M', change: '12% margin', icon: 'fa-vault', color: 'blue' },
      { id: 'stat-pending', label: 'Pending Payments', value: '₹420k', change: '4 overdue', icon: 'fa-clock-rotate-left', color: 'orange' }
    ],
    charts: {
      performance: {
        type: 'bar',
        label: 'Revenue',
        data: [850, 920, 880, 1100, 1240],
        borderColor: '#10b981',
        extra: { label: 'Expenses', data: [420, 450, 430, 480, 520], color: '#ef4444' }
      },
      distribution: {
        type: 'pie',
        labels: ['Payroll', 'Infrastructure', 'Marketing', 'Legal', 'Reserves'],
        data: [45, 20, 15, 10, 10],
        colors: ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#64748b']
      }
    },
    tableHeader: ['TXN ID', 'Description', 'Date', 'Amount', 'Status'],
    tableData: [
      { name: '#TX-8842', meta: 'AWS Infrastructure', value: 'Apr 28, 2026', status: 'Paid', badge: 'success', extra: '₹45,200' },
      { name: '#TX-9912', meta: 'Office Rent Q2', value: 'Apr 25, 2026', status: 'Paid', badge: 'success', extra: '₹120,000' },
      { name: '#TX-1123', meta: 'Starlink Pro', value: 'Apr 20, 2026', status: 'Overdue', badge: 'warn', extra: '₹8,500' },
      { name: '#TX-5541', meta: 'Client Refund #9', value: 'Apr 18, 2026', status: 'Pending', badge: 'pending', extra: '₹12,400' }
    ]
  }
};

export default deptConfig;

