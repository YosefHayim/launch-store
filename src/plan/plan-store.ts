// Compares the app in launch.config.ts with the live store.

export interface StoreSnapshot {
  name: string;
  version: string | null;
}

export interface StoreChange {
  field: 'name' | 'version';
  from: string | null;
  to: string | null;
}

export function planStore(desired: StoreSnapshot, live: StoreSnapshot): StoreChange[] {
  const changes: StoreChange[] = [];
  const isNameDifferent = desired.name !== live.name;

  if (isNameDifferent) {
    changes.push({ field: 'name', from: live.name, to: desired.name });
  }

  const isVersionDifferent = desired.version !== live.version;

  if (isVersionDifferent) {
    changes.push({ field: 'version', from: live.version, to: desired.version });
  }

  return changes;
}

export function describeChanges(storeName: string, changes: readonly StoreChange[]): string[] {
  const isEmpty = changes.length === 0;

  if (isEmpty) {
    return [`${storeName}: no changes`];
  }

  function describeChange(change: StoreChange): string {
    return `${storeName} ${change.field}: ${show(change.from)} -> ${show(change.to)}`;
  }

  return changes.map(describeChange);
}

function show(field: string | null): string {
  const isMissing = field == null;

  if (isMissing) {
    return 'none';
  }

  return field;
}
