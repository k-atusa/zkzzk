import { Module } from '@nestjs/common';
import { VodController } from './vod.controller';
import { VodService } from './vod.service';

import { EventsModule } from '../events/events.module';

@Module({
  imports: [EventsModule],
  controllers: [VodController],
  providers: [VodService]
})
export class VodModule {}
