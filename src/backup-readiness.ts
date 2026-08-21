import { pathToFileURL } from 'node:url';

type JsonObject = Record<string, unknown>;

export type BackupReadinessReport = {
  schemaVersion: 1;
  checkedAt: string;
  projectRef: string;
  region?: string;
  requestMethod: 'GET';
  mutationRequests: 0;
  pitrEnabled: boolean;
  walgEnabled: boolean;
  completedBackups: number;
  latestRestorePointAt: string | null;
  latestRestorePointAgeHours: number | null;
  maximumAgeHours: number;
  recoverable: boolean;
  reason: string;
};

type BackupReadinessOptions = {
  projectRef: string;
  accessToken: string;
  maximumAgeHours?: number;
  fetchImpl?: typeof fetch;
  now?: Date;
};

function objectValue(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function validTimestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function physicalTimestamp(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const timestamp = value * 1000;
  return Number.isFinite(timestamp) ? timestamp : null;
}

function redacted(message: string, token: string): string {
  return token ? message.split(token).join('[redacted]') : message;
}

export async function verifySupabaseBackupReadiness(
  options: BackupReadinessOptions,
): Promise<BackupReadinessReport> {
  const projectRef = options.projectRef.trim();
  const accessToken = options.accessToken.trim();
  const maximumAgeHours = options.maximumAgeHours ?? 36;
  if (!/^[a-z0-9]{20}$/.test(projectRef)) throw new Error('A valid 20-character Supabase project ref is required');
  if (!accessToken) throw new Error('SUPABASE_ACCESS_TOKEN is required for read-only backup inspection');
  if (!Number.isFinite(maximumAgeHours) || maximumAgeHours <= 0 || maximumAgeHours > 168) {
    throw new Error('maximumAgeHours must be greater than zero and no more than 168');
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  let response: Response;
  try {
    response = await fetchImpl(
      `https://api.supabase.com/v1/projects/${projectRef}/database/backups`,
      {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${accessToken}`,
        },
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Supabase backup inspection failed';
    throw new Error(redacted(message, accessToken));
  }
  if (!response.ok) {
    throw new Error(`Supabase backup inspection returned HTTP ${response.status}`);
  }

  let body: JsonObject;
  try {
    const parsed = objectValue(await response.json());
    if (!parsed) throw new Error('response was not an object');
    body = parsed;
  } catch {
    throw new Error('Supabase backup inspection returned an invalid JSON contract');
  }

  const backups = Array.isArray(body.backups)
    ? body.backups.map(objectValue).filter((backup): backup is JsonObject => backup !== null)
    : [];
  const completed = backups.filter((backup) => String(backup.status ?? '').toUpperCase() === 'COMPLETED');
  const restorePointTimes = completed
    .map((backup) => validTimestamp(backup.inserted_at))
    .filter((timestamp): timestamp is number => timestamp !== null);
  const physical = objectValue(body.physical_backup_data);
  const latestPhysical = physicalTimestamp(physical?.latest_physical_backup_date_unix);
  if (latestPhysical !== null) restorePointTimes.push(latestPhysical);

  const latestTimestamp = restorePointTimes.length > 0 ? Math.max(...restorePointTimes) : null;
  const ageHours = latestTimestamp === null
    ? null
    : Math.max(0, (now.getTime() - latestTimestamp) / 3_600_000);
  const timestampPlausible = latestTimestamp === null || latestTimestamp <= now.getTime() + 5 * 60_000;
  const recoverable = ageHours !== null && timestampPlausible && ageHours <= maximumAgeHours;
  const latestRestorePointAt = latestTimestamp === null ? null : new Date(latestTimestamp).toISOString();
  const roundedAge = ageHours === null ? null : Math.round(ageHours * 100) / 100;
  const reason = recoverable
    ? `Latest hosted restore point is ${roundedAge} hours old, within the ${maximumAgeHours}-hour gate.`
    : latestTimestamp === null
      ? 'No completed hosted backup or physical restore point was returned.'
      : !timestampPlausible
        ? 'The latest hosted restore point is implausibly newer than the inspection clock.'
      : `Latest hosted restore point is ${roundedAge} hours old, beyond the ${maximumAgeHours}-hour gate.`;

  return {
    schemaVersion: 1,
    checkedAt: now.toISOString(),
    projectRef,
    ...(typeof body.region === 'string' ? { region: body.region } : {}),
    requestMethod: 'GET',
    mutationRequests: 0,
    pitrEnabled: body.pitr_enabled === true,
    walgEnabled: body.walg_enabled === true,
    completedBackups: completed.length,
    latestRestorePointAt,
    latestRestorePointAgeHours: roundedAge,
    maximumAgeHours,
    recoverable,
    reason,
  };
}

function valueArg(args: string[], prefix: string): string | undefined {
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const projectRef = valueArg(args, '--project-ref=') ?? process.env.SUPABASE_PROJECT_REF ?? '';
  const maximumAgeRaw = valueArg(args, '--maximum-age-hours=');
  const maximumAgeHours = maximumAgeRaw === undefined ? 36 : Number(maximumAgeRaw);
  const report = await verifySupabaseBackupReadiness({
    projectRef,
    accessToken: process.env.SUPABASE_ACCESS_TOKEN ?? '',
    maximumAgeHours,
  });
  console.log(JSON.stringify(report, null, 2));
  if (!report.recoverable) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Backup readiness inspection failed');
    process.exitCode = 1;
  });
}
