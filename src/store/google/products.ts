import type { GooglePlay } from '@/google-play.js';

export class PlayProducts {
  constructor(private readonly play: GooglePlay) {}

  async list(packageName: string): Promise<readonly string[]> {
    return this.play.listInAppProducts(packageName);
  }

  async ensure(packageName: string | null, productId: string): Promise<void> {
    const hasPackage = packageName != null;

    if (hasPackage == false) {
      throw new Error(
        'No Android package name. Set it in app.json before sync can create a Play product.',
      );
    }

    const productIds = await this.list(packageName);

    function isThisProduct(liveProductId: string): boolean {
      return liveProductId == productId;
    }

    const found = productIds.find(isThisProduct);
    const isMissing = found == null;

    if (isMissing) {
      throw new Error(
        `Play has no in-app product ${productId}. Add its price in launch.config.ts before sync can create it.`,
      );
    }
  }
}
