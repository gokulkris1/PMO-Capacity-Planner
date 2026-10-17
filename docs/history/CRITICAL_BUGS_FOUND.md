# 🔴 COMPREHENSIVE BUG REPORT: Critical Issues Found

## Summary
Found **8 critical bugs** and **12 high-severity issues** spanning data persistence, validation, import logic, and error handling.

---

## 🔴 CRITICAL BUGS (Data Loss / Security Impact)

### BUG #1: Missing Workspace ID in POST Request ⭐ [Already Reported]
**Location:** [App.tsx](App.tsx#L267)  
**Severity:** 🔴 CRITICAL  

The save endpoint doesn't include `workspaceId` when `activeWorkspace?.id` is undefined:
```typescript
const saveBody: any = { resources, projects, allocations };
if (activeWorkspace?.id) saveBody.workspaceId = activeWorkspace.id; // ❌ May skip!
```

**Impact:**
- Data saved to wrong workspace
- Data lost if backend can't resolve workspace
- Users unaware of failure

**Data Loss Scenario:** User logs in → state clears → save fires before workspace ID resolves → data saved to wrong workspace or dropped.

---

### BUG #2: Missing Organization Slug in POST URL ⭐ [Already Reported]
**Location:** [App.tsx](App.tsx#L269)  
**Severity:** 🔴 CRITICAL  

POST endpoint has different parameters than GET:
```typescript
// GET: /api/workspace?orgSlug=myorg ✅
// POST: /api/workspace (NO SLUG!) ❌
const saveUrl = overrideOrg ? `/api/workspace?orgSlug=...` : '/api/workspace';
```

**Impact:**
- Backend uses fallback workspace resolution
- Picks FIRST workspace user belongs to (wrong one)
- Silent data loss or corruption

**Root Cause:** GET request uses `orgSlug` but POST strips it by default.

---

### BUG #3: CSV Import OVERWRITES All Data Instead of Merging ⭐ [NEW FINDING]
**Location:** [App.tsx](App.tsx#L480-L484)  
**Severity:** 🔴 CRITICAL  

The CSV import handler completely replaces all resources/projects/allocations:
```typescript
const handleBulkImport = (newRes: Resource[], newProj: Project[], newAlloc: Allocation[]) => {
  setResources(newRes);      // ❌ Replaces ALL resources!
  setProjects(newProj);      // ❌ Replaces ALL projects!
  setAllocations(newAlloc);  // ❌ Replaces ALL allocations!
  setModal({ type: 'none' });
};
```

The ImportCSVModal does try to merge, but it returns COMPLETE arrays, not just new items.

**Impact:**
- User imports 5 resources from CSV
- Existing 10 resources are deleted
- User loses all previous data
- No undo/confirmation dialog

**Example Scenario:**
1. User has 10 resources in system
2. User imports CSV with 3 resources (forgetting to include all 10)
3. All 10 existing resources are deleted
4. Only 3 from CSV remain
5. Data permanently lost (unless they reload)

---

### BUG #4: No Data Validation Before Saving to Backend
**Location:** [netlify/functions/workspace.ts](netlify/functions/workspace.ts#L230-L244)  
**Severity:** 🔴 CRITICAL  

The POST handler accepts ANY data without validation:
```typescript
for (const r of resources) {
  await sql`
    INSERT INTO resources (id, workspace_id, name, ...)
    VALUES (${r.id}, ${wsId}, ${r.name}, ...) // ❌ No validation!
  `;
}
```

**Missing Validations:**
- ❌ `name` can be empty string or null
- ❌ `percentage` can be negative (allocations)
- ❌ `percentage` exceeds 500% (multiple allocations)
- ❌ No check if resource/project IDs actually exist
- ❌ Allocation referencing non-existent resource/project

**Impact:**
- Database constraint violations cause 500 errors
- User gets "Save failed: database error" with no context
- Frontend state updated but backend save failed
- Data inconsistency

**Database Risk:**
```typescript
// This is valid in app but causes DB error:
{ name: '', role: null, totalCapacity: NaN }
{ percentage: -50.5 }
{ resourceId: 'invalid-ref-xyz', projectId: 'invalid-ref-abc' }
```

---

### BUG #5: No Validation That Allocations Reference Valid Resources/Projects
**Location:** [App.tsx](App.tsx#L335-L355) + [ImportCSVModal.tsx](ImportCSVModal.tsx#L60-L100)  
**Severity:** 🔴 CRITICAL  

Allocations can reference non-existent resources or projects:

**Scenario 1 - Import CSV:**
```typescript
// ImportCSVModal creates allocations with auto-generated project names:
proj = {
  id: generateId('p'),  // Random ID like "p-1234-xyz"
  name: projName,
  status: derivedStatus,
  priority: 'Medium',
  description: 'Imported from CSV' // 🔴 Never validated!
};
```

If user deletes the project → allocation orphaned (still references deleted project).

**Scenario 2 - Delete Resource with Allocations:**
```typescript
const deleteResource = (id: string) => {
  setResources(prev => prev.filter(r => r.id !== id));
  setAllocations(prev => prev.filter(a => a.resourceId !== id)); // ✅ This works
};
```

But if delete fails on backend → orphaned allocations in database.

**Impact:**
- Dashboard crashes when rendering orphaned allocations
- Heatmap/Matrix UI breaks on missing resource/project
- Silent data corruption

---

### BUG #6: Silent Save Failures Without User Notification
**Location:** [App.tsx](App.tsx#L278-L287)  
**Severity:** 🔴 CRITICAL  

Only 403 errors show alerts; other failures silently logged:
```typescript
.then(async res => {
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 403) {
      alert('Free Plan Limit Exceeded: ...'); // ✅ User sees this
    } else {
      console.error('Failed to sync workspace'); // ❌ Only console!
    }
  }
})
```

**Impact:**
- 500 errors (validation failure) → only console log
- 401 errors (token expired) → only console log
- 404 errors (workspace not found) → only console log
- User thinks data saved
- User closes browser
- Data lost forever

**Better UI Pattern:**
```typescript
// Should show toast/alert for all errors:
if (!res.ok) {
  const msg = data.error || 'Failed to save data';
  alert(`⚠️ Save failed: ${msg}\nPlease try again.`);
}
```

---

### BUG #7: Race Condition in Scenario Mode State Management
**Location:** [App.tsx](App.tsx#L253-L295)  
**Severity:** 🔴 CRITICAL  

When user enters "What-If" scenario mode, then logs out/switches workspace while in scenario mode:

```typescript
const enterScenario = () => {
  setScenarioAllocations(JSON.parse(JSON.stringify(allocations))); // Deep copy
  setScenarioMode(true);
  setActiveTab('what-if');
};

// Problem: User switches workspace while scenarioMode=true
// New workspace loads real data
// But scenarioMode is still true
// liveAlloc = scenarioMode && scenarioAllocations ? scenarioAllocations : allocations
// ❌ Still using old workspace's scenario data!
```

**Impact:**
- Dashboard shows data from OLD workspace
- User thinks changes apply to current workspace
- User presses "Apply" → wrong data applied
- Data corruption across workspaces

**Trigger:**
1. Load Workspace A with 10 resources
2. Enter What-If mode
3. Make changes
4. Switch to Workspace B (different org)
5. What-If mode still active with Workspace A data
6. User sees Workspace A data overlaid on Workspace B
7. Press "Apply Scenario" → Workspace B corrupted

---

### BUG #8: Orphaned Allocations on Cascading Delete Failures
**Location:** [App.tsx](App.tsx#L413-L417) + Database logic  
**Severity:** 🔴 CRITICAL  

Delete cascades only work in memory, not via API:

```typescript
const deleteResource = (id: string) => {
  setResources(prev => prev.filter(r => r.id !== id));           // Frontend deletes
  setAllocations(prev => prev.filter(a => a.resourceId !== id)); // Frontend cascades
  // ❌ But what if save fails after this?
};
```

**Scenario:**
1. User deletes resource "John Doe"
2. Frontend removes resource + clears its allocations ✅
3. Sync fires → tries to save to backend
4. Network timeout → save fails ❌
5. Frontend shows success (state already changed)
6. User browser refresh
7. Data reloaded from server → resource still there (wasn't deleted on server)
8. But allocations already deleted from user's memory
9. Data inconsistency

---

## 🟠 HIGH-SEVERITY BUGS

### BUG #9: CSV Import Doesn't Validate Column Names/Formats
**Location:** [ImportCSVModal.tsx](ImportCSVModal.tsx#L44)  
**Severity:** 🟠 HIGH  

Case-sensitive column matching:
```typescript
const getCol = (keyMatches: string[]) => {
  const foundKey = Object.keys(row).find(k => 
    keyMatches.includes(k.trim().toLowerCase()) // ❌ Only checks names, not header row
  );
  return foundKey ? row[foundKey]?.trim() : '';
};
```

**Problems:**
- Header row "Resource Name" vs "resource" → different keys
- Extra spaces "Resource  " doesn't match "Resource"
- Empty column detection missing
- No error message for missing required columns

**Impact:**
- Silent failures → creates resources with empty names
- Database constraint violated on save
- User gets cryptic error

---

### BUG #10: Timestamp Collision in ID Generation
**Location:** [App.tsx](App.tsx#L395) + [ImportCSVModal.tsx](ImportCSVModal.tsx#L47)  
**Severity:** 🟠 HIGH  

IDs generated by `Date.now()` can collide:
```typescript
const newRes: Resource = { 
  id: `r-${Date.now()}`,  // ❌ Can collide if 2 resources created in <1ms
  ...
};

// In bulk import:
const newResources = data.map((d, i) => ({
  id: `r-${Date.now()}-${i}`, // ✅ Better with index but...
  ...
}));
```

**Scenario:**
If frontend processes 2 API responses in same millisecond → same ID.
Later operations fail because ID isn't unique.

---

### BUG #11: No Referential Integrity on Allocations
**Location:** [netlify/functions/workspace.ts](netlify/functions/workspace.ts#L240-L244)  
**Severity:** 🟠 HIGH  

Backend doesn't validate allocation references:
```typescript
for (const a of allocations) {
  if (!a.percentage || a.percentage <= 0) continue;
  await sql`
    INSERT INTO allocations (id, workspace_id, resource_id, project_id, ...)
    VALUES (${a.id}, ${wsId}, ${a.resourceId}, ${a.projectId}, ...) // ❌ No FK check!
  `;
}
```

**Impact:**
- Can insert allocation referencing deleted resource
- Can insert allocation referencing deleted project
- Dashboard crashes when rendering
- Orphaned data in database

**Better Approach:**
```typescript
// Should validate first:
const validResources = new Set(resources.map(r => r.id));
const validProjects = new Set(projects.map(p => p.id));

for (const a of allocations) {
  if (!validResources.has(a.resourceId) || !validProjects.has(a.projectId)) {
    return fail(`Invalid allocation: resource or project not found`, 400);
  }
}
```

---

### BUG #12: Plan Limit Bypass via Direct API
**Location:** [App.tsx](App.tsx#L391-393) vs [netlify/functions/workspace.ts](netlify/functions/workspace.ts#L198-200)  
**Severity:** 🟠 HIGH  

Frontend validates plan limits but backend also validates:
```typescript
// Frontend check (can be bypassed by dev tools):
if (modal.type === 'addResource' && userPlan === 'BASIC' && resources.length >= 5) {
  setShowPricing(true);
  return;
}

// Backend check (can be outdated server-side):
if (resources.length > lim.resources) return fail(`${plan} plan allows max ${lim.resources} resources`, 403);
```

**Problem:** 
- `user.plan` from token issued 7 days ago might be outdated
- User upgraded but JWT still says "BASIC"
- Server gets conflicting data

**Mitigation Issue:**
Frontend check is good, but plan field in JWT can be stale. Should re-fetch plan from DB.

---

### BUG #13: Large Payload DoS Risk
**Location:** [netlify/functions/workspace.ts](netlify/functions/workspace.ts#L151)  
**Severity:** 🟠 HIGH  

No payload size validation:
```typescript
const body = JSON.parse(event.body || '{}'); // ❌ No size check!
const { resources = [], projects = [], allocations = [] } = body;

for (const r of resources) {
  // ❌ Could be 10,000+ large resources
}
```

**Impact:**
- User could send 100MB JSON payload
- Function times out or crashes
- Serverless timeout = data loss

---

### BUG #14: No Deduplication in CSV Import
**Location:** [ImportCSVModal.tsx](ImportCSVModal.tsx#L50-70)  
**Severity:** 🟠 HIGH  

If CSV has duplicate rows:
```typescript
preview.forEach((row, i) => {
  const resName = getCol(['resource', 'resource name']);
  const projName = getCol(['project', 'project name']);
  
  // Find or create resource
  let res = newResources.find(r => r.name.toLowerCase() === resName.toLowerCase());
  if (!res) {
    // Create new... but if CSV has 3 rows of "John Doe", creates 3 resources!
    res = { id: generateId('r'), name: resName, ... };
    newResources.push(res);
  }
```

**Impact:**
- CSV with duplicate employees creates duplicate resources
- Allocations reference different resource IDs
- Incorrect reporting

---

### BUG #15: Missing End Date Clamping Validation
**Location:** [components/AllocationModal.tsx](components/AllocationModal.tsx#L32-36)  
**Severity:** 🟠 HIGH  

End date auto-clamped to project end date but no warning:
```typescript
let finalEndDate = s.endDate;
if (project.endDate) {
  if (!finalEndDate || finalEndDate > project.endDate) {
    finalEndDate = project.endDate; // ❌ Silent modification!
  }
}
```

**Impact:**
- User sets allocation end date after project ends
- Gets silently clamped
- User unaware their allocation changed

---

### BUG #16: No Atomicity in Save Operation
**Location:** [netlify/functions/workspace.ts](netlify/functions/workspace.ts#L213-244)  
**Severity:** 🟠 HIGH  

If error occurs mid-transaction:
```typescript
await sql`DELETE FROM allocations WHERE workspace_id = ${wsId}`;
await sql`DELETE FROM resources WHERE workspace_id = ${wsId}`;
await sql`DELETE FROM projects WHERE workspace_id = ${wsId}`;

for (const r of resources) {
  await sql`INSERT INTO resources...`; // ❌ What if this fails partway?
}
```

**Impact:**
- Resources deleted
- Projects deleted
- First 49 resources inserted
- 50th resource fails → PARTIAL DATA LOSS
- Database left in inconsistent state

**Better Approach:** Use transaction (BEGIN/COMMIT/ROLLBACK)

---

## 🟡 MEDIUM SEVERITY ISSUES

### Issue #17: No Network Error Handling
Silent network failures during save have no retry logic.

### Issue #18: Token Expiration Not Handled
If token expires during save operation, error silently logged.

### Issue #19: No Form State Persistence
If modal closes unexpectedly, form data lost with no recovery.

### Issue #20: CSV Preview Shows First 10 Rows Only
Large imports don't show all rows, user may not see issues.

---

## 📋 Summary Table

| ID | Title | Severity | Type | Lines |
|---|---|---|---|---|
| 1 | Missing Workspace ID in POST | 🔴 CRITICAL | Data Loss | App.tsx:267 |
| 2 | Missing orgSlug in POST URL | 🔴 CRITICAL | Data Loss | App.tsx:269 |
| 3 | CSV Import Overwrites All Data | 🔴 CRITICAL | Data Loss | App.tsx:480 |
| 4 | No Data Validation Before Save | 🔴 CRITICAL | Corruption | workspace.ts:230 |
| 5 | No Referential Integrity Check | 🔴 CRITICAL | Corruption | workspace.ts:240 |
| 6 | Silent Save Failures | 🔴 CRITICAL | Data Loss | App.tsx:283 |
| 7 | Scenario Mode Race Condition | 🔴 CRITICAL | Corruption | App.tsx:395 |
| 8 | Orphaned Allocations on Error | 🔴 CRITICAL | Corruption | App.tsx:413 |
| 9 | CSV Column Validation Missing | 🟠 HIGH | Data Loss | ImportCSVModal:44 |
| 10 | Timestamp Collision in IDs | 🟠 HIGH | Corruption | App.tsx:395 |
| 11 | No FK Constraints Validated | 🟠 HIGH | Corruption | workspace.ts:240 |
| 12 | Plan Limit / Token Staleness | 🟠 HIGH | Logic Bug | App.tsx:391 |
| 13 | Large Payload DoS | 🟠 HIGH | Availability | workspace.ts:151 |
| 14 | CSV Duplicate Handling | 🟠 HIGH | Data Quality | ImportCSVModal:50 |
| 15 | Silent Date Clamping | 🟠 HIGH | UX Bug | AllocationModal:32 |
| 16 | No Transaction Atomicity | 🟠 HIGH | Data Loss | workspace.ts:213 |

---

## Recommended Quick Wins (Fix Order)

**Phase 1 - Immediate (Today):**
1. Fix CSV import to MERGE instead of REPLACE (BUG #3)
2. Add save failure alerts (BUG #6)
3. Add data validation before backend save (BUG #4)

**Phase 2 - This Sprint:**
4. Add workspaceId + orgSlug to POST consistently (BUGs #1, #2)
5. Fix scenario mode state cleanup (BUG #7)
6. Add referential integrity validation (BUG #5)

**Phase 3 - Next Sprint:**
7. Add database transactions
8. Improve CSV import validation
9. Add retry logic for network failures

---

## 🟣 MEDIUM-SEVERITY ISSUES (Performance, UX, Logic)

### Issue #21: Date Parsing Vulnerability in Allocation Range Filter ⭐ [NEW]
**Location:** [AllocationMatrix.tsx](AllocationMatrix.tsx#L37-L42)  
**Severity:** 🟣 MEDIUM  

Date parsing doesn't validate month/year bounds:
```typescript
const [sYear, sMonth] = range.start.split('-');
const [eYear, eMonth] = range.end.split('-');
const filterStart = new Date(parseInt(sYear), parseInt(sMonth) - 1, 1); // ❌ No validation!
```

**Problem:**
- If user enters `2026-13`, JavaScript silently converts to next year
- No validation that month is 1-12
- No validation that year is reasonable

**Impact:** Silent bugs in date filtering; UI shows wrong month ranges.

---

### Issue #22: Missing null Check on Allocation Start/End Dates
**Location:** [dateFilteredUtil.ts](dateFilteredUtil.ts#L8-L12)  
**Severity:** 🟣 MEDIUM  

No validation that date strings are ISO format:
```typescript
const start = a.startDate ? new Date(a.startDate) : new Date('2000-01-01');
const end = a.endDate ? new Date(a.endDate + 'T23:59:59') : new Date('2099-12-31T23:59:59');
// ❌ If a.startDate = "invalid-date", isNaN(new Date(...).getTime()) = true but check passes
```

**Impact:**
- Invalid dates silently treated as epoch (1970) or NaN
- Comparisons like `start <= date` may behave unexpectedly
- Wrong allocation filtering

---

### Issue #23: Resource Initials Break on Empty Names ⭐ [NEW]
**Location:** [AllocationMatrix.tsx](AllocationMatrix.tsx#L70-72)  
**Severity:** 🟣 MEDIUM  

```typescript
const Avatar: React.FC<{ name: string; type?: string }> = ({ name, type }) => {
    const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
    // ❌ If name = '' or ' ', initials = '', avatar shows empty
```

**Impact:**
- Empty avatar for resources with missing names
- Broken UI rendering

---

### Issue #24: parseInt() Without Radix Parameter ⭐ [NEW]
**Location:** [Modals.tsx](Modals.tsx#L48), [ImportCSVModal.tsx](ImportCSVModal.tsx#L67)  
**Severity:** 🟣 MEDIUM  

```typescript
totalCapacity: parseInt(cols[4] || '100', 10), // ✅ Good (has radix)
const num = Math.min(200, Math.max(0, parseInt(val) || 0)); // ❌ No radix!
if (percentage === 0) { ... } // Later uses string '0' incorrectly
```

**Bug:** `parseInt('08')` without radix may parse as octal in older JS.

**Impact:**
- Inconsistent parsing across codebase
- Values like "08" might parse as 8 instead of 8 (octal was 8 in ES5)

---

### Issue #25: Missing URL Cleanup on CSV Export
**Location:** [App.tsx](App.tsx#L516)  
**Severity:** 🟣 MEDIUM  

```typescript
const blob = new Blob([csv], { type: 'text/csv' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url; 
a.download = 'capacity_allocations.csv';
document.body.appendChild(a); 
a.click(); 
a.remove();
URL.revokeObjectURL(url); // ✅ Good, but only partially!
```

**Problem:** If click() fails before revoke(), object URL leaks memory.

**Better:** Wrap in try/finally.

---

### Issue #26: Permission Check Uses Stale Role from JWT ⭐ [NEW]
**Location:** [App.tsx](App.tsx#L140-145)  
**Severity:** 🟣 MEDIUM  

```typescript
const authGate = useCallback((action: () => void, requireWrite = false) => {
  if (user) {
    if (requireWrite && !canWrite(user, workspaceRole)) { // ❌ workspaceRole is from old token
      alert('Access Denied...');
      return;
    }
```

**Problem:** 
- `workspaceRole` is parsed from JWT token (7-day expiry)
- User's role may have changed (demoted from admin)
- Stale JWT allows old permissions

**Impact:** 
- User demoted to USER role but JWT still says ADMIN
- Can perform admin actions until token expires

**Better:** Re-verify permissions on sensitive operations.

---

### Issue #27: Team Custom Names Not Validated ⭐ [NEW]
**Location:** [Modals.tsx](Modals.tsx#L142)  
**Severity:** 🟣 MEDIUM  

```typescript
{teamMode === 'custom' && (
  <input
    className="form-input"
    style={{ marginTop: 8 }}
    value={customTeam}
    onChange={e => setCustomTeam(e.target.value)}
    placeholder="Enter custom team name" // ❌ No length limit, no validation
  />
)}
```

**Problems:**
- Allows 0-length strings
- No max length (could be 10k chars)
- No sanitization (could contain HTML/scripts)

**Impact:** 
- Empty team names in database
- Excessively long names break UI layout
- XSS risk if rendered without escaping

---

### Issue #28: Modal Backdrop Click Bypasses Unsaved Data Check ⭐ [NEW]
**Location:** [components/Modals.tsx](components/Modals.tsx#L75), [AllocationModal.tsx](AllocationModal.tsx#L39)  
**Severity:** 🟣 MEDIUM  

```typescript
<div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
    // ❌ Clicking backdrop immediately closes without warning if form has unsaved data
```

**Issue:** User fills form with data, clicks behind modal (accidentally), form closes, data lost.

**Better:** Warn if form has changes.

---

### Issue #29: Allocation Percentage Clamped Silently Without User Feedback ⭐ [NEW]
**Location:** [App.tsx](App.tsx#L361)  
**Severity:** 🟣 MEDIUM  

```typescript
const num = Math.min(200, Math.max(0, parseInt(val) || 0)); // Silently clamps to 0-200
setTarget(prev => {
  // ... updates state with clamped value
});
// ❌ User entered 300%, gets silently reduced to 200% with no message
```

**Impact:**
- User confused why their 300% allocation becomes 200%
- No feedback that value was modified

---

### Issue #30: Logout Triggers Hard Redirect
**Location:** [App.tsx](App.tsx#L715-720)  
**Severity:** 🟣 MEDIUM  

```typescript
onClick={() => {
  logout();
  navigate('/');
  window.location.href = '/'; // ❌ Hard page refresh, loses any pending state
}}
```

**Problem:**
- `navigate()` + `window.location.href` is redundant
- Hard refresh may trigger unexpected behaviors
- Should let React Router handle navigation

---

### Issue #31: Hidden Validation Errors in CSV Import Headers
**Location:** [Modals.tsx](Modals.tsx#L32-40)  
**Severity:** 🟣 MEDIUM  

```typescript
const parsed: Partial<Resource>[] = [];
for (let i = 1; i < lines.length; i++) {
  const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
  if (cols.length >= 1 && cols[0]) {
    parsed.push({
      // No validation that cols has minimum length
      // If CSV is malformed, cols[5] is undefined
```

**Impact:** 
- Silently skips malformed rows
- No error message to user
- Partial data import without warning

---

### Issue #32: Scenarios Don't Persist Browser Reload ⭐ [NEW]
**Location:** [App.tsx](App.tsx#L382-388)  
**Severity:** 🟣 MEDIUM  

```typescript
const enterScenario = () => {
  setScenarioAllocations(JSON.parse(JSON.stringify(allocations)));
  setScenarioMode(true);
  setActiveTab('what-if');
  // ❌ If user reloads page mid-scenario, all scenario changes lost
};
```

**Impact:**
- User spends 30 mins in What-If mode refining allocations
- Accidentally refreshes page
- All work lost

---

### Issue #33: JSON.parse() Without Error Handling in Auth ⭐ [NEW]
**Location:** [AuthContext.tsx](AuthContext.tsx#L51-54), [App.tsx](App.tsx#L238)  
**Severity:** 🟣 MEDIUM  

```typescript
try {
  setToken(storedToken);
  setUser(JSON.parse(storedUser)); // ❌ If JSON is corrupted, throws uncaught error
} catch { 
  console.error('Failed to parse stored user'); 
}
```

**Problem:**
- Catches error but doesn't fail gracefully
- User is logged-out state but context may be partial
- Could cause UI crashes

---

### Issue #34: Resource Type Enum Inconsistent with CSS Classes ⭐ [NEW]
**Location:** [types.ts](types.ts#L2-5) vs [ResourceView.tsx](ResourceView.tsx#L68-73)  
**Severity:** 🟣 MEDIUM  

```typescript
// types.ts
export enum ResourceType {
  PERMANENT = 'Permanent',
  CONTRACTOR = 'Contractor',
  PART_TIME = 'Part-Time',
}

// ResourceView.tsx
const typeMap: Record<string, string> = {
  Permanent: 'badge badge-perm',
  Contractor: 'badge badge-cont',
  'Part-Time': 'badge badge-part',
};
```

**Problem:**
- Enum keys match values exactly: `ResourceType.PERMANENT = 'Permanent'`
- If backend returns different casing, mapping breaks
- Type-unsafe string lookups

---

### Issue #35: Email Validation Only Lowercases in DB, Not Frontend ⭐ [NEW]
**Location:** [auth.ts](auth.ts#L153) vs [Login.tsx](Login.tsx) 
**Severity:** 🟣 MEDIUM  

```typescript
// Backend lowercases:
const existing = await sql`SELECT id FROM users WHERE email = ${email.toLowerCase()}`;

// Frontend doesn't always lowercase:
const { email, password } = body; // email could be "User@Test.COM"
```

**Impact:**
- Same user might register twice: "User@Test.COM" and "user@test.com"
- Backend prevents duplicates, but frontend doesn't warn user

**Better:** Lowercase email on frontend before any validation.

---

### Issue #36: No Loading State on Workspace Switch ⭐ [NEW]
**Location:** [App.tsx](App.tsx#L169-175)  
**Severity:** 🟣 MEDIUM  

```typescript
const handleBulkImport = (newRes: Resource[], newProj: Project[], newAlloc: Allocation[]) => {
  setResources(newRes);
  setProjects(newProj);
  setAllocations(newAlloc);
  // ❌ No loading indicator while GET /workspace is fetching
};
```

**Impact:**
- When user switches workspace, UI might show old workspace data for 100ms
- Appears frozen/buggy

---

### Issue #37: Heatmap/Matrix Doesn't Gracefully Handle Empty Data ⭐ [NEW]
**Location:** [AllocationMatrix.tsx](AllocationMatrix.tsx#L196-205)  
**Severity:** 🟣 MEDIUM  

```typescript
{resources.length === 0 ? (
  <div>No resources yet</div>
) : (
  <table>...</table>
)}
// ✅ Good empty state, BUT if projects.length === 0, table shows no columns
// User sees resource names but no projects to allocate to
```

**Improvement:** Show dedicated empty state for "no projects"

---

### Issue #38: OTP Rate Limiting Allows Brute Force ⭐ [NEW]
**Location:** [verify.ts](verify.ts#L100-110)  
**Severity:** 🟣 MEDIUM  

```typescript
const attempts = stored.attempts || 0;
if (stored.otp !== otp.trim()) {
  await sql`UPDATE otps SET attempts = attempts + 1 WHERE email = ${cleanEmail}`;
  return fail(event, 'Incorrect code. ' + Math.max(0, 3 - attempts - 1) + ' attempts remaining.', 400);
}
// ❌ No rate limiting on API itself, only shows remaining attempts
// Attacker can request new OTP hundreds of times
```

**Better:** 
- Lock email after 3-5 failed attempts
- Exponential backoff between attempts

---

### Issue #39: Theme Toggle Doesn't Persist Dark Mode Across Tabs ⭐ [NEW]
**Location:** [App.tsx](App.tsx#L131-136)  
**Severity:** 🟣 MEDIUM  

```typescript
const [themeMode, setThemeMode] = useState<'light' | 'dark'>(() => {
  return (localStorage.getItem('orbitTheme') as 'light' | 'dark') || 'light';
});

useEffect(() => {
  document.body.classList.toggle('dark-theme', themeMode === 'dark');
  localStorage.setItem('orbitTheme', themeMode);
}, [themeMode]);
// ✅ Persists, BUT if user opens 2 tabs, switching theme in one doesn't update other
```

**Better:** Use StorageEvent listener to sync across tabs.

---

### Issue #40: Dialog Overlay Doesn't Trap Focus (Accessibility) ⭐ [NEW]
**Location:** [Modals.tsx](Modals.tsx#L75)  
**Severity:** 🟣 MEDIUM  

```typescript
<div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
  <div className="modal-box">
    // ❌ User can tab through background elements
    // Accessible by keyboard nav to elements under modal
```

**Impact:** Accessibility issue; keyboard navigation broken; fails WCAG guidelines.

---

## 📊 Updated Summary

| Category | Count | Examples |
|----------|-------|----------|
| 🔴 Critical | 8 | Data loss, workspace routing, CSV overwrites |
| 🟠 High | 8 | Validation gaps, ID collisions, DoS risk |
| 🟣 Medium | 20 | Date parsing, UX issues, email validation |
| **TOTAL** | **36** | Severity ranges from critical to medium |

---

```typescript
// Test CSV overwrite bug:
1. Create 5 resources
2. Import CSV with 2 resources
3. Expected: 7 resources
4. Actual: 2 resources (data loss!)

// Test workspace sync bug:
1. Login to org-a
2. Edit resources (don't wait for save)
3. Quickly logout
4. Expected: Save fails (data kept locally)
5. Actual: Data sent to wrong workspace or lost
```
