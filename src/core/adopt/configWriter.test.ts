import { describe, expect, it } from 'vitest';
import {
  aggregateProductPieces,
  buildAdoptedConfig,
  renderEntitlementsBlock,
  serializeProductsSection,
} from './configWriter.js';
import type { ProductPiece, InAppPurchaseConfig, SubscriptionGroupConfig } from '../types.js';

const IAP: InAppPurchaseConfig = {
  productId: 'com.acme.coins',
  referenceName: 'Coins',
  type: 'CONSUMABLE',
  localizations: [{ locale: 'en-US', name: 'Coins' }],
};

const GROUP: SubscriptionGroupConfig = {
  referenceName: 'Pro',
  localizations: [{ locale: 'en-US', name: 'Pro Tiers' }],
  subscriptions: [
    {
      productId: 'com.acme.pro.monthly',
      referenceName: 'Pro Monthly',
      subscriptionPeriod: 'ONE_MONTH',
      localizations: [{ locale: 'en-US', name: 'Pro' }],
    },
  ],
};

describe('aggregateProductPieces', () => {
  it('folds iap and subscription-group pieces into one AppProducts, dropping empty arms', () => {
    const pieces: ProductPiece[] = [
      { type: 'iap', iap: IAP },
      { type: 'subscriptionGroup', group: GROUP },
    ];
    expect(aggregateProductPieces(pieces)).toEqual({
      inAppPurchases: [IAP],
      subscriptionGroups: [GROUP],
    });
    expect(aggregateProductPieces([{ type: 'iap', iap: IAP }])).toEqual({ inAppPurchases: [IAP] });
    expect(aggregateProductPieces([])).toEqual({});
  });
});

describe('serializeProductsSection', () => {
  it('renders a commented, paste-ready products block keyed by bundle id', () => {
    const section = serializeProductsSection({ 'com.acme.app': { inAppPurchases: [IAP] } });
    expect(section).toContain('// Imported from App Store Connect by `launch adopt`');
    expect(section).toContain('products: {');
    expect(section).toContain('"com.acme.app"');
    expect(section).toContain('"productId": "com.acme.coins"');
    expect(section.trimEnd().endsWith('},')).toBe(true);
  });
});

describe('buildAdoptedConfig', () => {
  it('produces a full config that imports defineConfig and embeds the products block', () => {
    const config = buildAdoptedConfig('./apps', { 'com.acme.app': { inAppPurchases: [IAP] } });
    expect(config).toContain('import { defineConfig } from "launch-store";');
    expect(config).toContain('appRoots: ["./apps"]');
    expect(config).toContain('products: {');
    expect(config.trimEnd().endsWith('});')).toBe(true);
  });
});

describe('renderEntitlementsBlock', () => {
  it('wraps entitlements under ios for pasting into a dynamic config', () => {
    expect(JSON.parse(renderEntitlementsBlock({ 'aps-environment': 'production' }))).toEqual({
      ios: { entitlements: { 'aps-environment': 'production' } },
    });
  });
});
