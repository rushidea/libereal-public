import { createAiOpsRuntime } from './runtime';
import { revalidateAiOpsActor, routeAiOpsRequest, runBusinessTask } from './business';
import { waitForEngineeringTask } from './engineering-bridge';

export const runAiOpsTask = createAiOpsRuntime({
  revalidateActor: revalidateAiOpsActor,
  route: routeAiOpsRequest,
  business: runBusinessTask,
  engineering: waitForEngineeringTask,
});
