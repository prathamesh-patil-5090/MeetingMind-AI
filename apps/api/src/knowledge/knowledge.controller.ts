import { Body, Controller, Post } from '@nestjs/common';
import { KnowledgeAskService } from './knowledge-ask.service';

@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly askService: KnowledgeAskService) {}

  @Post('ask')
  ask(
    @Body()
    body: {
      question?: string;
      history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    },
  ) {
    return this.askService.ask(body.question ?? '', body.history ?? []);
  }
}
