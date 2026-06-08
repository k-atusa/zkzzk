import { Test, TestingModule } from '@nestjs/testing';
import { RecordingsController } from './recordings.controller';

describe('RecordingsController', () => {
  let controller: RecordingsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RecordingsController],
    }).compile();

    controller = module.get<RecordingsController>(RecordingsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
