
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import './index.css';

import { Resource, Project, Allocation, ViewTab, getAllocationStatus, AllocationStatus } from './types';
import { MOCK_RESOURCES, MOCK_PROJECTS, MOCK_ALLOCATIONS, TEAMS, PLAN_LIMITS } from './constants';
import { getCapacityInsights } from './services/geminiService';

import { Dashboard } from './components/Dashboard';
import { AllocationMatrix } from './components/AllocationMatrix';
import { ProjectView } from './components/ProjectView';
import { ResourceView } from './components/ResourceView';
import { SkillsView } from './components/SkillsView';
import { TeamView } from './components/TeamView';
import { TribeView } from './components/TribeView';
import { WhatIfPanel } from './components/WhatIfPanel';
import { ResourceModal, ProjectModal, ConfirmModal } from './components/Modals';
import { AllocationModal } from './components/AllocationModal';
import { JiraImportModal } from './components/JiraImportModal';
import { TourOverlay } from './components/TourOverlay';
import { useAuth } from './context/AuthContext';
import { Login } from './components/Login';
import { ImportCSVModal } from './components/ImportCSVModal';
import { PricingPage } from './components/PricingPage';
import { Routes, Route, useNavigate, useParams, Navigate, useLocation } from 'react-router-dom';
import { exportExecSummaryPDF } from './utils/pdfExport';
import { AdminPanel } from './components/AdminPanel';
import { SuperAdminPanel } from './components/SuperAdminPanel';
import { SettingsHub } from './components/SettingsHub';
import { DirectoryProfile } from './components/DirectoryProfile';

const APP_VERSION = '1.0.0';
const APP_MODE = import.meta.env.VITE_APP_MODE || 'public';

