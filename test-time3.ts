import { buildMonthDayForecast } from './utils/timeGrid.js';

const mockAllocations = [
  { projectId: 'p1', resourceId: 'r1', percentage: 100, startDate: null, endDate: null },
  { projectId: 'p2', resourceId: 'r2', percentage: 100, startDate: undefined, endDate: undefined }
];

const mockProjects = [
  { id: 'p1', name: 'Test P1', startDate: null, endDate: null },
  { id: 'p2', name: 'Test P2', startDate: undefined, endDate: undefined } 
];

const res1 = buildMonthDayForecast(2026, 2, [mockAllocations[0]] as any, mockProjects as any);
const res2 = buildMonthDayForecast(2026, 2, [mockAllocations[1]] as any, mockProjects as any);
console.log("Direct dates:", res1.filter(r => r.dayOfMonth >= 4 && r.dayOfMonth <= 12).map(r => `${r.dayOfMonth}: ${r.utilization}%`));
console.log("Fallback dates:", res2.filter(r => r.dayOfMonth >= 4 && r.dayOfMonth <= 12).map(r => `${r.dayOfMonth}: ${r.utilization}%`));
