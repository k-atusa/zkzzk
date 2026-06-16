import { Module } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { YoutubeModule } from '../youtube/youtube.module';

@Module({
  imports: [YoutubeModule],
  providers: [TasksService],
  exports: [TasksService]
})
export class TasksModule {}
