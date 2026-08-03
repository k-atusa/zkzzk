import { Test, TestingModule } from '@nestjs/testing';
import { StreamersController } from './streamers.controller';
import { StreamersService } from './streamers.service';

describe('StreamersController', () => {
  let controller: StreamersController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StreamersController],
      providers: [
        { provide: StreamersService, useValue: {} },
      ],
    }).compile();

    controller = module.get<StreamersController>(StreamersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
