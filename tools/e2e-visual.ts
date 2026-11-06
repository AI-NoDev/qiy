import packageJson from "@playwright/test/package.json" with { type: "json" };

const port = Number(process.env.QIY_VISUAL_PORT ?? 53333);
const container = `qiy-visual-${port}`;
const image = `mcr.microsoft.com/playwright:v${packageJson.version}-noble`;

// Docker publishes the port before run-server listens, so probe with HTTP.
async function serverReady(): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

async function run(command: string[], env?: Record<string, string>): Promise<number> {
  const child = Bun.spawn(command, { stdio: ["inherit", "inherit", "inherit"], env: { ...process.env, ...env } });
  return child.exited;
}

/**
 * Runs the pixel-level visual project against a Playwright browser inside the
 * pinned Docker image, so every host renders with the same Linux font stack.
 */
async function main(): Promise<void> {
  await run(["docker", "rm", "-f", container]).catch(() => 0);
  const started = await run(["docker", "run", "-d", "--rm", "--init", "--name", container, "-p", `127.0.0.1:${port}:${port}`, "--ipc=host", image,
    "/bin/sh", "-c", `cd /home/pwuser && npx -y playwright@${packageJson.version} run-server --port ${port} --host 0.0.0.0`]);
  if (started !== 0) throw new Error(`docker run ${image} failed; Docker is required for pixel visual regression`);
  try {
    const deadline = Date.now() + 180_000;
    while (!(await serverReady())) {
      if (Date.now() > deadline) throw new Error(`Playwright run-server did not listen on ${port}`);
      await Bun.sleep(1000);
    }
    process.exitCode = await run([process.execPath, "x", "playwright", "test", "-c", "playwright.generated.config.ts", "--project", "visual", ...process.argv.slice(2)], { QIY_VISUAL_WS: `ws://127.0.0.1:${port}/` });
  } finally {
    await run(["docker", "stop", container]);
  }
}

if (import.meta.main) await main();
