import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { StreamersModule } from './streamers/streamers.module';
import { RecordingsModule } from './recordings/recordings.module';
import { TasksModule } from './tasks/tasks.module';
import { YoutubeModule } from './youtube/youtube.module';
import { EventsModule } from './events/events.module';
import { VodModule } from './vod/vod.module';

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'frontend', 'dist'),
      exclude: ['/api/(.*)'],
    }),
    AuthModule,
    PrismaModule,
    StreamersModule,
    RecordingsModule,
    TasksModule,
    YoutubeModule,
    EventsModule,
    VodModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
