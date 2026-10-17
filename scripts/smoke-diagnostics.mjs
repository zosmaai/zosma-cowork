export function healthTimeoutMessage(url, output = "") {
  const diagnostics = output.trim();
  return diagnostics
    ? `health timeout: ${url}\nchild output:\n${diagnostics}`
    : `health timeout: ${url}`;
}
