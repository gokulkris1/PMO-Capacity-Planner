import {
    Allocation,
    Project,
    ProjectStatus,
    Resource,
    ResourceType,
    getProjectCapacityImpact,
} from '../../types';
import { getUtilAtDate } from '../../utils/dateFilteredUtil';
import {
    getProjectTeamSummary,
    recommendResourcesForProject,
} from '../../utils/capacityPlanning';

const project = (overrides: Partial<Project>): Project => ({
    id: 'project',
    name: 'Project',
    status: ProjectStatus.ACTIVE,
    priority: 'Medium',
    description: '',
    ...overrides,
});

const resource = (overrides: Partial<Resource>): Resource => ({
    id: 'resource',
    name: 'Resource Name',
    role: 'Engineer',
    type: ResourceType.PERMANENT,
    department: 'Technology',
    totalCapacity: 100,
    skills: [],
    ...overrides,
});

describe('commercial capacity-planning rules', () => {
    it('counts Active and Planning work but not paused or historical work toward availability', () => {
        const projects = [
            project({ id: 'active', status: ProjectStatus.ACTIVE }),
            project({ id: 'planning', status: ProjectStatus.PLANNING }),
            project({ id: 'hold', status: ProjectStatus.ON_HOLD }),
            project({ id: 'suspended', status: ProjectStatus.SUSPENDED }),
            project({ id: 'complete', status: ProjectStatus.COMPLETED }),
            project({ id: 'called-off', status: ProjectStatus.CALLED_OFF }),
            project({ id: 'archived', status: ProjectStatus.ARCHIVED }),
        ];
        const allocations: Allocation[] = projects.map((item, index) => ({
            id: `a-${item.id}`,
            resourceId: 'r1',
            projectId: item.id,
            percentage: (index + 1) * 10,
        }));

        expect(getUtilAtDate(allocations, 'r1', new Date(2026, 0, 1), projects)).toBe(30);
        expect(getProjectCapacityImpact(ProjectStatus.ON_HOLD)).toBe('paused');
        expect(getProjectCapacityImpact(ProjectStatus.ARCHIVED)).toBe('historical');
    });

    it('reports a project team as people and FTE instead of a misleading combined percentage', () => {
        const allocations: Allocation[] = [
            { id: 'a1', resourceId: 'ada', projectId: 'project', percentage: 100 },
            { id: 'a2', resourceId: 'grace', projectId: 'project', percentage: 100 },
        ];

        expect(getProjectTeamSummary('project', allocations)).toEqual({
            memberCount: 2,
            fte: 2,
            allocatedPercentage: 200,
        });
    });

    it('ranks a skill-matched available person and shows the projected allocation', () => {
        const target = project({ id: 'target', status: ProjectStatus.PLANNING, requiredSkills: ['React', 'UX Research'] });
        const projects = [target, project({ id: 'source', requiredSkills: ['React'] })];
        const ada = resource({ id: 'ada', name: 'Ada Lovelace', skills: ['React', 'UX Research'] });
        const grace = resource({ id: 'grace', name: 'Grace Hopper', skills: ['React'] });
        const allocations: Allocation[] = [
            { id: 'a1', resourceId: 'ada', projectId: 'source', percentage: 30 },
        ];

        const recommendation = recommendResourcesForProject(target, [ada, grace], projects, allocations, 70)
            .find(item => item.resource.id === 'ada');

        expect(recommendation).toMatchObject({
            skillMatchPercent: 100,
            availableCapacity: 70,
            suggestedAllocation: 70,
            projectedUtilization: 100,
            status: 'ready',
        });
    });

    it('offers an explainable reallocation plan when the best skill fit is fully booked', () => {
        const target = project({ id: 'target', status: ProjectStatus.PLANNING, requiredSkills: ['React'] });
        const source = project({ id: 'source', status: ProjectStatus.ACTIVE, priority: 'Low', requiredSkills: ['React'] });
        const ada = resource({ id: 'ada', name: 'Ada Lovelace', skills: ['React'] });
        const grace = resource({ id: 'grace', name: 'Grace Hopper', skills: ['React'] });
        const allocations: Allocation[] = [
            { id: 'a1', resourceId: 'ada', projectId: 'source', percentage: 100, startDate: '2020-01-01', endDate: '2099-12-31' },
        ];

        const recommendation = recommendResourcesForProject(target, [ada, grace], [target, source], allocations, 25)
            .find(item => item.resource.id === 'ada');

        expect(recommendation).toMatchObject({
            status: 'rebalancing-needed',
            reallocation: {
                sourceResourceId: 'ada',
                sourceProjectId: 'source',
                sourceAllocationId: 'a1',
                sourceStartDate: '2020-01-01',
                sourceEndDate: '2099-12-31',
                replacementResourceId: 'grace',
                targetProjectId: 'target',
                transferredPercentage: 25,
            },
        });
    });
});
