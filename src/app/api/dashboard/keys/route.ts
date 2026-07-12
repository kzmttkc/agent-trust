import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createApiKey,
  ensureOwnerUserId,
  getApiKeyById,
  listApiKeysForOwner,
} from "@/lib/db/api-keys";
import { authorizeDashboardRequest } from "@/lib/dashboard/auth";

export async function GET(request: NextRequest) {
  const auth = await authorizeDashboardRequest(request);
  if (!auth.ok) return auth.error;

  const keys = await listApiKeysForOwner(auth.ctx.apiKeyId);
  const current = await getApiKeyById(auth.ctx.apiKeyId);

  return NextResponse.json({
    keys,
    currentKeyId: auth.ctx.apiKeyId,
    key: current
      ? {
          id: current.id,
          name: current.name,
          plan: current.plan,
          createdAt: current.createdAt,
          lastUsedAt: current.lastUsedAt,
          revokedAt: current.revokedAt,
        }
      : null,
  });
}

const createSchema = z.object({
  name: z.string().min(1).max(100).optional(),
});

export async function POST(request: NextRequest) {
  const auth = await authorizeDashboardRequest(request);
  if (!auth.ok) return auth.error;

  const body = await request.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const userId = await ensureOwnerUserId(auth.ctx.apiKeyId);
  const current = await getApiKeyById(auth.ctx.apiKeyId);

  try {
    const created = await createApiKey({
      name: parsed.data.name ?? "Dashboard created",
      plan: current?.plan ?? auth.ctx.plan,
      userId,
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "key_limit_reached") {
      return NextResponse.json({ error: "key_limit_reached" }, { status: 400 });
    }
    throw error;
  }
}
