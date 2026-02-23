
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import './index.css';

import { Resource, Project, Allocation, ViewTab, getAllocationStatus, AllocationStatus } from './types';
import { MOCK_RESOURCES, MOCK_PROJECTS, MOCK_ALLOCATIONS, TEAMS } from './constants';
import { getCapacityInsights } from './services/geminiService';

import { Dashboard } from './components/Dashboard';
import { AllocationMatrix } from './components/AllocationMatrix';
import { ProjectView } from './components/ProjectView';
import { ResourceView } from './components/ResourceView';
import { TeamView } from './components/TeamView';
import { WhatIfPanel } from './components/WhatIfPanel';
import { ResourceModal, ProjectModal, ConfirmModal } from './components/Modals';
import { AllocationModal } from './components/AllocationModal';
import { JiraImportModal } from './components/JiraImportModal';
import { TourOverlay } from './components/TourOverlay';
import { useAuth } from './context/AuthContext';
import { Login } from './components/Login';
import { ImportCSVModal } from './components/ImportCSVModal';
import { PricingPage } from './components/PricingPage';
import { exportExecSummaryPDF } from './utils/pdfExport';
import { AdminPanel } from './components/AdminPanel';
import { SuperAdminPanel } from './components/SuperAdminPanel';

const APP_VERSION = '1.0.0';

/* ── helpers ──────────────────────────────────────────────── */
function getUtil(allocs: Allocation[], resId: string) {
  return allocs.filter(a => a.resourceId === resId).reduce((s, a) => s + a.percentage, 0);
}

function utilColor(pct: number) {
  const s = getAllocationStatus(pct);
  if (s === AllocationStatus.OVER) return '#ef4444';
  if (s === AllocationStatus.HIGH) return '#f59e0b';
  if (s === AllocationStatus.OPTIMAL) return '#10b981';
  return '#94a3b8';
}

/* ── NAV CONFIG ────────────────────────────────────────────── */
const NAV_ITEMS: { id: ViewTab; label: string; icon: string; section?: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊', section: 'Overview' },
  { id: 'allocations', label: 'Allocation Matrix', icon: '⊞', section: 'Views' },
  { id: 'by-project', label: 'By Project', icon: '🚀' },
  { id: 'by-resource', label: 'By Individual', icon: '👤' },
  { id: 'by-team', label: 'By Team', icon: '👥' },
  { id: 'what-if', label: 'What-If Scenarios', icon: '🔬', section: 'Planning' },
];

/* ── TYPES for modal state ─────────────────────────────────── */
type ModalState =
  | { type: 'none' }
  | { type: 'addResource' }
  | { type: 'editResource'; resource: Resource }
  | { type: 'addProject' }
  | { type: 'editProject'; project: Project }
  | { type: 'deleteResource'; resource: Resource }
  | { type: 'deleteProject'; project: Project }
  | { type: 'importCSV' }
  | { type: 'login' };

