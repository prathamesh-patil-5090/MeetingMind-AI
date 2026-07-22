export interface PipelineWorker {
  readonly stage: string;
  run(meetingId: string): Promise<void>;
}
