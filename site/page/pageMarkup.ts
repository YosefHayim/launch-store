import {
  COMPARE_ROWS,
  FAQ_ITEMS,
  FEATURES,
  PIPELINE_STEPS,
  TERMINAL_LINES,
  HERO_CONFIG_LINES,
  type PipelineLane,
} from './pageContent.js';
import { escapeHtml, markupLineHtml, type MarkupLine } from './miniMarkup.js';
import { textWhen } from './textWhen.js';

const CHECK_ICON =
  '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-check"></use></svg>';

const iconHtml = (iconId: string, iconClass: string): string =>
  `<svg class="${iconClass}" aria-hidden="true"><use href="#${iconId}"></use></svg>`;

export const codeLinesHtml = (lines: readonly MarkupLine[]): string =>
  lines.map((line) => `<div class="cl">${markupLineHtml(line)}</div>`).join('');

export const heroTerminalHtml = (): string => {
  const replayLines = TERMINAL_LINES.map(
    (terminalLine) =>
      `<div class="ln"><div class="cl">${markupLineHtml(terminalLine.line)}</div></div>`,
  ).join('');
  return `${replayLines}<span class="cursor"></span>`;
};

export const heroConfigHtml = (): string => codeLinesHtml(HERO_CONFIG_LINES);

const laneHtml = (lane: PipelineLane): string => {
  const laneClass = textWhen(lane.isPlatform, 'lane os', 'lane');
  const laneIcon = textWhen(lane.iconId === '', '', iconHtml(lane.iconId, 'b'));
  return `<span class="${laneClass}">${laneIcon}${escapeHtml(lane.label)}</span>`;
};

export const pipelineNodesHtml = (): string =>
  PIPELINE_STEPS.map((step, stepIndex) => {
    const isFirst = stepIndex === 0;
    const isLast = stepIndex === PIPELINE_STEPS.length - 1;
    const nodeClass = ['pnode', textWhen(isFirst, 'first', ''), textWhen(isLast, 'live', '')]
      .filter((className) => className !== '')
      .join(' ');
    return `<div class="${nodeClass}" data-step="${stepIndex}">
        <span class="wire"></span><span class="packet"></span>
        <button type="button" class="pbtn" data-pick-step="${stepIndex}" aria-label="Show the ${step.title} step"><span class="pdot">${iconHtml(step.iconId, 'i')}</span><span class="pname">${step.title}</span></button>
        <div class="lanes">${step.lanes.map(laneHtml).join('')}</div>
      </div>`;
  }).join('\n');

export const featureTabsHtml = (selectedIndex: number): string =>
  FEATURES.map((feature, featureIndex) => {
    const isSelected = featureIndex === selectedIndex;
    return `<button type="button" role="tab" data-feature="${featureIndex}" aria-selected="${String(isSelected)}">${escapeHtml(feature.tab)}</button>`;
  }).join('');

export const featureCopyHtml = (featureIndex: number): string => {
  const feature = FEATURES[featureIndex];
  if (feature === undefined) return '';
  const pointItems = feature.points
    .map((point) => `<li>${CHECK_ICON}<span>${escapeHtml(point)}</span></li>`)
    .join('');
  return `<h3>${escapeHtml(feature.title)}</h3><p>${escapeHtml(feature.body)}</p><ul>${pointItems}</ul>`;
};

export const featureDemoHtml = (featureIndex: number): string => {
  const feature = FEATURES[featureIndex];
  if (feature === undefined) return '';
  return `<div class="code">${codeLinesHtml(feature.lines)}</div>`;
};

export const compareRowsHtml = (): string =>
  COMPARE_ROWS.map(
    (row) =>
      `<div class="cmp-row"><div class="cmp-label">${escapeHtml(row.label)}</div><div class="cmp-eas">${escapeHtml(row.eas)}</div><div class="cmp-launch">${escapeHtml(row.launch)}</div></div>`,
  ).join('\n');

export const faqItemsHtml = (openIndex: number): string =>
  FAQ_ITEMS.map((item, itemIndex) => {
    const isOpen = itemIndex === openIndex;
    const hiddenAttribute = textWhen(isOpen, '', ' hidden');
    return `<div class="qa" data-open="${String(isOpen)}">
        <button type="button" data-faq="${itemIndex}" aria-expanded="${String(isOpen)}" aria-controls="faq-answer-${itemIndex}">${escapeHtml(item.question)}${iconHtml('i-plus', 'i')}</button>
        <p class="ans" id="faq-answer-${itemIndex}"${hiddenAttribute}>${escapeHtml(item.answer)}</p>
      </div>`;
  }).join('\n');
