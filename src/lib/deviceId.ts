const DEVICE_ID_KEY = "lifeHubDeviceId";

/** Stable per-browser identifier used to tag rows written by this device and
 * to recognize (and skip) Realtime echoes of this device's own writes. */
export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}
