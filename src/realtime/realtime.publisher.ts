import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';
import type { RealtimeEventName, RealtimeEventPayloadMap } from './realtime.types';

@Injectable()
export class RealtimePublisherService {
  private server: Server | null = null;

  bindServer(server: Server): void {
    this.server = server;
  }

  publishToCommunityRoom<EventName extends RealtimeEventName>(
    communityId: string,
    eventName: EventName,
    payload: RealtimeEventPayloadMap[EventName],
  ): void {
    this.server?.to(this.getCommunityRoomName(communityId)).emit(eventName, payload);
  }

  getCommunityRoomName(communityId: string): string {
    return `community:${communityId}`;
  }
}
