// Filesystem abstraction. Dynamically loads node:fs/promises so the
// browser bundle stays clean. When fs is null, callers must fall back
// to streaming APIs.

type FsPromisesModule = typeof import('node:fs/promises');

let fsPromise: Promise<FsPromisesModule | null> | null = null;

export async function getFs(): Promise<FsPromisesModule | null> {
  if (!fsPromise) {
    fsPromise = (async () => {
      try {
        return await import('node:fs/promises');
      } catch {
        return null;
      }
    })();
  }
  return fsPromise;
}

export async function hasFs(): Promise<boolean> {
  return (await getFs()) !== null;
}

export async function ensureDir(dirPath: string): Promise<void> {
  const fs = await getFs();
  if (!fs) throw new Error('Filesystem unavailable in this runtime');
  await fs.mkdir(dirPath, { recursive: true });
}

export async function fileExists(filePath: string): Promise<boolean> {
  const fs = await getFs();
  if (!fs) return false;
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function writeBytes(filePath: string, data: Uint8Array): Promise<void> {
  const fs = await getFs();
  if (!fs) throw new Error('Filesystem unavailable in this runtime');
  await fs.writeFile(filePath, data);
}

export async function appendBytes(filePath: string, data: Uint8Array): Promise<void> {
  const fs = await getFs();
  if (!fs) throw new Error('Filesystem unavailable in this runtime');
  await fs.appendFile(filePath, data);
}

export async function writeText(filePath: string, text: string): Promise<void> {
  const fs = await getFs();
  if (!fs) throw new Error('Filesystem unavailable in this runtime');
  await fs.writeFile(filePath, text, 'utf-8');
}
