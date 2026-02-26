import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export const DirectoryProfile: React.FC = () => {
    const { user } = useAuth();
    const [name, setName] = useState(user?.name || '');
    const [password, setPassword] = useState('');

    const [success, setSuccess] = useState('');

    const handleSave = () => {
        setSuccess("Profile updated successfully!"); // In a full implementation, this hits an API
        setTimeout(() => setSuccess(''), 3000);
    };

    return (
        <div style={{ padding: 40, background: '#f8fafc', minHeight: '100%', borderRadius: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
                <span style={{ fontSize: 32 }}>🪪</span>
                <div>
                    <h2 style={{ fontSize: 24, fontWeight: 700, color: '#1e293b', margin: 0 }}>Workspace Directory</h2>
                    <p style={{ color: '#64748b', margin: 0, fontSize: 14 }}>Manage your profile settings and discover other members</p>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 400px) 1fr', gap: 32, alignItems: 'start' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                    {/* User Profile Card */}
                    <div className="glass-panel" style={{ padding: 24, borderRadius: 24, border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                        <div style={{
                            width: 96, height: 96, borderRadius: '50%', background: 'linear-gradient(135deg, var(--color-primary, #6366f1), #8b5cf6)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 36, fontWeight: 600, marginBottom: 16,
                            boxShadow: '0 8px 16px var(--color-primary-glow, rgba(99,102,241,0.3))'
                        }}>
                            👤
                        </div>
                        <h3 style={{ fontSize: 20, color: '#1e293b', marginBottom: 4 }}>{user?.name || 'My Profile'}</h3>
                        <div style={{ background: '#eef2ff', color: '#4f46e5', padding: '4px 12px', borderRadius: 99, fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', marginBottom: 16 }}>
                            {user?.role || 'STANDARD MEMBER'}
                        </div>

                        <div style={{ width: '100%', borderTop: '1px solid #e2e8f0', margin: '16px 0' }} />

                        <div style={{ width: '100%', textAlign: 'left', fontSize: 14, color: '#475569' }}>
                            <div style={{ marginBottom: 12 }}><strong>Email:</strong> {user?.email || 'user@example.com'}</div>
                            <div style={{ marginBottom: 12 }}><strong>Plan Tier:</strong> {user?.plan || 'BASIC'}</div>
                        </div>
                    </div>

                    {/* Profile Settings Form */}
                    <div className="glass-panel" style={{ padding: 24, borderRadius: 24, border: '1px solid #e2e8f0' }}>
                        <h3 style={{ fontSize: 18, color: '#1e293b', marginBottom: 16 }}>Profile Settings</h3>

                        <div style={{ marginBottom: 16 }}>
                            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#475569', marginBottom: 6 }}>Full Name</label>
                            <input
                                value={name} onChange={e => setName(e.target.value)}
                                style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 14, outline: 'none' }}
                            />
                        </div>

                        <div style={{ marginBottom: 16 }}>
                            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#475569', marginBottom: 6 }}>Change Password</label>
                            <input
                                type="password" placeholder="••••••••"
                                value={password} onChange={e => setPassword(e.target.value)}
                                style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 14, outline: 'none' }}
                            />
                        </div>

                        {success && (
                            <div style={{ marginBottom: 16, padding: '10px 14px', background: '#ecfdf5', color: '#047857', borderRadius: 8, fontSize: 13, border: '1px solid #10b981' }}>
                                ✓ {success}
                            </div>
                        )}
                        <button onClick={handleSave} className="nav-item" style={{ width: '100%', justifyContent: 'center', background: '#eef2ff', color: '#4f46e5', fontWeight: 600, border: '1px solid #c7d2fe', borderRadius: 8 }}>
                            Save Changes
                        </button>
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
