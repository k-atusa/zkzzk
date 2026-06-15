import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as path from 'path';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    let url = process.env.DATABASE_URL;
    if (url && url.startsWith('file:')) {
      const dbPath = url.replace(/^file:/, '');
      if (!path.isAbsolute(dbPath)) {
        const absoluteDbPath = path.resolve(process.cwd(), 'prisma', dbPath);
        url = `file:${absoluteDbPath}`;
      }
    }

    super({
      datasources: {
        db: {
          url: url,
        },
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
