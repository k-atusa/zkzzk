import { Module } from '@nestjs/common';
import { YoutubeService } from './youtube.service';
import { YoutubeController } from './youtube.controller';

@Module({
  providers: [YoutubeService],
  controllers: [YoutubeController],
  exports: [YoutubeService]
})
export class YoutubeModule {}
