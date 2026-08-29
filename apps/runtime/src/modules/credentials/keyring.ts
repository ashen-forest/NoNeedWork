import { Entry } from "@napi-rs/keyring";
import {
  MODEL_PROFILE_IDS,
  type ModelCredentialStatus,
  type ModelProfileId,
  modelCredentialSetRequestSchema,
  modelProfileIdSchema,
} from "@noneedwork/protocol";

import {
  type CredentialEnvelope,
  type CredentialVault,
  CredentialVaultError,
  credentialStatus,
  decodeCredentialEnvelope,
  encodeCredentialEnvelope,
} from "./credential-vault.js";
import { MODEL_CREDENTIAL_SERVICE, modelCredentialAccount } from "./model-credentials.js";

export interface KeyringEntry {
  setPassword(password: string): void;
  getPassword(): string | null;
  deletePassword(): boolean;
}

export type EntryFactory = (service: string, account: string) => KeyringEntry;

export interface KeyringCredentialVaultOptions {
  entryFactory?: EntryFactory;
  now?: () => Date;
}

function isMissingEntryError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "NoEntry"
  );
}

export class KeyringCredentialVault implements CredentialVault {
  readonly #entryFactory: EntryFactory;
  readonly #entries = new Map<ModelProfileId, KeyringEntry>();
  readonly #now: () => Date;

  constructor(options: KeyringCredentialVaultOptions = {}) {
    this.#entryFactory =
      options.entryFactory ?? ((service, account) => new Entry(service, account));
    this.#now = options.now ?? (() => new Date());
  }

  get(rawProfileId: ModelProfileId): string | undefined {
    return this.#readEnvelope(rawProfileId)?.secret;
  }

  status(rawProfileId: ModelProfileId): ModelCredentialStatus {
    const profileId = modelProfileIdSchema.parse(rawProfileId);
    return credentialStatus(profileId, this.#readEnvelope(profileId));
  }

  listStatus(): readonly ModelCredentialStatus[] {
    return MODEL_PROFILE_IDS.map((profileId) => this.status(profileId));
  }

  set(rawProfileId: ModelProfileId, rawSecret: string): void {
    const profileId = modelProfileIdSchema.parse(rawProfileId);
    const { secret } = modelCredentialSetRequestSchema.parse({ secret: rawSecret });
    try {
      this.#entry(profileId).setPassword(encodeCredentialEnvelope(secret, this.#now()));
    } catch {
      throw new CredentialVaultError("CREDENTIAL_WRITE_FAILED");
    }
  }

  delete(rawProfileId: ModelProfileId): boolean {
    const profileId = modelProfileIdSchema.parse(rawProfileId);
    try {
      return this.#entry(profileId).deletePassword();
    } catch (error) {
      if (isMissingEntryError(error)) return false;
      throw new CredentialVaultError("CREDENTIAL_DELETE_FAILED");
    }
  }

  #readEnvelope(rawProfileId: ModelProfileId): CredentialEnvelope | undefined {
    const profileId = modelProfileIdSchema.parse(rawProfileId);
    let value: string | null;
    try {
      value = this.#entry(profileId).getPassword();
    } catch (error) {
      if (isMissingEntryError(error)) return undefined;
      throw new CredentialVaultError("CREDENTIAL_READ_FAILED");
    }
    if (value === null) return undefined;
    try {
      return decodeCredentialEnvelope(value);
    } catch {
      throw new CredentialVaultError("CREDENTIAL_CORRUPT");
    }
  }

  #entry(profileId: ModelProfileId): KeyringEntry {
    const existing = this.#entries.get(profileId);
    if (existing) return existing;
    const created = this.#entryFactory(MODEL_CREDENTIAL_SERVICE, modelCredentialAccount(profileId));
    this.#entries.set(profileId, created);
    return created;
  }
}
