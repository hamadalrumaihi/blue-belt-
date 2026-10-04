// The agent and the Railway worker share one readiness module (single source
// of truth for what counts as a real schedule page). Run the agent from the
// repository checkout so this relative import resolves.
export { assessReadiness, findPaginationHint, hasScheduleStructure } from "../../worker/src/readiness.mjs";
