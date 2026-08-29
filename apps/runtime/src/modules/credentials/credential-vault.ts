import {
  type ModelCredentialStatus,
  type ModelProfileId,
  modelCredentialSetRequestSchema,
  modelCredentialStatusSchema,
  modelProfileIdSchema,
} from "@noneedwork/protocol";
import { z } from "zod";

export const credentialEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    secret: modelCredentialSetRequestSchema.shape.secret,
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type CredentialEnvelope = z.infer<typeof credentialEnvelopeSchema>;

export type CredentialVaultErrorCode =
  | "CREDENTIAL_READ_FAILED"
  | "CREDENTIAL_WRITE_FAILED"
  | "CREDENTIAL_DELETE_FAILED"
  | "CREDENTIAL_CORRUPT";

const CREDENTIAL_ERROR_MESSAGES: Record<CredentialVaultErrorCode, string> = {
  CREDENTIAL_READ_FAILED: "Credential read failed",
  CREDENTIAL_WRITE_FAILED: "Credential write failed",
  CREDENTIAL_DELETE_FAILED: "Credential delete failed",
  CREDENTIAL_CORRUPT: "Stored credential is invalid",
};

export class CredentialVaultError extends Error {
  constructor(readonly code: CredentialVaultErrorCode) {
    super(CREDENTIAL_ERROR_MESSAGES[code]);
    this.name = "CredentialVaultError";
  }
}

export interface CredentialVault {
  get(profileId: ModelProfileId): string | undefined;
  status(profileId: ModelProfileId): ModelCredentialStatus;
  listStatus(): readonly ModelCredentialStatus[];
  set(profileId: ModelProfileId, secret: string): void;
  delete(profileId: ModelProfileId): boolean;
}

export function encodeCredentialEnvelope(secret: string, now: Date = new Date()): string {
  return JSON.stringify(
    credentialEnvelopeSchema.parse({
      schemaVersion: 1,
      secret,
      updatedAt: now.toISOString(),
    }),
  );
}

export function decodeCredentialEnvelope(value: string): CredentialEnvelope {
  return credentialEnvelopeSchema.parse(JSON.parse(value));
}

export function credentialStatus(
  rawProfileId: ModelProfileId,
  envelope: CredentialEnvelope | undefined,
): ModelCredentialStatus {
  const profileId = modelProfileIdSchema.parse(rawProfileId);
  return modelCredentialStatusSchema.parse({
    profileId,
    configured: envelope !== undefined,
    updatedAt: envelope?.updatedAt ?? null,
  });
}
