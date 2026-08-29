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
} from "./credential-vault.js";

type VaultOperation = "read" | "write" | "delete";

export interface CredentialVaultOperationRecord {
  operation: VaultOperation;
  profileId: ModelProfileId;
}

export interface FakeCredentialVaultOptions {
  now?: () => Date;
}

export class FakeCredentialVault implements CredentialVault {
  readonly #entries = new Map<ModelProfileId, CredentialEnvelope>();
  readonly #records: CredentialVaultOperationRecord[] = [];
  readonly #failures: VaultOperation[] = [];
  readonly #now: () => Date;

  constructor(options: FakeCredentialVaultOptions = {}) {
    this.#now = options.now ?? (() => new Date());
  }

  failNext(operation: VaultOperation): void {
    this.#failures.push(operation);
  }

  operations(): readonly CredentialVaultOperationRecord[] {
    return this.#records.map((record) => ({ ...record }));
  }

  get(rawProfileId: ModelProfileId): string | undefined {
    const profileId = modelProfileIdSchema.parse(rawProfileId);
    this.#record("read", profileId);
    return this.#entries.get(profileId)?.secret;
  }

  status(rawProfileId: ModelProfileId): ModelCredentialStatus {
    const profileId = modelProfileIdSchema.parse(rawProfileId);
    this.#record("read", profileId);
    return credentialStatus(profileId, this.#entries.get(profileId));
  }

  listStatus(): readonly ModelCredentialStatus[] {
    return MODEL_PROFILE_IDS.map((profileId) => this.status(profileId));
  }

  set(rawProfileId: ModelProfileId, rawSecret: string): void {
    const profileId = modelProfileIdSchema.parse(rawProfileId);
    const { secret } = modelCredentialSetRequestSchema.parse({ secret: rawSecret });
    this.#record("write", profileId);
    this.#entries.set(profileId, {
      schemaVersion: 1,
      secret,
      updatedAt: this.#now().toISOString(),
    });
  }

  delete(rawProfileId: ModelProfileId): boolean {
    const profileId = modelProfileIdSchema.parse(rawProfileId);
    this.#record("delete", profileId);
    return this.#entries.delete(profileId);
  }

  #record(operation: VaultOperation, profileId: ModelProfileId): void {
    this.#records.push({ operation, profileId });
    const failureIndex = this.#failures.indexOf(operation);
    if (failureIndex < 0) return;
    this.#failures.splice(failureIndex, 1);
    const code =
      operation === "read"
        ? "CREDENTIAL_READ_FAILED"
        : operation === "write"
          ? "CREDENTIAL_WRITE_FAILED"
          : "CREDENTIAL_DELETE_FAILED";
    throw new CredentialVaultError(code);
  }
}
