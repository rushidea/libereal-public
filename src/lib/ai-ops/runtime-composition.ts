import { createAiOpsRuntime } from './runtime';
import { revalidateAiOpsActor, routeAiOpsRequest, runBusinessTask } from './business';
import { runEngineeringTask } from './engineering';

export const runAiOpsTask = createAiOpsRuntime({
  revalidateActor: revalidateAiOpsActor,
  route: routeAiOpsRequest,
  business: runBusinessTask,
  engineering: runEngineeringTask,
});
