type MarkupSegment = Readonly<{ className: string; text: string }>;
export type MarkupLine = readonly MarkupSegment[];

export const escapeHtml = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

export const parseMarkupLine = (source: string): MarkupLine => {
  const segments: MarkupSegment[] = [];
  const segmentPattern = /\[(\w+)\]([\s\S]*?)\[\/\]/g;
  let readUpTo = 0;
  let match = segmentPattern.exec(source);
  while (match !== null) {
    if (match.index > readUpTo) {
      segments.push({ className: '', text: source.slice(readUpTo, match.index) });
    }
    segments.push({ className: match[1] as string, text: match[2] as string });
    readUpTo = segmentPattern.lastIndex;
    match = segmentPattern.exec(source);
  }
  if (readUpTo < source.length) segments.push({ className: '', text: source.slice(readUpTo) });
  if (segments.length === 0) segments.push({ className: '', text: ' ' });
  return segments;
};

export const parseMarkupBlock = (source: string): readonly MarkupLine[] =>
  source.split('\n').map(parseMarkupLine);

export const markupLineHtml = (line: MarkupLine): string =>
  line
    .map((segment) => `<span class="${segment.className}">${escapeHtml(segment.text)}</span>`)
    .join('');
