import { Test, TestingModule } from '@nestjs/testing';
import { VodController } from './vod.controller';
import { VodService } from './vod.service';

describe('VodController', () => {
  let controller: VodController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [VodController],
      providers: [
        { provide: VodService, useValue: {} },
      ],
    }).compile();

    controller = module.get<VodController>(VodController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
