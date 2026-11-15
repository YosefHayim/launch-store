import { codeLinesHtml } from '../page/pageMarkup.js';
import { escapeHtml, parseMarkupBlock } from '../page/miniMarkup.js';
import { textWhen } from '../page/textWhen.js';
import {
  PLAYGROUND_PRESETS,
  PRICE_CHOICES,
  SAMPLE_BUNDLE_ID,
  findPreset,
  offersApplyTo,
  type PlaygroundSettings,
} from './presets.js';
import { halfPriceOf } from './sampleConfig.js';
import type { SamplePlan } from './runSamplePlan.js';

const formatPrice = (price: number): string => price.toFixed(2);

const linesWhen = (condition: boolean, lines: readonly string[]): readonly string[] => {
  if (condition) return lines;
  return [];
};

const subscriptionConfigLines = (settings: PlaygroundSettings): readonly string[] => [
  '[p]subscriptions[/]: [{',
  '  productId: [s]"pro.monthly"[/],',
  `  price: { customerPrice: [n]${formatPrice(settings.price)}[/] },`,
  ...linesWhen(settings.trial, [
    '  introductoryOffers: [{ offerMode: [s]"FREE_TRIAL"[/], duration: [s]"ONE_WEEK"[/] }],',
  ]),
  ...linesWhen(settings.winback, [
    `  promotionalOffers: [{ offerCode: [s]"promo-halfoff"[/], customerPrice: [n]${formatPrice(halfPriceOf(settings.price))}[/] }],`,
  ]),
  ...linesWhen(settings.play, ['  play: { basePlanId: [s]"p1m"[/] },']),
  '}]',
];

const gemPackConfigLines = (settings: PlaygroundSettings): readonly string[] => [
  '[p]inAppPurchases[/]: [{',
  '  productId: [s]"gems.small"[/],',
  `  price: { customerPrice: [n]${formatPrice(settings.price)}[/] },`,
  ...linesWhen(settings.play, ['  play: { defaultPrice: { currency: [s]"USD"[/] } },']),
  '}, [c]// plus remove.ads at 2.99[/]',
  ']',
];

const firstReleaseConfigLines = (settings: PlaygroundSettings): readonly string[] => [
  '[p]subscriptionGroups[/]: [{ referenceName: [s]"Hello Pro"[/],',
  '  subscriptions: [{',
  '    productId: [s]"pro.monthly"[/],',
  `    price: { customerPrice: [n]${formatPrice(settings.price)}[/] },`,
  ...linesWhen(settings.play, ['    play: { basePlanId: [s]"p1m"[/] },']),
  '  }] }]',
];

const configLinesFor = (settings: PlaygroundSettings): readonly string[] => {
  if (settings.presetId === 'freeGame') return gemPackConfigLines(settings);
  if (settings.presetId === 'firstRelease') return firstReleaseConfigLines(settings);
  return subscriptionConfigLines({
    ...settings,
    trial: settings.trial && offersApplyTo(settings.presetId),
    winback: settings.winback && offersApplyTo(settings.presetId),
  });
};

const pressedButtons = (
  items: readonly { key: string; label: string; isPressed: boolean }[],
  attributeName: string,
): string =>
  items
    .map(
      (item) =>
        `<button type="button" data-${attributeName}="${item.key}" aria-pressed="${String(item.isPressed)}">${escapeHtml(item.label)}</button>`,
    )
    .join('');

const toggleHtml = (
  toggleKey: string,
  label: string,
  fieldName: string,
  isChecked: boolean,
  isEnabled: boolean,
): string => {
  const disabledAttribute = textWhen(isEnabled, '', ' disabled');
  return `<button type="button" class="toggle" role="switch" data-toggle="${toggleKey}" aria-checked="${String(isChecked && isEnabled)}"${disabledAttribute}><span>${escapeHtml(label)}<small>${escapeHtml(fieldName)}</small></span><span class="switch"></span></button>`;
};

