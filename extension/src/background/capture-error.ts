export function captureFailureCode(error: unknown): 'E-CAPTURE-PERMISSION' | 'E-CAPTURE-UNAVAILABLE' {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Either the '<all_urls>' or 'activeTab' permission is required")
    ? 'E-CAPTURE-PERMISSION'
    : 'E-CAPTURE-UNAVAILABLE';
}