/* ── helpers ──────────────────────────────────────────────── */
function getUtil(allocs: Allocation[], resId: string) {
  const now = new Date();
  return allocs
    .filter(a => {
      if (a.resourceId !== resId) return false;
      if (!a.startDate && !a.endDate) return true;
      const start = a.startDate ? new Date(a.startDate) : new Date('2000-01-01');
      // Set end date boundary to 23:59:59 to include the whole day
      const end = a.endDate ? new Date(a.endDate + 'T23:59:59') : new Date('2099-12-31T23:59:59');
      return start <= now && end >= now;
    })
    .reduce((s, a) => s + a.percentage, 0);
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
  { id: 'by-tribe', label: 'By Tribe', icon: '⛺' },
  { id: 'by-project', label: 'By Project', icon: '🚀' },
  { id: 'by-resource', label: 'By Individual', icon: '👤' },
  { id: 'by-skills', label: 'By Skills', icon: '🧩' },
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
const AppShell: React.FC = () => {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const navigate = useNavigate();
  const location = useLocation();
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
  const [workspaceLogo, setWorkspaceLogo] = useState<string | null>(null);

  /* scenario state */
  const [scenarioMode, setScenarioMode] = useState(false);
  const [scenarioAllocations, setScenarioAllocations] = useState<Allocation[] | null>(null);

  /* Theme state */
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('orbitTheme') as 'light' | 'dark') || 'light';
  });

  useEffect(() => {
    document.body.classList.toggle('dark-theme', themeMode === 'dark');
    localStorage.setItem('orbitTheme', themeMode);
  }, [themeMode]);

  /* AI state */
  const [showAiChat, setShowAiChat] = useState(false);
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);

  /* Auth-gate: queue an action and show login if not authenticated or prevent if unauthorized */
  const pendingActionRef = React.useRef<(() => void) | null>(null);
  const authGate = useCallback((action: () => void, requireWrite = false) => {
    if (user) {
      if (requireWrite && user.role === 'USER') {
        alert('Access Denied: You have Viewer permissions for this workspace.');
        return;
      }
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

      // Look for a Superuser override in the URL
      const urlParams = new URLSearchParams(window.location.search);
      const overrideOrg = urlParams.get('org');

      // Append orgSlug context to the workspace fetch
      const targetSlug = overrideOrg ? encodeURIComponent(overrideOrg) : orgSlug;
      fetch(`/api/workspace?orgSlug=${targetSlug}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
        .then(res => res.json())
        .then(data => {
          const hasDbData = (data.resources && data.resources.length > 0) || (data.projects && data.projects.length > 0);

          // Routine login: pull latest from PostgreSQL
          if (data.resources) setResources(data.resources);
          if (data.projects) setProjects(data.projects);
          if (data.allocations) setAllocations(data.allocations);

          if (data.orgName) setOrgName(data.orgName);
          if (data.workspaceName) setWorkspaceName(data.workspaceName);
          if (data.logoUrl) setWorkspaceLogo(data.logoUrl);

          if (data.primaryColor) {
            document.documentElement.style.setProperty('--color-primary', data.primaryColor);
            // Derive a glow color natively
            document.documentElement.style.setProperty('--color-primary-glow', `${data.primaryColor}66`);
          } else {
            document.documentElement.style.removeProperty('--color-primary');
            document.documentElement.style.removeProperty('--color-primary-glow');
          }

          initialLoadDone.current = true;
        })
        .catch(err => {
          console.error('Failed to load workspace', err);
          initialLoadDone.current = true;
        });
    } else {
      // Guest/demo — restore demo data ONLY if no login token exists to prevent local data bleeds
      if (!localStorage.getItem('pcp_token')) {
        initialLoadDone.current = false;
        const rs = localStorage.getItem('pcp_resources');
        const ps = localStorage.getItem('pcp_projects');
        const al = localStorage.getItem('pcp_allocations');
        setResources(rs && rs !== "[]" ? JSON.parse(rs) : MOCK_RESOURCES);
        setProjects(ps && ps !== "[]" ? JSON.parse(ps) : MOCK_PROJECTS);
        setAllocations(al && al !== "[]" ? JSON.parse(al) : MOCK_ALLOCATIONS);
        initialLoadDone.current = true;
      } else {
        initialLoadDone.current = true; // Waiting for AuthContext to finish fetching user
      }
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

        const urlParams = new URLSearchParams(window.location.search);
        const overrideOrg = urlParams.get('org');
        const saveUrl = overrideOrg ? `/api/workspace?orgSlug=${encodeURIComponent(overrideOrg)}` : '/api/workspace';

        fetch(saveUrl, {
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

  const effectiveTeams = useMemo(() => {
    const base = [...TEAMS];
    const seen = new Set(base.map(t => t.name.toLowerCase()));
    resources.forEach((r, idx) => {
      const name = r.teamName?.trim();
      if (!name || seen.has(name.toLowerCase())) return;
      seen.add(name.toLowerCase());
      base.push({
        id: r.teamId || `custom-team-${idx}-${name.toLowerCase().replace(/\s+/g, '-')}`,
        name,
        color: '#8b5cf6',
      });
    });
    return base;
  }, [resources]);

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
        if (num === 0) return prev.filter(a => !(a.resourceId === resId && a.projectId === projId));
        return prev.map(a =>
          (a.resourceId === resId && a.projectId === projId)
            ? { ...a, percentage: num }
            : a
        );
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
    const userPlan = user?.plan || 'BASIC';
    if (modal.type === 'addResource' && userPlan === 'BASIC' && resources.length >= 5) {
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
    const userPlan = user?.plan || 'BASIC';
    const ownProjects = projects.filter(p => p.id !== 'demo');
    if (modal.type === 'addProject' && userPlan === 'BASIC' && ownProjects.length >= 1) {
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

  /* ── bulk import CSV modals ─────────────────────────────── */
  const bulkSaveResources = (data: Partial<Resource>[]) => {
    if (!data.length) return;
    const userPlan = user?.plan || 'BASIC';
    const limits = PLAN_LIMITS[userPlan];
    if (resources.length + data.length > limits.maxUsers) {
      alert(`Plan limit reached. Your ${userPlan} plan allows a maximum of ${limits.maxUsers} resources. Please upgrade to add more.`);
      return;
    }
    const newResources = data.map((d, i) => ({
      id: `r-${Date.now()}-${i}`,
      name: d.name || 'Unnamed Resource',
      role: d.role || '',
      type: d.type || 'Permanent' as any,
      department: d.department || '',
      totalCapacity: d.totalCapacity ?? 100,
      dailyRate: d.dailyRate,
      location: d.location || '',
      email: d.email || '',
      skills: d.skills || [],
      teamName: d.teamName || ''
    }));
    setResources(prev => [...newResources, ...prev]);
    setModal({ type: 'none' });
  };

  const bulkSaveProjects = (data: Partial<Project>[]) => {
    if (!data.length) return;
    const userPlan = user?.plan || 'BASIC';
    const limits = PLAN_LIMITS[userPlan];
    const ownProjects = projects.filter(p => p.id !== 'demo');
    if (ownProjects.length + data.length > limits.maxProjects) {
      alert(`Plan limit reached. Your ${userPlan} plan allows a maximum of ${limits.maxProjects} projects. Please upgrade to add more.`);
      return;
    }
    const newProjects = data.map((d, i) => ({
      id: `p-${Date.now()}-${i}`,
      name: d.name || 'Unnamed Project',
      status: d.status || 'Planning' as any,
      priority: d.priority || 'Medium',
      description: d.description || '',
      startDate: d.startDate || '',
      endDate: d.endDate || '',
      clientName: d.clientName || '',
      budget: d.budget,
      color: d.color || '#6366f1'
    }));
    setProjects(prev => [...newProjects, ...prev]);
    setModal({ type: 'none' });
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
    'by-tribe': { title: 'By Tribe', subtitle: 'Capacity utilization broken down by Tribe (Client/Owner)' },
    'by-project': { title: 'By Project', subtitle: 'Capacity committed per project' },
    'by-resource': { title: 'By Individual', subtitle: 'How each person is spread across projects' },
    'by-skills': { title: 'By Skills', subtitle: 'Group resources by skills and spot utilization by capability' },
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
          <div className="sidebar-logo-icon" style={{ padding: workspaceLogo ? 4 : 0, background: workspaceLogo ? '#fff' : undefined }}>
            {workspaceLogo ? (
              <img src={workspaceLogo} alt="Org Logo" style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 6 }} />
            ) : (
              '🪐'
            )}
          </div>
          <div style={{ overflow: 'hidden' }}>
            <div className="sidebar-logo-text" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Orbit Space</div>
            <div className="sidebar-logo-sub" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{orgName}</div>
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
                  <div style={{ fontSize: 10, color: '#64748b' }}>{(user.plan || 'BASIC')} plan</div>
                </div>
              </div>
              <button
                onClick={() => {
                  logout();
                  navigate('/');
                  window.location.href = '/'; // Hard redirect to clear all router artifacts
                }}
                title="Log out"
                style={{ background: 'none', border: '1px solid #334155', borderRadius: 8, color: '#94a3b8', fontSize: 11, padding: '4px 8px', cursor: 'pointer', flexShrink: 0 }}>
                Out
              </button>
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
                    const limits = PLAN_LIMITS[user?.plan || 'BASIC'];
                    if (item.id === 'what-if') {
                      if (!limits.features.whatIfMode) {
                        alert(`What-If Mode requires the PRO plan or higher. You are currently on ${user?.plan || 'BASIC'}.`);
                        return;
                      }
                      if (!scenarioMode) enterScenario();
                    } else {
                      setActiveTab(item.id);
                      if (location.pathname.endsWith('/settings') || location.pathname.endsWith('/directory')) {
                        navigate(`/o/${orgSlug}`);
                      }
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
            {APP_MODE === 'public' && (
              <button
                className="nav-item"
                onClick={() => setShowPricing(true)}
                style={{
                  background: user?.plan && user.plan !== 'BASIC'
                    ? 'rgba(16,185,129,0.1)'
                    : 'rgba(99,102,241,0.1)',
                  borderRadius: 10, marginBottom: 6,
                  border: '1px solid rgba(99,102,241,0.2)',
                }}
              >
                <span style={{ fontSize: 14 }}>💎</span>
                <span style={{ fontWeight: 600, color: '#a5b4fc' }}>
                  {user?.plan && user.plan !== 'BASIC' ? `${user.plan} Plan` : 'View Pricing'}
                </span>
              </button>
            )}

            {/* Install Sample Data for Internal modes */}
            {APP_MODE === 'internal' && resources.length === 0 && projects.length === 0 && (
              <button
                className="nav-item"
                onClick={() => {
                  if (confirm('Install sample data? This will provision your workspace with demo data.')) {
                    setResources(MOCK_RESOURCES);
                    setProjects(MOCK_PROJECTS);
                    setAllocations(MOCK_ALLOCATIONS);
                  }
                }}
                style={{
                  background: 'rgba(16,185,129,0.1)',
                  borderRadius: 10, marginBottom: 6,
                  border: '1px solid rgba(16,185,129,0.2)',
                }}
              >
                <span style={{ fontSize: 14 }}>💾</span>
                <span style={{ fontWeight: 600, color: '#34d399' }}>Install Sample Data</span>
              </button>
            )}

            <div className="nav-section-label">Manage {!user && <span style={{ fontSize: 10, opacity: .6 }}>🔒</span>}</div>
            <button
              className="nav-item"
              onClick={() => {
                setActiveTab('by-resource');
                if (location.pathname.endsWith('/settings') || location.pathname.endsWith('/directory')) {
                  navigate(`/o/${orgSlug}`);
                }
              }}
            >
              <span style={{ fontSize: 15 }}>👤</span><span>Manage Resources</span>
            </button>
            <button
              className="nav-item"
              onClick={() => {
                setActiveTab('by-project');
                if (location.pathname.endsWith('/settings') || location.pathname.endsWith('/directory')) {
                  navigate(`/o/${orgSlug}`);
                }
              }}
            >
              <span style={{ fontSize: 15 }}>🚀</span><span>Manage Projects</span>
            </button>
          </div>

          {/* Data Management */}
          <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 14 }}>
            <div className="nav-section-label">Data</div>
            <button className="nav-item" onClick={() => exportExecSummaryPDF(resources, projects, liveAlloc)}>
              <span style={{ fontSize: 15 }}>📄</span><span>Exec Summary (PDF)</span>
            </button>
            <button
              className="nav-item"
              onClick={() => {
                const limits = PLAN_LIMITS[user?.plan || 'BASIC'];
                if (!limits.features.importExport) {
                  alert(`Export CSV requires the PRO plan. You are currently on ${user?.plan || 'BASIC'}.`);
                  return;
                }
                exportCSV();
              }}
              style={{ opacity: !PLAN_LIMITS[user?.plan || 'BASIC'].features.importExport ? 0.5 : 1 }}
            >
              <span style={{ fontSize: 15 }}>⬇️</span><span>Export CSV</span>
            </button>
            <button
              className="nav-item"
              onClick={() => {
                const limits = PLAN_LIMITS[user?.plan || 'BASIC'];
                if (!limits.features.importExport) {
                  alert(`Import CSV requires the PRO plan. You are currently on ${user?.plan || 'BASIC'}.`);
                  return;
                }
                authGate(() => setModal({ type: 'importCSV' }));
              }}
              style={{ opacity: !PLAN_LIMITS[user?.plan || 'BASIC'].features.importExport ? 0.5 : 1 }}
            >
              <span style={{ fontSize: 15 }}>⬆️</span><span>Import CSV {!user && '🔒'}</span>
            </button>
          </div>

          {/* Role-Based Organizational Settings */}
          <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 14 }}>
            <div className="nav-section-label">Organization</div>

            {user?.role === 'SUPERUSER' && (
              <button
                className={`nav-item ${location.pathname.endsWith('/settings') ? 'active' : ''}`}
                onClick={() => navigate(`/o/${orgSlug}/settings`)}
                style={{ background: 'rgba(244,63,94,0.12)', border: '1px solid rgba(244,63,94,0.3)', borderRadius: 10 }}
              >
                <span style={{ fontSize: 15 }}>🚀</span><span style={{ color: '#f43f5e', fontWeight: 700 }}>Cockpit</span>
              </button>
            )}

            {user?.role === 'ADMIN' && (
              <button
                className={`nav-item ${location.pathname.endsWith('/settings') ? 'active' : ''}`}
                onClick={() => navigate(`/o/${orgSlug}/settings`)}
              >
                <span style={{ fontSize: 15 }}>⚙️</span><span>Workspace Settings</span>
              </button>
            )}

            {(!user || user?.role === 'USER') && (
              <button
                className={`nav-item ${location.pathname.endsWith('/directory') ? 'active' : ''}`}
                onClick={() => navigate(`/o/${orgSlug}/directory`)}
              >
                <span style={{ fontSize: 15 }}>⚙️</span><span>Workspace</span>
              </button>
            )}
          </div>

          {/* Take a Tour */}
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,.06)' }}>
            <button className="nav-item" onClick={() => setShowTour(true)}>
              <span style={{ fontSize: 15 }}>🎓</span><span>Take a Tour</span>
            </button>
          </div>
        </nav>

        {/* Sidebar Footer: Branding and version only */}
        <div className="sidebar-footer">
          <div className="branding" style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>
              {APP_MODE === 'public' ? (
                <>
                  Plan: <span style={{ color: user?.plan === 'PRO' ? '#10b981' : '#f59e0b' }}>
                    {user?.plan || 'Free'}
                  </span>
                </>
              ) : (
                <span style={{ color: '#6366f1' }}>Internal Mode</span>
              )}
            </div>
          </div>
          {/* Theme Toggle */}
          <div style={{ textAlign: 'center', padding: '8px 0', borderTop: '1px solid rgba(255,255,255,.06)', marginTop: 8 }}>
            <button
              onClick={() => setThemeMode(prev => prev === 'light' ? 'dark' : 'light')}
              style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', fontWeight: 600 }}
            >
              {themeMode === 'light' ? '🌙 Dark Mode' : '☀️ Light Mode'}
            </button>
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
            {user?.role !== 'USER' && (
              <>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    const limits = PLAN_LIMITS[user?.plan || 'BASIC'];
                    if (resources.length >= limits.maxUsers) {
                      alert(`Plan limit reached. Your ${user?.plan || 'BASIC'} plan allows a maximum of ${limits.maxUsers} resources. Please upgrade to add more.`);
                      return;
                    }
                    authGate(() => setModal({ type: 'addResource' }), true)
                  }}
                >
                  + Resource {!user && '🔒'}
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    const limits = PLAN_LIMITS[user?.plan || 'BASIC'];
                    if (projects.length >= limits.maxProjects) {
                      alert(`Plan limit reached. Your ${user?.plan || 'BASIC'} plan allows a maximum of ${limits.maxProjects} projects. Please upgrade to add more.`);
                      return;
                    }
                    authGate(() => setModal({ type: 'addProject' }), true)
                  }}
                >
                  + Project {!user && '🔒'}
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
          {location.pathname.endsWith('/settings') ? (
            <SettingsHub />
          ) : location.pathname.endsWith('/directory') ? (
            <DirectoryProfile />
          ) : (
            <>
              {activeTab === 'dashboard' && (
                <Dashboard
                  resources={resources}
                  projects={projects}
                  allocations={allocations}
                  scenarioAllocations={scenarioAllocations}
                  onTabChange={t => setActiveTab(t as ViewTab)}
                  teams={effectiveTeams}
                />
              )}

              {activeTab === 'allocations' && (
                <AllocationMatrix
                  resources={resources}
                  projects={projects}
                  allocations={allocations}
                  scenarioMode={scenarioMode}
                  scenarioAllocations={scenarioAllocations}
                  onUpdateAdvanced={(r, p) => authGate(() => setActiveAllocationModal({ resId: r, projId: p }), true)}
                  onExportCSV={exportCSV}
                />
              )}

              {activeTab === 'by-tribe' && (
                <TribeView resources={resources} projects={projects} allocations={allocations} scenarioAllocations={scenarioMode ? scenarioAllocations : null} onEditResource={(res) => authGate(() => setModal({ type: 'editResource', resource: res }), true)} />
              )}

              {activeTab === 'by-project' && (
                <ProjectView
                  resources={resources}
                  projects={projects}
                  allocations={allocations}
                  scenarioAllocations={scenarioAllocations}
                  onAddProject={() => authGate(() => setModal({ type: 'addProject' }), true)}
                  onEditProject={(proj) => authGate(() => setModal({ type: 'editProject', project: proj }), true)}
                  onDeleteProject={(proj) => authGate(() => setModal({ type: 'deleteProject', project: proj }), true)}
                />
              )}

              {activeTab === 'by-resource' && (
                <ResourceView
                  resources={resources}
                  projects={projects}
                  allocations={allocations}
                  scenarioAllocations={scenarioAllocations}
                  onAddResource={() => authGate(() => setModal({ type: 'addResource' }), true)}
                  onEditResource={(res) => authGate(() => setModal({ type: 'editResource', resource: res }), true)}
                  onDeleteResource={(res) => authGate(() => setModal({ type: 'deleteResource', resource: res }), true)}
                />
              )}

              {activeTab === 'by-skills' && (
                <SkillsView
                  resources={resources}
                  projects={projects}
                  allocations={allocations}
                  scenarioAllocations={scenarioMode ? scenarioAllocations : null}
                  onEditResource={(res) => authGate(() => setModal({ type: 'editResource', resource: res }), true)}
                />
              )}

              {activeTab === 'by-team' && (
                <TeamView
                  resources={resources}
                  projects={projects}
                  allocations={allocations}
                  teams={effectiveTeams}
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
            </>
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
          <ResourceModal teams={effectiveTeams} onSave={saveResource} onBulkSave={bulkSaveResources} onClose={() => setModal({ type: 'none' })} />
        )
      }
      {
        modal.type === 'editResource' && (
          <ResourceModal teams={effectiveTeams} initial={modal.resource} onSave={saveResource} onBulkSave={bulkSaveResources} onClose={() => setModal({ type: 'none' })} />
        )
      }
      {
        modal.type === 'addProject' && (
          <ProjectModal onSave={saveProject} onBulkSave={bulkSaveProjects} onClose={() => setModal({ type: 'none' })} />
        )
      }
      {
        modal.type === 'syncJira' && (
          <JiraImportModal onClose={() => setModal({ type: 'none' })} />
        )
      }
      {
        modal.type === 'editProject' && (
          <ProjectModal initial={modal.project} onSave={saveProject} onBulkSave={bulkSaveProjects} onClose={() => setModal({ type: 'none' })} />
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

      {/* ── Orbit Floating AI Assistant ── */}
      <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 16 }}>
        {showAiChat && (
          <div className="glass-panel" style={{ width: 340, height: 400, borderRadius: 20, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 12px 40px rgba(0,0,0,0.15)', border: '1px solid rgba(255,255,255,0.5)' }}>
            <div style={{ padding: '16px 20px', background: 'rgba(255,255,255,0.4)', borderBottom: '1px solid rgba(255,255,255,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 20 }}>🤖</span>
                <span style={{ fontWeight: 600, color: '#1e293b' }}>Orbit AI</span>
              </div>
              <button onClick={() => setShowAiChat(false)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 16 }}>✕</button>
            </div>
            <div style={{ flex: 1, padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {!user && <div style={{ fontSize: 13, color: '#64748b', textAlign: 'center', marginTop: 20 }}>🔒 Log in to use Orbit AI.</div>}
              {aiResponse ? (
                <div style={{ background: 'rgba(255,255,255,0.8)', padding: 12, borderRadius: 12, fontSize: 13, border: '1px solid rgba(99,102,241,0.2)', color: '#334155' }}>
                  {aiResponse}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: '#64748b', textAlign: 'center', marginTop: 20 }}>
                  Ask about team capacity, pipeline risks, or smart reallocations.
                </div>
              )}
              {isAiLoading && <div style={{ fontSize: 13, color: '#6366f1', textAlign: 'center' }}>Thinking... 💫</div>}
            </div>
            <div style={{ padding: 12, background: 'rgba(255,255,255,0.6)', borderTop: '1px solid rgba(255,255,255,0.3)', display: 'flex', gap: 8 }}>
              <input
                className="ai-input"
                style={{ flex: 1, padding: '10px 16px', borderRadius: 99, border: '1px solid rgba(255,255,255,0.8)', background: 'rgba(255,255,255,0.5)', outline: 'none', fontSize: 13 }}
                placeholder={user ? "Message Orbit..." : "Log in to chat..."}
                disabled={!user || isAiLoading}
                onKeyDown={e => {
                  if (!user) { setModal({ type: 'login' }); return; }
                  if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                    handleAiAsk((e.target as HTMLInputElement).value);
                    (e.target as HTMLInputElement).value = '';
                    setActiveTab('what-if');
                  }
                }}
              />
            </div>
          </div>
        )}
        <button
          onClick={() => setShowAiChat(!showAiChat)}
          style={{ width: 56, height: 56, borderRadius: '50%', background: 'linear-gradient(135deg, var(--color-primary), #6366f1)', border: 'none', color: '#fff', fontSize: 24, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 24px var(--color-primary-glow)', transition: 'transform 0.2s', transform: showAiChat ? 'scale(0.9)' : 'scale(1)' }}
        >
          {showAiChat ? '✕' : '✨'}
        </button>
      </div>
    </div >
  );
};

/* ── Landing Page (Root Route) ────────────────────────────── */
const Landing: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [showLogin, setShowLogin] = useState(false);

  useEffect(() => {
    if (user) {
      const token = localStorage.getItem('pcp_token');
      fetch('/api/workspace_lookup', { headers: { 'Authorization': `Bearer ${token}` } })
        .then(r => r.json())
        .then(async d => {
          if (d.orgSlug) {
            navigate(`/o/${d.orgSlug}`);
          } else {
            // Immediately provision a workspace to prevent jumping to the separate /create screen
            try {
              const res = await fetch('/api/org_create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ orgName: `${user.name || 'My'}'s Workspace` })
              });
              const data = await res.json();
              if (res.ok && data.orgSlug) navigate(`/o/${data.orgSlug}`);
            } catch (createErr) {
              console.error('Auto-provisioning failed:', createErr);
            }
          }
        })
        .catch(console.error);
    }
  }, [user, navigate]);

  return (
    <div style={{ position: 'relative', height: '100vh', width: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc' }}>
      {/* Background Animated Orbs */}
      <div className="orb orb-primary"></div>
      <div className="orb orb-secondary"></div>

      {/* Main Hero Container */}
      <div style={{ display: 'flex', gap: 40, alignItems: 'center', justifyContent: 'center', width: '90%', maxWidth: 1000, position: 'relative', zIndex: 10 }}>

        <div className="glass-panel" style={{ flex: 1, padding: '60px 40px', borderRadius: '32px', textAlign: 'left', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 64, height: 64, borderRadius: 20, background: 'linear-gradient(135deg, var(--color-primary), #4f46e5)', color: 'white', fontSize: 32, marginBottom: 24, boxShadow: '0 8px 16px var(--color-primary-glow)' }}>
            🪐
          </div>
          <h1 className="orbit-hero-title" style={{ fontSize: 56, marginBottom: 16 }}>Orbit Space</h1>
          <p style={{ fontSize: 20, color: '#475569', fontWeight: 500, lineHeight: 1.5, marginBottom: 0 }}>
            Visual resource orchestration and team capacity management for modern PMOs.
          </p>
        </div>

        {/* Embedded Login / Signup */}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: '100%', maxWidth: 420 }}>
            <Login />
          </div>
        </div>

      </div>
    </div>
  );
};

