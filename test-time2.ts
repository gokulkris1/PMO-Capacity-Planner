import { buildMonthDayForecast } from './utils/timeGrid.js';

const mockAllocations = [
  { projectId: 'p1', resourceId: 'r1', percentage: 100, startDate: '2026-03-05', endDate: '2026-03-10' },
  { projectId: 'p1', resourceId: 'r1', percentage: 100, startDate: '', endDate: '' } // simulating empty string dates
];

const mockProjects = [
  { id: 'p1', name: 'Test P1', startDate: '2026-03-05', endDate: '2026-03-10' } // and project fallbacks
];

const res1 = buildMonthDayForecast(2026, 2, [mockAllocations[0]] as any, mockProjects as any);
const res2 = buildMonthDayForecast(2026, 2, [mockAllocations[1]] as any, mockProjects as any);
console.log("Direct dates:", res1.filter(r => r.dayOfMonth >= 4 && r.dayOfMonth <= 12).map(r => `${r.dayOfMonth}: ${r.utilization}%`));
console.log("Fallback dates:", res2.filter(r => r.dayOfMonth >= 4 && r.dayOfMonth <= 12).map(r => `${r.dayOfMonth}: ${r.utilization}%`));
