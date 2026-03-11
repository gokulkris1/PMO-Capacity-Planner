# 🔴 CRITICAL BUG: Data Not Being Saved

## Root Cause Analysis

I've identified **multiple critical issues** preventing data from being saved:

### Issue #1: Missing Workspace ID in POST Request ⭐ PRIMARY ISSUE

**Location:** [App.tsx](App.tsx#L267)

**Problem:**
The frontend fails to consistently include `workspaceId` in the save payload because `activeWorkspace?.id` may be undefined when the sync fires.

```typescript
// Line 267 in App.tsx
const saveBody: any = { resources, projects, allocations };
if (activeWorkspace?.id) saveBody.workspaceId = activeWorkspace.id; // ❌ May skip!
```

**When this happens:**
1. User logs in → `setResources([])` clears local state
2. This triggers the persist effect (line 252)
3. `activeWorkspace?.id` hasn't been populated yet (async `setAvailableWorkspaces`)
4. `workspaceId` is NOT added to the payload
5. Backend cannot properly resolve which workspace to save to

---

### Issue #2: Incorrect POST URL Without orgSlug

**Location:** [App.tsx](App.tsx#L269)

**Problem:**
When neither `overrideOrg` nor `orgSlug` is available, the POST URL omits the `orgSlug` parameter entirely:

```typescript
// Line 269
const saveUrl = overrideOrg ? `/api/workspace?orgSlug=${encodeURIComponent(overrideOrg)}` : '/api/workspace';
// ❌ Results in: /api/workspace (NO orgSlug!)
```

But the GET request DOES include it:
```typescript
// Line 197-198
fetch(`/api/workspace?orgSlug=${targetSlug}`, {...}) // ✅ Has orgSlug
```

**Consequence:**
- GET request loads from correct workspace
- POST request saves to WRONG or UNRESOLVED workspace
- Data mismatch and silent data loss

---

### Issue #3: Backend Workspace Resolution Fallback Issues

**Location:** [netlify/functions/workspace.ts](netlify/functions/workspace.ts#L159-L172)

**Problem:**
When POST has no `bodyWsId` and no `orgSlug`, backend falls back to:

```typescript
wsRows = await sql`
    SELECT w.id, u.plan, w.org_id FROM workspaces w
    JOIN users u ON u.org_id = w.org_id
    WHERE u.id = ${userId} LIMIT 1
`;
```

This picks the FIRST workspace the user belongs to, which may NOT be the intended workspace.

---

### Issue #4: Silent Error Handling

**Location:** [App.tsx](App.tsx#L278-L287)

**Problem:**
Sync failures are silently logged to console, no user feedback:

```typescript
.then(async res => {
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 403) {
      alert('Free Plan Limit Exceeded: ...'); // ✅ Shows alert for 403
    } else {
      console.error('Failed to sync workspace'); // ❌ Only logs, no alert!
    }
  }
})
```

Users don't know their data failed to save.

---

### Issue #5: Race Condition on Initial Load

**Location:** [App.tsx](App.tsx#L181-296)

**Sequence:**
1. User logs in → `user?.id` changes
2. useEffect (line 181) sets `initialLoadDone = false`, clears state
3. State change triggers persist effect (line 252)
4. `dataLoadedFromServer` guard prevents save, but...
5. After 1.5s debounce, if guards pass but activeWorkspace unknown → save fails
6. User never gets feedback

---

## Fix Order (Priority)

1. **CRITICAL:** Ensure `workspaceId` is ALWAYS in the payload
2. **CRITICAL:** Ensure POST save URL includes same parameters as GET load URL
3. **HIGH:** Improve workspace resolution logic
4. **HIGH:** Show user alerts on save failures
5. **MEDIUM:** Better coordination between activeWorkspace initialization and persist effect

---

## Data Loss Scenarios

### Scenario A: Empty Payload During Load
1. User logs in with existing data in DB
2. Frontend clears state (line 193-195)
3. Safety Guard is bypassed because it only checks resources & projects
4. Allocations are deleted but resources/projects weren't (due to safety check)
5. Data partially wiped

### Scenario B: Wrong Workspace Saved
1. User with multiple workspaces logs in
2. Data syncs to wrong workspace (first one in list)
3. User's intended workspace remains empty
4. User's original workspace data may be overwritten

### Scenario C: Save Fails, User Continues
1. User adds resource, project, allocation
2. Save attempt fails (500 error, only logs to console)
3. User doesn't know data wasn't saved
4. User closes browser, data lost
5. On next login, user finds workspace empty
