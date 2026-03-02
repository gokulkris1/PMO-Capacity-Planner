import React, { useMemo, useState } from 'react';
import { Allocation, Project, Resource, getAllocationStatus, AllocationStatus } from '../types';

interface Props {
    resources: Resource[];
    projects: Project[];
    allocations: Allocation[];
    scenarioAllocations?: Allocation[] | null;
    onEditResource?: (res: Resource) => void;
}

function utilColor(pct: number) {
    const s = getAllocationStatus(pct);
    if (s === AllocationStatus.OVER) return '#ef4444';
    if (s === AllocationStatus.HIGH) return '#f59e0b';
    if (s === AllocationStatus.OPTIMAL) return '#10b981';
    return '#94a3b8';
}

export const SkillsView: React.FC<Props> = ({ resources, projects, allocations, scenarioAllocations, onEditResource }) => {
    const [search, setSearch] = useState('');
    const liveAlloc = scenarioAllocations ?? allocations;

    const skillGroups = useMemo(() => {
        const map = new Map<string, Resource[]>();
        resources.forEach(resource => {
            const skills = (resource.skills || []).map(s => s.trim()).filter(Boolean);
            skills.forEach(skill => {
                if (!map.has(skill)) map.set(skill, []);
                map.get(skill)!.push(resource);
            });
        });

        return Array.from(map.entries())
            .map(([skill, members]) => ({ skill, members }))
            .filter(g => g.skill.toLowerCase().includes(search.toLowerCase()) || g.members.some(m => m.name.toLowerCase().includes(search.toLowerCase())))
            .sort((a, b) => a.skill.localeCompare(b.skill));
    }, [resources, search]);

    if (resources.length > 0 && skillGroups.length === 0 && !resources.some(r => (r.skills || []).length)) {
        return (
            <div className="empty-state page-enter">
                <h3>No skills captured yet</h3>
                <p>Edit a resource and add comma-separated skills to use this view.</p>
            </div>
        );
    }

    return (
        <div className="page-enter" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ position: 'relative', maxWidth: 360 }}>
                <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: 14 }}>🔍</span>
                <input
                    type="text"
                    placeholder="Search skills or people..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="form-input"
                    style={{ paddingLeft: 34 }}
                />
            </div>

            {skillGroups.map(({ skill, members }) => {
                const totalUtil = members.reduce((sum, m) => {
                    return sum + liveAlloc.filter(a => a.resourceId === m.id).reduce((s, a) => s + a.percentage, 0);
                }, 0);
                const avgUtil = members.length ? Math.round(totalUtil / members.length) : 0;

                return (
                    <div key={skill} className="panel">
                        <div className="panel-header" style={{ borderLeft: `4px solid ${utilColor(avgUtil)}` }}>
                            <div>
                                <div className="panel-title">By Skill: {skill}</div>
                                <div className="panel-subtitle">
                                    {members.length} resource{members.length !== 1 ? 's' : ''} · Avg booking {avgUtil}%
                                </div>
                            </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12, padding: 16 }}>
                            {members.map(member => {
                                const memberAllocs = liveAlloc.filter(a => a.resourceId === member.id);
                                const memberUtil = memberAllocs.reduce((s, a) => s + a.percentage, 0);
                                const topProjects = memberAllocs
                                    .map(a => ({ a, p: projects.find(p => p.id === a.projectId) }))
                                    .filter(x => !!x.p)
                                    .sort((x, y) => y.a.percentage - x.a.percentage)
                                    .slice(0, 2);

                                return (
                                    <div key={member.id} style={{ border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                            <div className="avatar" style={{ width: 36, height: 36, fontSize: 12 }}>
                                                {member.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a' }}>{member.name}</div>
                                                <div style={{ fontSize: 11, color: '#64748b' }}>{member.role}</div>
                                            </div>
                                            <div style={{ fontWeight: 800, fontSize: 16, color: utilColor(memberUtil) }}>{memberUtil}%</div>
                                        </div>

                                        <div style={{ height: 7, background: '#f1f5f9', borderRadius: 999, overflow: 'hidden' }}>
                                            <div style={{ height: '100%', width: `${Math.min(100, memberUtil)}%`, background: utilColor(memberUtil) }} />
                                        </div>

                                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                            {(member.skills || []).map(s => (
                                                <span key={`${member.id}-${s}`} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 999, background: s === skill ? '#dbeafe' : '#f1f5f9', color: s === skill ? '#1d4ed8' : '#475569', fontWeight: 600 }}>
                                                    {s}
                                                </span>
                                            ))}
                                        </div>

                                        <div style={{ fontSize: 11, color: '#64748b' }}>
                                            {topProjects.length > 0 ? (
                                                <>Top allocations: {topProjects.map(x => `${x.p!.name} (${x.a.percentage}%)`).join(', ')}</>
                                            ) : (
                                                'No allocations yet'
                                            )}
                                        </div>

                                        {onEditResource && (
                                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                                <button className="btn btn-secondary" style={{ padding: '6px 10px', fontSize: 12 }} onClick={() => onEditResource(member)}>
                                                    Edit Resource
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })}

            {skillGroups.length === 0 && resources.some(r => (r.skills || []).length > 0) && (
                <div className="empty-state">
                    <h3>No matches</h3>
                    <p>Try a different skill or person search term.</p>
                </div>
            )}
        </div>
    );
};
