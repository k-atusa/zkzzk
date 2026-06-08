import { Test, TestingModule } from '@nestjs/testing';
import { StreamersService } from './streamers.service';

describe('StreamersService', () => {
  let service: StreamersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StreamersService],
    }).compile();

    service = module.get<StreamersService>(StreamersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
