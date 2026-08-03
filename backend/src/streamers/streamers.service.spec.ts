import { Test, TestingModule } from '@nestjs/testing';
import { StreamersService } from './streamers.service';
import { PrismaService } from '../prisma/prisma.service';
import { TasksService } from '../tasks/tasks.service';

describe('StreamersService', () => {
  let service: StreamersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StreamersService,
        { provide: PrismaService, useValue: {} },
        { provide: TasksService, useValue: {} },
      ],
    }).compile();

    service = module.get<StreamersService>(StreamersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
