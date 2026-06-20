import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import * as path from 'path';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    let url = process.env.DATABASE_URL;
    let sqlitePath = path.resolve(process.cwd(), 'prisma', 'dev.db');
    
    if (url && url.startsWith('file:')) {
      const dbPath = url.replace(/^file:/, '');
      if (path.isAbsolute(dbPath)) {
        sqlitePath = dbPath;
      } else {
        sqlitePath = path.resolve(process.cwd(), 'prisma', dbPath);
      }
    }

    const adapter = new PrismaBetterSqlite3({ url: `file:${sqlitePath}` });

    super({
      adapter,
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
