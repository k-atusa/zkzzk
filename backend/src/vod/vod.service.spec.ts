import { Test, TestingModule } from '@nestjs/testing';
import { VodService } from './vod.service';

describe('VodService', () => {
  let service: VodService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [VodService],
    }).compile();

    service = module.get<VodService>(VodService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
