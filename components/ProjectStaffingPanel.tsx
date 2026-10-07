import React, { useMemo, useState } from 'react';
import { Allocation, Project, Resource, getProjectCapacityImpact, projectConsumesCapacity } from '../types';
import {
    recommendResourcesForProject,
    StaffingRecommendation,
    StaffingScenarioPlan,
} from '../utils/capacityPlanning';
import { getAvatarInitials } from '../utils/avatarInitials';

interface Props {
    project: Project;
    resources: Resource[];
    projects: Project[];
    allocations: Allocation[];
    onPreviewScenario?: (plan: StaffingScenarioPlan) => void;
    onEditProject?: () => void;
}

const STATUS_COPY: Record<ReturnType<typeof getProjectCapacityImpact>, string> = {
    committed: 'Active work counts against live availability.',
    planned: 'Planning work reserves capacity before delivery begins.',
    paused: 'Paused work remains visible but does not consume live availability.',
    historical: 'Historical work is retained for context and does not consume availability.',
};

function statusLabel(recommendation: StaffingRecommendation): string {
    switch (recommendation.status) {
        case 'ready':
            return 'Ready to staff';
        case 'partially-available':
            return 'Partially available';
        case 'rebalancing-needed':
            return 'Rebalance first';
        default:
            return 'Partial skill fit';
    }
}

function statusColors(status: StaffingRecommendation['status']) {
    switch (status) {
        case 'ready':
            return { background: '#ecfdf5', border: '#86efac', text: '#047857' };
        case 'partially-available':
            return { background: '#fffbeb', border: '#fde68a', text: '#a16207' };
        case 'rebalancing-needed':
            return { background: '#fef2f2', border: '#fecaca', text: '#b91c1c' };
        default:
            return { background: '#f8fafc', border: '#cbd5e1', text: '#475569' };
    }
}

