import {
    Allocation,
    Project,
    Resource,
    projectConsumesCapacity,
} from '../types';
import { getCurrentUtil, isAllocActiveOn } from './dateFilteredUtil';

export type StaffingRecommendationStatus =
    | 'ready'
    | 'partially-available'
    | 'rebalancing-needed'
    | 'skill-gap';

export interface ProjectTeamSummary {
    memberCount: number;
    fte: number;
    allocatedPercentage: number;
}

export interface ReallocationPlan {
    sourceResourceId: string;
    sourceProjectId: string;
    sourceAllocationId: string;
    sourceStartDate?: string;
    sourceEndDate?: string;
    replacementResourceId: string;
    targetProjectId: string;
    targetAllocationIncrease: number;
    transferredPercentage: number;
}

export interface StaffingScenarioPlan {
    targetResourceId: string;
    targetProjectId: string;
    targetAllocationIncrease: number;
    reallocation?: ReallocationPlan;
}

export interface StaffingRecommendation {
    resource: Resource;
    requiredSkills: string[];
    matchedSkills: string[];
    missingSkills: string[];
    skillMatchPercent: number;
    currentUtilization: number;
    availableCapacity: number;
    suggestedAllocation: number;
    projectedUtilization: number;
    status: StaffingRecommendationStatus;
    score: number;
    reallocation?: ReallocationPlan;
}

