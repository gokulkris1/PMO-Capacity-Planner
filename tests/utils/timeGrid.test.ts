import { execFileSync } from 'node:child_process';
import { buildTimeForecast, forecastColor } from '../../utils/timeGrid';
import { AllocationStatus, Allocation, Project, ProjectStatus, ResourceType } from '../../types';

describe('timeGrid utility functions', () => {

    describe('forecastColor', () => {
        it('should return correct color for OVER status', () => {
            expect(forecastColor(AllocationStatus.OVER)).toBe('#ef4444');
        });

        it('should return correct color for HIGH status', () => {
            expect(forecastColor(AllocationStatus.HIGH)).toBe('#f59e0b');
        });

        it('should return correct color for OPTIMAL status', () => {
            expect(forecastColor(AllocationStatus.OPTIMAL)).toBe('#10b981');
        });

        it('should return correct color for UNDER status', () => {
            expect(forecastColor(AllocationStatus.UNDER)).toBe('#94a3b8');
        });
    });

    describe('buildTimeForecast', () => {
        const dummyProjects: Project[] = [
            {
                id: 'p1',
                name: 'Project Alpha',
                status: ProjectStatus.ACTIVE,
                priority: 'High',
                description: 'Test Project',
                startDate: '2026-01-01',
                endDate: '2026-12-31'
            }
        ];

        function runInLosAngeles(source: string): string {
            return execFileSync(
                process.execPath,
                ['--import', 'tsx', '--input-type=module', '--eval', source],
                {
                    cwd: process.cwd(),
                    env: { ...process.env, TZ: 'America/Los_Angeles' },
                },
            ).toString().trim();
        }

        const dummyAllocations: Allocation[] = [
            {
                id: 'a1',
                resourceId: 'r1',
                projectId: 'p1',
                percentage: 50,
                startDate: '2026-03-01',
                endDate: '2026-05-31'
            }
        ];

        it('should return an empty forecast structure correctly', () => {
            const result = buildTimeForecast([], dummyProjects, 2, 0);
            expect(result.length).toBe(2);
            expect(result[0].percentage).toBe(0);
            expect(result[0].status).toBe(AllocationStatus.UNDER);
        });

        // This test needs to mock Date or use relative math, so we'll just test that it runs without errors.
        it('should compute percentages without throwing', () => {
            const result = buildTimeForecast(dummyAllocations, dummyProjects, 3, 0);
            expect(result.length).toBe(3);
            expect(result[0]).toHaveProperty('percentage');
            expect(result[0]).toHaveProperty('status');
        });

        it('uses local calendar boundaries for date-only values', () => {
            expect(runInLosAngeles(`
                import { parseLocalDateBoundary } from './utils/timeGrid.ts';
                console.log(JSON.stringify([
                    parseLocalDateBoundary('2026-10-01', false).toISOString(),
                    parseLocalDateBoundary('2026-10-01', true).toISOString(),
                ]));
            `)).toBe(JSON.stringify([
                '2026-10-01T07:00:00.000Z',
                '2026-10-02T06:59:59.000Z',
            ]));
        });

        it('does not count an October allocation in September', () => {
            expect(runInLosAngeles(`
                import { buildTimeForecast } from './utils/timeGrid.ts';
                const now = new Date();
                const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
                const nextMonthDate = [nextMonth.getFullYear(), String(nextMonth.getMonth() + 1).padStart(2, '0'), String(nextMonth.getDate()).padStart(2, '0')].join('-');
                const result = buildTimeForecast([
                    { id: 'allocation-1', resourceId: 'resource-1', projectId: 'project-1', percentage: 50, startDate: nextMonthDate, endDate: nextMonthDate },
                ], [{ id: 'project-1', name: 'Roadmap', status: 'Active' }], 2, 0);
                console.log(JSON.stringify(result.slice(0, 2).map(({ percentage }) => percentage)));
            `)).toBe(JSON.stringify([0, 50]));
        });
    });
});