export const ProjectStaffingPanel: React.FC<Props> = ({
    project,
    resources,
    projects,
    allocations,
    onPreviewScenario,
    onEditProject,
}) => {
    const [desiredAllocation, setDesiredAllocation] = useState(100);
    const requirements = project.requiredSkills || [];
    const recommendations = useMemo(
        () => recommendResourcesForProject(project, resources, projects, allocations, desiredAllocation),
        [project, resources, projects, allocations, desiredAllocation],
    );
    const capacityImpact = getProjectCapacityImpact(project.status);
    const countsTowardCapacity = projectConsumesCapacity(project.status);

    const preview = (recommendation: StaffingRecommendation) => {
        if (!onPreviewScenario) return;
        const targetAllocationIncrease = recommendation.reallocation?.targetAllocationIncrease
            || recommendation.suggestedAllocation;
        if (targetAllocationIncrease <= 0) return;

        onPreviewScenario({
            targetResourceId: recommendation.resource.id,
            targetProjectId: project.id,
            targetAllocationIncrease,
            reallocation: recommendation.reallocation,
        });
    };

    return (
        <div className="panel">
            <div className="panel-header" style={{ alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                <div>
                    <div className="panel-title">Skill-led staffing</div>
                    <div className="panel-subtitle">
                        Explainable recommendations combine the skills required with live availability.
                    </div>
                </div>
                <div style={{ marginLeft: 'auto', minWidth: 220 }}>
                    <label htmlFor={`desired-capacity-${project.id}`} style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--n-600)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 5 }}>
                        Capacity to staff
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                            id={`desired-capacity-${project.id}`}
                            type="number"
                            min={5}
                            max={100}
                            step={5}
                            value={desiredAllocation}
                            onChange={event => setDesiredAllocation(Math.max(5, Math.min(100, Number(event.target.value) || 5)))}
                            className="form-input"
                            style={{ width: 84, padding: '7px 9px' }}
                            aria-label="Capacity to staff for this recommendation"
                        />
                        <span style={{ fontSize: 12, color: 'var(--n-600)', fontWeight: 600 }}>% of one person</span>
                    </div>
                </div>
            </div>

            <div style={{ padding: '0 20px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', border: '1px solid var(--n-300)', borderRadius: 8, background: 'var(--n-50)' }}>
                    <span aria-hidden="true">{countsTowardCapacity ? '●' : '○'}</span>
                    <div style={{ fontSize: 12, color: 'var(--n-700)', lineHeight: 1.5 }}>
                        <strong>{project.status}:</strong> {STATUS_COPY[capacityImpact]}
                    </div>
                </div>

                <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--n-600)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 7 }}>
                        Required skills
                    </div>
                    {requirements.length > 0 ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {requirements.map(skill => (
                                <span key={skill} style={{ fontSize: 12, padding: '4px 9px', borderRadius: 999, background: 'var(--brand-50)', color: 'var(--brand-700)', fontWeight: 700, border: '1px solid var(--brand-200)' }}>
                                    {skill}
                                </span>
                            ))}
                        </div>
                    ) : (
                        <div style={{ border: '1px dashed var(--n-400)', borderRadius: 8, padding: '12px', color: 'var(--n-600)', fontSize: 13 }}>
                            Add the skills this project needs to unlock availability-aware recommendations.
                            {onEditProject && (
                                <button type="button" className="btn btn-secondary" style={{ marginLeft: 10, padding: '5px 9px', fontSize: 12 }} onClick={onEditProject}>
                                    Add skills
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {requirements.length > 0 && recommendations.length === 0 && (
                    <div className="empty-state" style={{ padding: '22px 12px' }}>
                        <h3>No skill matches yet</h3>
                        <p>Add skills to people or revise the requirements to surface recommendations.</p>
                    </div>
                )}

                {recommendations.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
                        {recommendations.slice(0, 6).map(recommendation => {
                            const colors = statusColors(recommendation.status);
                            const canPreview = recommendation.suggestedAllocation > 0 || !!recommendation.reallocation;
                            const replacement = recommendation.reallocation
                                ? resources.find(resource => resource.id === recommendation.reallocation!.replacementResourceId)
                                : undefined;
                            const sourceProject = recommendation.reallocation
                                ? projects.find(candidate => candidate.id === recommendation.reallocation!.sourceProjectId)
                                : undefined;

                            return (
                                <article key={recommendation.resource.id} style={{ border: `1px solid ${colors.border}`, background: '#fff', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <div className="avatar" style={{ width: 38, height: 38, fontSize: 12, background: 'var(--brand-50)', color: 'var(--brand-700)' }}>
                                            {getAvatarInitials(recommendation.resource.name)}
                                        </div>
                                        <div style={{ minWidth: 0, flex: 1 }}>
                                            <div style={{ fontSize: 13, color: 'var(--n-800)', fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {recommendation.resource.name}
                                            </div>
                                            <div style={{ fontSize: 11, color: 'var(--n-600)' }}>{recommendation.resource.role}</div>
                                        </div>
                                        <span style={{ fontSize: 11, padding: '4px 7px', borderRadius: 999, background: colors.background, border: `1px solid ${colors.border}`, color: colors.text, fontWeight: 800, whiteSpace: 'nowrap' }}>
                                            {statusLabel(recommendation)}
                                        </span>
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, fontSize: 11 }}>
                                        <div style={{ background: 'var(--n-50)', borderRadius: 7, padding: '7px 8px' }}>
                                            <div style={{ color: 'var(--n-500)' }}>Skill fit</div>
                                            <strong style={{ color: 'var(--n-800)' }}>{recommendation.skillMatchPercent}%</strong>
                                        </div>
                                        <div style={{ background: 'var(--n-50)', borderRadius: 7, padding: '7px 8px' }}>
                                            <div style={{ color: 'var(--n-500)' }}>Available</div>
                                            <strong style={{ color: 'var(--n-800)' }}>{recommendation.availableCapacity}%</strong>
                                        </div>
                                        <div style={{ background: 'var(--n-50)', borderRadius: 7, padding: '7px 8px' }}>
                                            <div style={{ color: 'var(--n-500)' }}>After</div>
                                            <strong style={{ color: recommendation.projectedUtilization > 100 ? 'var(--over)' : 'var(--n-800)' }}>{recommendation.projectedUtilization}%</strong>
                                        </div>
                                    </div>

                                    <div style={{ fontSize: 11, color: 'var(--n-600)', lineHeight: 1.45 }}>
                                        <strong style={{ color: 'var(--n-700)' }}>Matches:</strong> {recommendation.matchedSkills.join(', ') || 'No required skills'}
                                        {recommendation.missingSkills.length > 0 && <> · Missing: {recommendation.missingSkills.join(', ')}</>}
                                    </div>

                                    {recommendation.reallocation && sourceProject && replacement && (
                                        <div style={{ borderRadius: 8, padding: '9px 10px', background: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412', fontSize: 11, lineHeight: 1.45 }}>
                                            <strong>What-if rebalance:</strong> move {recommendation.reallocation.transferredPercentage}% of {recommendation.resource.name}'s work on {sourceProject.name} to {replacement.name}, then assign that capacity here.
                                        </div>
                                    )}

                                    {canPreview && (
                                        <button type="button" className="btn btn-secondary" onClick={() => preview(recommendation)} style={{ width: '100%', fontSize: 12 }}>
                                            {recommendation.reallocation ? 'Preview rebalance in What-If' : `Preview ${recommendation.suggestedAllocation}% in What-If`}
                                        </button>
                                    )}
                                </article>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};
