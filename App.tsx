
import React, { useState, useMemo, useEffect } from 'react';
import { 
  Users, 
  Briefcase, 
  BarChart3, 
  Plus, 
  Search, 
  MessageSquare, 
  AlertTriangle, 
  ChevronRight,
  TrendingUp,
  LayoutDashboard,
  Filter,
  MoreVertical,
  CheckCircle2
} from 'lucide-react';
import { Resource, Project, Allocation, ResourceType, ProjectStatus } from './types';
import { MOCK_RESOURCES, MOCK_PROJECTS, MOCK_ALLOCATIONS } from './constants';
import { CapacityChart } from './components/CapacityChart';
import { StatCard } from './components/StatCard';
import { getCapacityInsights } from './services/geminiService';

const App: React.FC = () => {
  const [resources, setResources] = useState<Resource[]>(MOCK_RESOURCES);
  const [projects, setProjects] = useState<Project[]>(MOCK_PROJECTS);
  const [allocations, setAllocations] = useState<Allocation[]>(MOCK_ALLOCATIONS);
  
  // Persist to localStorage so demo changes survive reloads
  useEffect(() => {
    const rs = localStorage.getItem('pcp_resources');
    const ps = localStorage.getItem('pcp_projects');
    const al = localStorage.getItem('pcp_allocations');
    if (rs) setResources(JSON.parse(rs));
    if (ps) setProjects(JSON.parse(ps));
    if (al) setAllocations(JSON.parse(al));
  }, []);

  useEffect(() => {
    localStorage.setItem('pcp_resources', JSON.stringify(resources));
  }, [resources]);

  useEffect(() => {
    localStorage.setItem('pcp_projects', JSON.stringify(projects));
  }, [projects]);

  useEffect(() => {
    localStorage.setItem('pcp_allocations', JSON.stringify(allocations));
  }, [allocations]);
  
  const [activeTab, setActiveTab] = useState<'dashboard' | 'resources' | 'projects' | 'allocations'>('dashboard');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  // Scenario (What-if) mode state
  const [scenarioMode, setScenarioMode] = useState(false);
  const [scenarioAllocations, setScenarioAllocations] = useState<Allocation[] | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  // Derived metrics
  const stats = useMemo(() => {
    const totalResources = resources.length;
    const permanentCount = resources.filter(r => r.type === ResourceType.PERMANENT).length;
    const contractorCount = resources.filter(r => r.type === ResourceType.CONTRACTOR).length;
    const activeProjects = projects.filter(p => p.status === ProjectStatus.ACTIVE).length;
    
    const overAllocatedCount = resources.filter(res => {
      const total = allocations
        .filter(a => a.resourceId === res.id)
        .reduce((sum, a) => sum + a.percentage, 0);
      return total > 100;
    }).length;

    const avgUtilization = resources.length === 0 ? 0 : Math.round(
      allocations.reduce((sum, a) => sum + a.percentage, 0) / resources.length
    );

    return { 
      totalResources, 
      permanentCount, 
      contractorCount, 
      activeProjects, 
      overAllocatedCount,
      avgUtilization
    };
  }, [resources, projects, allocations]);

  const handleAiAsk = async () => {
    if (!aiPrompt.trim()) return;
    setIsAiLoading(true);
    const response = await getCapacityInsights(resources, projects, allocations, aiPrompt);
    setAiResponse(response);
    setIsAiLoading(false);
  };

  // Resource CRUD
  const updateResource = (id: string, patch: Partial<Resource>) => {
    setResources(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  };

  const deleteResource = (id: string) => {
    if (!confirm('Delete resource?')) return;
    setResources(prev => prev.filter(r => r.id !== id));
    setAllocations(prev => prev.filter(a => a.resourceId !== id));
  };

  // Project CRUD
  const addProject = (proj: Project) => setProjects(prev => [proj, ...prev]);
  const updateProject = (id: string, patch: Partial<Project>) => setProjects(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p));
  const deleteProject = (id: string) => {
    if (!confirm('Delete project?')) return;
    setProjects(prev => prev.filter(p => p.id !== id));
    setAllocations(prev => prev.filter(a => a.projectId !== id));
  };

  const updateAllocation = (resId: string, projId: string, val: string) => {
    const num = parseInt(val) || 0;
    // If in scenario mode, edit the scenario allocations copy
    const targetAllocations = scenarioMode && scenarioAllocations ? scenarioAllocations : allocations;
    const setTarget = (next: Allocation[]) => {
      if (scenarioMode) setScenarioAllocations(next);
      else setAllocations(next);
    };

    const existing = targetAllocations.find(a => a.resourceId === resId && a.projectId === projId);
    if (existing) {
      const next = targetAllocations.map(a => 
        a.resourceId === resId && a.projectId === projId 
          ? { ...a, percentage: Math.min(100, Math.max(0, num)) }
          : a
      );
      setTarget(next);
    } else {
      const newAlloc: Allocation = {
        id: `a-${Date.now()}-${Math.random()}`,
        resourceId: resId,
        projectId: projId,
        percentage: Math.min(100, Math.max(0, num))
      };
      setTarget([...targetAllocations, newAlloc]);
    }
  };

  const enterScenarioMode = () => {
    setScenarioAllocations(JSON.parse(JSON.stringify(allocations)));
    setScenarioMode(true);
  };

  const applyScenario = () => {
    if (!scenarioAllocations) return;
    setAllocations(scenarioAllocations);
    setScenarioAllocations(null);
    setScenarioMode(false);
  };

  const discardScenario = () => {
    setScenarioAllocations(null);
    setScenarioMode(false);
  };

  const getResourceUtilization = (resId: string) => {
    const target = scenarioMode && scenarioAllocations ? scenarioAllocations : allocations;
    return target
      .filter(a => a.resourceId === resId)
      .reduce((sum, a) => sum + a.percentage, 0);
  };

  const getResourceAvailableDate = (resId: string) => {
    // find all allocations for resource that have a project with endDate, take latest endDate
    const resAllocs = allocations.filter(a => a.resourceId === resId && a.percentage > 0);
    const endDates = resAllocs
      .map(a => projects.find(p => p.id === a.projectId)?.endDate)
      .filter(Boolean) as string[];
    if (endDates.length === 0) return 'Available now';
    const latest = endDates.sort().reverse()[0];
    return latest;
  };

  const exportCSV = () => {
    const headers = ['resourceId', 'resourceName', 'projectId', 'projectName', 'percentage'];
    const rows: string[] = [];
    allocations.forEach(a => {
      const res = resources.find(r => r.id === a.resourceId);
      const proj = projects.find(p => p.id === a.projectId);
      rows.push([a.resourceId, res?.name || '', a.projectId, proj?.name || '', String(a.percentage)].map(v => `"${v.replaceAll('"','""')}"`).join(','));
    });

    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'allocations.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleNewEntry = () => {
    const type = window.prompt('Type "r" to add Resource or "p" to add Project (r/p):');
    if (!type) return;
    if (type.toLowerCase() === 'r') {
      const name = window.prompt('Resource name:');
      if (!name) return;
      const role = window.prompt('Role/title (optional):') || '';
      const dept = window.prompt('Department (optional):') || '';
      const newRes: Resource = {
        id: `r-${Date.now()}`,
        name,
        role,
        type: ResourceType.PERMANENT,
        department: dept,
        totalCapacity: 100
      };
      setResources(prev => [newRes, ...prev]);
      setActiveTab('resources');
      return;
    }

    if (type.toLowerCase() === 'p') {
      const name = window.prompt('Project name:');
      if (!name) return;
      const desc = window.prompt('Description (optional):') || '';
      const newProj: Project = {
        id: `p-${Date.now()}`,
        name,
        status: ProjectStatus.PLANNING,
        priority: 'Medium',
        description: desc
      };
      setProjects(prev => [newProj, ...prev]);
      setActiveTab('projects');
      return;
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col">
        <div className="p-6">
          <div className="flex items-center gap-3 text-blue-600 mb-8">
            <BarChart3 className="w-8 h-8" />
            <span className="text-xl font-bold tracking-tight text-slate-800">Toms Planner</span>
          </div>

          <nav className="space-y-1">
            <button 
              onClick={() => setActiveTab('dashboard')}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeTab === 'dashboard' ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              <LayoutDashboard size={18} />
              Dashboard
            </button>
            <button 
              onClick={() => setActiveTab('allocations')}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeTab === 'allocations' ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              <Briefcase size={18} />
              Allocations
            </button>
            <button 
              onClick={() => setActiveTab('resources')}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeTab === 'resources' ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              <Users size={18} />
              Team Directory
            </button>
            <button 
              onClick={() => setActiveTab('projects')}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeTab === 'projects' ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              <CheckCircle2 size={18} />
              Projects
            </button>
          </nav>
        </div>

        <div className="mt-auto p-4 border-t border-slate-100">
          <div className="bg-slate-900 rounded-xl p-4 text-white">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></div>
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">AI Assistant Online</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed mb-3">Ask me about resource balancing or "what-if" scenarios.</p>
            <div className="relative">
              <input 
                type="text" 
                placeholder="Ask Gemini..."
                className="w-full bg-slate-800 text-xs py-2 px-3 rounded-md border border-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 pr-8"
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAiAsk()}
              />
              <button 
                onClick={handleAiAsk}
                className="absolute right-2 top-1.5 text-slate-400 hover:text-white"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0">
          <h1 className="text-lg font-semibold text-slate-800 capitalize">{activeTab} View</h1>
          <div className="flex items-center gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input 
                type="text" 
                placeholder="Search resources..." 
                className="bg-slate-100 border-none rounded-full py-1.5 pl-10 pr-4 text-sm focus:ring-2 focus:ring-blue-500 focus:bg-white w-64 transition-all"
              />
            </div>
            <button className="p-2 text-slate-500 hover:bg-slate-100 rounded-full">
              <Filter size={18} />
            </button>
            {!scenarioMode ? (
              <button onClick={enterScenarioMode} className="px-3 py-1 bg-amber-50 border border-amber-200 text-amber-700 rounded text-sm font-semibold">Enter What-If</button>
            ) : (
              <div className="flex items-center gap-2">
                <button onClick={applyScenario} className="px-3 py-1 bg-green-600 text-white rounded text-sm font-semibold">Apply Scenario</button>
                <button onClick={discardScenario} className="px-3 py-1 bg-white border border-slate-200 rounded text-sm font-semibold">Discard</button>
              </div>
            )}
            <button onClick={handleNewEntry} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors shadow-sm">
              <Plus size={16} />
              <span>New Entry</span>
            </button>
          </div>
        </header>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          
          {/* Dashboard View */}
          {activeTab === 'dashboard' && (
            <div className="space-y-8 animate-in fade-in duration-500">
              {/* Top Stats */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard 
                  label="Avg Utilization" 
                  value={`${stats.avgUtilization}%`} 
                  icon={<TrendingUp size={20} />}
                  trend="+2.4% vs last month"
                />
                <StatCard 
                  label="Active Projects" 
                  value={stats.activeProjects} 
                  icon={<Briefcase size={20} />}
                />
                <StatCard 
                  label="Over Allocated" 
                  value={stats.overAllocatedCount} 
                  icon={<AlertTriangle size={20} />}
                  trendColor={stats.overAllocatedCount > 0 ? 'text-red-500' : 'text-green-500'}
                  trend={stats.overAllocatedCount > 0 ? "Critical Action Required" : "Healthy Pipeline"}
                />
                <StatCard 
                  label="Resource Mix" 
                  value={`${stats.permanentCount}P / ${stats.contractorCount}C`} 
                  icon={<Users size={20} />}
                />
              </div>

              {/* Charts & AI Row */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h3 className="text-lg font-bold text-slate-800">Capacity Thresholds</h3>
                      <p className="text-sm text-slate-500">Resource distribution across 60%, 80%, and 100% benchmarks</p>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-2 max-w-[300px] justify-end">
                      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        <span className="w-2.5 h-2.5 rounded-sm bg-slate-400"></span> Under (&lt;60%)
                      </span>
                      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-blue-500">
                        <span className="w-2.5 h-2.5 rounded-sm bg-blue-500"></span> Optimal (60-80%)
                      </span>
                      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-500">
                        <span className="w-2.5 h-2.5 rounded-sm bg-amber-500"></span> High (80-100%)
                      </span>
                      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-red-500">
                        <span className="w-2.5 h-2.5 rounded-sm bg-red-500"></span> Over (100%+)
                      </span>
                    </div>
                  </div>
                  <CapacityChart resources={resources} allocations={allocations} />
                </div>

                <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm flex flex-col h-[350px]">
                  <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                    <MessageSquare size={20} className="text-blue-600" />
                    AI Insights
                  </h3>
                  <div className="flex-1 overflow-y-auto text-sm text-slate-600 space-y-4 custom-scrollbar pr-2">
                    {isAiLoading ? (
                      <div className="flex flex-col items-center justify-center h-full gap-3 py-8 text-slate-400">
                        <div className="w-8 h-8 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin"></div>
                        <p className="animate-pulse">Analyzing capacity data...</p>
                      </div>
                    ) : aiResponse ? (
                      <div className="prose prose-sm prose-slate max-w-none">
                        {aiResponse.split('\n').map((line, i) => (
                          <p key={i} className="mb-2 leading-relaxed">{line}</p>
                        ))}
                      </div>
                    ) : (
                      <div className="bg-slate-50 rounded-lg p-4 border border-slate-100">
                        <p className="font-medium text-slate-800 mb-1">Tom's Recommendations:</p>
                        <ul className="space-y-2 text-xs text-slate-500">
                          <li>Click a suggestion below to analyze with Gemini.</li>
                        </ul>
                        <ul className="space-y-2 text-xs mt-3">
                          <li 
                            className="cursor-pointer hover:text-blue-600 transition-colors bg-white p-2 rounded border border-slate-200"
                            onClick={() => { setAiPrompt("Who is over-allocated and who can help?"); handleAiAsk(); }}
                          >
                            "Analyze over-allocated resources"
                          </li>
                          <li 
                            className="cursor-pointer hover:text-blue-600 transition-colors bg-white p-2 rounded border border-slate-200"
                            onClick={() => { setAiPrompt("Summarize current project risks based on staffing."); handleAiAsk(); }}
                          >
                            "Assess project risks"
                          </li>
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Priority Projects List */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="font-bold text-slate-800">Project Staffing Status</h3>
                  <button onClick={() => setActiveTab('projects')} className="text-sm text-blue-600 font-medium hover:underline">View All Projects</button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-100">
                      <tr>
                        <th className="px-6 py-3">Project Name</th>
                        <th className="px-6 py-3">Status</th>
                        <th className="px-6 py-3">Team Size</th>
                        <th className="px-6 py-3">Total FTE</th>
                        <th className="px-6 py-3">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {projects.map(proj => {
                        const projectAllocations = allocations.filter(a => a.projectId === proj.id);
                        const totalFte = projectAllocations.reduce((sum, a) => sum + a.percentage, 0) / 100;
                        return (
                          <tr key={proj.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-4 font-semibold text-slate-800">{proj.name}</td>
                            <td className="px-6 py-4">
                              <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                proj.status === ProjectStatus.ACTIVE ? 'bg-green-100 text-green-700' : 
                                proj.status === ProjectStatus.PLANNING ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'
                              }`}>
                                {proj.status}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-slate-600 font-medium">{projectAllocations.length} Members</td>
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-2">
                                <div className="w-24 bg-slate-100 h-2 rounded-full overflow-hidden">
                                  <div 
                                    className={`h-full ${totalFte >= 1 ? 'bg-blue-500' : 'bg-amber-400'}`} 
                                    style={{ width: `${Math.min(100, totalFte * 50)}%` }}
                                  ></div>
                                </div>
                                <span className="font-bold text-slate-700">{totalFte.toFixed(1)}</span>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <button className="text-slate-400 hover:text-slate-600">
                                <MoreVertical size={18} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Allocation Matrix View */}
          {activeTab === 'allocations' && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-lg overflow-hidden animate-in slide-in-from-bottom-4 duration-500">
              <div className="p-6 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-slate-800">Allocation Grid</h2>
                  <p className="text-sm text-slate-500">Threshold alerts: <span className="text-red-600 font-bold">100%+</span>, <span className="text-amber-600 font-bold">80%-100%</span>, <span className="text-blue-600 font-bold">60%-80%</span></p>
                </div>
                <div className="flex gap-4">
                  <button onClick={exportCSV} className="px-3 py-1 bg-white border border-slate-200 rounded text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors">Export CSV</button>
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-slate-500">Filter:</label>
                    <select value={selectedProjectId || ''} onChange={(e) => setSelectedProjectId(e.target.value || null)} className="text-sm border border-slate-200 rounded px-2 py-1">
                      <option value="">All projects</option>
                      {projects.map(p => (
                        <option key={p.id} value={p.id}>{p.name}{p.startDate ? ` (${p.startDate}→${p.endDate || '—'})` : ''}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-white border-b border-slate-200">
                      <th className="sticky left-0 bg-white px-6 py-4 font-bold text-slate-700 border-r border-slate-100 min-w-[200px] z-10">Resource</th>
                      <th className="px-6 py-4 font-bold text-slate-700 text-center border-r border-slate-100">Util %</th>
                      {projects.map(p => (
                        <th key={p.id} className="px-6 py-4 font-bold text-slate-700 min-w-[150px] text-center border-r border-slate-100">
                          {p.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {resources.filter(r => {
                      if (!selectedProjectId) return true;
                      // show all resources but inputs will be filtered in columns; keep rows intact
                      return true;
                    }).map(res => {
                      const util = getResourceUtilization(res.id);
                      return (
                        <tr key={res.id} className={`border-b border-slate-100 ${util > 100 ? 'bg-red-50' : (util > 80 ? 'bg-amber-50' : 'hover:bg-slate-50 transition-colors')}`}>
                          <td className="sticky left-0 bg-inherit px-6 py-4 border-r border-slate-100 z-10">
                            <div className="flex items-center gap-3">
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${res.type === ResourceType.PERMANENT ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                                {res.name.charAt(0)}
                              </div>
                              <div>
                                <div className="font-bold text-slate-800 whitespace-nowrap">{res.name}</div>
                                <div className="text-[10px] uppercase text-slate-500 tracking-wider font-semibold">{res.type}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-center border-r border-slate-100">
                            <span className={`font-bold text-lg ${util > 100 ? 'text-red-600' : (util > 80 ? 'text-amber-600' : (util > 60 ? 'text-blue-600' : 'text-slate-400'))}`}>
                              {util}%
                            </span>
                          </td>
                          {projects.map(proj => {
                            const target = scenarioMode && scenarioAllocations ? scenarioAllocations : allocations;
                            const alloc = target.find(a => a.resourceId === res.id && a.projectId === proj.id);
                            return (
                              <td key={proj.id} className="px-4 py-4 border-r border-slate-100">
                                <div className="relative group">
                                  <input 
                                    type="number" 
                                    value={alloc?.percentage || ''}
                                    placeholder="0"
                                    onChange={(e) => updateAllocation(res.id, proj.id, e.target.value)}
                                    className="w-full text-center py-2 border border-slate-200 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-slate-700 font-medium group-hover:border-slate-300 transition-all bg-white shadow-sm"
                                  />
                                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-300 text-[10px] pointer-events-none">%</span>
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {selectedProjectId && (
                <div className="mt-4 bg-white border border-slate-200 rounded-xl p-4">
                  <h3 className="font-bold text-slate-800 mb-2">Project allocations — {projects.find(p=>p.id===selectedProjectId)?.name}</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {allocations.filter(a => a.projectId === selectedProjectId).map(a => {
                      const res = resources.find(r => r.id === a.resourceId);
                      return (
                        <div key={a.id} className="p-3 bg-slate-50 rounded">
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="font-semibold text-slate-800">{res?.name}</div>
                              <div className="text-xs text-slate-500">{res?.role}</div>
                            </div>
                            <div className="font-bold text-slate-700">{a.percentage}%</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Fallback for empty tabs */}
          {activeTab === 'resources' && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 animate-in slide-in-from-bottom-2 duration-300">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-xl font-bold text-slate-800">Team Directory</h2>
                  <p className="text-sm text-slate-500">Manage people and their details. Changes persist in your browser.</p>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={handleNewEntry} className="px-3 py-1 bg-white border border-slate-200 rounded text-sm font-semibold text-slate-600 hover:bg-slate-50">Add Resource</button>
                  <button onClick={() => { localStorage.removeItem('pcp_resources'); setResources(MOCK_RESOURCES); }} className="px-3 py-1 bg-white border border-slate-200 rounded text-sm font-semibold text-slate-600 hover:bg-slate-50">Reset</button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-100">
                    <tr>
                      <th className="px-4 py-2">Name</th>
                      <th className="px-4 py-2">Role</th>
                      <th className="px-4 py-2">Department</th>
                      <th className="px-4 py-2">Type</th>
                      <th className="px-4 py-2">Available From</th>
                      <th className="px-4 py-2">Util %</th>
                      <th className="px-4 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {resources.map(r => (
                      <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 font-semibold">{r.name}</td>
                        <td className="px-4 py-3 text-slate-600">{r.role}</td>
                        <td className="px-4 py-3 text-slate-600">{r.department}</td>
                        <td className="px-4 py-3 text-slate-600">{r.type}</td>
                        <td className="px-4 py-3 text-slate-700">{getResourceAvailableDate(r.id)}</td>
                        <td className="px-4 py-3 text-slate-700 font-bold">{getResourceUtilization(r.id)}%</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <button onClick={() => {
                              const name = window.prompt('Edit name:', r.name) || r.name;
                              const role = window.prompt('Edit role:', r.role) || r.role;
                              const dept = window.prompt('Edit department:', r.department) || r.department;
                              updateResource(r.id, { name, role, department: dept });
                            }} className="text-sm text-blue-600">Edit</button>
                            <button onClick={() => deleteResource(r.id)} className="text-sm text-red-600">Delete</button>
                            <button onClick={() => setActiveTab('allocations')} className="text-sm text-slate-600">Manage Allocations</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'projects' && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 animate-in slide-in-from-bottom-2 duration-300">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-xl font-bold text-slate-800">Projects</h2>
                  <p className="text-sm text-slate-500">Create and manage projects. Deleting a project removes its allocations.</p>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => {
                    const name = window.prompt('Project name:');
                    if (!name) return;
                    const desc = window.prompt('Description (optional):') || '';
                    const newProj: Project = { id: `p-${Date.now()}`, name, status: ProjectStatus.PLANNING, priority: 'Medium', description: desc };
                    addProject(newProj);
                  }} className="px-3 py-1 bg-white border border-slate-200 rounded text-sm font-semibold text-slate-600 hover:bg-slate-50">Add Project</button>
                  <button onClick={() => { localStorage.removeItem('pcp_projects'); setProjects(MOCK_PROJECTS); }} className="px-3 py-1 bg-white border border-slate-200 rounded text-sm font-semibold text-slate-600 hover:bg-slate-50">Reset</button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-100">
                    <tr>
                      <th className="px-4 py-2">Name</th>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-4 py-2">Priority</th>
                      <th className="px-4 py-2">Team Size</th>
                      <th className="px-4 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {projects.map(p => (
                      <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 font-semibold">{p.name}</td>
                        <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${p.status === ProjectStatus.ACTIVE ? 'bg-green-100 text-green-700' : (p.status === ProjectStatus.PLANNING ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600')}`}>{p.status}</span></td>
                        <td className="px-4 py-3 text-slate-600">{p.priority}</td>
                        <td className="px-4 py-3 text-slate-700 font-bold">{allocations.filter(a => a.projectId === p.id).length}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <button onClick={() => {
                              const name = window.prompt('Edit project name:', p.name) || p.name;
                              const statusVal = window.prompt('Status (Active/Planning/On Hold/Completed):', p.status) as ProjectStatus || p.status;
                              updateProject(p.id, { name, status: statusVal });
                            }} className="text-sm text-blue-600">Edit</button>
                            <button onClick={() => deleteProject(p.id)} className="text-sm text-red-600">Delete</button>
                            <button onClick={() => setActiveTab('allocations')} className="text-sm text-slate-600">View Allocations</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
};

export default App;
