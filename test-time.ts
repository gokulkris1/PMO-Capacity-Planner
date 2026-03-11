import { buildMonthDayForecast } from './utils/timeGrid.js';

const mockAllocations = [
  { projectId: 'p1', resourceId: 'r1', percentage: 100, startDate: '2026-03-05T00:00:00.000Z', endDate: '2026-03-10T00:00:00.000Z' }
];

const mockProjects = [
  { id: 'p1', name: 'Test P1' }
];

const res = buildMonthDayForecast(2026, 2, mockAllocations as any, mockProjects as any);
console.log(res.filter(r => r.dayOfMonth >= 4 && r.dayOfMonth <= 12).map(r => `${r.dayOfMonth}: ${r.utilization}%`));
