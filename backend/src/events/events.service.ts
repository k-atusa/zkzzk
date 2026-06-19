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

export interface VodProgressEvent {
  type: 'VOD_DOWNLOAD_PROGRESS';
  payload: {
    recordingId: string;
    progress: string;
  };
}

@Injectable()
export class EventsService {
  private youtubeUploadSubject = new Subject<YoutubeUploadEvent>();
  private vodProgressSubject = new Subject<VodProgressEvent>();

  emitYoutubeUploadComplete(data: YoutubeUploadEvent['payload']) {
    this.youtubeUploadSubject.next({ type: 'YOUTUBE_UPLOAD_COMPLETE', payload: data });
  }

  getYoutubeUploadStream() {
    return this.youtubeUploadSubject.asObservable();
  }

  emitVodProgress(data: VodProgressEvent['payload']) {
    this.vodProgressSubject.next({ type: 'VOD_DOWNLOAD_PROGRESS', payload: data });
  }

  getVodProgressStream() {
    return this.vodProgressSubject.asObservable();
  }
}