function normalizeSkill(skill: string): string {
    return skill.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function uniqueSkills(skills: string[] | undefined): string[] {
    const seen = new Set<string>();
    return (skills || []).filter(skill => {
        const normalized = normalizeSkill(skill);
        if (!normalized || seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
    });
}

function matchedSkills(resource: Resource, requiredSkills: string[]): string[] {
    const resourceByNormalizedSkill = new Map(
        (resource.skills || [])
            .filter(Boolean)
            .map(skill => [normalizeSkill(skill), skill.trim()]),
    );

    return requiredSkills.filter(skill => resourceByNormalizedSkill.has(normalizeSkill(skill)));
}

function isCapacityAllocation(allocation: Allocation, projects: Project[], date = new Date()): boolean {
    if (!isAllocActiveOn(allocation, date)) return false;
    const project = projects.find(candidate => candidate.id === allocation.projectId);
    return !project || projectConsumesCapacity(project.status);
}

/**
 * Returns team capacity in people and FTE, rather than presenting a summed
 * percentage such as "200%" for two full-time people.
 */
export function getProjectTeamSummary(
    projectId: string,
    allocations: Allocation[],
    date = new Date(),
): ProjectTeamSummary {
    const relevant = allocations.filter(allocation =>
        allocation.projectId === projectId
        && allocation.percentage > 0
        && isAllocActiveOn(allocation, date),
    );

    const allocatedPercentage = relevant.reduce((total, allocation) => total + allocation.percentage, 0);
    return {
        memberCount: new Set(relevant.map(allocation => allocation.resourceId)).size,
        fte: allocatedPercentage / 100,
        allocatedPercentage,
    };
}

function availableCapacityForProject(
    resource: Resource,
    project: Project,
    projects: Project[],
    allocations: Allocation[],
): { currentUtilization: number; existingProjectAllocation: number; availableCapacity: number } {
    const activeTargetAllocation = allocations
        .filter(allocation => allocation.resourceId === resource.id
            && allocation.projectId === project.id
            && isCapacityAllocation(allocation, projects))
        .reduce((total, allocation) => total + allocation.percentage, 0);

    const allocationsOutsideTarget = allocations.filter(allocation =>
        !(allocation.resourceId === resource.id && allocation.projectId === project.id),
    );
    const currentOutsideTarget = getCurrentUtil(allocationsOutsideTarget, resource.id, projects);
    const capacity = resource.totalCapacity || 100;
    const availableCapacity = Math.max(0, capacity - currentOutsideTarget - activeTargetAllocation);

    return {
        currentUtilization: currentOutsideTarget + activeTargetAllocation,
        existingProjectAllocation: activeTargetAllocation,
        availableCapacity,
    };
}

function findReallocationPlan(
    busyResource: Resource,
    targetProject: Project,
    desiredAllocation: number,
    resources: Resource[],
    projects: Project[],
    allocations: Allocation[],
): ReallocationPlan | undefined {
    const targetAllocation = allocations
        .filter(allocation => allocation.resourceId === busyResource.id
            && allocation.projectId === targetProject.id
            && isCapacityAllocation(allocation, projects))
        .reduce((total, allocation) => total + allocation.percentage, 0);
    const capacityNeeded = Math.max(0, desiredAllocation - targetAllocation);
    if (!capacityNeeded) return undefined;

    const moveCandidates = allocations
        .filter(allocation => allocation.resourceId === busyResource.id
            && allocation.projectId !== targetProject.id
            && allocation.percentage > 0
            && isCapacityAllocation(allocation, projects))
        .map(allocation => ({ allocation, project: projects.find(project => project.id === allocation.projectId) }))
        .filter((candidate): candidate is { allocation: Allocation; project: Project } => !!candidate.project)
        .sort((left, right) => {
            const priority = { Low: 0, Medium: 1, High: 2, Critical: 3 } as const;
            return priority[left.project.priority] - priority[right.project.priority];
        });

    for (const candidate of moveCandidates) {
        const sourceRequiredSkills = uniqueSkills(candidate.project.requiredSkills);
        if (!sourceRequiredSkills.length) continue;

        for (const replacement of resources) {
            if (replacement.id === busyResource.id) continue;
            const replacementMatches = matchedSkills(replacement, sourceRequiredSkills);
            if (replacementMatches.length !== sourceRequiredSkills.length) continue;

            const replacementUtilization = getCurrentUtil(allocations, replacement.id, projects);
            const replacementAvailable = Math.max(0, (replacement.totalCapacity || 100) - replacementUtilization);
            const transferable = Math.min(candidate.allocation.percentage, capacityNeeded, replacementAvailable);
            if (transferable <= 0) continue;

            return {
                sourceResourceId: busyResource.id,
                sourceProjectId: candidate.project.id,
                sourceAllocationId: candidate.allocation.id,
                sourceStartDate: candidate.allocation.startDate,
                sourceEndDate: candidate.allocation.endDate,
                replacementResourceId: replacement.id,
                targetProjectId: targetProject.id,
                targetAllocationIncrease: transferable,
                transferredPercentage: transferable,
            };
        }
    }

    return undefined;
}

/**
 * Ranks people for a project using transparent skill coverage and live
 * availability. It is deterministic by design: product teams can explain why
 * a person was suggested before optionally asking an LLM for narrative advice.
 */
export function recommendResourcesForProject(
    project: Project,
    resources: Resource[],
    projects: Project[],
    allocations: Allocation[],
    desiredAllocation = 100,
): StaffingRecommendation[] {
    const requiredSkills = uniqueSkills(project.requiredSkills);
    if (!requiredSkills.length) return [];

    return resources
        .map(resource => {
            const matches = matchedSkills(resource, requiredSkills);
            const missingSkills = requiredSkills.filter(skill => !matches.some(match => normalizeSkill(match) === normalizeSkill(skill)));
            const skillMatchPercent = Math.round((matches.length / requiredSkills.length) * 100);
            const {
                currentUtilization,
                existingProjectAllocation,
                availableCapacity,
            } = availableCapacityForProject(resource, project, projects, allocations);
            const amountStillNeeded = Math.max(0, desiredAllocation - existingProjectAllocation);
            const suggestedAllocation = Math.min(amountStillNeeded, availableCapacity);
            const projectedUtilization = currentUtilization + suggestedAllocation;

            let status: StaffingRecommendationStatus;
            if (skillMatchPercent === 0) {
                status = 'skill-gap';
            } else if (skillMatchPercent === 100 && suggestedAllocation >= amountStillNeeded) {
                status = 'ready';
            } else if (availableCapacity > 0) {
                status = 'partially-available';
            } else {
                status = 'rebalancing-needed';
            }

            const availabilityScore = amountStillNeeded === 0
                ? 100
                : Math.min(100, Math.round((availableCapacity / amountStillNeeded) * 100));
            const score = Math.round((skillMatchPercent * 0.75) + (availabilityScore * 0.25));
            const reallocation = status === 'rebalancing-needed' && skillMatchPercent === 100
                ? findReallocationPlan(resource, project, desiredAllocation, resources, projects, allocations)
                : undefined;

            return {
                resource,
                requiredSkills,
                matchedSkills: matches,
                missingSkills,
                skillMatchPercent,
                currentUtilization,
                availableCapacity,
                suggestedAllocation,
                projectedUtilization,
                status,
                score,
                reallocation,
            };
        })
        .filter(recommendation => recommendation.skillMatchPercent > 0)
        .sort((left, right) => {
            const statusRank: Record<StaffingRecommendationStatus, number> = {
                ready: 0,
                'partially-available': 1,
                'rebalancing-needed': 2,
                'skill-gap': 3,
            };
            return statusRank[left.status] - statusRank[right.status]
                || right.score - left.score
                || left.resource.name.localeCompare(right.resource.name);
        });
}
