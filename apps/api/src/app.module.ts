import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiModule } from './ai/ai.module';
import { HealthController } from './health.controller';
import { MeetingsModule } from './meetings/meetings.module';
import { MediaModule } from './media/media.module';
import { PipelineModule } from './pipeline/pipeline.module';
import { PrismaModule } from './prisma/prisma.module';
import { SearchModule } from './search/search.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Root .env first so GROQ_API_KEY there wins over empty local placeholders.
      envFilePath: ['../../.env', '.env'],
    }),
    PrismaModule,
    StorageModule,
    MediaModule,
    AiModule,
    MeetingsModule,
    PipelineModule,
    SearchModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
