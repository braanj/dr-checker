// Single entry point for DR checks: JSON `{ domains: "a.com, b.com\n..." }`
// for typed lookups (max 100) or multipart `file` for CSV uploads (max
// 1,000). Order matters: validate first (so typos don't burn rate-limit
// slots), then rate limit, then write. Processing is picked up by the
// process-queue edge function (statement trigger + cron, ADR 0002), not here.

import type { H3Event } from "h3";
import {
  buildCheckRows,
  CheckInputError,
  CSV_MAX,
  parseCsvUrls,
  parseDomainList,
  TYPED_MAX,
  type CheckSource,
} from "../utils/checkInput";
import { createCheck } from "../utils/createCheck";
import { assertRateLimit } from "../utils/rateLimit";

async function readInputs(
  event: H3Event,
): Promise<{ raw: string[]; label: string; source: CheckSource; max: number }> {
  const contentType = getRequestHeader(event, "content-type") ?? "";

  if (contentType.startsWith("multipart/form-data")) {
    const form = await readMultipartFormData(event);
    const filePart = form?.find((p) => p.name === "file");
    if (!filePart) {
      throw createError({ statusCode: 400, statusMessage: "Missing 'file' field" });
    }
    return {
      raw: parseCsvUrls(filePart.data.toString("utf-8")),
      label: filePart.filename ?? "upload.csv",
      source: "csv",
      max: CSV_MAX,
    };
  }

  const body = await readBody<{ domains?: unknown }>(event);
  if (typeof body?.domains !== "string") {
    throw createError({
      statusCode: 400,
      statusMessage: "Expected JSON { domains: string } or a multipart 'file' field",
    });
  }
  return { raw: parseDomainList(body.domains), label: "Quick check", source: "typed", max: TYPED_MAX };
}

export default defineEventHandler(async (event) => {
  const { raw, label, source, max } = await readInputs(event);

  let built: ReturnType<typeof buildCheckRows>;
  try {
    built = buildCheckRows(raw, max);
  } catch (e) {
    if (e instanceof CheckInputError) {
      throw createError({ statusCode: 400, statusMessage: e.message });
    }
    throw e;
  }

  await assertRateLimit(event);

  return createCheck({ ...built, label, source });
});
