export const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const taggedMessage = error.message;
    if (typeof taggedMessage === 'string') return taggedMessage;
  }
  return String(error);
};
