import { Controller, Sse } from '@nestjs/common';
import { EventsService } from './events.service';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Sse('youtube')
  youtubeEvents(): Observable<MessageEvent> {
    return this.eventsService.getYoutubeUploadStream().pipe(
      map((event) => {
        return {
          data: event,
        } as MessageEvent;
      }),
    );
  }

  @Sse('vod')
  vodEvents(): Observable<MessageEvent> {
    return this.eventsService.getVodProgressStream().pipe(
      map((event) => {
        return {
          data: event,
        } as MessageEvent;
      }),
    );
  }
}
