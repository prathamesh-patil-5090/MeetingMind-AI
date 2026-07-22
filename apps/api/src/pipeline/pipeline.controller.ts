import { Controller, Get, Param } from '@nestjs/common';
import { PipelineService } from './pipeline.service';

@Controller('pipeline')
export class PipelineController {
  constructor(private readonly pipeline: PipelineService) {}

  @Get(':meetingId')
  status(@Param('meetingId') meetingId: string) {
    return this.pipeline.getStatus(meetingId);
  }
}
