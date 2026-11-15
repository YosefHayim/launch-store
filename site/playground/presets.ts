export type PresetId = 'subscriptionApp' | 'freeGame' | 'firstRelease';

export type PlaygroundSettings = Readonly<{
  presetId: PresetId;
  price: number;
  trial: boolean;
  winback: boolean;
  play: boolean;
}>;

export type PlaygroundPreset = Readonly<{
  id: PresetId;
  label: string;
  product: 'subscription' | 'inAppPurchase';
  storeNow: readonly string[];
  defaults: Omit<PlaygroundSettings, 'presetId'>;
}>;

export const PRICE_CHOICES: readonly number[] = [2.99, 3.99, 4.99, 9.99];

export const SAMPLE_BUNDLE_ID = 'com.example.helloworld';

export const PLAYGROUND_PRESETS: readonly PlaygroundPreset[] = [
  {
    id: 'subscriptionApp',
    label: 'Subscription app',
    product: 'subscription',
    storeNow: [
      'group "Hello Pro" with pro.monthly',
      'no price set, no intro offer, no promo offer',
      'not on Google Play',
    ],
    defaults: { price: 4.99, trial: true, winback: false, play: false },
  },
  {
    id: 'freeGame',
    label: 'Free game',
    product: 'inAppPurchase',
    storeNow: [
      'gems.small exists with no price',
      'no other in-app purchases',
      'not on Google Play',
    ],
    defaults: { price: 4.99, trial: false, winback: false, play: false },
  },
  {
    id: 'firstRelease',
    label: 'First release',
    product: 'subscription',
    storeNow: ['app record exists', 'no subscriptions, no in-app purchases', 'not on Google Play'],
    defaults: { price: 4.99, trial: true, winback: false, play: false },
  },
];

export const findPreset = (presetId: PresetId): PlaygroundPreset => {
  const foundPreset = PLAYGROUND_PRESETS.find((preset) => preset.id === presetId);
  if (foundPreset === undefined) return PLAYGROUND_PRESETS[0] as PlaygroundPreset;
  return foundPreset;
};

export const offersApplyTo = (presetId: PresetId): boolean => presetId === 'subscriptionApp';

export const settingsForPreset = (presetId: PresetId): PlaygroundSettings => ({
  presetId,
  ...findPreset(presetId).defaults,
});

export const INITIAL_PRESET_ID: PresetId = 'subscriptionApp';
