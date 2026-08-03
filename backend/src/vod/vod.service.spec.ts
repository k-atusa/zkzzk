import { Test, TestingModule } from '@nestjs/testing';
import { VodService } from './vod.service';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';

describe('VodService', () => {
  let service: VodService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VodService,
        { provide: PrismaService, useValue: {} },
        { provide: EventsService, useValue: {} },
      ],
    }).compile();

    service = module.get<VodService>(VodService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
