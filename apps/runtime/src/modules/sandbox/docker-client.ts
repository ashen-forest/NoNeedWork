import Docker from "dockerode";

export type DockerClient = Docker;

export function createDockerClient(options?: Docker.DockerOptions): DockerClient {
  return new Docker(options);
}

export interface DockerHealth {
  available: boolean;
  serverVersion?: string;
  operatingSystem?: string;
  error?: string;
}

export async function inspectDockerHealth(docker: DockerClient): Promise<DockerHealth> {
  try {
    await docker.ping();
    const info = await docker.info();
    return {
      available: true,
      ...(info.ServerVersion ? { serverVersion: info.ServerVersion } : {}),
      ...(info.OperatingSystem ? { operatingSystem: info.OperatingSystem } : {}),
    };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
