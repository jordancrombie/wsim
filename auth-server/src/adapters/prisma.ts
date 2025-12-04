import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Prisma Adapter for oidc-provider
 * Stores OIDC payloads (sessions, tokens, etc.) in PostgreSQL
 */
export class PrismaAdapter {
  private model: string;

  constructor(model: string) {
    this.model = model;
  }

  async upsert(id: string, payload: object, expiresIn: number): Promise<void> {
    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;

    await prisma.oidcPayload.upsert({
      where: { id: this.key(id) },
      update: {
        payload: JSON.stringify(payload),
        expiresAt,
        ...(this.getGrantId(payload) && { grantId: this.getGrantId(payload) }),
        ...(this.getUserCode(payload) && { userCode: this.getUserCode(payload) }),
        ...(this.getUid(payload) && { uid: this.getUid(payload) }),
      },
      create: {
        id: this.key(id),
        type: this.model,
        payload: JSON.stringify(payload),
        expiresAt,
        grantId: this.getGrantId(payload),
        userCode: this.getUserCode(payload),
        uid: this.getUid(payload),
      },
    });
  }

  async find(id: string): Promise<object | undefined> {
    const doc = await prisma.oidcPayload.findUnique({
      where: { id: this.key(id) },
    });

    if (!doc) return undefined;

    // Check expiration
    if (doc.expiresAt && doc.expiresAt < new Date()) {
      return undefined;
    }

    return JSON.parse(doc.payload);
  }

  async findByUserCode(userCode: string): Promise<object | undefined> {
    const doc = await prisma.oidcPayload.findFirst({
      where: {
        userCode,
        type: this.model,
      },
    });

    if (!doc) return undefined;
    if (doc.expiresAt && doc.expiresAt < new Date()) return undefined;

    return JSON.parse(doc.payload);
  }

  async findByUid(uid: string): Promise<object | undefined> {
    const doc = await prisma.oidcPayload.findFirst({
      where: {
        uid,
        type: this.model,
      },
    });

    if (!doc) return undefined;
    if (doc.expiresAt && doc.expiresAt < new Date()) return undefined;

    return JSON.parse(doc.payload);
  }

  async consume(id: string): Promise<void> {
    await prisma.oidcPayload.update({
      where: { id: this.key(id) },
      data: { consumedAt: new Date() },
    });
  }

  async destroy(id: string): Promise<void> {
    await prisma.oidcPayload.delete({
      where: { id: this.key(id) },
    }).catch(() => {
      // Ignore if not found
    });
  }

  async revokeByGrantId(grantId: string): Promise<void> {
    await prisma.oidcPayload.deleteMany({
      where: { grantId },
    });
  }

  private key(id: string): string {
    return `${this.model}:${id}`;
  }

  private getGrantId(payload: object): string | undefined {
    return (payload as { grantId?: string }).grantId;
  }

  private getUserCode(payload: object): string | undefined {
    return (payload as { userCode?: string }).userCode;
  }

  private getUid(payload: object): string | undefined {
    return (payload as { uid?: string }).uid;
  }
}

export { prisma };
