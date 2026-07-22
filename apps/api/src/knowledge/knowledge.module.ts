import { Module } from '@nestjs/common';
import { SearchModule } from '../search/search.module';
import { KnowledgeAskService } from './knowledge-ask.service';
import { KnowledgeController } from './knowledge.controller';

@Module({
  imports: [SearchModule],
  controllers: [KnowledgeController],
  providers: [KnowledgeAskService],
})
export class KnowledgeModule {}
