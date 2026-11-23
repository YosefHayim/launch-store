// Lists sandbox testers and clears their purchase history on App Store Connect.

import type { AscHost } from './host.ts';
import type { SandboxTesterResource } from '@/types/apple-catalog.js';
import { APPLE_PAGE_LIMIT, applyAppleListQuery, type AppleListQuery } from './list-query.ts';

export class ConnectSandbox {
  constructor(private readonly client: AscHost) {}

  /**
   * Get a list of Sandbox Testers for your team.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v2-sandboxtesters
   */
  async listSandboxTesters(
    listQuery: AppleListQuery | null = null,
  ): Promise<SandboxTesterResource[]> {
    const appleResources = await this.client.requestAll<{
      acAccountName?: string;
      firstName?: string;
      lastName?: string;
      territory?: string;
      applePayCompatible?: boolean;
      interruptPurchases?: boolean;
      subscriptionRenewalRate?: string;
    }>(this.client.v2(applyAppleListQuery('/sandboxTesters', listQuery, APPLE_PAGE_LIMIT)));

    return appleResources.map((tester) => {
      let accountName = tester.attributes.acAccountName;

      if (accountName == null) accountName = '';

      const sandboxTester: SandboxTesterResource = { id: tester.id, acAccountName: accountName };

      if (tester.attributes.firstName != null)
        Object.assign(sandboxTester, { firstName: tester.attributes.firstName });

      if (tester.attributes.lastName != null)
        Object.assign(sandboxTester, { lastName: tester.attributes.lastName });

      if (tester.attributes.territory != null)
        Object.assign(sandboxTester, { territory: tester.attributes.territory });

      if (tester.attributes.applePayCompatible != null)
        Object.assign(sandboxTester, { applePayCompatible: tester.attributes.applePayCompatible });

      if (tester.attributes.interruptPurchases != null)
        Object.assign(sandboxTester, { interruptPurchases: tester.attributes.interruptPurchases });

      if (tester.attributes.subscriptionRenewalRate != null)
        Object.assign(sandboxTester, {
          subscriptionRenewalRate: tester.attributes.subscriptionRenewalRate,
        });

      return sandboxTester;
    });
  }

  /**
   * Remove purchase history from a Sandbox Apple Account.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v2-sandboxtestersclearpurchasehistoryrequest
   */
  async clearSandboxTesterPurchaseHistory(testerIds: readonly string[]): Promise<void> {
    function writeSandboxTesterLink(id: string) {
      return { type: 'sandboxTesters', id };
    }

    await this.client.createResource(this.client.v2('/sandboxTestersClearPurchaseHistoryRequest'), {
      type: 'sandboxTestersClearPurchaseHistoryRequest',
      relationships: {
        sandboxTesters: { data: testerIds.map(writeSandboxTesterLink) },
      },
    });
  }
}
