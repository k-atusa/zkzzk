import { Test, TestingModule } from '@nestjs/testing';
import { StreamersController } from './streamers.controller';

describe('StreamersController', () => {
  let controller: StreamersController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StreamersController],
    }).compile();

    controller = module.get<StreamersController>(StreamersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
