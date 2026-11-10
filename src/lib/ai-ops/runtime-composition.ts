// AI model execution is owned by the native Mac runner.
// Legacy website workers cannot claim these tasks.
export async function runAiOpsTask(..._args: unknown[]): Promise<void> { throw new Error('aiops_native_runner_required'); }
