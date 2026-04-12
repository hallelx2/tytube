// Tiny path helpers — avoid pulling in node:path so the browser bundle stays clean.

export function joinPath(...segments: string[]): string {
  const parts: string[] = [];
  for (const seg of segments) {
    if (!seg) continue;
    parts.push(seg.replace(/^[/\\]+|[/\\]+$/g, ''));
  }
  const joined = parts.filter((p) => p.length > 0).join('/');
  // Preserve leading slash if first segment had one.
  if (segments[0]?.startsWith('/') || segments[0]?.startsWith('\\')) {
    return '/' + joined;
  }
  return joined;
}

export function basename(p: string): string {
  const normalized = p.replace(/\\/g, '/');
  const i = normalized.lastIndexOf('/');
  return i === -1 ? normalized : normalized.slice(i + 1);
}

export function extname(p: string): string {
  const base = basename(p);
  const i = base.lastIndexOf('.');
  if (i <= 0) return '';
  return base.slice(i);
}

export function isAbsolute(p: string): boolean {
  if (!p) return false;
  if (p.startsWith('/')) return true;
  // Windows drive letter, e.g. C:\ or C:/
  if (/^[a-zA-Z]:[\\/]/.test(p)) return true;
  return false;
}

export async function resolveOutputDir(outputPath?: string): Promise<string> {
  const cwd = typeof process !== 'undefined' && process.cwd ? process.cwd() : '.';
  if (!outputPath) return cwd;
  if (isAbsolute(outputPath)) return outputPath;
  return joinPath(cwd, outputPath);
}
