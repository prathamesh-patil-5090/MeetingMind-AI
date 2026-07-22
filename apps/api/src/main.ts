import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DEFAULT_API_PORT } from '@meetingmind/shared';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: true,
    credentials: true,
  });
  app.setGlobalPrefix('api');

  const port = Number(process.env.PORT ?? DEFAULT_API_PORT);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`MeetingMind API listening on http://127.0.0.1:${port}`);
}

void bootstrap();
