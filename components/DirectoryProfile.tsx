import React from 'react';

export const DirectoryProfile: React.FC = () => {
    return (
        <div style={{ padding: 40, background: '#f8fafc', minHeight: '100%', borderRadius: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
                <span style={{ fontSize: 32 }}>🪪</span>
                <div>
                    <h2 style={{ fontSize: 24, fontWeight: 700, color: '#1e293b', margin: 0 }}>Profile Directory</h2>
                    <p style={{ color: '#64748b', margin: 0, fontSize: 14 }}>View your unified profile and discover other members</p>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 350px) 1fr', gap: 32 }}>
                {/* User Profile Card */}
                <div className="glass-panel" style={{ padding: 24, borderRadius: 24, border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                    <div style={{
                        width: 96, height: 96, borderRadius: '50%', background: 'linear-gradient(135deg, var(--color-primary, #6366f1), #8b5cf6)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 36, fontWeight: 600, marginBottom: 16,
                        boxShadow: '0 8px 16px var(--color-primary-glow, rgba(99,102,241,0.3))'
                    }}>
                        👤
                    </div>
                    <h3 style={{ fontSize: 20, color: '#1e293b', marginBottom: 4 }}>My Profile</h3>
                    <div style={{ background: '#eef2ff', color: '#4f46e5', padding: '4px 12px', borderRadius: 99, fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', marginBottom: 16 }}>
                        STANDARD MEMBER
                    </div>

                    <div style={{ width: '100%', borderTop: '1px solid #e2e8f0', margin: '16px 0' }} />

                    <div style={{ width: '100%', textAlign: 'left', fontSize: 14, color: '#475569' }}>
                        <div style={{ marginBottom: 12 }}><strong>Email:</strong> user@example.com</div>
                        <div style={{ marginBottom: 12 }}><strong>Department:</strong> Product Engineering</div>
                        <div style={{ marginBottom: 12 }}><strong>Active Allocations:</strong> 3 Projects</div>
                    </div>
                </div>

                {/* Org Roster */}
                <div className="glass-panel" style={{ padding: 32, borderRadius: 24, border: '1px solid #e2e8f0' }}>
                    <h3 style={{ fontSize: 20, color: '#1e293b', marginBottom: 16 }}>Organization Roster</h3>
                    <p style={{ fontSize: 14, color: '#64748b', marginBottom: 24 }}>A comprehensive view of active team members across the workspace.</p>

                    <div style={{ padding: 16, background: '#f1f5f9', borderRadius: 12, border: '1px solid #e2e8f0', color: '#475569', fontSize: 14, textAlign: 'center' }}>
                        List of organization members will populate here.
                    </div>
                </div>
            </div>
        </div>
    );
};
