import { describe, expect, it } from 'vitest';
import {
  aggregateProductPieces,
  buildAdoptedConfig,
  renderEntitlementsBlock,
  serializeProductsSection,
} from './config-writer.ts';
import type { ProductPiece } from '../types/adopt.ts';
import type { InAppPurchaseConfig, SubscriptionGroupConfig } from '../types/catalog.ts';
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
function describeAggregateProductPieces() {
  function foldsIapAndSubscriptionGroupPiecesIntoOneAppProductsDroppingEmptyArms() {
    const pieces: ProductPiece[] = [
      { type: 'iap', iap: IAP },
      { type: 'subscriptionGroup', group: GROUP },
    ];
    const productPieces = aggregateProductPieces(pieces);

    expect(productPieces).toEqual({
      inAppPurchases: [IAP],
      subscriptionGroups: [GROUP],
    });
    expect(aggregateProductPieces([{ type: 'iap', iap: IAP }])).toEqual({ inAppPurchases: [IAP] });
    expect(aggregateProductPieces([])).toEqual({});
  }

  it(
    'folds iap and subscription-group pieces into one AppProducts, dropping empty arms',
    foldsIapAndSubscriptionGroupPiecesIntoOneAppProductsDroppingEmptyArms,
  );
}

describe('aggregateProductPieces', describeAggregateProductPieces);
function describeSerializeProductsSection() {
  function rendersACommentedPasteReadyProductsBlockKeyedByBundleId() {
    const section = serializeProductsSection({ 'com.acme.app': { inAppPurchases: [IAP] } });

    expect(section).toContain('// Imported from App Store Connect by `launch-store adopt`');
    expect(section).toContain('products: {');
    expect(section).toContain('"com.acme.app"');
    expect(section).toContain('"productId": "com.acme.coins"');
    expect(section.trimEnd().endsWith('},')).toBe(true);
  }

  it(
    'renders a commented, paste-ready products block keyed by bundle id',
    rendersACommentedPasteReadyProductsBlockKeyedByBundleId,
  );
}

describe('serializeProductsSection', describeSerializeProductsSection);
function describeBuildAdoptedPiece() {
  function producesAFullPieceThatImportsDefinePieceAndEmbedsTheProductsBlock() {
    const config = buildAdoptedConfig('./apps', { 'com.acme.app': { inAppPurchases: [IAP] } });

    expect(config).toContain('import { defineConfig } from "launch-store";');
    expect(config).toContain('appRoots: ["./apps"]');
    expect(config).toContain('products: {');
    expect(config.trimEnd().endsWith('});')).toBe(true);
  }

  it(
    'produces a full config that imports defineConfig and embeds the products block',
    producesAFullPieceThatImportsDefinePieceAndEmbedsTheProductsBlock,
  );
}

describe('buildAdoptedConfig', describeBuildAdoptedPiece);
function describeRenderEntitlementsBlock() {
  function wrapsEntitlementsUnderIosForPastingIntoADynamicPiece() {
    const entitlementsBlock = renderEntitlementsBlock({ 'aps-environment': 'production' });
    const parsed = JSON.parse(entitlementsBlock);

    expect(parsed).toEqual({
      ios: { entitlements: { 'aps-environment': 'production' } },
    });
  }

  it(
    'wraps entitlements under ios for pasting into a dynamic config',
    wrapsEntitlementsUnderIosForPastingIntoADynamicPiece,
  );
}

describe('renderEntitlementsBlock', describeRenderEntitlementsBlock);
