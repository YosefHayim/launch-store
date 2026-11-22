import type { AscHost } from './host.ts';
import type { SandboxTesterResource } from '../../types/apple-catalog.ts';

export class ConnectSandbox {
  constructor(private readonly client: AscHost) {}

  async listSandboxTesters(): Promise<SandboxTesterResource[]> {
    const appleResources = await this.client.requestAll<{
      acAccountName?: string;
      firstName?: string;
      lastName?: string;
      territory?: string;
      applePayCompatible?: boolean;
      interruptPurchases?: boolean;
      subscriptionRenewalRate?: string;
    }>(this.client.v2('/sandboxTesters?limit=200'));
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

  async clearSandboxTesterPurchaseHistory(testerIds: readonly string[]): Promise<void> {
    await this.client.createResource(this.client.v2('/sandboxTestersClearPurchaseHistoryRequest'), {
      type: 'sandboxTestersClearPurchaseHistoryRequest',
      relationships: {
        sandboxTesters: { data: testerIds.map((id) => ({ type: 'sandboxTesters', id })) },
      },
    });
  }
}
