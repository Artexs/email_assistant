export { deleteOrganization, type OrgDeleteResult } from "./delete";
export {
  addressRegex,
  DSR_ADDRESS_MAP,
  MESSAGE_TABLES,
  normalizeDsrAddress,
  NO_PERSONAL_TABLES,
  NOT_PERSONAL,
  type AddressRule,
} from "./address-map";
export { matchSubject, type DsrMatch } from "./dsr-match";
export { privacyRoutes, type PrivacyRouteDeps } from "./routes";
