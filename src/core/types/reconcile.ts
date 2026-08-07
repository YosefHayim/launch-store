export type ActionStatus = 'planned' | 'applied' | 'skipped' | 'failed';
/**
 * One unit of store-reconcile work shown in plans and apply summaries.
 * Description and destructive are fixed when planned; status/error are filled in by the owning apply path.
 */
export type PlannedAction = {
  readonly description: string;
  readonly destructive: boolean;
  status: ActionStatus;
  error?: string;
};
/** Result of reconciling one app's store surface. */
export type ReconcileReport = Readonly<{
  bundleId: string;
  actions: readonly PlannedAction[];
}>;
