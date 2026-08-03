import { Test, TestingModule } from '@nestjs/testing';
import { RecordingsService } from './recordings.service';
import { PrismaService } from '../prisma/prisma.service';

describe('RecordingsService', () => {
  let service: RecordingsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecordingsService,
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();

    service = module.get<RecordingsService>(RecordingsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
