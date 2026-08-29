import {
  modelCredentialSetRequestSchema,
  modelCredentialStatusListSchema,
  modelCredentialStatusSchema,
  modelProbeResultSchema,
  modelProfileIdSchema,
  modelProfileListSchema,
  modelSelectionSchema,
} from "@noneedwork/protocol";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { RuntimeServices } from "../services.js";

const profileParamsSchema = z.object({ profileId: modelProfileIdSchema }).strict();

export function registerModelRoutes(app: FastifyInstance, services: RuntimeServices): void {
  app.get("/v1/models/profiles", async () =>
    modelProfileListSchema.parse({ profiles: services.modelService.listProfiles() }),
  );

  app.get("/v1/models/selection", async () =>
    modelSelectionSchema.parse(services.modelService.getDefaultSelection()),
  );

  app.put("/v1/models/selection", async (request) => {
    const selection = modelSelectionSchema.parse(request.body);
    return modelSelectionSchema.parse(services.modelService.setDefaultSelection(selection));
  });

  app.get("/v1/models/credentials", async () =>
    modelCredentialStatusListSchema.parse({
      credentials: services.modelService.listCredentialStatus(),
    }),
  );

  app.put("/v1/models/credentials/:profileId", { logLevel: "silent" }, async (request) => {
    const { profileId } = profileParamsSchema.parse(request.params);
    const { secret } = modelCredentialSetRequestSchema.parse(request.body);
    return modelCredentialStatusSchema.parse(
      services.modelService.setCredential(profileId, secret),
    );
  });

  app.delete("/v1/models/credentials/:profileId", async (request) => {
    const { profileId } = profileParamsSchema.parse(request.params);
    return modelCredentialStatusSchema.parse(services.modelService.deleteCredential(profileId));
  });

  app.post("/v1/models/probe/:profileId", async (request) => {
    const { profileId } = profileParamsSchema.parse(request.params);
    return modelProbeResultSchema.parse(await services.modelService.probe(profileId));
  });
}
