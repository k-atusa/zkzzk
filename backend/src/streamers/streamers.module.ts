import { Module } from '@nestjs/common';
import { StreamersController } from './streamers.controller';
import { StreamersService } from './streamers.service';

@Module({
  controllers: [StreamersController],
  providers: [StreamersService]
})
export class StreamersModule {}
