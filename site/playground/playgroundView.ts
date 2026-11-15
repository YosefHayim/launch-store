import { controlsHtml, outputHtml } from './playgroundMarkup.js';
import {
  INITIAL_PRESET_ID,
  PLAYGROUND_PRESETS,
  settingsForPreset,
  type PlaygroundSettings,
  type PresetId,
} from './presets.js';
import { runSamplePlan } from './runSamplePlan.js';

const isPresetId = (candidate: string): candidate is PresetId =>
  PLAYGROUND_PRESETS.some((preset) => preset.id === candidate);

const focusKeyOf = (element: Element | null): string => {
  if (!(element instanceof HTMLElement)) return '';
  const { preset, price, toggle } = element.dataset;
  if (preset !== undefined) return preset;
  if (price !== undefined) return price;
  if (toggle !== undefined) return toggle;
  return '';
};

export const startPlayground = (): void => {
  const controlsPanel = document.getElementById('playControls');
  const outputPanel = document.getElementById('playOutput');
  if (controlsPanel === null || outputPanel === null) return;
  let settings: PlaygroundSettings = settingsForPreset(INITIAL_PRESET_ID);
  let runCounter = 0;

  const render = async (): Promise<void> => {
    runCounter += 1;
    const thisRun = runCounter;
    const focusedKey = focusKeyOf(document.activeElement);
    controlsPanel.innerHTML = controlsHtml(settings);
    if (focusedKey !== '') {
      const focusTarget = controlsPanel.querySelector<HTMLElement>(
        `[data-preset="${focusedKey}"], [data-price="${focusedKey}"], [data-toggle="${focusedKey}"]`,
      );
      focusTarget?.focus();
    }
    const samplePlan = await runSamplePlan(settings);
    if (thisRun !== runCounter) return;
    outputPanel.innerHTML = outputHtml(settings, samplePlan);
  };

  controlsPanel.addEventListener('click', (clickEvent) => {
    const clicked = clickEvent.target;
    if (!(clicked instanceof Element)) return;
    const control = clicked.closest<HTMLElement>('[data-preset], [data-price], [data-toggle]');
    if (control === null) return;
    const { preset, price, toggle } = control.dataset;
    if (preset !== undefined && isPresetId(preset)) {
      settings = settingsForPreset(preset);
    }
    if (price !== undefined) settings = { ...settings, price: Number(price) };
    if (toggle === 'trial') settings = { ...settings, trial: !settings.trial };
    if (toggle === 'winback') settings = { ...settings, winback: !settings.winback };
    if (toggle === 'play') settings = { ...settings, play: !settings.play };
    void render();
  });
};
