import { Test, TestingModule } from '@nestjs/testing';
import { RecordingsController } from './recordings.controller';
import { RecordingsService } from './recordings.service';

describe('RecordingsController', () => {
  let controller: RecordingsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RecordingsController],
      providers: [
        { provide: RecordingsService, useValue: {} },
      ],
    }).compile();

    controller = module.get<RecordingsController>(RecordingsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
