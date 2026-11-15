// Dev only: a loopback root never reaches a real or remote server. `origin` drops userinfo, path, query and hash.
// A trailing "/" is refused too: grammY throws on an apiRoot that ends with "/".
export function isLoopbackApiRoot(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
    url.origin === value
  );
}
