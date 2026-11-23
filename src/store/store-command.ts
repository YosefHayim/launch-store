import type { Command } from '../cli/command.ts';
import { AppStoreConnect } from '../apple/app-store-connect.ts';
import type { ExpoApp } from '../expo-app.ts';
import { readExpoApp } from '../expo-app.ts';
import { GooglePlay } from '../google-play.ts';
import { LoadLaunchFile } from '../launch-file/load-launch-file.ts';
import {
  DRIFT_MESSAGE,
  desiredProducts,
  planStore,
  type StoreProduct,
  type StoreSnapshot,
} from './plan-store.ts';
import { StoreAdopt } from './store-adopt.ts';
import { StoreSync } from './store-sync.ts';

interface PlanFlags {
  check: boolean;
  json: boolean;
}

interface SyncFlags {
  dryRun: boolean;
  yes: boolean;
}

interface AdoptFlags {
  dryRun: boolean;
  yes: boolean;
}

interface LoadedStore {
  directory: string;
  desired: StoreSnapshot;
  live: StoreSnapshot;
  packageName: string | null;
  bundleId: string | null;
}

export class StoreCommand {
  register(program: Command): void {
    program
      .command('plan [surface]')
      .description('diff launch.config against the live store and change nothing')
      .option('--check', 'exit 2 when the store has drifted', false)
      .option('--json', 'print one JSON object', false)
      .action(this.plan);

    program
      .command('drift [surface]')
      .description('fail when the live store has drifted (alias of launch-store plan --check)')
      .option('--json', 'print one JSON object', false)
      .action(this.drift);

    program
      .command('sync')
      .description('apply the store diff')
      .option('--dry-run', 'print the diff and change nothing', false)
      .option('-y, --yes', 'apply without a prompt', false)
      .action(this.sync);

    program
      .command('adopt')
      .description('read the live store back into the project')
      .option('--dry-run', 'print the live store and change nothing', false)
      .option('-y, --yes', 'write without a prompt', false)
      .action(this.adopt);
  }

  plan = async (surfaceName: string | undefined, flags: PlanFlags): Promise<void> => {
    refuseLaterSurface(surfaceName);
    await this.showPlan(flags.check, flags.json);
  };

  drift = async (surfaceName: string | undefined, flags: PlanFlags): Promise<void> => {
    refuseLaterSurface(surfaceName);
    await this.showPlan(true, flags.json);
  };

  sync = async (flags: SyncFlags): Promise<void> => {
    const loaded = await this.load();

    const isDryRun = flags.dryRun;

    if (isDryRun) {
      const store = planStore(loaded.desired, loaded.live);
      this.printChanges(store, false);
      return;
    }

    const sync = new StoreSync();

    await sync.run({
      desired: loaded.desired,
      live: loaded.live,
      hasYes: flags.yes,
      packageName: loaded.packageName,
    });
  };

  async adopt(flags: AdoptFlags): Promise<void> {
    const directory = process.cwd();
    const expoApp = await readExpoApp(directory);
    const adopt = new StoreAdopt();

    await adopt.run({
      directory,
      hasYes: flags.yes,
      isDryRun: flags.dryRun,
      bundleId: expoApp.bundleId,
      packageName: expoApp.packageName,
    });
  }

  private async showPlan(shouldCheck: boolean, hasJson: boolean): Promise<void> {
    const loaded = await this.load();
    const changes = planStore(loaded.desired, loaded.live);

    this.printChanges(changes, hasJson);

    const hasDrift = changes.length != 0;

    if (hasDrift == false) {
      return;
    }

    if (shouldCheck) {
      throw new Error(DRIFT_MESSAGE);
    }
  }

  private printChanges(changes: ReturnType<typeof planStore>, hasJson: boolean): void {
    if (hasJson) {
      const serialized = JSON.stringify({ changes });
      console.log(serialized);
      return;
    }

    for (const change of changes) {
      console.log(`${change.action} ${change.topic} ${change.detail}`);
    }
  }

  private async load(): Promise<LoadedStore> {
    const directory = process.cwd();
    const launchFile = await new LoadLaunchFile().read(directory);
    const desired = { products: desiredProducts(launchFile) };
    const expoApp = await readExpoApp(directory);

    const isDesiredEmpty = desired.products.length == 0;

    if (isDesiredEmpty) {
      return {
        directory,
        desired,
        live: { products: [] },
        packageName: expoApp.packageName,
        bundleId: expoApp.bundleId,
      };
    }

    const canRead = canReadStore(expoApp);

    if (canRead == false) {
      throw new Error('No bundle id or package name, so the live catalog cannot be read.');
    }

    const liveProducts = await readLiveProducts(expoApp);

    return {
      directory,
      desired,
      live: { products: liveProducts },
      packageName: expoApp.packageName,
      bundleId: expoApp.bundleId,
    };
  }
}

function refuseLaterSurface(surfaceName: string | undefined): void {
  const hasSurface = surfaceName != null;

  if (hasSurface == false) {
    return;
  }

  throw new Error(`The ship path plans products. ${surfaceName} stays on a later command.`);
}

function canReadStore(expoApp: ExpoApp): boolean {
  const hasPackage = expoApp.packageName != null;

  if (hasPackage) {
    return true;
  }

  return expoApp.bundleId != null;
}

async function readLiveProducts(expoApp: ExpoApp): Promise<StoreProduct[]> {
  const liveProducts: StoreProduct[] = [];
  const packageName = expoApp.packageName;

  const hasPackage = packageName != null;

  if (hasPackage) {
    const play = new GooglePlay();
    const productIds = await play.listInAppProducts(packageName);

    for (const productId of productIds) {
      liveProducts.push({ productId });
    }
  }

  const bundleId = expoApp.bundleId;
  const hasBundle = bundleId != null;

  if (hasBundle == false) {
    return liveProducts;
  }

  const apple = new AppStoreConnect();
  const appId = await apple.findAppId(bundleId);

  const isMissing = appId == null;

  if (isMissing) {
    return liveProducts;
  }

  const productIds = await apple.listInAppPurchases(appId);

  for (const productId of productIds) {
    function isAlreadyListed(product: StoreProduct): boolean {
      return product.productId == productId;
    }

    const already = liveProducts.find(isAlreadyListed);

    const isNew = already == null;

    if (isNew) {
      liveProducts.push({ productId });
    }
  }

  return liveProducts;
}
