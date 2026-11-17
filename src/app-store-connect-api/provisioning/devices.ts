// Docs: https://developer.apple.com/documentation/appstoreconnectapi/devices
import type { DeviceResource } from '@core/types/appleCatalog.js';
import type { AppStoreConnectRequests } from '@/app-store-connect-api/api-client.js';
/** Platform value Apple expects when registering a device for ad-hoc distribution. */
const IOS_DEVICE_PLATFORM = 'IOS';
export const makeDevicesApi = (api: AppStoreConnectRequests) => {
  /**
   * List every registered device, across all pages. An ad-hoc profile must enumerate the devices it
   * covers, and a real team easily exceeds Apple's 200-per-page cap - so this folds the whole
   * collection via {@link requestAll} rather than reading one page (the silent-truncation trap).
   */
  const listDevices = async (): Promise<DeviceResource[]> => {
    const appleResources = await api.requestAll<{
      udid: string;
      name: string;
      status?: string;
    }>('/devices?limit=200');
    return appleResources.map((entry) => ({
      id: entry.id,
      udid: entry.attributes.udid,
      name: entry.attributes.name,
      status: entry.attributes.status,
    }));
  };
  /** Find a registered device by UDID (case-insensitive - Apple stores UDIDs lower-case), or null. */
  const findDeviceByUdid = async (udid: string): Promise<DeviceResource | null> => {
    const wanted = udid.toLowerCase();
    const matchingDevice = (await listDevices()).find(
      (device) => device.udid.toLowerCase() === wanted,
    );
    if (matchingDevice === undefined) return null;
    return matchingDevice;
  };
  /**
   * Register a device so ad-hoc builds can target it. Apple treats a known UDID idempotently (it
   * returns the existing entry rather than erroring), so callers can register-then-include safely.
   */
  const registerDevice = async (udid: string, name: string): Promise<DeviceResource> => {
    const appleResources = await api.createResource<{
      udid: string;
      name: string;
      status?: string;
    }>('/devices', {
      type: 'devices',
      attributes: { udid, name, platform: IOS_DEVICE_PLATFORM },
    });
    return {
      id: appleResources.id,
      udid: appleResources.attributes.udid,
      name: appleResources.attributes.name,
      status: appleResources.attributes.status,
    };
  };
  return {
    listDevices,
    findDeviceByUdid,
    registerDevice,
  };
};
