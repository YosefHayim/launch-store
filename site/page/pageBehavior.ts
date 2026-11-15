import { FEATURES, INSTALL_COMMAND, PIPELINE_STEPS, TERMINAL_LINES } from './pageContent.js';
import { featureCopyHtml, featureDemoHtml, featureTabsHtml } from './pageMarkup.js';
import { textWhen } from './textWhen.js';

const PIPELINE_TICK_MS = 1600;
const PIPELINE_LAST_HOLD_TICKS = 2;
const TERMINAL_START_MS = 900;
const TERMINAL_RESET_MS = 300;
const COPIED_LABEL_MS = 1400;

const isReducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const findElement = (selector: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(selector);

export const startPipeline = (): void => {
  const pipeNodes = Array.from(document.querySelectorAll<HTMLElement>('.pnode'));
  const logTag = findElement('#pipeLogTag');
  const logText = findElement('#pipeLogText');
  const captionTitle = findElement('#pipeTitle');
  const captionText = findElement('#pipeCaption');
  const toggleButton = findElement('#pipeToggle');
  const toggleIcon = findElement('#pipeToggleIcon');
  const toggleLabel = findElement('#pipeToggleLabel');
  if (
    logTag === null ||
    logText === null ||
    captionTitle === null ||
    captionText === null ||
    toggleButton === null ||
    toggleIcon === null ||
    toggleLabel === null
  ) {
    return;
  }
  const lastStep = PIPELINE_STEPS.length - 1;
  let currentStep = 0;
  let isAutoplay = !isReducedMotion();
  let lastHoldTicks = 0;

  const showStep = (): void => {
    pipeNodes.forEach((pipeNode, stepIndex) => {
      pipeNode.classList.toggle('done', stepIndex < currentStep);
      pipeNode.classList.toggle('active', stepIndex === currentStep);
    });
    const step = PIPELINE_STEPS[currentStep];
    if (step === undefined) return;
    logTag.textContent = `[${step.tag}]`;
    logTag.className = textWhen(step.tag === 'OK', 'ok', 'run');
    logText.textContent = step.log;
    captionTitle.textContent = `${step.title}.`;
    captionText.textContent = step.caption;
    toggleLabel.textContent = textWhen(isAutoplay, 'Pause', 'Play');
    toggleIcon.setAttribute('href', textWhen(isAutoplay, '#i-pause', '#i-play'));
  };

  const tick = (): void => {
    if (!isAutoplay) return;
    if (currentStep < lastStep) {
      currentStep += 1;
      showStep();
      return;
    }
    lastHoldTicks += 1;
    if (lastHoldTicks >= PIPELINE_LAST_HOLD_TICKS) {
      lastHoldTicks = 0;
      currentStep = 0;
      showStep();
    }
  };

  document.querySelectorAll<HTMLElement>('[data-pick-step]').forEach((pickButton) => {
    pickButton.addEventListener('click', () => {
      currentStep = Number(pickButton.getAttribute('data-pick-step'));
      isAutoplay = false;
      lastHoldTicks = 0;
      showStep();
    });
  });
  toggleButton.addEventListener('click', () => {
    isAutoplay = !isAutoplay;
    lastHoldTicks = 0;
    showStep();
  });
  showStep();
  window.setInterval(tick, PIPELINE_TICK_MS);
};

export const startHeroTabs = (): void => {
  const terminalPanel = findElement('#heroTerminal');
  const configPanel = findElement('#heroConfig');
  const tabButtons = Array.from(document.querySelectorAll<HTMLElement>('[data-hero-tab]'));
  if (terminalPanel === null || configPanel === null) return;
  tabButtons.forEach((tabButton) => {
    tabButton.addEventListener('click', () => {
      const isTerminalTab = tabButton.getAttribute('data-hero-tab') === 'terminal';
      terminalPanel.hidden = !isTerminalTab;
      configPanel.hidden = isTerminalTab;
      tabButtons.forEach((otherButton) => {
        otherButton.setAttribute('aria-selected', String(otherButton === tabButton));
      });
    });
  });
};

export const startTerminalReplay = (): void => {
  if (isReducedMotion()) return;
  const replayLines = Array.from(document.querySelectorAll<HTMLElement>('#heroTerminal .ln'));
  let shownCount = 0;
  const showShown = (): void => {
    replayLines.forEach((replayLine, lineIndex) => {
      replayLine.classList.toggle('off', lineIndex >= shownCount);
    });
  };
  const step = (): void => {
    const isFinished = shownCount >= replayLines.length;
    if (isFinished) {
      shownCount = 0;
    } else {
      shownCount += 1;
    }
    showShown();
    const lastShown = TERMINAL_LINES[shownCount - 1];
    if (shownCount === 0 || lastShown === undefined) {
      window.setTimeout(step, TERMINAL_RESET_MS);
      return;
    }
    window.setTimeout(step, lastShown.waitMs);
  };
  showShown();
  window.setTimeout(step, TERMINAL_START_MS);
};

export const startFeatureTabs = (): void => {
  const tabsSlot = findElement('#featureTabs');
  const copySlot = findElement('#featureCopy');
  const demoSlot = findElement('#featureDemo');
  if (tabsSlot === null || copySlot === null || demoSlot === null) return;
  tabsSlot.addEventListener('click', (clickEvent) => {
    const target = clickEvent.target;
    if (!(target instanceof Element)) return;
    const tabButton = target.closest<HTMLElement>('[data-feature]');
    if (tabButton === null) return;
    const featureIndex = Number(tabButton.getAttribute('data-feature'));
    if (FEATURES[featureIndex] === undefined) return;
    tabsSlot.innerHTML = featureTabsHtml(featureIndex);
    copySlot.innerHTML = featureCopyHtml(featureIndex);
    demoSlot.innerHTML = featureDemoHtml(featureIndex);
  });
};

export const startFaq = (): void => {
  document.querySelectorAll<HTMLElement>('[data-faq]').forEach((faqButton) => {
    faqButton.addEventListener('click', () => {
      const faqIndex = Number(faqButton.getAttribute('data-faq'));
      const isOpening = faqButton.getAttribute('aria-expanded') !== 'true';
      document.querySelectorAll<HTMLElement>('[data-faq]').forEach((otherButton) => {
        const otherIndex = Number(otherButton.getAttribute('data-faq'));
        const shouldOpen = isOpening && otherIndex === faqIndex;
        otherButton.setAttribute('aria-expanded', String(shouldOpen));
        const answer = document.getElementById(`faq-answer-${otherIndex}`);
        if (answer !== null) answer.hidden = !shouldOpen;
      });
    });
  });
};

const copyWithFallback = async (text: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const scratchField = document.createElement('textarea');
    scratchField.value = text;
    scratchField.style.position = 'fixed';
    scratchField.style.opacity = '0';
    document.body.append(scratchField);
    scratchField.select();
    document.execCommand('copy');
    scratchField.remove();
  }
};

export const startCopyButtons = (): void => {
  document.querySelectorAll<HTMLElement>('[data-copy-install]').forEach((copyButton) => {
    const label = copyButton.querySelector<HTMLElement>('.copy-label');
    copyButton.addEventListener('click', () => {
      void copyWithFallback(INSTALL_COMMAND).then(() => {
        if (label === null) return;
        const originalText = label.textContent;
        label.textContent = 'Copied';
        window.setTimeout(() => {
          label.textContent = originalText;
        }, COPIED_LABEL_MS);
      });
    });
  });
};

export const startThemeToggle = (): void => {
  document.querySelectorAll<HTMLElement>('[data-theme-toggle]').forEach((themeButton) => {
    themeButton.addEventListener('click', () => {
      const root = document.documentElement;
      const nextTheme = textWhen(root.getAttribute('data-theme') === 'light', 'dark', 'light');
      root.setAttribute('data-theme', nextTheme);
    });
  });
};
