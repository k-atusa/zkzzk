import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { StreamersModule } from './streamers/streamers.module';
import { RecordingsModule } from './recordings/recordings.module';
import { TasksModule } from './tasks/tasks.module';
import { VodModule } from './vod/vod.module';
import { YoutubeModule } from './youtube/youtube.module';
import { EventsModule } from './events/events.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    StreamersModule,
    RecordingsModule,
    TasksModule,
    VodModule,
    YoutubeModule,
    EventsModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