/* ─────────────────────────────────────────────────────────── */
const App: React.FC = () => {
  const { user, logout, isLoading } = useAuth();
  // Guests see demo data; logged-in users get their own scoped workspace
  const storageKey = useCallback((key: string) =>
    user ? `pcp_${user.id}_${key}` : `pcp_${key}`
    , [user]);

  /* data state — guests start with MOCK, authenticated users start empty */
  const [resources, setResources] = useState<Resource[]>(user ? [] : MOCK_RESOURCES);
  const [projects, setProjects] = useState<Project[]>(user ? [] : MOCK_PROJECTS);
  const [allocations, setAllocations] = useState<Allocation[]>(user ? [] : MOCK_ALLOCATIONS);

  /* ui state */
  const [activeTab, setActiveTab] = useState<ViewTab>('dashboard');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<ModalState>({ type: 'none' });
  const [activeAllocationModal, setActiveAllocationModal] = useState<{ resId: string, projId: string } | null>(null);
  const [showTour, setShowTour] = useState(false);
  const [showPricing, setShowPricing] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showSuperAdmin, setShowSuperAdmin] = useState(false);

  /* tenant state */
  const [workspaceName, setWorkspaceName] = useState<string>('Default Workspace');
  const [orgName, setOrgName] = useState<string>('My Organization');

  /* scenario state */
  const [scenarioMode, setScenarioMode] = useState(false);
  const [scenarioAllocations, setScenarioAllocations] = useState<Allocation[] | null>(null);

  /* AI state */
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);

  /* Auth-gate: queue an action and show login if not authenticated */
  const pendingActionRef = React.useRef<(() => void) | null>(null);
  const authGate = useCallback((action: () => void) => {
    if (user) {
      action();
    } else {
      pendingActionRef.current = action;
      setModal({ type: 'login' });
    }
  }, [user]);

  /* Called when login succeeds – fires the pending action if any */
  const onLoginSuccess = useCallback(() => {
    setModal({ type: 'none' });
    if (pendingActionRef.current) {
      // Defer a tick so AuthContext has updated the user
      setTimeout(() => {
        pendingActionRef.current?.();
        pendingActionRef.current = null;
      }, 50);
    }
  }, []);

  const initialLoadDone = React.useRef(false);
  const syncTimeoutRef = React.useRef<any>(null);

  // Load/switch data when user logs in or out
  useEffect(() => {
    if (user) {
      // Authenticated — instantly clear demo data to avoid bleed-over
      initialLoadDone.current = false;
      setResources([]);
      setProjects([]);
      setAllocations([]);

      const token = localStorage.getItem('pcp_token');
      fetch('/api/workspace', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
        .then(res => res.json())
        .then(data => {
          if (data.resources) setResources(data.resources);
          if (data.projects) setProjects(data.projects);
          if (data.allocations) setAllocations(data.allocations);
          if (data.orgName) setOrgName(data.orgName);
          if (data.workspaceName) setWorkspaceName(data.workspaceName);
          initialLoadDone.current = true;
        })
        .catch(err => {
          console.error('Failed to load workspace', err);
          initialLoadDone.current = true;
        });
    } else {
      // Guest/demo — restore demo data
      initialLoadDone.current = false;
      const rs = localStorage.getItem('pcp_resources');
      const ps = localStorage.getItem('pcp_projects');
      const al = localStorage.getItem('pcp_allocations');
      setResources(rs && rs !== "[]" ? JSON.parse(rs) : MOCK_RESOURCES);
      setProjects(ps && ps !== "[]" ? JSON.parse(ps) : MOCK_PROJECTS);
      setAllocations(al && al !== "[]" ? JSON.parse(al) : MOCK_ALLOCATIONS);
      initialLoadDone.current = true;
    }

    if (!localStorage.getItem('pcp_tour_done')) {
      setTimeout(() => setShowTour(true), 600);
    }
  }, [user?.id]);

  // Persist data — sync to Postgres when authenticated, localStorage when guest
  useEffect(() => {
    if (!initialLoadDone.current) return;

    if (user) {
      // Debounce Postgres sync by 1.5s
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = setTimeout(() => {
        const token = localStorage.getItem('pcp_token');
        if (!token) return;
        fetch('/api/workspace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ resources, projects, allocations })
        }).then(async res => {
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            if (res.status === 403) {
              alert('Free Plan Limit Exceeded: ' + (data.error || 'You have exceeded your Free tier limits. Data will not be saved.'));
              setShowPricing(true);
            } else {
              console.error('Failed to sync workspace');
            }
          }
        }).catch(err => console.error('Sync failed', err));
      }, 1500);
    } else {
      // Demo users still save to local storage
      localStorage.setItem('pcp_resources', JSON.stringify(resources));
      localStorage.setItem('pcp_projects', JSON.stringify(projects));
      localStorage.setItem('pcp_allocations', JSON.stringify(allocations));
    }
  }, [resources, projects, allocations, user?.id]);


  /* ── derived stats ──────────────────────────────────────── */
  const liveAlloc = scenarioMode && scenarioAllocations ? scenarioAllocations : allocations;

  const overAllocCount = useMemo(() =>
    resources.filter(r => getUtil(liveAlloc, r.id) > 100).length
    , [resources, liveAlloc]);

  /* ── AI handler ─────────────────────────────────────────── */
  const handleAiAsk = useCallback(async (prompt: string) => {
    setIsAiLoading(true);
    const resp = await getCapacityInsights(resources, projects, liveAlloc, prompt);
    setAiResponse(resp);
    setIsAiLoading(false);
  }, [resources, projects, liveAlloc]);

  /* ── allocation CRUD ────────────────────────────────────── */
  const updateAllocation = useCallback((resId: string, projId: string, val: string) => {
    const num = Math.min(200, Math.max(0, parseInt(val) || 0));
    const setTarget = scenarioMode
      ? (fn: (a: Allocation[]) => Allocation[]) => setScenarioAllocations(prev => fn(prev ?? allocations))
      : (fn: (a: Allocation[]) => Allocation[]) => setAllocations(fn);

    setTarget(prev => {
      const existing = prev.find(a => a.resourceId === resId && a.projectId === projId);
      if (existing) {
        return num === 0
          ? prev.filter(a => !(a.resourceId === resId && a.projectId === projId))
          : prev.map(a => a.resourceId === resId && a.projectId === projId ? { ...a, percentage: num } : a);
      }
      if (num === 0) return prev;
      return [...prev, { id: `a-${Date.now()}-${Math.random().toString(36).slice(2)}`, resourceId: resId, projectId: projId, percentage: num }];
    });
  }, [scenarioMode, allocations]);

  const updateAllocationsAdvanced = useCallback((resId: string, projId: string, newSlices: Allocation[]) => {
    const setTarget = scenarioMode
      ? (fn: (a: Allocation[]) => Allocation[]) => setScenarioAllocations(prev => fn(prev ?? allocations))
      : (fn: (a: Allocation[]) => Allocation[]) => setAllocations(fn);

    setTarget(prev => {
      const filtered = prev.filter(a => !(a.resourceId === resId && a.projectId === projId));
      return [...filtered, ...newSlices];
    });
    setActiveAllocationModal(null);
  }, [scenarioMode, allocations]);

  /* ── scenario helpers ───────────────────────────────────── */
  const enterScenario = () => {
    setScenarioAllocations(JSON.parse(JSON.stringify(allocations)));
    setScenarioMode(true);
    setActiveTab('what-if');
  };
  const applyScenario = () => {
    if (scenarioAllocations) setAllocations(scenarioAllocations);
    setScenarioAllocations(null);
    setScenarioMode(false);
  };
  const discardScenario = () => {
    setScenarioAllocations(null);
    setScenarioMode(false);
  };

  /* ── resource CRUD ──────────────────────────────────────── */
  const saveResource = (data: Partial<Resource>) => {
    // Freemium limit: 5 resources max without a paid plan
    const userPlan = user?.plan || 'FREE';
    if (modal.type === 'addResource' && userPlan === 'FREE' && resources.length >= 5) {
      setModal({ type: 'none' });
      setTimeout(() => setShowPricing(true), 150);
      return;
    }
    if (modal.type === 'editResource') {
      setResources(prev => prev.map(r => r.id === modal.resource.id ? { ...r, ...data } : r));
    } else {
      const newRes: Resource = { id: `r-${Date.now()}`, name: '', role: '', type: 'Permanent' as any, department: '', totalCapacity: 100, ...data };
      setResources(prev => [newRes, ...prev]);
    }
    setModal({ type: 'none' });
  };

  const deleteResource = (id: string) => {
    setResources(prev => prev.filter(r => r.id !== id));
    setAllocations(prev => prev.filter(a => a.resourceId !== id));
  };

  /* ── project CRUD ───────────────────────────────────────── */
  const saveProject = (data: Partial<Project>) => {
    // Freemium limit: 1 project max without a paid plan
    const userPlan = user?.plan || 'FREE';
    const ownProjects = projects.filter(p => p.id !== 'demo');
    if (modal.type === 'addProject' && userPlan === 'FREE' && ownProjects.length >= 1) {
      setModal({ type: 'none' });
      setTimeout(() => setShowPricing(true), 150);
      return;
    }
    if (modal.type === 'editProject') {
      setProjects(prev => prev.map(p => p.id === modal.project.id ? { ...p, ...data } : p));
    } else {
      const newProj: Project = { id: `p-${Date.now()}`, name: '', status: 'Planning' as any, priority: 'Medium', description: '', ...data };
      setProjects(prev => [newProj, ...prev]);
    }
    setModal({ type: 'none' });
  };

  const deleteProject = (id: string) => {
    setProjects(prev => prev.filter(p => p.id !== id));
    setAllocations(prev => prev.filter(a => a.projectId !== id));
  };

  /* ── bulk import ────────────────────────────────────────── */
  const handleBulkImport = (newRes: Resource[], newProj: Project[], newAlloc: Allocation[]) => {
    setResources(newRes);
    setProjects(newProj);
    setAllocations(newAlloc);
    setModal({ type: 'none' });
  };

  /* ── CSV export ─────────────────────────────────────────── */
  const exportCSV = () => {
    const headers = ['Resource', 'Role', 'Department', 'Project', 'Project Status', 'Allocation %'];
    const rows = allocations.map(a => {
      const res = resources.find(r => r.id === a.resourceId);
      const proj = projects.find(p => p.id === a.projectId);
      return [res?.name || '', res?.role || '', res?.department || '', proj?.name || '', proj?.status || '', String(a.percentage)];
    });
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'capacity_allocations.csv';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  /* ── render helpers ─────────────────────────────────────── */
  const PAGE_TITLES: Record<ViewTab, { title: string; subtitle: string }> = {
    'dashboard': { title: 'Dashboard', subtitle: 'Portfolio capacity overview' },
    'allocations': { title: 'Allocation Matrix', subtitle: 'Edit resource-to-project assignments' },
    'by-project': { title: 'By Project', subtitle: 'Capacity committed per project' },
    'by-resource': { title: 'By Individual', subtitle: 'How each person is spread across projects' },
    'by-team': { title: 'By Team', subtitle: 'Team-level allocation heatmap' },
    'what-if': { title: 'What-If Scenarios', subtitle: 'Explore hypothetical reallocation scenarios' },
  };

  const current = PAGE_TITLES[activeTab];

  if (isLoading) {
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-app)', color: 'var(--text-main)', fontFamily: 'Inter' }}>Loading...</div>;
  }

  return (
    <div className="app-shell">
      {/* ── SIDEBAR ─────────────────────────────────── */}
      <aside className="sidebar">
        {/* Logo */}
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">📊</div>
          <div>
            <div className="sidebar-logo-text">PMO Planner</div>
            <div className="sidebar-logo-sub">Capacity Management</div>
          </div>
        </div>

        {/* ── Workspace Tenant Info ── */}
        {user && (
          <div style={{ padding: '0 12px', marginTop: 12 }}>
            <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 4 }}>
                {orgName}
              </div>
              <div style={{ fontSize: 13, color: '#f1f5f9', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: '#6366f1' }}>↳</span> {workspaceName}
              </div>
            </div>
          </div>
        )}

        {/* ── Auth Row: always at top of sidebar ── */}
        <div style={{ padding: '12px 12px 0' }}>
          {user ? (
            <div style={{ background: 'rgba(99,102,241,0.12)', borderRadius: 12, padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>👤</div>
                <div style={{ overflow: 'hidden' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#f1f5f9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.name || user.email}</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>{(user.plan || 'FREE')} plan</div>
                </div>
              </div>
              <button onClick={logout} title="Log out" style={{ background: 'none', border: '1px solid #334155', borderRadius: 8, color: '#94a3b8', fontSize: 11, padding: '4px 8px', cursor: 'pointer', flexShrink: 0 }}>Out</button>
            </div>
          ) : (
            <button
              onClick={() => { pendingActionRef.current = null; setModal({ type: 'login' }); }}
              style={{
                width: '100%', padding: '11px 16px',
                background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                border: 'none', borderRadius: 12, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 10,
                color: '#fff', fontWeight: 700, fontSize: 14,
                boxShadow: '0 4px 16px rgba(99,102,241,0.35)',
              }}
            >
              <span style={{ fontSize: 18 }}>🔑</span>
              <span>Log In / Sign Up</span>
            </button>
          )}
        </div>

        {/* Nav */}
        <nav className="sidebar-nav" style={{ flex: 1, overflowY: 'auto' }}>
          {NAV_ITEMS.map((item, i) => {
            const prev = i > 0 ? NAV_ITEMS[i - 1] : null;
            return (
              <React.Fragment key={item.id}>
                {item.section && item.section !== prev?.section && (
                  <div className="nav-section-label">{item.section}</div>
                )}
                <button
                  className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
                  onClick={() => {
                    if (item.id === 'what-if' && !scenarioMode) {
                      enterScenario();
                    } else {
                      setActiveTab(item.id);
                    }
                  }}
                >
                  <span style={{ fontSize: 15 }}>{item.icon}</span>
                  <span>{item.label}</span>
                  {item.id === 'dashboard' && overAllocCount > 0 && (
                    <span className="nav-badge">{overAllocCount}</span>
                  )}
                </button>
              </React.Fragment>
            );
          })}

          {/* Quick Add / Pricing */}
          <div style={{ marginTop: 16, borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 14 }}>
            {/* Pricing always visible */}
            <button
              className="nav-item"
              onClick={() => setShowPricing(true)}
              style={{
                background: user?.plan && user.plan !== 'FREE'
                  ? 'rgba(16,185,129,0.1)'
                  : 'rgba(99,102,241,0.1)',
                borderRadius: 10, marginBottom: 6,
                border: '1px solid rgba(99,102,241,0.2)',
              }}
            >
              <span style={{ fontSize: 14 }}>💎</span>
              <span style={{ fontWeight: 600, color: '#a5b4fc' }}>
                {user?.plan && user.plan !== 'FREE' ? `${user.plan} Plan` : 'View Pricing'}
              </span>
            </button>

            <div className="nav-section-label">Quick Add {!user && <span style={{ fontSize: 10, opacity: .6 }}>🔒</span>}</div>
            <button className="nav-item" onClick={() => authGate(() => setModal({ type: 'addResource' }))}>
              <span style={{ fontSize: 15 }}>👤</span><span>Add Resource</span>
            </button>
            <button className="nav-item" onClick={() => authGate(() => setModal({ type: 'addProject' }))}>
              <span style={{ fontSize: 15 }}>🚀</span><span>Add Project</span>
            </button>
          </div>

          {/* Data Management */}
          <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 14 }}>
            <div className="nav-section-label">Data</div>
            <button className="nav-item" onClick={() => exportExecSummaryPDF(resources, projects, liveAlloc)}>
              <span style={{ fontSize: 15 }}>📄</span><span>Exec Summary (PDF)</span>
            </button>
            <button className="nav-item" onClick={exportCSV}>
              <span style={{ fontSize: 15 }}>⬇️</span><span>Export CSV</span>
            </button>
            <button className="nav-item" onClick={() => authGate(() => setModal({ type: 'importCSV' }))}>
              <span style={{ fontSize: 15 }}>⬆️</span><span>Import CSV {!user && '🔒'}</span>
            </button>
            <button className="nav-item" onClick={() => authGate(() => {
              if (window.confirm('Reset all data to demo defaults?')) {
                localStorage.clear();
                setResources(MOCK_RESOURCES);
                setProjects(MOCK_PROJECTS);
                setAllocations(MOCK_ALLOCATIONS);
                discardScenario();
              }
            })}>
              <span style={{ fontSize: 15 }}>🔄</span><span>Reset to Demo {!user && '🔒'}</span>
            </button>
          </div>

          {/* Superuser Console — SUPERUSER role only */}
          {user?.role === 'SUPERUSER' && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,.06)' }}>
              <button className="nav-item" onClick={() => setShowSuperAdmin(true)}
                style={{ background: 'rgba(244,63,94,0.12)', border: '1px solid rgba(244,63,94,0.3)', borderRadius: 10 }}>
                <span style={{ fontSize: 15 }}>🦸</span><span style={{ color: '#f43f5e', fontWeight: 700 }}>Superuser Console</span>
              </button>
            </div>
          )}

          {/* Admin Panel - PMO role */}
          {user && ['PMO', 'SUPERUSER', 'ADMIN'].includes(user.role?.toUpperCase()) && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,.06)' }}>
              <button className="nav-item" onClick={() => setShowAdmin(true)}>
                <span style={{ fontSize: 15 }}>⚙️</span><span style={{ color: '#fbbf24', fontWeight: 600 }}>Admin Panel</span>
              </button>
            </div>
          )}

          {/* Take a Tour */}
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,.06)' }}>
            <button className="nav-item" onClick={() => setShowTour(true)}>
              <span style={{ fontSize: 15 }}>🎓</span><span>Take a Tour</span>
            </button>
          </div>
        </nav>

        {/* Sidebar Footer: AI widget + version */}
        <div className="sidebar-footer">
          <div className="ai-widget">
            <div className="ai-widget-header">
              <div className="ai-pulse" />
              <span className="ai-widget-label">AI Advisor</span>
              {!user && <span style={{ fontSize: 10, color: '#64748b', marginLeft: 4 }}>🔒 login to use</span>}
            </div>
            <div className="ai-widget-desc">Ask about capacity, risks, or reallocation ideas.</div>
            <div className="ai-input-wrap">
              <input
                className="ai-input"
                placeholder={user ? 'Ask about your team...' : 'Log in to ask AI...'}
                disabled={!user}
                onKeyDown={e => {
                  if (!user) { setModal({ type: 'login' }); return; }
                  if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                    handleAiAsk((e.target as HTMLInputElement).value);
                    (e.target as HTMLInputElement).value = '';
                    setActiveTab('what-if');
                  }
                }}
              />
              <button className="ai-send-btn">→</button>
            </div>
          </div>
          {/* Version number */}
          <div style={{ textAlign: 'center', fontSize: 10, color: '#334155', padding: '6px 0 2px', letterSpacing: '0.04em' }}>
            PMO Planner v{APP_VERSION}
          </div>
        </div>
      </aside>

      {/* ── MAIN ──────────────────────────────────────── */}
      <main className="main-content">
        {/* Header */}
        <header className="app-header">
          <div>
            <div className="header-title">
              {current.title}
              <span>{current.subtitle}</span>
            </div>
          </div>
          <div className="header-actions">
            <div className="search-wrap">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><circle cx={11} cy={11} r={8} /><path d="m21 21-4.3-4.3" /></svg>
              <input className="search-input" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>

            {!scenarioMode ? (
              <button className="btn btn-warning" onClick={enterScenario}>🔬 What-If</button>
            ) : (
              <>
                <button className="btn btn-success" onClick={applyScenario}>✅ Apply</button>
                <button className="btn btn-danger" onClick={discardScenario}>✕ Discard</button>
              </>
            )}
            <button className="btn btn-primary" onClick={() => authGate(() => setModal({ type: 'addResource' }))}>
              + Resource {!user && '🔒'}
            </button>
            <button className="btn btn-secondary" onClick={() => authGate(() => setModal({ type: 'addProject' }))}>
              + Project {!user && '🔒'}
            </button>
          </div>
        </header>

        {/* Scenario banner */}
        {scenarioMode && (
          <div className="scenario-banner">
            <span>🔬</span>
            <span><b>What-If Mode Active</b> – all allocation changes are sandboxed and won't affect live data until you apply them.</span>
            <div className="scenario-banner-actions">
              <button className="btn btn-success" style={{ padding: '5px 12px', fontSize: 12 }} onClick={applyScenario}>Apply Scenario</button>
              <button className="btn btn-danger" style={{ padding: '5px 12px', fontSize: 12 }} onClick={discardScenario}>Discard</button>
            </div>
          </div>
        )}

        {/* Page body */}
        <div className="page-body">
          {activeTab === 'dashboard' && (
            <Dashboard
              resources={resources}
              projects={projects}
              allocations={allocations}
              scenarioAllocations={scenarioAllocations}
              onTabChange={t => setActiveTab(t as ViewTab)}
              teams={TEAMS}
            />
          )}

          {activeTab === 'allocations' && (
            <AllocationMatrix
              resources={resources}
              projects={projects}
              allocations={allocations}
              scenarioMode={scenarioMode}
              scenarioAllocations={scenarioAllocations}
              onUpdateAdvanced={(r, p) => setActiveAllocationModal({ resId: r, projId: p })}
              onExportCSV={exportCSV}
            />
          )}

          {activeTab === 'by-project' && (
            <ProjectView
              resources={resources}
              projects={projects}
              allocations={allocations}
              scenarioAllocations={scenarioAllocations}
            />
          )}

          {activeTab === 'by-resource' && (
            <ResourceView
              resources={resources}
              projects={projects}
              allocations={allocations}
              scenarioAllocations={scenarioAllocations}
            />
          )}

          {activeTab === 'by-team' && (
            <TeamView
              resources={resources}
              projects={projects}
              allocations={allocations}
              teams={TEAMS}
              scenarioAllocations={scenarioAllocations}
            />
          )}

          {activeTab === 'what-if' && (
            <WhatIfPanel
              resources={resources}
              projects={projects}
              baseAllocations={allocations}
              scenarioAllocations={scenarioAllocations}
              scenarioMode={scenarioMode}
              onEnter={enterScenario}
              onApply={applyScenario}
              onDiscard={discardScenario}
              onUpdate={updateAllocation}
              aiResponse={aiResponse}
              isAiLoading={isAiLoading}
              onAiAsk={handleAiAsk}
            />
          )}
        </div>
      </main>

      {/* ── TOUR ────────────────────────────────────── */}
      {
        showTour && (
          <TourOverlay
            onClose={() => {
              setShowTour(false);
              localStorage.setItem('pcp_tour_done', '1');
            }}
            onNavigate={tab => setActiveTab(tab as ViewTab)}
          />
        )
      }

      {/* ── MODALS ───────────────────────────────────── */}
      {activeAllocationModal && (
        <AllocationModal
          resource={resources.find(r => r.id === activeAllocationModal.resId)!}
          project={projects.find(p => p.id === activeAllocationModal.projId)!}
          allocations={(scenarioMode && scenarioAllocations ? scenarioAllocations : allocations).filter(a => a.resourceId === activeAllocationModal.resId && a.projectId === activeAllocationModal.projId)}
          onSave={(slices) => updateAllocationsAdvanced(activeAllocationModal.resId, activeAllocationModal.projId, slices)}
          onClose={() => setActiveAllocationModal(null)}
        />
      )}
      {
        modal.type === 'addResource' && (
          <ResourceModal teams={TEAMS} onSave={saveResource} onClose={() => setModal({ type: 'none' })} />
        )
      }
      {
        modal.type === 'editResource' && (
          <ResourceModal teams={TEAMS} initial={modal.resource} onSave={saveResource} onClose={() => setModal({ type: 'none' })} />
        )
      }
      {
        modal.type === 'addProject' && (
          <ProjectModal onSave={saveProject} onClose={() => setModal({ type: 'none' })} />
        )
      }
      {
        modal.type === 'syncJira' && (
          <JiraImportModal onClose={() => setModal({ type: 'none' })} />
        )
      }
      {
        modal.type === 'editProject' && (
          <ProjectModal initial={modal.project} onSave={saveProject} onClose={() => setModal({ type: 'none' })} />
        )
      }
      {
        modal.type === 'deleteResource' && (
          <ConfirmModal
            title="Delete Resource"
            message={`Are you sure you want to delete "${modal.resource.name}"? All their allocations will also be removed.`}
            onConfirm={() => deleteResource(modal.resource.id)}
            onClose={() => setModal({ type: 'none' })}
          />
        )
      }
      {
        modal.type === 'deleteProject' && (
          <ConfirmModal
            title="Delete Project"
            message={`Are you sure you want to delete "${modal.project.name}"? All its allocations will also be removed.`}
            onConfirm={() => deleteProject(modal.project.id)}
            onClose={() => setModal({ type: 'none' })}
          />
        )
      }
      {
        modal.type === 'importCSV' && (
          <ImportCSVModal
            currentResources={resources}
            currentProjects={projects}
            currentAllocations={allocations}
            onConfirm={handleBulkImport}
            onClose={() => setModal({ type: 'none' })}
          />
        )
      }
      {
        modal.type === 'login' && (
          <div
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(10, 15, 30, 0.85)', backdropFilter: 'blur(6px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
              padding: '1rem'
            }}
            onClick={e => { if (e.target === e.currentTarget) { setModal({ type: 'none' }); pendingActionRef.current = null; } }}
          >
            <div style={{ position: 'relative', width: '100%', maxWidth: 420 }}>
              <button
                onClick={() => { setModal({ type: 'none' }); pendingActionRef.current = null; }}
                style={{
                  position: 'absolute', top: -12, right: -12,
                  width: 32, height: 32, borderRadius: '50%',
                  background: '#1e293b', border: '1px solid #334155',
                  color: '#94a3b8', fontSize: 16, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10
                }}
              >✕</button>
              <Login onSuccess={onLoginSuccess} />
            </div>
          </div>
        )
      }
      {showPricing && (
        <PricingPage
          onClose={() => setShowPricing(false)}
          currentPlan={user?.plan || 'Free'}
        />
      )}
      {showAdmin && (
        <AdminPanel onClose={() => setShowAdmin(false)} />
      )}
      {showSuperAdmin && (
        <SuperAdminPanel onClose={() => setShowSuperAdmin(false)} />
      )}
    </div >
  );
};

export default App;
