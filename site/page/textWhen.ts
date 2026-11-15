export const textWhen = (condition: boolean, whenTrue: string, whenFalse: string): string => {
  if (condition) return whenTrue;
  return whenFalse;
};
