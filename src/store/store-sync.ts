// Confirms a planned store diff and checks the in-app products on Google Play.

import { AppStoreConnect } from '../apple/app-store-connect.ts';
import { GooglePlay } from '../google-play.ts';
import { Prompts } from '../prompts.ts';
import { AppleListing } from './apple/listing.ts';
import { PlayProducts } from './google/products.ts';
import { planStore, type StoreChange, type StoreSnapshot } from './plan-store.ts';

interface SyncRequest {
  desired: StoreSnapshot;
  live: StoreSnapshot;
  hasYes: boolean;
  packageName: string | null;
}

export class StoreSync {
  private packageName: string | null = null;

  constructor(
    private readonly apple = new AppStoreConnect(),
    private readonly play = new GooglePlay(),
    private readonly prompts = new Prompts(),
  ) {}

  async run(syncRequest: SyncRequest): Promise<void> {
    const changes = planStore(syncRequest.desired, syncRequest.live);

    const isEmpty = changes.length == 0;

    if (isEmpty) {
      return;
    }

    const isAllowed = await this.allow(syncRequest.hasYes);

    if (isAllowed == false) {
      return;
    }

    this.packageName = syncRequest.packageName;

    const listing = new AppleListing(this.apple);
    const products = new PlayProducts(this.play);

    for (const change of changes) {
      await this.apply(change, listing, products);
    }
  }

  private async allow(hasYes: boolean): Promise<boolean> {
    if (hasYes) {
      return true;
    }

    const isInteractive = this.prompts.isInteractive();

    if (isInteractive == false) {
      throw new Error('Pass --yes to sync without a terminal');
    }

    return this.prompts.confirm('Apply these store changes?');
  }

  private async apply(
    change: StoreChange,
    listing: AppleListing,
    products: PlayProducts,
  ): Promise<void> {
    switch (change.action) {
      case 'create':
        await products.ensure(this.packageName, change.detail);
        return;
      case 'update':
        await products.ensure(this.packageName, change.detail);
        return;
      case 'leave':
        await listing.list();
        return;
    }
  }
}
