export const hasMessage = (failure: unknown): failure is Readonly<{ message: string }> =>
  typeof failure === 'object' &&
  failure !== null &&
  'message' in failure &&
  typeof failure.message === 'string';

export const errorMessage = (error: unknown): string => {
  if (hasMessage(error)) return error.message;
  return String(error);
};
