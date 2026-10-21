import { z } from "zod";
import type { UsageBucket } from "../shared/types";

export const tokenUsageSchema = z.object({
  totalTokens: z.number().nonnegative(),
  inputTokens: z.number().nonnegative(),
  cachedInputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  reasoningOutputTokens: z.number().nonnegative(),
});
const windowSchema = z.object({
  usedPercent: z.number(),
  windowDurationMins: z.number().nullable().optional(),
  resetsAt: z.number().nullable().optional(),
});
const bucketSchema = z.object({
  limitId: z.string().nullable().optional(),
  limitName: z.string().nullable().optional(),
  primary: windowSchema.nullable().optional(),
  secondary: windowSchema.nullable().optional(),
});
const limitsSchema = z.object({
  rateLimits: bucketSchema.nullable().optional(),
  rateLimitsByLimitId: z.record(z.string(), bucketSchema).nullable().optional(),
});
export function parseLimits(value: unknown): UsageBucket[] {
  const parsed = limitsSchema.parse(value);
  const buckets =
    parsed.rateLimitsByLimitId && Object.keys(parsed.rateLimitsByLimitId).length
      ? Object.entries(parsed.rateLimitsByLimitId)
      : parsed.rateLimits
        ? [[parsed.rateLimits.limitId ?? "codex", parsed.rateLimits] as const]
        : [];
  return buckets.map(([id, bucket]) => ({
    id,
    name: bucket.limitName ?? id,
    primary: bucket.primary
      ? {
          ...bucket.primary,
          windowDurationMins: bucket.primary.windowDurationMins ?? null,
          resetsAt: bucket.primary.resetsAt ?? null,
        }
      : null,
    secondary: bucket.secondary
      ? {
          ...bucket.secondary,
          windowDurationMins: bucket.secondary.windowDurationMins ?? null,
          resetsAt: bucket.secondary.resetsAt ?? null,
        }
      : null,
  }));
}
