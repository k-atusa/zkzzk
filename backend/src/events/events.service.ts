import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

export interface YoutubeUploadEvent {
  type: 'YOUTUBE_UPLOAD_COMPLETE';
  payload: {
    recordingId: string;
    video_id: string;
    isDeleted: boolean; // Indicates if the video was deleted after upload based on settings
  };
}

@Injectable()
export class EventsService {
  private youtubeUploadSubject = new Subject<YoutubeUploadEvent>();

  emitYoutubeUploadComplete(data: YoutubeUploadEvent['payload']) {
    this.youtubeUploadSubject.next({ type: 'YOUTUBE_UPLOAD_COMPLETE', payload: data });
  }

  getYoutubeUploadStream() {
    return this.youtubeUploadSubject.asObservable();
  }
}
