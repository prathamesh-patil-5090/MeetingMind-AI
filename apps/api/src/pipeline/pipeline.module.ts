import { Module } from '@nestjs/common';
import { PipelineController } from './pipeline.controller';
import { PipelineService } from './pipeline.service';
import { AudioExtractionWorker } from './workers/audio-extraction.worker';
import { TranscriptionWorker } from './workers/transcription.worker';
import { DiarizationWorker } from './workers/diarization.worker';
import { OcrWorker } from './workers/ocr.worker';
import { VisionWorker } from './workers/vision.worker';
import { TimelineWorker } from './workers/timeline.worker';
import { SummaryWorker } from './workers/summary.worker';
import { ActionItemsWorker } from './workers/action-items.worker';
import {
  DecisionsWorker,
  QuestionsWorker,
  RisksWorker,
} from './workers/phase2-extract.workers';
import { EmbeddingsWorker } from './workers/embeddings.worker';
import { StorageFinalizeWorker } from './workers/storage-finalize.worker';

@Module({
  controllers: [PipelineController],
  providers: [
    PipelineService,
    AudioExtractionWorker,
    TranscriptionWorker,
    DiarizationWorker,
    OcrWorker,
    VisionWorker,
    TimelineWorker,
    SummaryWorker,
    ActionItemsWorker,
    DecisionsWorker,
    RisksWorker,
    QuestionsWorker,
    EmbeddingsWorker,
    StorageFinalizeWorker,
  ],
  exports: [PipelineService],
})
export class PipelineModule {}
