// Docs: https://developer.apple.com/documentation/appstoreconnectapi/certificates
import type { CertificateResource } from '@core/types/appleCatalog.js';
import type { AppStoreConnectRequests } from '@/app-store-connect-api/api-client.js';
/**
 * Certificate type to create/reuse. `DISTRIBUTION` is Apple's modern unified "Apple Distribution"
 * identity, valid for App Store submission; its codesign identity is named `Apple Distribution`.
 */
const DISTRIBUTION_CERT_TYPE = 'DISTRIBUTION';
export const makeCertificatesApi = (api: AppStoreConnectRequests) => {
  /** List distribution certificates, newest expiry first, for reuse before creating a new one. */
  const listDistributionCertificates = async (): Promise<CertificateResource[]> => {
    const appleResources = await api.requestAll<{
      serialNumber: string;
      certificateContent: string;
      expirationDate?: string;
    }>(`/certificates?filter[certificateType]=${DISTRIBUTION_CERT_TYPE}&limit=200`);
    return appleResources.map((entry) => ({
      id: entry.id,
      serialNumber: entry.attributes.serialNumber,
      certificateContent: entry.attributes.certificateContent,
      expirationDate: entry.attributes.expirationDate,
    }));
  };
  /** Create a distribution certificate from a PEM certificate-signing request. */
  const createCertificate = async (csrContent: string): Promise<CertificateResource> => {
    const appleResources = await api.createResource<{
      serialNumber: string;
      certificateContent: string;
      expirationDate?: string;
    }>('/certificates', {
      type: 'certificates',
      attributes: { csrContent, certificateType: DISTRIBUTION_CERT_TYPE },
    });
    return {
      id: appleResources.id,
      serialNumber: appleResources.attributes.serialNumber,
      certificateContent: appleResources.attributes.certificateContent,
      expirationDate: appleResources.attributes.expirationDate,
    };
  };
  return {
    listDistributionCertificates,
    createCertificate,
  };
};