const offersNoteFor = (settings: PlaygroundSettings): string => {
  if (settings.presetId === 'freeGame')
    return 'Offers belong to subscriptions. This sample sells in-app purchases.';
  if (settings.presetId === 'firstRelease') {
    return 'Offers wait until the subscription exists. Run launch sync first.';
  }
  return '';
};

export const controlsHtml = (settings: PlaygroundSettings): string => {
  const preset = findPreset(settings.presetId);
  const offersEnabled = offersApplyTo(settings.presetId);
  const priceLabel = textWhen(preset.product === 'subscription', 'Pro Monthly', 'Small gem pack');
  const playField = textWhen(
    preset.product === 'subscription',
    'play.basePlanId',
    'play.defaultPrice',
  );
  const offersNote = offersNoteFor(settings);
  const noteHtml = textWhen(
    offersNote === '',
    '',
    `<p class="ctl-note">${escapeHtml(offersNote)}</p>`,
  );
  const presetButtons = pressedButtons(
    PLAYGROUND_PRESETS.map((item) => ({
      key: item.id,
      label: item.label,
      isPressed: item.id === settings.presetId,
    })),
    'preset',
  );
  const priceButtons = pressedButtons(
    PRICE_CHOICES.map((price) => ({
      key: formatPrice(price),
      label: `$${formatPrice(price)}`,
      isPressed: price === settings.price,
    })),
    'price',
  );
  const storeNowLines = preset.storeNow.map((line) => escapeHtml(line)).join('<br>');
  return `<div><div class="ctl-label"><span>Sample app</span></div><div class="presets" role="group" aria-label="Sample app">${presetButtons}</div></div>
        <div><div class="ctl-label"><span>${priceLabel} price</span><span class="mono">USD</span></div><div class="chips" role="group" aria-label="Price">${priceButtons}</div></div>
        <div><div class="toggles">
          ${toggleHtml('trial', 'Free trial', 'introductoryOffers', settings.trial, offersEnabled)}
          ${toggleHtml('winback', 'Winback offer', 'promotionalOffers', settings.winback, offersEnabled)}
          ${toggleHtml('play', 'Also on Google Play', playField, settings.play, true)}
        </div>${noteHtml}</div>
        <div class="store-now"><b>Sample store today</b><br>${storeNowLines}</div>
        <p class="ctl-note">Runs the real planners from the Launch source, bundled into this page. No network, no keys.</p>`;
};

const planGlyphClass = (glyph: string): string => {
  if (glyph === '+') return 'add';
  if (glyph === '~') return 'chg';
  return 'same';
};

const planLinesHtml = (samplePlan: SamplePlan): string => {
  if (samplePlan.appErrorCount > 0) {
    return '<div class="chg">[ERROR] The sample plan could not run.</div>';
  }
  if (samplePlan.lines.length === 0) {
    return '<div class="same">= no changes. The store already matches your config.</div>';
  }
  return samplePlan.lines
    .map(
      (line) =>
        `<div class="plan-line"><span class="${planGlyphClass(line.glyph)}">${line.glyph}</span><span>${escapeHtml(line.description)}</span></div>`,
    )
    .join('');
};

export const outputHtml = (settings: PlaygroundSettings, samplePlan: SamplePlan): string => {
  const configHtml = codeLinesHtml(parseMarkupBlock(configLinesFor(settings).join('\n')));
  return `<div class="window-bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="mono window-title">~/hello-world  ${escapeHtml(SAMPLE_BUNDLE_ID)}</span></div>
        <div class="grow">
          <div class="cfg"><div class="code">${configHtml}</div></div>
          <div class="code plan" aria-live="polite"><div class="cl"><span class="s">$</span> launch plan</div>${planLinesHtml(samplePlan)}</div>
        </div>
        <div class="plan-sum"><span>${samplePlan.createCount} to create</span><span>${samplePlan.updateCount} to update</span><span>${samplePlan.deleteCount} to delete</span><span class="next">next: launch sync</span></div>`;
};
