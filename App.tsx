
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
import { TourOverlay } from './components/TourOverlay';
import { useAuth } from './context/AuthContext';
import { Login } from './components/Login';
import { TimeGranularity, TimeSelector } from './components/TimeSelector';
import { ImportCSVModal } from './components/ImportCSVModal';

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
  /* data state */
  const [resources, setResources] = useState<Resource[]>(MOCK_RESOURCES);
  const [projects, setProjects] = useState<Project[]>(MOCK_PROJECTS);
  const [allocations, setAllocations] = useState<Allocation[]>(MOCK_ALLOCATIONS);

  /* ui state */
  const [activeTab, setActiveTab] = useState<ViewTab>('dashboard');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<ModalState>({ type: 'none' });
  const [showTour, setShowTour] = useState(false);
  const [timeGranularity, setTimeGranularity] = useState<TimeGranularity>('Month');

  /* scenario state */
  const [scenarioMode, setScenarioMode] = useState(false);
  const [scenarioAllocations, setScenarioAllocations] = useState<Allocation[] | null>(null);

  /* AI state */
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);

  /* persist to localStorage & show tour for first-time visitors */
  useEffect(() => {
    const rs = localStorage.getItem('pcp_resources');
    const ps = localStorage.getItem('pcp_projects');
    const al = localStorage.getItem('pcp_allocations');
    if (rs) setResources(JSON.parse(rs));
    if (ps) setProjects(JSON.parse(ps));
    if (al) setAllocations(JSON.parse(al));

    const tg = localStorage.getItem('pcp_time_granularity');
    if (tg) setTimeGranularity(tg as TimeGranularity);

    if (!localStorage.getItem('pcp_tour_done')) {
      // Small delay so the app renders first
      setTimeout(() => setShowTour(true), 600);
    }
  }, []);

  useEffect(() => { localStorage.setItem('pcp_resources', JSON.stringify(resources)); }, [resources]);
  useEffect(() => { localStorage.setItem('pcp_projects', JSON.stringify(projects)); }, [projects]);
  useEffect(() => { localStorage.setItem('pcp_allocations', JSON.stringify(allocations)); }, [allocations]);
  useEffect(() => { localStorage.setItem('pcp_time_granularity', timeGranularity); }, [timeGranularity]);

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

  /* ── permissions ────────────────────────────────────────── */
  const isAdminList = ['PMO', 'PM'];
  const canEdit = user && isAdminList.includes(user.role);

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

        {/* Nav */}
        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item, i) => {
            const prev = i > 0 ? NAV_ITEMS[i - 1] : null;
            return (
              <React.Fragment key={item.id}>
                {item.section && item.section !== prev?.section && (
                  <div className="nav-section-label">{item.section}</div>
                )}
                <button
                  className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
                  onClick={() => setActiveTab(item.id)}
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

          {canEdit && (
            <div style={{ marginTop: 20, borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 14 }}>
              <div className="nav-section-label">Quick Add</div>
              <button className="nav-item" onClick={() => setModal({ type: 'addResource' })}>
                <span style={{ fontSize: 15 }}>👤</span><span>Add Resource</span>
              </button>
              <button className="nav-item" onClick={() => setModal({ type: 'addProject' })}>
                <span style={{ fontSize: 15 }}>🚀</span><span>Add Project</span>
              </button>
            </div>
          )}

          {/* Data Management */}
          <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 14 }}>
            <div className="nav-section-label">Data</div>
            <button className="nav-item" onClick={exportCSV}>
              <span style={{ fontSize: 15 }}>⬇️</span><span>Export CSV</span>
            </button>
            {canEdit && (
              <button className="nav-item" onClick={() => setModal({ type: 'importCSV' })}>
                <span style={{ fontSize: 15 }}>⬆️</span><span>Import CSV</span>
              </button>
            )}
            {canEdit && (
              <button className="nav-item" onClick={() => {
                if (window.confirm('Reset all data to demo defaults?')) {
                  localStorage.clear();
                  setResources(MOCK_RESOURCES);
                  setProjects(MOCK_PROJECTS);
                  setAllocations(MOCK_ALLOCATIONS);
                  discardScenario();
                }
              }}>
                <span style={{ fontSize: 15 }}>🔄</span><span>Reset to Demo</span>
              </button>
            )}
            <button className="nav-item" onClick={() => setShowTour(true)} style={{ marginTop: 4 }}>
              <span style={{ fontSize: 15 }}>🎓</span><span>Take a Tour</span>
            </button>
            {user ? (
              <button className="nav-item" onClick={logout} style={{ marginTop: 4, color: 'var(--text-muted)' }}>
                <span style={{ fontSize: 15 }}>🚪</span><span>Log Out</span>
              </button>
            ) : (
              <button className="nav-item" onClick={() => setModal({ type: 'login' })} style={{ marginTop: 4, color: 'var(--primary-light)' }}>
                <span style={{ fontSize: 15 }}>🔑</span><span>Log In</span>
              </button>
            )}
          </div>
        </nav>

        {/* AI Widget */}
        <div className="sidebar-footer">
          <div className="ai-widget">
            <div className="ai-widget-header">
              <div className="ai-pulse" />
              <span className="ai-widget-label">AI Advisor</span>
            </div>
            <div className="ai-widget-desc">Ask about capacity, risks, or reallocation ideas.</div>
            <div className="ai-input-wrap">
              <input
                className="ai-input"
                placeholder="Ask Gemini..."
                onKeyDown={e => {
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
            <TimeSelector value={timeGranularity} onChange={setTimeGranularity} />
            <div className="search-wrap">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><circle cx={11} cy={11} r={8} /><path d="m21 21-4.3-4.3" /></svg>
              <input className="search-input" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>

            {canEdit && (!scenarioMode ? (
              <button className="btn btn-warning" onClick={enterScenario}>🔬 What-If</button>
            ) : (
              <>
                <button className="btn btn-success" onClick={applyScenario}>✅ Apply</button>
                <button className="btn btn-danger" onClick={discardScenario}>✕ Discard</button>
              </>
            ))}
            {canEdit && (
              <>
                <button className="btn btn-primary" onClick={() => setModal({ type: 'addResource' })}>
                  + Add Resource
                </button>
                <button className="btn btn-secondary" onClick={() => setModal({ type: 'addProject' })}>
                  + Add Project
                </button>
              </>
            )}
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
              onUpdate={updateAllocation}
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
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(15, 23, 42, 0.8)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
          }}>
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setModal({ type: 'none' })}
                style={{
                  position: 'absolute', top: 10, right: 10, background: 'none',
                  border: 'none', color: '#94a3b8', fontSize: '20px', cursor: 'pointer', zIndex: 10
                }}
              >✕</button>
              <Login onSuccess={() => setModal({ type: 'none' })} />
            </div>
          </div>
        )
      }
    </div >
  );
};

export default App;
