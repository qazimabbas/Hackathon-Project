import { createApp } from '../server/src/app.js';
import { createRepository } from '../server/src/repository.js';
import { createJobStore } from '../server/src/jobs.js';

// Work stays inside the streaming request for the whole function invocation.
// No work is scheduled after the HTTP response has ended.
export default createApp({
  repository: createRepository(),
  jobStore: createJobStore(),
  streamChecks: true,
  trustProxy: 1,
  privateWorkspaces: true,
});
