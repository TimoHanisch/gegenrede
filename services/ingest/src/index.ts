// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

export { RawFactCheck, type Connector } from "./connector.js";
export {
  dedupHash,
  factcheckId,
  normalizeRawFactCheck,
  type NormalizedFactCheck,
} from "./normalize.js";
export { ingestRawFactChecks, type IngestCounters } from "./ingest.js";
export {
  InMemoryFactcheckStore,
  type FactcheckRecord,
  type FactcheckStore,
  type UpsertOutcome,
} from "./store.js";
export {
  factchecks,
  type FactcheckInsert,
  type FactcheckRow,
} from "./db/schema.js";
export {
  DrizzleFactcheckStore,
  connectIngestDatabase,
  type IngestDatabase,
} from "./db/store.js";
export {
  CLAIMS_SEARCH_ENDPOINT,
  GOOGLE_FC_API_KEY_ENV,
  GoogleFactcheckConnector,
  maxAgeDaysSince,
  type GoogleClaim,
  type GoogleClaimsSearchPage,
  type GoogleFactcheckConnectorOptions,
} from "./connectors/google-factcheck.js";
export {
  EUVSDISINFO_DEFAULT_RATING,
  EUVSDISINFO_PUBLISHER,
  EuvsdisinfoConnector,
  type EuvsdisinfoClaim,
  type EuvsdisinfoConnectorOptions,
  type EuvsdisinfoHydraPage,
  type EuvsdisinfoReview,
} from "./connectors/euvsdisinfo.js";
export { loadSources, SourcesConfig, SOURCES_PATH } from "./sources.js";