/* ── Create Org Page ──────────────────────────────────────── */
const CreateOrg: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [orgName, setOrgName] = useState('');
  const [website, setWebsite] = useState('');
  const [loading, setLoading] = useState(false);
  const [showLogin, setShowLogin] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgName.trim() || !user) return;
    setLoading(true);

    let extractedTheme: { logo_url?: string, primary_color?: string } = {};

    try {
      if (website.trim()) {
        const themeRes = await fetch('/api/theme_extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: website })
        });
        if (themeRes.ok) {
          extractedTheme = await themeRes.json();
        }
      }

      const token = localStorage.getItem('pcp_token');
      const res = await fetch('/api/org_create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          orgName,
          logoUrl: extractedTheme.logo_url,
          primaryColor: extractedTheme.primary_color
        })
      });

      const data = await res.json();
      if (res.ok && data.orgSlug) {
        navigate(`/o/${data.orgSlug}`);
      } else {
        alert(data.error || 'Failed to create organization');
      }
    } catch (err) {
      console.error(err);
      alert('Network error');
    } finally {
      setLoading(false);
    }
  };

  // Enforce Login Wall
  if (!user) {
    return (
      <div style={{ padding: 40, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, height: '100vh', justifyContent: 'center' }}>
        <h2>Authentication Required</h2>
        <p style={{ color: '#64748b' }}>You must be logged in to provision a new B2B tenant.</p>
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={() => navigate('/')} className="btn btn-secondary">Go Home</button>
          <button onClick={() => setShowLogin(true)} className="btn btn-primary">Sign In / Register</button>
        </div>
        {showLogin && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(10, 15, 30, 0.85)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
            <div style={{ position: 'relative', width: '100%', maxWidth: 420 }}>
              <button
                onClick={() => setShowLogin(false)}
                style={{ position: 'absolute', top: -12, right: -12, width: 32, height: 32, borderRadius: '50%', background: '#1e293b', border: '1px solid #334155', color: '#94a3b8', fontSize: 16, cursor: 'pointer', zIndex: 10 }}
              >✕</button>
              <Login onSuccess={() => setShowLogin(false)} force2fa={false} />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
      <form onSubmit={handleCreate} className="glass-panel" style={{ width: '100%', maxWidth: 460, padding: 40, borderRadius: 24, textAlign: 'left' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 48, height: 48, borderRadius: 16, background: 'linear-gradient(135deg, var(--color-primary, #6366f1), #4f46e5)', color: 'white', fontSize: 24, marginBottom: 20, boxShadow: '0 8px 16px rgba(99,102,241,0.3)' }}>
          🪐
        </div>
        <h2 style={{ fontSize: 24, marginBottom: 8, fontWeight: 700, color: '#1e293b' }}>Create Enterprise Tenant</h2>
        <p style={{ color: '#64748b', marginBottom: 24, fontSize: 13 }}>Provision your dedicated Orbit Space and customize your brand.</p>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 600, color: '#475569' }}>Organization Name *</label>
          <input
            type="text" required autoFocus
            value={orgName} onChange={e => setOrgName(e.target.value)}
            placeholder="e.g. Acme Corp"
            style={{ width: '100%', padding: '12px 16px', borderRadius: 12, border: '1px solid #cbd5e1', outline: 'none', fontSize: 14 }}
            disabled={loading}
          />
        </div>

        <div style={{ marginBottom: 32 }}>
          <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 600, color: '#475569' }}>Company Website</label>
          <input
            type="text"
            value={website} onChange={e => setWebsite(e.target.value)}
            placeholder="e.g. apple.com (Extracts colors/logos)"
            style={{ width: '100%', padding: '12px 16px', borderRadius: 12, border: '1px solid #cbd5e1', outline: 'none', fontSize: 14 }}
            disabled={loading}
          />
        </div>

        <button type="submit" className="btn btn-primary" disabled={loading || !orgName.trim()} style={{ width: '100%', padding: 14, fontSize: 16, borderRadius: 12, fontWeight: 600, boxShadow: '0 8px 16px var(--color-primary-glow, rgba(99,102,241,0.3))' }}>
          {loading ? 'Provisioning Orbit Space...' : 'Initialize Workspace'}
        </button>
      </form>
    </div>
  );
};

/* ── Router Export ────────────────────────────────────────── */
const App: React.FC = () => {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/create" element={<CreateOrg />} />
      <Route path="/o/:orgSlug" element={<AppShell />} />
      <Route path="/o/:orgSlug/settings" element={<AppShell />} />
      <Route path="/o/:orgSlug/directory" element={<AppShell />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

export default App;
