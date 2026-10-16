/** The /api/v2 route table (BACKLOG §4.3). Exported for the authorisation matrix test (PL-12). */
import { Router } from './router';
import { getMe, patchMe } from './handlers/me';
import { platformOverview } from './handlers/platform';
import {
  createOrg,
  createWorkspace,
  deleteWorkspace,
  getOrg,
  getWorkspace,
  listOrgWorkspaces,
  patchOrg,
  patchWorkspace,
} from './handlers/orgs';
import { createStructure, deleteStructure, listStructure, patchStructure } from './handlers/structure';
import {
  listOrgMembers,
  listWorkspaceMembers,
  patchOrgMember,
  patchWorkspaceMember,
  removeOrgMember,
  removeWorkspaceMember,
} from './handlers/members';
import {
  acceptInvitation,
  createInvitation,
  listInvitations,
  lookupInvitation,
  resendInvitation,
  revokeInvitation,
} from './handlers/invitations';
import { exportAudit, orgAudit } from './handlers/auditLog';
import { getSnapshot, installSampleData } from './handlers/snapshot';
import {
  bulkPeople,
  createPerson,
  decideCraftRequest,
  deletePerson,
  importPeople,
  listCraftRequests,
  patchPerson,
  submitCraftRequest,
} from './handlers/people';
import {
  createDemand,
  createProject,
  deleteDemand,
  deleteProject,
  demandBatch,
  patchDemand,
  patchProject,
} from './handlers/projects';
import {
  allocationBatch,
  createAllocation,
  deleteAllocation,
  deleteOffer,
  patchAllocation,
  propose,
  putOffer,
  respondAllocation,
} from './handlers/allocations';
import {
  autoMatch,
  getCalibration,
  getDelivery,
  getMappings,
  getSyncHealth,
  listJobs,
  putCalibration,
  putPeopleMappings,
  putProjectMappings,
  startJiraSync,
  stepJob,
} from './handlers/delivery';
import { planviewApply, planviewPreview, planviewTestMapping } from './handlers/planview';

const W = '/workspaces/:wsId';
const O = '/orgs/:orgId';

export const v2Router = new Router()
  .get('/me', getMe)
  .patch('/me', patchMe)
  .get('/platform/overview', platformOverview)
  .post('/orgs', createOrg)
  .get(O, getOrg)
  .patch(O, patchOrg)
  .get(`${O}/workspaces`, listOrgWorkspaces)
  .post(`${O}/workspaces`, createWorkspace)
  .get(`${O}/members`, listOrgMembers)
  .patch(`${O}/members/:userId`, patchOrgMember)
  .delete(`${O}/members/:userId`, removeOrgMember)
  .get(`${O}/invitations`, listInvitations)
  .post(`${O}/invitations`, createInvitation)
  .delete(`${O}/invitations/:id`, revokeInvitation)
  .post(`${O}/invitations/:id/resend`, resendInvitation)
  .get(`${O}/audit`, orgAudit)
  .get(`${O}/:kind`, listStructure)
  .post(`${O}/:kind`, createStructure)
  .patch(`${O}/:kind/:id`, patchStructure)
  .delete(`${O}/:kind/:id`, deleteStructure)
  .get('/invitations/:token', lookupInvitation, { auth: 'none' })
  .post('/invitations/:token/accept', acceptInvitation, { auth: 'none' })
  .get(W, getWorkspace)
  .patch(W, patchWorkspace)
  .delete(W, deleteWorkspace)
  .get(`${W}/members`, listWorkspaceMembers)
  .patch(`${W}/members/:userId`, patchWorkspaceMember)
  .delete(`${W}/members/:userId`, removeWorkspaceMember)
  .get(`${W}/snapshot`, getSnapshot)
  .post(`${W}/sample-data`, installSampleData)
  .post(`${W}/people`, createPerson)
  .post(`${W}/people/bulk`, bulkPeople)
  .post(`${W}/people/import`, importPeople)
  .post(`${W}/people/:personId/craft-requests`, submitCraftRequest)
  .patch(`${W}/people/:id`, patchPerson)
  .delete(`${W}/people/:id`, deletePerson)
  .get(`${W}/craft-requests`, listCraftRequests)
  .post(`${W}/craft-requests/:id/:decision`, decideCraftRequest)
  .post(`${W}/projects`, createProject)
  .patch(`${W}/projects/:id`, patchProject)
  .delete(`${W}/projects/:id`, deleteProject)
  .post(`${W}/demand`, createDemand)
  .post(`${W}/demand/batch`, demandBatch)
  .patch(`${W}/demand/:id`, patchDemand)
  .delete(`${W}/demand/:id`, deleteDemand)
  .post(`${W}/allocations`, createAllocation)
  .post(`${W}/allocations/batch`, allocationBatch)
  .post(`${W}/allocations/:id/respond`, respondAllocation)
  .patch(`${W}/allocations/:id`, patchAllocation)
  .delete(`${W}/allocations/:id`, deleteAllocation)
  .post(`${W}/marketplace/propose`, propose)
  .put(`${W}/offers/:personId/:quarterKey`, putOffer)
  .delete(`${W}/offers/:personId/:quarterKey`, deleteOffer)
  .post(`${W}/audit/export`, exportAudit)
  .get(`${W}/integrations/jira/mappings`, getMappings)
  .post(`${W}/integrations/jira/mappings/auto-match`, autoMatch)
  .put(`${W}/integrations/jira/mappings/projects`, putProjectMappings)
  .put(`${W}/integrations/jira/mappings/people`, putPeopleMappings)
  .get(`${W}/calibration`, getCalibration)
  .put(`${W}/calibration/:tribeId`, putCalibration)
  .post(`${W}/sync/jira`, startJiraSync)
  .get(`${W}/sync/jobs`, listJobs)
  .post(`${W}/sync/jobs/:jobId/step`, stepJob)
  .get(`${W}/sync/health`, getSyncHealth)
  .get(`${W}/delivery`, getDelivery)
  .post(`${W}/planview/preview`, planviewPreview)
  .post(`${W}/planview/apply`, planviewApply)
  .post(`${W}/planview/test-mapping`, planviewTestMapping);
