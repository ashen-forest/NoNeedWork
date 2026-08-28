import type Docker from "dockerode";

export const SANDBOX_IMAGE = "noneedwork/sandbox:0.1";
export const SANDBOX_WORKSPACE = "/workspace";

export interface SandboxLimits {
  cpuCount: number;
  memoryBytes: number;
  pids: number;
  workspaceBytes: number;
  stopTimeoutSeconds: number;
}

export const DEFAULT_SANDBOX_LIMITS: SandboxLimits = {
  cpuCount: 2,
  memoryBytes: 4 * 1024 * 1024 * 1024,
  pids: 256,
  workspaceBytes: 10 * 1024 * 1024 * 1024,
  stopTimeoutSeconds: 5,
};

export function createOfflineSandboxProfile(
  image = SANDBOX_IMAGE,
  limits: SandboxLimits = DEFAULT_SANDBOX_LIMITS,
): Docker.ContainerCreateOptions {
  return {
    Image: image,
    User: "10001:10001",
    WorkingDir: SANDBOX_WORKSPACE,
    Env: [],
    Cmd: ["sleep", "infinity"],
    NetworkDisabled: true,
    StopTimeout: limits.stopTimeoutSeconds,
    Labels: {
      "dev.noneedwork.managed": "true",
      "dev.noneedwork.profile": "offline-readonly-v1",
    },
    HostConfig: {
      AutoRemove: false,
      Binds: [],
      CapDrop: ["ALL"],
      NetworkMode: "none",
      ReadonlyRootfs: true,
      SecurityOpt: ["no-new-privileges:true"],
      NanoCpus: limits.cpuCount * 1_000_000_000,
      Memory: limits.memoryBytes,
      MemorySwap: limits.memoryBytes,
      PidsLimit: limits.pids,
      Tmpfs: {
        "/tmp": "rw,noexec,nosuid,nodev,size=67108864,mode=1777",
        [SANDBOX_WORKSPACE]: `rw,nosuid,nodev,size=${limits.workspaceBytes},uid=10001,gid=10001,mode=0750`,
      },
    },
  };
}
